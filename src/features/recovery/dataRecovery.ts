import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { applyRuntimeJsonFromExternalSource, applyRuntimeValueFromExternalSource, getRuntimeStorage, removeRuntimeValue, removeRuntimeValueFromExternalSource, writeRuntimeJson } from '../../platform/runtimeStorage';
import type { ReadingSession, UserBookRecord } from '../../types';
import {
  IMPORT_ENRICHMENT_PAUSED_KEY,
  IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY,
  IMPORT_ENRICHMENT_RETRY_REQUEST_KEY,
  IMPORT_HISTORY_STORAGE_KEY,
} from '../import/importHistory';
import { IMPORT_ENRICHMENT_QUEUE_KEY } from '../import/libraryEnrichment';
import {
  AUXILIARY_ACCOUNT_KEYS,
  getAuxiliaryBaselineKey,
  getAuxiliaryPendingKey,
  type AuxiliaryAccountKeyName,
} from '../sync/auxiliaryAccountSyncConfig';
import { notifyCloudDataUpdated, notifyLocalDataChanged } from '../sync/cloudSyncEvents';
import { DEVICE_FEATURE_STORAGE_KEYS, SYNC_STORAGE_KEYS, legacySyncBaselineV1Key, syncBaselineStateKey, syncPendingStateKey } from '../sync/storageKeys';

const RECOVERY_COLLECTION = 'recoverySnapshots';
const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const PHOTO_REVISION_KEY = DEVICE_FEATURE_STORAGE_KEYS.photoMemoryCloudRevisions;
const RESTORE_REQUEST_KEY = DEVICE_FEATURE_STORAGE_KEYS.pendingRecoveryRestore;
const MAX_LISTED_RECOVERY_POINTS = 12;
const WRITE_BATCH_SIZE = 350;

const RECOVERABLE_RUNTIME_KEYS = [
  IMPORT_HISTORY_STORAGE_KEY,
  IMPORT_ENRICHMENT_QUEUE_KEY,
  IMPORT_ENRICHMENT_PAUSED_KEY,
  IMPORT_ENRICHMENT_RETRY_REQUEST_KEY,
  IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY,
] as const;

interface CloudRecord<T> {
  data: T;
}

interface ReaderProfile {
  displayName?: string;
  email?: string;
  favoriteQuote?: string;
  bio?: string;
  avatarImage?: string;
  bannerImage?: string;
}

interface ScheduledRecoveryRestore {
  uid: string;
  snapshotId: string;
  requestedAt: string;
}

export interface RecoveryPointSummary {
  id: string;
  createdAtClient: string;
  reason: string;
  bookCount: number;
  sessionCount: number;
  auxiliaryCount: number;
  photoMemoryCount: number;
  runtimeStateCount: number;
  fingerprint: string;
}

interface SnapshotPayload {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  profile?: ReaderProfile;
  auxiliary: Array<{ id: AuxiliaryAccountKeyName; data: unknown }>;
  photoMemories: Array<{ id: string; data: Record<string, unknown> }>;
  runtimeState: Array<{ id: string; data: string }>;
}

const stable = (value: unknown) => JSON.stringify(value);

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function snapshotFingerprint(payload: SnapshotPayload): string {
  const compact = {
    books: [...payload.books].sort((a, b) => a.id.localeCompare(b.id)).map((book) => [book.id, stable(book)]),
    sessions: [...payload.sessions].sort((a, b) => a.id.localeCompare(b.id)).map((session) => [session.id, stable(session)]),
    profile: payload.profile ? stable(payload.profile) : '',
    auxiliary: [...payload.auxiliary].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, stable(item.data)]),
    photoMemories: [...payload.photoMemories].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, stable(item.data)]),
    runtimeState: [...payload.runtimeState].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, item.data]),
  };
  return hashText(stable(compact));
}

function readRecoverableRuntimeState(): SnapshotPayload['runtimeState'] {
  const storage = getRuntimeStorage();
  return RECOVERABLE_RUNTIME_KEYS.flatMap((key) => {
    try {
      const value = storage.getItem(key);
      return value === null ? [] : [{ id: key, data: value }];
    } catch {
      return [];
    }
  });
}

async function readCloudPayload(uid: string): Promise<SnapshotPayload> {
  if (!db) throw new Error('Cloud recovery is unavailable because Firebase is not configured.');

  const [booksSnapshot, sessionsSnapshot, profileSnapshot, auxiliarySnapshot, photoSnapshot] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'books')),
    getDocs(collection(db, 'users', uid, 'sessions')),
    getDoc(doc(db, 'users', uid, 'profile', 'current')),
    getDocs(collection(db, 'users', uid, 'auxiliary')),
    getDocs(collection(db, 'users', uid, 'photoMemories')),
  ]);

  return {
    books: booksSnapshot.docs
      .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
      .filter(Boolean),
    sessions: sessionsSnapshot.docs
      .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
      .filter(Boolean),
    profile: profileSnapshot.exists()
      ? (profileSnapshot.data() as CloudRecord<ReaderProfile>).data
      : undefined,
    auxiliary: auxiliarySnapshot.docs
      .filter((item) => item.id in AUXILIARY_ACCOUNT_KEYS)
      .map((item) => ({
        id: item.id as AuxiliaryAccountKeyName,
        data: (item.data() as CloudRecord<unknown>).data,
      })),
    photoMemories: photoSnapshot.docs.map((item) => ({
      id: item.id,
      data: item.data() as Record<string, unknown>,
    })),
    runtimeState: readRecoverableRuntimeState(),
  };
}

async function commitTasks(tasks: Array<(batch: ReturnType<typeof writeBatch>) => void>) {
  if (!db) return;
  for (let index = 0; index < tasks.length; index += WRITE_BATCH_SIZE) {
    const batch = writeBatch(db);
    tasks.slice(index, index + WRITE_BATCH_SIZE).forEach((task) => task(batch));
    await batch.commit();
  }
}

export async function listRecoveryPoints(uid: string): Promise<RecoveryPointSummary[]> {
  if (!db || !uid) return [];
  const snapshot = await getDocs(query(
    collection(db, 'users', uid, RECOVERY_COLLECTION),
    orderBy('createdAtClient', 'desc'),
    limit(MAX_LISTED_RECOVERY_POINTS),
  ));

  return snapshot.docs.map((item) => {
    const data = item.data() as Partial<RecoveryPointSummary>;
    return {
      id: item.id,
      createdAtClient: String(data.createdAtClient ?? ''),
      reason: String(data.reason ?? 'Automatic safety copy'),
      bookCount: Number(data.bookCount ?? 0),
      sessionCount: Number(data.sessionCount ?? 0),
      auxiliaryCount: Number(data.auxiliaryCount ?? 0),
      photoMemoryCount: Number(data.photoMemoryCount ?? 0),
      runtimeStateCount: Number(data.runtimeStateCount ?? 0),
      fingerprint: String(data.fingerprint ?? ''),
    };
  });
}

export async function createRecoveryPoint(
  uid: string,
  reason: string,
  options: { force?: boolean } = {},
): Promise<RecoveryPointSummary | null> {
  if (!db || !uid) return null;
  const payload = await readCloudPayload(uid);
  if (
    payload.books.length === 0 &&
    payload.sessions.length === 0 &&
    payload.auxiliary.length === 0 &&
    payload.photoMemories.length === 0 &&
    payload.runtimeState.length === 0 &&
    !payload.profile
  ) return null;

  const fingerprint = snapshotFingerprint(payload);
  const latest = (await listRecoveryPoints(uid))[0];
  if (!options.force && latest?.fingerprint === fingerprint) return latest;

  const createdAtClient = new Date().toISOString();
  const snapshotId = `${Date.now()}-${crypto.randomUUID()}`;
  const snapshotRef = doc(db, 'users', uid, RECOVERY_COLLECTION, snapshotId);

  const tasks: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  payload.books.forEach((book) => tasks.push((batch) => batch.set(doc(snapshotRef, 'books', book.id), { data: book })));
  payload.sessions.forEach((session) => tasks.push((batch) => batch.set(doc(snapshotRef, 'sessions', session.id), { data: session })));
  payload.auxiliary.forEach((item) => tasks.push((batch) => batch.set(doc(snapshotRef, 'auxiliary', item.id), { data: item.data })));
  payload.photoMemories.forEach((item) => tasks.push((batch) => batch.set(doc(snapshotRef, 'photoMemories', item.id), { data: item.data })));
  payload.runtimeState.forEach((item) => tasks.push((batch) => batch.set(doc(snapshotRef, 'runtimeState', item.id), { data: item.data })));
  if (payload.profile) tasks.push((batch) => batch.set(doc(snapshotRef, 'profile', 'current'), { data: payload.profile }));
  await commitTasks(tasks);

  await setDoc(snapshotRef, {
    schemaVersion: 2,
    createdAt: serverTimestamp(),
    createdAtClient,
    reason,
    fingerprint,
    bookCount: payload.books.length,
    sessionCount: payload.sessions.length,
    auxiliaryCount: payload.auxiliary.length,
    photoMemoryCount: payload.photoMemories.length,
    runtimeStateCount: payload.runtimeState.length,
  });

  return {
    id: snapshotId,
    createdAtClient,
    reason,
    bookCount: payload.books.length,
    sessionCount: payload.sessions.length,
    auxiliaryCount: payload.auxiliary.length,
    photoMemoryCount: payload.photoMemories.length,
    runtimeStateCount: payload.runtimeState.length,
    fingerprint,
  };
}

async function readRecoveryPayload(uid: string, snapshotId: string): Promise<SnapshotPayload> {
  if (!db) throw new Error('Cloud recovery is unavailable because Firebase is not configured.');
  const root = doc(db, 'users', uid, RECOVERY_COLLECTION, snapshotId);
  const rootSnapshot = await getDoc(root);
  if (!rootSnapshot.exists()) throw new Error('That recovery point no longer exists.');

  const [booksSnapshot, sessionsSnapshot, profileSnapshot, auxiliarySnapshot, photoSnapshot, runtimeSnapshot] = await Promise.all([
    getDocs(collection(root, 'books')),
    getDocs(collection(root, 'sessions')),
    getDoc(doc(root, 'profile', 'current')),
    getDocs(collection(root, 'auxiliary')),
    getDocs(collection(root, 'photoMemories')),
    getDocs(collection(root, 'runtimeState')),
  ]);

  return {
    books: booksSnapshot.docs.map((item) => (item.data() as CloudRecord<UserBookRecord>).data).filter(Boolean),
    sessions: sessionsSnapshot.docs.map((item) => (item.data() as CloudRecord<ReadingSession>).data).filter(Boolean),
    profile: profileSnapshot.exists() ? (profileSnapshot.data() as CloudRecord<ReaderProfile>).data : undefined,
    auxiliary: auxiliarySnapshot.docs
      .filter((item) => item.id in AUXILIARY_ACCOUNT_KEYS)
      .map((item) => ({ id: item.id as AuxiliaryAccountKeyName, data: (item.data() as CloudRecord<unknown>).data })),
    photoMemories: photoSnapshot.docs.map((item) => ({ id: item.id, data: (item.data() as CloudRecord<Record<string, unknown>>).data })),
    runtimeState: runtimeSnapshot.docs.map((item) => ({ id: item.id, data: String((item.data() as CloudRecord<unknown>).data ?? '') })),
  };
}

async function replaceCollection(
  uid: string,
  name: 'books' | 'sessions' | 'auxiliary' | 'photoMemories',
  records: Array<{ id: string; data: unknown }>,
  wrapData: boolean,
) {
  if (!db) return;
  const targetCollection = collection(db, 'users', uid, name);
  const current = await getDocs(targetCollection);
  const wantedIds = new Set(records.map((item) => item.id));
  const tasks: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  current.docs.forEach((item) => {
    if (!wantedIds.has(item.id)) tasks.push((batch) => batch.delete(item.ref));
  });
  const clientUpdatedAt = new Date().toISOString();
  records.forEach((item) => tasks.push((batch) => batch.set(
    doc(targetCollection, item.id),
    wrapData
      ? { data: item.data, updatedAt: serverTimestamp(), clientUpdatedAt }
      : item.data as Record<string, unknown>,
  )));
  await commitTasks(tasks);
}

export function scheduleRecoveryRestore(uid: string, snapshotId: string): void {
  writeRuntimeJson(RESTORE_REQUEST_KEY, { uid, snapshotId, requestedAt: new Date().toISOString() } satisfies ScheduledRecoveryRestore);
}

export function readScheduledRecoveryRestore(uid: string): ScheduledRecoveryRestore | null {
  try {
    const raw = getRuntimeStorage().getItem(RESTORE_REQUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScheduledRecoveryRestore>;
    return parsed.uid === uid && typeof parsed.snapshotId === 'string' && parsed.snapshotId ? parsed as ScheduledRecoveryRestore : null;
  } catch {
    return null;
  }
}

export function clearScheduledRecoveryRestore(): void {
  removeRuntimeValue(RESTORE_REQUEST_KEY);
}

export async function restoreRecoveryPoint(uid: string, snapshotId: string): Promise<void> {
  if (!db || !uid) throw new Error('Cloud recovery is unavailable.');

  await createRecoveryPoint(uid, 'Before recovery restore', { force: true });
  const payload = await readRecoveryPayload(uid, snapshotId);

  await replaceCollection(uid, 'books', payload.books.map((book) => ({ id: book.id, data: book })), true);
  await replaceCollection(uid, 'sessions', payload.sessions.map((session) => ({ id: session.id, data: session })), true);
  await replaceCollection(uid, 'auxiliary', payload.auxiliary, true);
  await replaceCollection(uid, 'photoMemories', payload.photoMemories, false);

  const profileRef = doc(db, 'users', uid, 'profile', 'current');
  if (payload.profile) {
    await setDoc(profileRef, { data: payload.profile, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() });
  } else {
    await deleteDoc(profileRef);
  }

  const storage = getRuntimeStorage();

  // Recovery must invalidate the CURRENT sync metadata. Keeping an old v2
  // baseline after a restore can make the restored state look like a local edit
  // or make a deleted pre-restore record appear authoritative again.
  removeRuntimeValue(syncPendingStateKey(uid));
  removeRuntimeValue(syncBaselineStateKey(uid));
  // Older beta keys are cleared too so an upgraded device cannot resurrect them.
  removeRuntimeValue(legacySyncBaselineV1Key(uid));
  removeRuntimeValue(getAuxiliaryPendingKey(uid));
  removeRuntimeValue(getAuxiliaryBaselineKey(uid));

  applyRuntimeJsonFromExternalSource(BOOKS_KEY, payload.books);
  applyRuntimeJsonFromExternalSource(SESSIONS_KEY, payload.sessions);
  applyRuntimeJsonFromExternalSource(PROFILE_KEY, payload.profile ?? {});

  const restoredAuxiliary = new Map(payload.auxiliary.map((item) => [item.id, item.data]));
  (Object.entries(AUXILIARY_ACCOUNT_KEYS) as Array<[AuxiliaryAccountKeyName, string]>).forEach(([name, runtimeKey]) => {
    if (restoredAuxiliary.has(name)) applyRuntimeJsonFromExternalSource(runtimeKey, restoredAuxiliary.get(name));
    else removeRuntimeValueFromExternalSource(runtimeKey);
  });

  const restoredRuntime = new Map(payload.runtimeState.map((item) => [item.id, item.data]));
  RECOVERABLE_RUNTIME_KEYS.forEach((runtimeKey) => {
    const value = restoredRuntime.get(runtimeKey);
    if (value === undefined) removeRuntimeValueFromExternalSource(runtimeKey);
    else applyRuntimeValueFromExternalSource(runtimeKey, value);
  });

  removeRuntimeValueFromExternalSource(PHOTO_REVISION_KEY);

  notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
  notifyLocalDataChanged([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
}
