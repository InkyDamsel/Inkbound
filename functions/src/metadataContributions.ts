import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const catalogAdminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(catalogAdminApp);
const ENFORCE_APP_CHECK = false;
const MAX_DAILY_CONTRIBUTIONS = 100;
const MIN_SUBMISSION_INTERVAL_MS = 3_000;

type ContributionStatus = 'pending' | 'approved' | 'rejected';
type ReviewDecision = ContributionStatus | 'promoted';
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
  asin?: string;
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
  const snapshot = await db.doc(`admins/${auth.uid}`).get();
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
  if (trimmed.length > maxLength) {
    throw new HttpsError('invalid-argument', 'One or more metadata fields are too long.');
  }
  return trimmed;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  const result = optionalString(value, maxLength);
  if (!result) throw new HttpsError('invalid-argument', `${field} is required.`);
  return result;
}

function normalizeIsbn(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9X]/gi, '').toUpperCase() : '';
}

function normalizeAsin(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
}

function normalizeIdentity(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';
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
  const total = value.slice(0, 12).split('').reduce(
    (sum, character, index) => sum + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (total % 10)) % 10 === Number(value[12]);
}

function validAsin(value: string): boolean {
  return /^[A-Z0-9]{10}$/.test(value);
}

function normalizeDate(value: unknown): string | undefined {
  const raw = optionalString(value, 32);
  if (!raw) return undefined;
  if (Number.isNaN(new Date(raw).getTime())) {
    throw new HttpsError('invalid-argument', 'Publication date is invalid.');
  }
  return raw;
}

function normalizeFields(value: unknown): CatalogFields {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const title = requiredString(input.title, 'Title', 300);
  const author = requiredString(input.author, 'Author', 300);
  const isbn10 = normalizeIsbn(input.isbn10) || undefined;
  const isbn13 = normalizeIsbn(input.isbn13) || undefined;
  const asin = normalizeAsin(input.asin) || undefined;

  if (isbn10 && !validIsbn10(isbn10)) throw new HttpsError('invalid-argument', 'ISBN-10 is invalid.');
  if (isbn13 && !validIsbn13(isbn13)) throw new HttpsError('invalid-argument', 'ISBN-13 is invalid.');
  if (asin && !validAsin(asin)) throw new HttpsError('invalid-argument', 'ASIN must be exactly 10 letters or numbers.');

  const publisher = optionalString(input.publisher, 200);
  const publicationDate = normalizeDate(input.publicationDate);
  const externalEditionId = optionalString(input.externalEditionId, 200);
  if (!isbn10 && !isbn13 && !asin && !externalEditionId && !(publisher && publicationDate)) {
    throw new HttpsError(
      'failed-precondition',
      'Add an ISBN, ASIN, edition identifier, or both publisher and publication date before contributing catalog metadata.',
    );
  }

  const pageCount = input.pageCount === undefined || input.pageCount === null || input.pageCount === ''
    ? undefined
    : Number(input.pageCount);
  if (pageCount !== undefined && (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100_000)) {
    throw new HttpsError('invalid-argument', 'Page count must be between 1 and 100,000.');
  }

  const seriesNumber = input.seriesNumber === undefined || input.seriesNumber === null || input.seriesNumber === ''
    ? undefined
    : Number(input.seriesNumber);
  if (seriesNumber !== undefined && (!Number.isFinite(seriesNumber) || seriesNumber < 0 || seriesNumber > 10_000)) {
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
    ...(asin ? { asin } : {}),
    ...(seriesName ? { seriesName } : {}),
    ...(seriesNumber !== undefined ? { seriesNumber } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publicationDate ? { publicationDate } : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(language ? { language } : {}),
    ...(format ? { format } : {}),
    ...(externalEditionId ? { externalEditionId } : {}),
  };
}

function catalogKey(fields: CatalogFields): string {
  if (fields.isbn13) return `isbn13:${fields.isbn13}`;
  if (fields.isbn10) return `isbn10:${fields.isbn10}`;
  if (fields.asin) return `asin:${fields.asin}`;
  if (fields.externalEditionId) return `edition:${normalizeIdentity(fields.externalEditionId)}`;
  return `work:${normalizeIdentity(fields.title)}::${normalizeIdentity(fields.author)}::${normalizeIdentity(fields.publisher)}::${fields.publicationDate ?? ''}`;
}

function trustedCatalogId(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function hashContributor(uid: string): string {
  return createHash('sha256').update(uid).digest('hex');
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function publicationYear(value?: string): number {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function rethrowContributionError(error: unknown, fallbackMessage: string): never {
  if (error instanceof HttpsError) throw error;
  console.error('Catalog contribution service failed.', error);
  throw new HttpsError('internal', fallbackMessage);
}

async function enforceRateLimit(uid: string) {
  const ref = db.doc(`metadataContributionRateLimits/${hashContributor(uid)}`);
  const today = new Date().toISOString().slice(0, 10);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    const count = data.dateKey === today && typeof data.count === 'number' ? data.count : 0;
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

function trustedRecordToGroup(id: string, record: Record<string, unknown>) {
  const fields = (
    record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
      ? record.fields
      : {}
  ) as Partial<CatalogFields>;
  if (!fields.title || !fields.author) return null;

  return {
    key: `inkbound-catalog:${id}`,
    title: fields.title,
    subtitle: fields.subtitle,
    authors: [fields.author],
    genres: [],
    editions: [{
      source: 'inkbound-catalog',
      externalEditionId: id,
      title: fields.title,
      subtitle: fields.subtitle,
      authors: [fields.author],
      genres: [],
      publisher: fields.publisher,
      publicationDate: fields.publicationDate,
      publicationYear: publicationYear(fields.publicationDate),
      language: fields.language,
      format: fields.format ?? 'ebook',
      isbn10: fields.isbn10,
      isbn13: fields.isbn13,
      asin: fields.asin,
      pageCount: fields.pageCount,
      editionName: 'Inkbound verified edition',
      specialFeatures: [],
    }],
  };
}

function titleSearchVariants(title: string): string[] {
  const withoutArticle = title.replace(/^(the|a|an)\s+/, '');
  const variants = new Set<string>([title, withoutArticle]);
  if (!/^(the|a|an)\s+/.test(title)) variants.add(`the ${title}`);
  return [...variants].filter(Boolean);
}

async function searchTrustedCatalog(data: Record<string, unknown>) {
  const isbn = normalizeIsbn(data.isbn);
  const asin = normalizeAsin(data.asin);
  const title = normalizeIdentity(data.title);
  const author = normalizeIdentity(data.author);
  const matches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  if (isbn.length === 13) {
    const snapshot = await db.collection('trustedCatalogEditions').where('isbn13', '==', isbn).limit(10).get();
    snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
  } else if (isbn.length === 10) {
    const snapshot = await db.collection('trustedCatalogEditions').where('isbn10', '==', isbn).limit(10).get();
    snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
  }

  if (matches.size === 0 && asin.length === 10) {
    const snapshot = await db.collection('trustedCatalogEditions').where('asin', '==', asin).limit(10).get();
    snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
  }

  if (matches.size === 0 && author && !title) {
    const snapshot = await db.collection('trustedCatalogEditions')
      .where('normalizedAuthor', '==', author)
      .limit(100)
      .get();
    snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
  }

  // Trusted titles are often longer than what a reader types (for example,
  // "The Black Oath: A Dark MM Bodyguard and Boss Mafia Romance"). Exact
  // equality made those records invisible unless the entire subtitle-style
  // title was entered. Prefix ranges preserve indexed Firestore lookup while
  // allowing natural searches such as "The Black Oath" or "Black Oath".
  if (matches.size === 0 && title) {
    for (const variant of titleSearchVariants(title)) {
      const snapshot = await db.collection('trustedCatalogEditions')
        .where('normalizedTitle', '>=', variant)
        .where('normalizedTitle', '<=', `${variant}\uf8ff`)
        .limit(25)
        .get();

      snapshot.docs.forEach((doc) => {
        const recordTitle = typeof doc.get('normalizedTitle') === 'string' ? String(doc.get('normalizedTitle')) : '';
        const recordAuthor = typeof doc.get('normalizedAuthor') === 'string' ? String(doc.get('normalizedAuthor')) : '';
        const normalizedRecordWithoutArticle = recordTitle.replace(/^(the|a|an)\s+/, '');
        const normalizedVariantWithoutArticle = variant.replace(/^(the|a|an)\s+/, '');
        const titleMatches = recordTitle.startsWith(variant)
          || normalizedRecordWithoutArticle.startsWith(normalizedVariantWithoutArticle);
        const authorMatches = !author
          || recordAuthor === author
          || recordAuthor.includes(author)
          || author.includes(recordAuthor);
        if (titleMatches && authorMatches) matches.set(doc.id, doc);
      });

      if (matches.size > 0) break;
    }
  }

  const groups = [...matches.values()]
    .filter((doc) => doc.get('active') !== false)
    .map((doc) => trustedRecordToGroup(doc.id, doc.data()))
    .filter(Boolean);
  return { groups, totalItems: groups.length };
}

export const submitMetadataContribution = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  try {
    const auth = requireAuthenticated(request);
    const data = request.data && typeof request.data === 'object'
      ? request.data as Record<string, unknown>
      : {};
    const sourceBookId = requiredString(data.sourceBookId, 'sourceBookId', 180);
    const fields = normalizeFields(data.fields);
    await enforceRateLimit(auth.uid);

    const key = catalogKey(fields);
    const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    const contributorHash = hashContributor(auth.uid);
    const contributionId = createHash('sha256')
      .update(`${contributorHash}|${key}|${fingerprint}`)
      .digest('hex');
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
      promotedCatalogId: null,
      promotedAt: null,
      promotedBy: null,
      promotedByEmail: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!existing.exists) contributionRecord.createdAt = FieldValue.serverTimestamp();

    await ref.set(contributionRecord, { merge: true });
    return { success: true, contributionId, status: 'pending' as const };
  } catch (error) {
    rethrowContributionError(error, 'Inkbound could not save this catalog contribution.');
  }
});

export const getMetadataContributions = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  try {
    const data = request.data && typeof request.data === 'object'
      ? request.data as Record<string, unknown>
      : {};

    if (data.action === 'searchTrustedCatalog') {
      requireAuthenticated(request);
      return await searchTrustedCatalog(data);
    }

    if (data.action === 'promotionStatuses') {
      await requireOwner(request);
      const ids = (Array.isArray(data.contributionIds) ? data.contributionIds : [])
        .filter((value): value is string => typeof value === 'string' && value.length <= 128)
        .slice(0, 100);
      const snapshots = await Promise.all(ids.map((id) => db.doc(`catalogContributions/${id}`).get()));
      const statuses: Record<string, { promoted: boolean; catalogId: string; promotedAt: string | null }> = {};
      snapshots.forEach((snapshot, index) => {
        const record = snapshot.data() ?? {};
        const catalogId = typeof record.promotedCatalogId === 'string' ? record.promotedCatalogId : '';
        statuses[ids[index]] = {
          promoted: Boolean(catalogId),
          catalogId,
          promotedAt: timestampToIso(record.promotedAt),
        };
      });
      return { statuses };
    }

    await requireOwner(request);
    const requestedStatus = typeof data.status === 'string' ? data.status : 'pending';
    const status: ContributionStatus = requestedStatus === 'approved' || requestedStatus === 'rejected'
      ? requestedStatus
      : 'pending';
    const snapshot = await db.collection('catalogContributions').where('status', '==', status).limit(100).get();
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
    rethrowContributionError(error, 'Inkbound could not load catalog metadata.');
  }
});

export const reviewMetadataContribution = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  try {
    const { auth, admin } = await requireOwner(request);
    const data = request.data && typeof request.data === 'object'
      ? request.data as Record<string, unknown>
      : {};
    const contributionId = requiredString(data.contributionId, 'contributionId', 128);
    const decision = data.decision as ReviewDecision | undefined;
    if (decision !== 'approved' && decision !== 'rejected' && decision !== 'promoted') {
      throw new HttpsError('invalid-argument', 'Choose approve, reject, or promote.');
    }

    const ref = db.doc(`catalogContributions/${contributionId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError('not-found', 'That catalog contribution no longer exists.');
    const previous = snapshot.data() ?? {};

    if (decision === 'promoted') {
      if (previous.status !== 'approved') {
        throw new HttpsError('failed-precondition', 'Only approved catalog contributions can be promoted.');
      }
      const key = requiredString(previous.catalogKey, 'catalogKey', 800);
      const fields = previous.fields as CatalogFields | undefined;
      if (!fields?.title || !fields?.author) {
        throw new HttpsError('failed-precondition', 'The approved contribution is missing required catalog fields.');
      }
      const catalogId = trustedCatalogId(key);
      await db.runTransaction(async (transaction) => {
        transaction.set(db.doc(`trustedCatalogEditions/${catalogId}`), {
          catalogKey: key,
          fields,
          normalizedTitle: normalizeIdentity(fields.title),
          normalizedAuthor: normalizeIdentity(fields.author),
          isbn10: normalizeIsbn(fields.isbn10) || null,
          isbn13: normalizeIsbn(fields.isbn13) || null,
          asin: normalizeAsin(fields.asin) || null,
          active: true,
          sourceContributionId: contributionId,
          promotedAt: FieldValue.serverTimestamp(),
          promotedBy: auth.uid,
          promotedByEmail: admin.email,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(ref, {
          promotedCatalogId: catalogId,
          promotedAt: FieldValue.serverTimestamp(),
          promotedBy: auth.uid,
          promotedByEmail: admin.email,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      await db.collection('adminAudit').add({
        action: 'promote_metadata_contribution',
        targetUserId: 'catalog',
        targetEmail: '',
        performedBy: auth.uid,
        performedByEmail: admin.email,
        reason: 'Approved metadata promoted to the Inkbound Trusted Catalog.',
        previousValue: { status: previous.status },
        newValue: { catalogId, contributionId },
        createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true, status: 'promoted' as const, catalogId };
    }

    const reviewNote = optionalString(data.reviewNote, 1000) ?? '';
    if (decision === 'rejected' && !reviewNote) {
      throw new HttpsError('invalid-argument', 'Add a review note before rejecting a contribution.');
    }

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
    rethrowContributionError(error, 'Inkbound could not update this catalog contribution.');
  }
});
