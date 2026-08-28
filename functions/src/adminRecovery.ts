import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { reapplyProtectedBookDetails } from './protectedBookDetails.js';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const RECOVERY_COLLECTION = 'recoverySnapshots';
const MANUAL_COVER_LEDGER_COLLECTION = 'manualCoverAssignments';
const MAX_RECOVERY_POINTS = 12;
const WRITE_BATCH_SIZE = 350;

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

interface RecoveryPointSummary {
  id: string;
  createdAtClient: string;
  createdAt: string | null;
  reason: string;
  bookCount: number;
  sessionCount: number;
  auxiliaryCount: number;
  photoMemoryCount: number;
  runtimeStateCount: number;
}

interface ManualCoverLedgerEntry {
  bookId?: unknown;
  editionId?: unknown;
  coverUrl?: unknown;
}

async function requireOwner(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const db = getFirestore();
  const snapshot = await db.doc(`admins/${request.auth.uid}`).get();
  const admin = snapshot.data() as AdminRecord | undefined;
  if (!admin?.enabled || admin.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner access is required for reader recovery.');
  }
  return { auth: request.auth, admin };
}

function requireString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new HttpsError('invalid-argument', `${field} is invalid.`);
  return normalized;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function unwrapEnvelope(value: FirebaseFirestore.DocumentData): Record<string, unknown> {
  if (value && typeof value === 'object' && 'data' in value && value.data && typeof value.data === 'object') {
    return value.data as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

async function commitTasks(tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  const db = getFirestore();
  for (let index = 0; index < tasks.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    tasks.slice(index, index + WRITE_BATCH_SIZE).forEach((task) => task(batch));
    await batch.commit();
  }
}

async function listPoints(targetUserId: string): Promise<RecoveryPointSummary[]> {
  const db = getFirestore();
  const snapshot = await db.collection(`users/${targetUserId}/${RECOVERY_COLLECTION}`)
    .orderBy('createdAtClient', 'desc')
    .limit(MAX_RECOVERY_POINTS)
    .get();

  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      createdAtClient: typeof data.createdAtClient === 'string' ? data.createdAtClient : '',
      createdAt: timestampToIso(data.createdAt),
      reason: typeof data.reason === 'string' ? data.reason : 'Recovery point',
      bookCount: Number(data.bookCount ?? 0),
      sessionCount: Number(data.sessionCount ?? 0),
      auxiliaryCount: Number(data.auxiliaryCount ?? 0),
      photoMemoryCount: Number(data.photoMemoryCount ?? 0),
      runtimeStateCount: Number(data.runtimeStateCount ?? 0),
    };
  });
}

async function createCloudSafetyPoint(targetUserId: string, reason: string) {
  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const [books, sessions, profile, auxiliary, photoMemories] = await Promise.all([
    userRef.collection('books').get(),
    userRef.collection('sessions').get(),
    userRef.collection('profile').doc('current').get(),
    userRef.collection('auxiliary').get(),
    userRef.collection('photoMemories').get(),
  ]);

  const snapshotId = `${Date.now()}-${crypto.randomUUID()}`;
  const snapshotRef = userRef.collection(RECOVERY_COLLECTION).doc(snapshotId);
  const tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  books.docs.forEach((document) => tasks.push((batch) => batch.set(snapshotRef.collection('books').doc(document.id), document.data())));
  sessions.docs.forEach((document) => tasks.push((batch) => batch.set(snapshotRef.collection('sessions').doc(document.id), document.data())));
  auxiliary.docs.forEach((document) => tasks.push((batch) => batch.set(snapshotRef.collection('auxiliary').doc(document.id), document.data())));
  photoMemories.docs.forEach((document) => tasks.push((batch) => batch.set(snapshotRef.collection('photoMemories').doc(document.id), { data: document.data() })));
  if (profile.exists) tasks.push((batch) => batch.set(snapshotRef.collection('profile').doc('current'), profile.data() ?? {}));

  await commitTasks(tasks);
  const createdAtClient = new Date().toISOString();
  await snapshotRef.set({
    schemaVersion: 2,
    createdAt: FieldValue.serverTimestamp(),
    createdAtClient,
    reason,
    bookCount: books.size,
    sessionCount: sessions.size,
    auxiliaryCount: auxiliary.size,
    photoMemoryCount: photoMemories.size,
    runtimeStateCount: 0,
    createdByAdmin: true,
  });

  return snapshotId;
}

async function replaceCollection(
  targetUserId: string,
  name: 'books' | 'sessions' | 'auxiliary' | 'photoMemories',
  source: FirebaseFirestore.QuerySnapshot,
  unwrapData: boolean,
) {
  const db = getFirestore();
  const target = db.collection(`users/${targetUserId}/${name}`);
  const current = await target.get();
  const wantedIds = new Set(source.docs.map((document) => document.id));
  const tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  current.docs.forEach((document) => {
    if (!wantedIds.has(document.id)) tasks.push((batch) => batch.delete(document.ref));
  });

  const clientUpdatedAt = new Date().toISOString();
  source.docs.forEach((document) => {
    const stored = document.data();
    const data = unwrapData && stored && typeof stored === 'object' && 'data' in stored ? stored.data : stored;
    tasks.push((batch) => batch.set(
      target.doc(document.id),
      name === 'photoMemories'
        ? (data as FirebaseFirestore.DocumentData)
        : { data, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt },
    ));
  });

  await commitTasks(tasks);
}

async function reapplyManualCoverLedger(targetUserId: string): Promise<number> {
  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const ledger = await userRef.collection(MANUAL_COVER_LEDGER_COLLECTION).get();
  if (ledger.empty) return 0;

  const tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  const clientUpdatedAt = new Date().toISOString();
  let reapplied = 0;

  for (const ledgerDocument of ledger.docs) {
    const entry = ledgerDocument.data() as ManualCoverLedgerEntry;
    const bookId = typeof entry.bookId === 'string' && entry.bookId ? entry.bookId : ledgerDocument.id;
    const editionId = typeof entry.editionId === 'string' ? entry.editionId : '';
    const coverUrl = typeof entry.coverUrl === 'string' ? entry.coverUrl.trim() : '';
    if (!bookId || !coverUrl) continue;

    const bookRef = userRef.collection('books').doc(bookId);
    const bookSnapshot = await bookRef.get();
    if (!bookSnapshot.exists) continue;

    const book = unwrapEnvelope(bookSnapshot.data() ?? {});
    const editions = Array.isArray(book.editions)
      ? book.editions.filter((edition): edition is Record<string, unknown> => Boolean(edition) && typeof edition === 'object' && !Array.isArray(edition))
      : [];
    if (editions.length === 0) continue;

    const activeEditionId = typeof book.activeEditionId === 'string' ? book.activeEditionId : '';
    let targetIndex = editionId ? editions.findIndex((edition) => edition.id === editionId) : -1;
    if (targetIndex < 0 && activeEditionId) targetIndex = editions.findIndex((edition) => edition.id === activeEditionId);
    if (targetIndex < 0) targetIndex = 0;

    const nextEditions = editions.map((edition, index) => index === targetIndex
      ? { ...edition, coverUrl, externalSource: 'manual' }
      : edition);
    const nextBook = {
      ...book,
      activeEditionId: typeof nextEditions[targetIndex]?.id === 'string'
        ? nextEditions[targetIndex].id
        : book.activeEditionId,
      editions: nextEditions,
    };

    tasks.push((batch) => batch.set(bookRef, {
      data: nextBook,
      updatedAt: FieldValue.serverTimestamp(),
      clientUpdatedAt,
    }));
    reapplied += 1;
  }

  await commitTasks(tasks);
  return reapplied;
}

export const listAdminRecoveryPoints = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await requireOwner(request);
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(input?.targetUserId, 'targetUserId', 128);
  return { points: await listPoints(targetUserId) };
});

export const restoreAdminRecoveryPoint = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { auth, admin } = await requireOwner(request);
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(input?.targetUserId, 'targetUserId', 128);
  const targetEmail = typeof input?.targetEmail === 'string' ? input.targetEmail.trim().toLowerCase() : '';
  const snapshotId = requireString(input?.snapshotId, 'snapshotId', 256);
  const reason = requireString(input?.reason, 'reason', 1000);
  const confirmation = requireString(input?.confirmation, 'confirmation', 32).toUpperCase();
  if (confirmation !== 'RESTORE') {
    throw new HttpsError('failed-precondition', 'Type RESTORE to confirm this reader recovery.');
  }

  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const snapshotRef = userRef.collection(RECOVERY_COLLECTION).doc(snapshotId);
  const root = await snapshotRef.get();
  if (!root.exists) throw new HttpsError('not-found', 'That recovery point no longer exists.');

  // Preserve the cloud state being replaced first so an admin restore is reversible.
  // Manual covers and protected reader book details live in independent ledgers
  // and are intentionally not rolled back with an older library snapshot.
  const beforeRestoreSnapshotId = await createCloudSafetyPoint(targetUserId, 'Before admin recovery restore');

  const [books, sessions, profile, auxiliary, photoMemories] = await Promise.all([
    snapshotRef.collection('books').get(),
    snapshotRef.collection('sessions').get(),
    snapshotRef.collection('profile').doc('current').get(),
    snapshotRef.collection('auxiliary').get(),
    snapshotRef.collection('photoMemories').get(),
  ]);

  await replaceCollection(targetUserId, 'books', books, true);
  await replaceCollection(targetUserId, 'sessions', sessions, true);
  await replaceCollection(targetUserId, 'auxiliary', auxiliary, true);
  await replaceCollection(targetUserId, 'photoMemories', photoMemories, true);

  const profileRef = userRef.collection('profile').doc('current');
  if (profile.exists) {
    const stored = profile.data() ?? {};
    const data = 'data' in stored ? stored.data : stored;
    await profileRef.set({ data, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt: new Date().toISOString() });
  } else {
    await profileRef.delete();
  }

  const protectedDetailsReapplied = await reapplyProtectedBookDetails(targetUserId);
  const manualCoversReapplied = await reapplyManualCoverLedger(targetUserId);

  await db.collection('adminAudit').add({
    action: 'restore_reader_recovery_point',
    targetUserId,
    targetEmail,
    performedBy: auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: { safetySnapshotId: beforeRestoreSnapshotId },
    newValue: {
      restoredSnapshotId: snapshotId,
      protectedDetailsReapplied,
      manualCoversReapplied,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    restoredSnapshotId: snapshotId,
    safetySnapshotId: beforeRestoreSnapshotId,
    protectedDetailsReapplied,
    manualCoversReapplied,
  };
});
