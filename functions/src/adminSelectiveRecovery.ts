import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const RECOVERY_COLLECTION = 'recoverySnapshots';
const COLLECTION_DEFINITIONS_DOC_ID = 'collectionDefinitions';
const LEGACY_COLLECTION_DEFINITIONS_DOC_ID = 'inkbound_collection_definitions';
const WRITE_BATCH_SIZE = 350;

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';
type RecoveryScope = 'book' | 'session' | 'collection' | 'auxiliary' | 'profile';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

interface CollectionDefinition {
  id?: string;
  name?: string;
  description?: string;
  color?: string;
  iconName?: string;
}

interface RecoveryPreviewBook { id: string; title: string; author: string; }
interface RecoveryPreviewSession { id: string; bookId: string; label: string; }
interface RecoveryPreviewCollection { id: string; name: string; bookCount: number; }
interface RecoveryPreviewAuxiliary { id: string; label: string; }

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

function unwrapEnvelope(value: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  if (value && typeof value === 'object' && 'data' in value && value.data && typeof value.data === 'object') {
    return value.data as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}

function unwrapUnknown(value: FirebaseFirestore.DocumentData | undefined): unknown {
  if (value && typeof value === 'object' && 'data' in value) return value.data;
  return value;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function auxiliaryLabel(id: string): string {
  const labels: Record<string, string> = {
    collectionDefinitions: 'Collection definitions',
    seriesOverrides: 'Series overrides',
    customOwnershipCategories: 'Custom ownership categories',
    annualReadingGoal: 'Annual reading goal',
    dailyReadingGoalMinutes: 'Daily reading goal',
    timelineMemories: 'Timeline memories',
    readingTimeCapsules: 'Reading time capsules',
    joinedChallenges: 'Joined challenges',
    customChallenges: 'Custom challenges',
    challengeRotation: 'Challenge rotation',
    joinedChallengeSnapshots: 'Challenge snapshots',
    dragonProfile: 'Dragon profile',
    achievementUnlocks: 'Achievement unlocks',
    achievementReveals: 'Achievement reveals',
    achievementSeen: 'Achievement seen state',
    inkbound_collection_definitions: 'Collection definitions',
    inkbound_series_overrides_v1: 'Series overrides',
    inkbound_custom_ownership_categories_v1: 'Custom ownership categories',
    inkbound_annual_goal: 'Annual reading goal',
    inkbound_daily_goal_minutes: 'Daily reading goal',
    inkbound_timeline_memories: 'Timeline memories',
    inkbound_reading_time_capsules: 'Reading time capsules',
    inkbound_joined_challenges: 'Joined challenges',
    inkbound_custom_challenges_v1: 'Custom challenges',
    inkbound_challenge_rotation_v2: 'Challenge rotation',
    inkbound_joined_challenge_snapshots_v2: 'Challenge snapshots',
    inkbound_dragon: 'Dragon profile',
    inkbound_achievement_unlocks_v5: 'Achievement unlocks',
    inkbound_achievement_reveals_v5: 'Achievement reveals',
    inkbound_achievement_seen_v5: 'Achievement seen state',
  };
  return labels[id] ?? id.replace(/^inkbound_/, '').replaceAll('_', ' ');
}

function findCollectionDefinitionsDocument(snapshot: FirebaseFirestore.QuerySnapshot) {
  return snapshot.docs.find((document) => document.id === COLLECTION_DEFINITIONS_DOC_ID)
    ?? snapshot.docs.find((document) => document.id === LEGACY_COLLECTION_DEFINITIONS_DOC_ID);
}

async function commitTasks(tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  const db = getFirestore();
  for (let index = 0; index < tasks.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    tasks.slice(index, index + WRITE_BATCH_SIZE).forEach((task) => task(batch));
    await batch.commit();
  }
}

async function createSafetySnapshot(targetUserId: string, reason: string): Promise<string> {
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

async function getSnapshot(targetUserId: string, snapshotId: string) {
  const db = getFirestore();
  const snapshotRef = db.doc(`users/${targetUserId}`).collection(RECOVERY_COLLECTION).doc(snapshotId);
  const root = await snapshotRef.get();
  if (!root.exists) throw new HttpsError('not-found', 'That recovery point no longer exists.');
  return { snapshotRef, root };
}

export const previewAdminRecoveryPoint = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await requireOwner(request);
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(input?.targetUserId, 'targetUserId', 128);
  const snapshotId = requireString(input?.snapshotId, 'snapshotId', 256);
  const { snapshotRef, root } = await getSnapshot(targetUserId, snapshotId);

  const [booksSnapshot, sessionsSnapshot, auxiliarySnapshot, profileSnapshot] = await Promise.all([
    snapshotRef.collection('books').get(),
    snapshotRef.collection('sessions').get(),
    snapshotRef.collection('auxiliary').get(),
    snapshotRef.collection('profile').doc('current').get(),
  ]);

  const books: RecoveryPreviewBook[] = booksSnapshot.docs.map((document) => {
    const book = unwrapEnvelope(document.data());
    const work = book.work && typeof book.work === 'object' ? book.work as Record<string, unknown> : {};
    return {
      id: document.id,
      title: typeof work.title === 'string' ? work.title : 'Untitled book',
      author: typeof work.author === 'string' ? work.author : 'Unknown author',
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
  const bookTitleById = new Map(books.map((book) => [book.id, book.title]));

  const sessions: RecoveryPreviewSession[] = sessionsSnapshot.docs.map((document) => {
    const session = unwrapEnvelope(document.data());
    const bookId = typeof session.bookId === 'string' ? session.bookId : '';
    const date = typeof session.date === 'string' ? session.date : 'Unknown date';
    const start = typeof session.startTime === 'string' ? session.startTime : '';
    const end = typeof session.endTime === 'string' ? session.endTime : '';
    const time = start || end ? ` · ${start}${start && end ? '–' : ''}${end}` : '';
    return { id: document.id, bookId, label: `${bookTitleById.get(bookId) ?? 'Unknown book'} · ${date}${time}` };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const collectionDoc = findCollectionDefinitionsDocument(auxiliarySnapshot);
  const definitionsRaw = unwrapUnknown(collectionDoc?.data());
  const definitions = Array.isArray(definitionsRaw)
    ? definitionsRaw.filter((item): item is CollectionDefinition => Boolean(item) && typeof item === 'object')
    : [];
  const collectionCounts = new Map<string, number>();
  booksSnapshot.docs.forEach((document) => {
    const book = unwrapEnvelope(document.data());
    const memberships = Array.isArray(book.collections) ? book.collections.filter((item): item is string => typeof item === 'string') : [];
    memberships.forEach((name) => collectionCounts.set(name, (collectionCounts.get(name) ?? 0) + 1));
  });
  const collections: RecoveryPreviewCollection[] = definitions
    .map((definition, index) => ({
      id: typeof definition.id === 'string' && definition.id ? definition.id : `collection-${index}`,
      name: typeof definition.name === 'string' && definition.name ? definition.name : `Collection ${index + 1}`,
      bookCount: collectionCounts.get(typeof definition.name === 'string' ? definition.name : '') ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const auxiliary: RecoveryPreviewAuxiliary[] = auxiliarySnapshot.docs
    .map((document) => ({ id: document.id, label: auxiliaryLabel(document.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rootData = root.data() ?? {};
  return {
    snapshot: {
      id: snapshotId,
      createdAtClient: typeof rootData.createdAtClient === 'string' ? rootData.createdAtClient : '',
      createdAt: timestampToIso(rootData.createdAt),
      reason: typeof rootData.reason === 'string' ? rootData.reason : 'Recovery point',
    },
    books,
    sessions,
    collections,
    auxiliary,
    profilePresent: profileSnapshot.exists,
  };
});

export const restoreAdminRecoverySelection = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { auth, admin } = await requireOwner(request);
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(input?.targetUserId, 'targetUserId', 128);
  const targetEmail = typeof input?.targetEmail === 'string' ? input.targetEmail.trim().toLowerCase() : '';
  const snapshotId = requireString(input?.snapshotId, 'snapshotId', 256);
  const scope = requireString(input?.scope, 'scope', 32) as RecoveryScope;
  const itemId = scope === 'profile' ? 'current' : requireString(input?.itemId, 'itemId', 512);
  const reason = requireString(input?.reason, 'reason', 1000);
  const confirmation = requireString(input?.confirmation, 'confirmation', 32).toUpperCase();
  if (!['book', 'session', 'collection', 'auxiliary', 'profile'].includes(scope)) throw new HttpsError('invalid-argument', 'Unsupported recovery scope.');
  if (confirmation !== 'RESTORE') throw new HttpsError('failed-precondition', 'Type RESTORE to confirm this recovery.');

  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const { snapshotRef } = await getSnapshot(targetUserId, snapshotId);
  const safetySnapshotId = await createSafetySnapshot(targetUserId, `Before selective admin recovery (${scope})`);
  const clientUpdatedAt = new Date().toISOString();
  let restoredCount = 0;
  let description = '';

  if (scope === 'book') {
    const source = await snapshotRef.collection('books').doc(itemId).get();
    if (!source.exists) throw new HttpsError('not-found', 'That book is not present in the selected recovery point.');
    const data = unwrapEnvelope(source.data());
    await userRef.collection('books').doc(itemId).set({ data, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt });
    restoredCount = 1;
    const work = data.work && typeof data.work === 'object' ? data.work as Record<string, unknown> : {};
    description = `Book: ${typeof work.title === 'string' ? work.title : itemId}`;
  }

  if (scope === 'session') {
    const source = await snapshotRef.collection('sessions').doc(itemId).get();
    if (!source.exists) throw new HttpsError('not-found', 'That reading session is not present in the selected recovery point.');
    const data = unwrapEnvelope(source.data());
    await userRef.collection('sessions').doc(itemId).set({ data, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt });
    restoredCount = 1;
    description = `Reading session ${itemId}`;
  }

  if (scope === 'auxiliary') {
    const source = await snapshotRef.collection('auxiliary').doc(itemId).get();
    if (!source.exists) throw new HttpsError('not-found', 'That account record is not present in the selected recovery point.');
    const data = unwrapUnknown(source.data());
    await userRef.collection('auxiliary').doc(itemId).set({ data, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt });
    restoredCount = 1;
    description = auxiliaryLabel(itemId);
  }

  if (scope === 'profile') {
    const source = await snapshotRef.collection('profile').doc('current').get();
    if (!source.exists) throw new HttpsError('not-found', 'The selected recovery point does not contain a profile.');
    const data = unwrapUnknown(source.data());
    await userRef.collection('profile').doc('current').set({ data, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt });
    restoredCount = 1;
    description = 'Reader profile';
  }

  if (scope === 'collection') {
    const auxiliarySnapshot = await snapshotRef.collection('auxiliary').get();
    const sourceDefinitions = findCollectionDefinitionsDocument(auxiliarySnapshot);
    if (!sourceDefinitions) throw new HttpsError('not-found', 'The selected recovery point does not contain collection definitions.');
    const rawDefinitions = unwrapUnknown(sourceDefinitions.data());
    const definitions = Array.isArray(rawDefinitions)
      ? rawDefinitions.filter((item): item is CollectionDefinition => Boolean(item) && typeof item === 'object')
      : [];
    const selectedDefinition = definitions.find((definition, index) => {
      const definitionId = typeof definition.id === 'string' && definition.id ? definition.id : `collection-${index}`;
      return definitionId === itemId;
    });
    if (!selectedDefinition || typeof selectedDefinition.name !== 'string' || !selectedDefinition.name.trim()) {
      throw new HttpsError('not-found', 'That collection is not present in the selected recovery point.');
    }
    const collectionName = selectedDefinition.name.trim();

    const currentDefinitionsRef = userRef.collection('auxiliary').doc(COLLECTION_DEFINITIONS_DOC_ID);
    const currentDefinitionsSnapshot = await currentDefinitionsRef.get();
    const currentRaw = unwrapUnknown(currentDefinitionsSnapshot.data());
    const currentDefinitions = Array.isArray(currentRaw)
      ? currentRaw.filter((item): item is CollectionDefinition => Boolean(item) && typeof item === 'object')
      : [];
    const nextDefinitions = [...currentDefinitions];
    const existingIndex = nextDefinitions.findIndex((definition) => definition.id === itemId || definition.name === collectionName);
    if (existingIndex >= 0) nextDefinitions[existingIndex] = { ...nextDefinitions[existingIndex], ...selectedDefinition };
    else nextDefinitions.push(selectedDefinition);
    await currentDefinitionsRef.set({ data: nextDefinitions, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt });

    const snapshotBooks = await snapshotRef.collection('books').get();
    const memberIds = snapshotBooks.docs.filter((document) => {
      const book = unwrapEnvelope(document.data());
      return Array.isArray(book.collections) && book.collections.some((value) => value === collectionName);
    }).map((document) => document.id);

    const tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
    for (const bookId of memberIds) {
      const currentBookRef = userRef.collection('books').doc(bookId);
      const currentBook = await currentBookRef.get();
      if (!currentBook.exists) continue;
      const data = unwrapEnvelope(currentBook.data());
      const memberships = Array.isArray(data.collections) ? data.collections.filter((value): value is string => typeof value === 'string') : [];
      if (memberships.includes(collectionName)) continue;
      const nextBook = { ...data, collections: [...memberships, collectionName] };
      tasks.push((batch) => batch.set(currentBookRef, { data: nextBook, updatedAt: FieldValue.serverTimestamp(), clientUpdatedAt }));
    }
    await commitTasks(tasks);
    restoredCount = 1 + tasks.length;
    description = `Collection: ${collectionName} (${tasks.length} missing memberships restored)`;
  }

  await db.collection('adminAudit').add({
    action: 'restore_reader_recovery_selection',
    targetUserId,
    targetEmail,
    performedBy: auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: { safetySnapshotId },
    newValue: { restoredSnapshotId: snapshotId, scope, itemId, restoredCount, description },
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, safetySnapshotId, restoredSnapshotId: snapshotId, scope, itemId, restoredCount, description };
});