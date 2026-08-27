import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);
const ENFORCE_APP_CHECK = false;

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
  const snapshot = await db.doc(`admins/${auth.uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled || record.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner access is required.');
  }
  return { auth, admin: record };
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new HttpsError('invalid-argument', `${field} is invalid.`);
  return trimmed;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function normalizeIsbn(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9X]/gi, '').toUpperCase() : '';
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function trustedCatalogId(catalogKey: string): string {
  return createHash('sha256').update(catalogKey).digest('hex');
}

function publicationYear(value?: string): number {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function trustedRecordToGroup(id: string, record: Record<string, unknown>) {
  const fields = (record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
    ? record.fields
    : {}) as Partial<CatalogFields>;
  if (!fields.title || !fields.author) return null;

  return {
    key: `inkbound-catalog:${id}`,
    title: fields.title,
    subtitle: fields.subtitle,
    authors: [fields.author],
    genres: [],
    editions: [{
      source: 'inkbound-catalog' as const,
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
      pageCount: fields.pageCount,
      editionName: fields.externalEditionId ? `Inkbound verified edition ${fields.externalEditionId}` : 'Inkbound verified edition',
      specialFeatures: [],
    }],
  };
}

export const promoteMetadataContribution = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { auth, admin } = await requireOwner(request);
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
  const contributionId = requiredString(data.contributionId, 'contributionId', 128);
  const contributionRef = db.doc(`catalogContributions/${contributionId}`);
  const contributionSnapshot = await contributionRef.get();
  if (!contributionSnapshot.exists) throw new HttpsError('not-found', 'That catalog contribution no longer exists.');

  const contribution = contributionSnapshot.data() ?? {};
  if (contribution.status !== 'approved') {
    throw new HttpsError('failed-precondition', 'Only approved catalog contributions can be promoted.');
  }

  const catalogKey = requiredString(contribution.catalogKey, 'catalogKey', 800);
  const fields = contribution.fields as CatalogFields | undefined;
  if (!fields?.title || !fields?.author) {
    throw new HttpsError('failed-precondition', 'The approved contribution is missing required catalog fields.');
  }

  const catalogId = trustedCatalogId(catalogKey);
  const trustedRef = db.doc(`trustedCatalogEditions/${catalogId}`);
  const normalizedTitle = normalizeText(fields.title);
  const normalizedAuthor = normalizeText(fields.author);

  await db.runTransaction(async (transaction) => {
    transaction.set(trustedRef, {
      catalogKey,
      fields,
      normalizedTitle,
      normalizedAuthor,
      isbn10: normalizeIsbn(fields.isbn10) || null,
      isbn13: normalizeIsbn(fields.isbn13) || null,
      active: true,
      sourceContributionId: contributionId,
      promotedAt: FieldValue.serverTimestamp(),
      promotedBy: auth.uid,
      promotedByEmail: admin.email,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(contributionRef, {
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
    previousValue: { contributionId, status: contribution.status },
    newValue: { contributionId, catalogId, active: true },
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, catalogId };
});

export const getCatalogPromotionStatuses = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await requireOwner(request);
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
  const rawIds = Array.isArray(data.contributionIds) ? data.contributionIds : [];
  const contributionIds = rawIds
    .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128)
    .slice(0, 100);

  const snapshots = await Promise.all(contributionIds.map((id) => db.doc(`catalogContributions/${id}`).get()));
  const statuses: Record<string, { promoted: boolean; catalogId: string; promotedAt: string | null }> = {};
  snapshots.forEach((snapshot, index) => {
    const record = snapshot.data() ?? {};
    const catalogId = typeof record.promotedCatalogId === 'string' ? record.promotedCatalogId : '';
    statuses[contributionIds[index]] = {
      promoted: Boolean(catalogId),
      catalogId,
      promotedAt: timestampToIso(record.promotedAt),
    };
  });
  return { statuses };
});

export const searchTrustedCatalog = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  requireAuthenticated(request);
  const data = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
  const isbn = normalizeIsbn(data.isbn);
  const title = normalizeText(data.title);
  const author = normalizeText(data.author);
  const matches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  if (isbn.length === 13) {
    const snapshot = await db.collection('trustedCatalogEditions').where('isbn13', '==', isbn).limit(10).get();
    snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
  } else if (isbn.length === 10) {
    const snapshot = await db.collection('trustedCatalogEditions').where('isbn10', '==', isbn).limit(10).get();
    snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
  }

  if (matches.size === 0 && title) {
    const snapshot = await db.collection('trustedCatalogEditions').where('normalizedTitle', '==', title).limit(25).get();
    snapshot.docs.forEach((doc) => {
      const record = doc.data();
      const recordAuthor = typeof record.normalizedAuthor === 'string' ? record.normalizedAuthor : '';
      if (!author || recordAuthor === author || recordAuthor.includes(author) || author.includes(recordAuthor)) {
        matches.set(doc.id, doc);
      }
    });
  }

  const groups = [...matches.values()]
    .filter((doc) => doc.get('active') !== false)
    .map((doc) => trustedRecordToGroup(doc.id, doc.data()))
    .filter((group): group is NonNullable<typeof group> => Boolean(group));

  return { groups, totalItems: groups.length };
});
