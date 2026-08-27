import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const MAX_DAILY_CONTRIBUTIONS = 100;
const MIN_SUBMISSION_INTERVAL_MS = 3_000;

type ContributionStatus = 'pending' | 'approved' | 'rejected';
type ReviewDecision = 'approved' | 'rejected';
type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

interface CatalogFields {
  title: string;
  subtitle?: string;
  author: string;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesNumber?: number;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  format?: string;
  externalEditionId?: string;
}

function requireAuthenticated(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  return request.auth;
}

async function requireOwner(request: CallableRequest<unknown>) {
  const auth = requireAuthenticated(request);
  const snapshot = await getFirestore().doc(`admins/${auth.uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled || record.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner access is required.');
  }
  return { auth, admin: record };
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new HttpsError('invalid-argument', 'One or more metadata fields are too long.');
  return trimmed;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  const result = optionalString(value, maxLength);
  if (!result) throw new HttpsError('invalid-argument', `${field} is required.`);
  return result;
}

function normalizeIsbn(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[^0-9X]/gi, '').toUpperCase();
  return normalized || undefined;
}

function validIsbn10(value: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(value)) return false;
  const total = value.split('').reduce((sum, character, index) => {
    const digit = character === 'X' ? 10 : Number(character);
    return sum + digit * (10 - index);
  }, 0);
  return total % 11 === 0;
}

function validIsbn13(value: string): boolean {
  if (!/^[0-9]{13}$/.test(value)) return false;
  const total = value.slice(0, 12).split('').reduce((sum, character, index) => sum + Number(character) * (index % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (total % 10)) % 10;
  return check === Number(value[12]);
}

function normalizeDate(value: unknown): string | undefined {
  const raw = optionalString(value, 32);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new HttpsError('invalid-argument', 'Publication date is invalid.');
  return raw;
}

function normalizeFields(value: unknown): CatalogFields {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const title = requiredString(input.title, 'Title', 300);
  const author = requiredString(input.author, 'Author', 300);
  const isbn10 = normalizeIsbn(input.isbn10);
  const isbn13 = normalizeIsbn(input.isbn13);
  if (isbn10 && !validIsbn10(isbn10)) throw new HttpsError('invalid-argument', 'ISBN-10 is invalid.');
  if (isbn13 && !validIsbn13(isbn13)) throw new HttpsError('invalid-argument', 'ISBN-13 is invalid.');

  const publisher = optionalString(input.publisher, 200);
  const publicationDate = normalizeDate(input.publicationDate);
  const externalEditionId = optionalString(input.externalEditionId, 200);
  if (!isbn10 && !isbn13 && !externalEditionId && !(publisher && publicationDate)) {
    throw new HttpsError('failed-precondition', 'Add an ISBN, an edition identifier, or both publisher and publication date before contributing catalog metadata.');
  }

  const pageCountValue = input.pageCount === undefined || input.pageCount === null || input.pageCount === '' ? undefined : Number(input.pageCount);
  if (pageCountValue !== undefined && (!Number.isInteger(pageCountValue) || pageCountValue < 1 || pageCountValue > 100_000)) {
    throw new HttpsError('invalid-argument', 'Page count must be between 1 and 100,000.');
  }
  const seriesNumberValue = input.seriesNumber === undefined || input.seriesNumber === null || input.seriesNumber === '' ? undefined : Number(input.seriesNumber);
  if (seriesNumberValue !== undefined && (!Number.isFinite(seriesNumberValue) || seriesNumberValue < 0 || seriesNumberValue > 10_000)) {
    throw new HttpsError('invalid-argument', 'Series number is invalid.');
  }

  const subtitle = optionalString(input.subtitle, 300);
  const seriesName = optionalString(input.seriesName, 200);
  const language = optionalString(input.language, 80);
  const format = optionalString(input.format, 80);

  return {
    title,
    author,
    ...(subtitle ? { subtitle } : {}),
    ...(isbn10 ? { isbn10 } : {}),
    ...(isbn13 ? { isbn13 } : {}),
    ...(seriesName ? { seriesName } : {}),
    ...(seriesNumberValue !== undefined ? { seriesNumber: seriesNumberValue } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publicationDate ? { publicationDate } : {}),
    ...(pageCountValue !== undefined ? { pageCount: pageCountValue } : {}),
    ...(language ? { language } : {}),
    ...(format ? { format } : {}),
    ...(externalEditionId ? { externalEditionId } : {}),
  };
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function catalogKey(fields: CatalogFields): string {
  if (fields.isbn13) return `isbn13:${fields.isbn13}`;
  if (fields.isbn10) return `isbn10:${fields.isbn10}`;
  if (fields.externalEditionId) return `edition:${normalizeIdentity(fields.externalEditionId)}`;
  return `work:${normalizeIdentity(fields.title)}::${normalizeIdentity(fields.author)}::${normalizeIdentity(fields.publisher ?? '')}::${fields.publicationDate ?? ''}`;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function hashContributor(uid: string): string {
  return createHash('sha256').update(uid).digest('hex');
}

function rethrowContributionError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  console.error('Catalog contribution service failed.', error);
  throw new HttpsError('internal', 'Inkbound could not save this catalog contribution. Please try again.');
}

async function enforceRateLimit(uid: string) {
  const db = getFirestore();
  const contributorHash = hashContributor(uid);
  const ref = db.doc(`metadataContributionRateLimits/${contributorHash}`);
  const today = new Date().toISOString().slice(0, 10);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    const dateKey = typeof data.dateKey === 'string' ? data.dateKey : '';
    const count = dateKey === today && typeof data.count === 'number' ? data.count : 0;
    const lastSubmittedAt = data.lastSubmittedAt instanceof Timestamp ? data.lastSubmittedAt.toMillis() : 0;
    if (now.toMillis() - lastSubmittedAt < MIN_SUBMISSION_INTERVAL_MS) {
      throw new HttpsError('resource-exhausted', 'Please wait a moment before submitting another catalog correction.');
    }
    if (count >= MAX_DAILY_CONTRIBUTIONS) {
      throw new HttpsError('resource-exhausted', 'Daily catalog contribution limit reached.');
    }
    transaction.set(ref, {
      dateKey: today,
      count: count + 1,
      lastSubmittedAt: now,
      updatedAt: now,
    }, { merge: true });
  });
}

export const submitMetadataContribution = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  try {
    const auth = requireAuthenticated(request);
    const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
    const sourceBookId = requiredString(data.sourceBookId, 'sourceBookId', 180);
    const fields = normalizeFields(data.fields);
    await enforceRateLimit(auth.uid);

    const key = catalogKey(fields);
    const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    const contributorHash = hashContributor(auth.uid);
    const contributionId = createHash('sha256').update(`${contributorHash}|${key}|${fingerprint}`).digest('hex');
    const db = getFirestore();
    const ref = db.doc(`catalogContributions/${contributionId}`);
    const existing = await ref.get();

    const contributionRecord: Record<string, unknown> = {
      catalogKey: key,
      fingerprint,
      fields,
      source: 'manual-reader',
      sourceBookId,
      contributorHash,
      status: 'pending' satisfies ContributionStatus,
      reviewedAt: null,
      reviewedBy: null,
      reviewedByEmail: null,
      reviewNote: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!existing.exists) contributionRecord.createdAt = FieldValue.serverTimestamp();

    await ref.set(contributionRecord, { merge: true });
    return { success: true, contributionId, status: 'pending' as const };
  } catch (error) {
    rethrowContributionError(error);
  }
});

export const getMetadataContributions = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  try {
    await requireOwner(request);
    const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
    const requestedStatus = typeof data.status === 'string' ? data.status : 'pending';
    const status: ContributionStatus = requestedStatus === 'approved' || requestedStatus === 'rejected' ? requestedStatus : 'pending';
    const snapshot = await getFirestore().collection('catalogContributions').where('status', '==', status).limit(100).get();
    const contributions = snapshot.docs.map((document) => {
      const record = document.data();
      return {
        id: document.id,
        catalogKey: typeof record.catalogKey === 'string' ? record.catalogKey : '',
        fields: record.fields ?? {},
        source: typeof record.source === 'string' ? record.source : 'manual-reader',
        status: record.status as ContributionStatus,
        contributorHash: typeof record.contributorHash === 'string' ? record.contributorHash.slice(0, 12) : '',
        createdAt: timestampToIso(record.createdAt),
        updatedAt: timestampToIso(record.updatedAt),
        reviewedAt: timestampToIso(record.reviewedAt),
        reviewedByEmail: typeof record.reviewedByEmail === 'string' ? record.reviewedByEmail : '',
        reviewNote: typeof record.reviewNote === 'string' ? record.reviewNote : '',
      };
    });
    contributions.sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''));
    return { status, contributions };
  } catch (error) {
    rethrowContributionError(error);
  }
});

export const reviewMetadataContribution = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  try {
    const { auth, admin } = await requireOwner(request);
    const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
    const contributionId = requiredString(data.contributionId, 'contributionId', 128);
    const decision = data.decision as ReviewDecision | undefined;
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new HttpsError('invalid-argument', 'Choose approve or reject.');
    }
    const reviewNote = optionalString(data.reviewNote, 1000) ?? '';
    if (decision === 'rejected' && !reviewNote) {
      throw new HttpsError('invalid-argument', 'Add a review note before rejecting a contribution.');
    }

    const db = getFirestore();
    const ref = db.doc(`catalogContributions/${contributionId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError('not-found', 'That catalog contribution no longer exists.');
    const previous = snapshot.data() ?? {};

    await ref.set({
      status: decision,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: auth.uid,
      reviewedByEmail: admin.email,
      reviewNote,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('adminAudit').add({
      action: decision === 'approved' ? 'approve_metadata_contribution' : 'reject_metadata_contribution',
      targetUserId: 'catalog',
      targetEmail: '',
      performedBy: auth.uid,
      performedByEmail: admin.email,
      reason: reviewNote || 'Approved for future catalog promotion.',
      previousValue: { status: previous.status ?? 'pending' },
      newValue: { status: decision, contributionId },
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, status: decision };
  } catch (error) {
    rethrowContributionError(error);
  }
});
