import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const COLLECTION_DEFINITIONS_DOC_ID = 'collectionDefinitions';
const LEGACY_COLLECTION_DEFINITIONS_DOC_ID = 'inkbound_collection_definitions';

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';
type DetailSection = 'collections' | 'books' | 'sessions' | 'auxiliary' | 'profile' | 'photoMemories' | 'syncState' | 'deletions' | 'recoveryPoints' | 'entitlement';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

interface StoredBook {
  id?: unknown;
  activeEditionId?: unknown;
  editions?: unknown;
  work?: unknown;
  privateTags?: unknown;
  sourceOfImport?: unknown;
  importMetadataVerified?: unknown;
  collections?: unknown;
  readingStatus?: unknown;
}

interface StoredSession {
  id?: unknown;
  bookId?: unknown;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function serializeFirestoreValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (value && typeof value === 'object') {
    const possibleReference = value as { path?: unknown; latitude?: unknown; longitude?: unknown };
    if (typeof possibleReference.path === 'string') return possibleReference.path;
    if (typeof possibleReference.latitude === 'number' && typeof possibleReference.longitude === 'number') {
      return { latitude: possibleReference.latitude, longitude: possibleReference.longitude };
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeFirestoreValue(entry)]));
  }
  return value;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function normalizeIsbn(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9X]/gi, '').toUpperCase() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unwrapData<T>(value: Record<string, unknown>): T {
  return ('data' in value ? value.data : value) as T;
}

function safeUnwrapRecord<T>(value: Record<string, unknown>): T {
  const candidate = 'data' in value ? value.data : value;
  return (candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : {}) as T;
}

function friendlyAuxiliaryLabel(id: string): string {
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
  };
  return labels[id] ?? id.replace(/^inkbound_/, '').replaceAll('_', ' ');
}

async function requireAdmin(request: CallableRequest<unknown>, allowedRoles?: AdminRole[]) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');

  const db = getFirestore();
  const snapshot = await db.doc(`admins/${request.auth.uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled || (allowedRoles && !allowedRoles.includes(record.role))) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }

  return { auth: request.auth, admin: record };
}

async function getPagedDocuments(collection: FirebaseFirestore.CollectionReference, page: number, pageSize: number) {
  const snapshot = await collection.orderBy(FieldPath.documentId()).offset(page * pageSize).limit(pageSize + 1).get();
  return { docs: snapshot.docs.slice(0, pageSize), hasMore: snapshot.size > pageSize };
}

async function getIntegrityDetail(targetUserId: string, section: DetailSection, page: number, pageSize: number, bookQuery = '') {
  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);

  if (section === 'collections') {
    const [booksSnapshot, auxiliarySnapshot] = await Promise.all([
      userRef.collection('books').get(),
      userRef.collection('auxiliary').get(),
    ]);
    const definitionsDoc = auxiliarySnapshot.docs.find((document) => document.id === COLLECTION_DEFINITIONS_DOC_ID)
      ?? auxiliarySnapshot.docs.find((document) => document.id === LEGACY_COLLECTION_DEFINITIONS_DOC_ID);
    const definitionsRaw = definitionsDoc ? unwrapData<unknown>(definitionsDoc.data()) : [];
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
    const memberships = new Map<string, Array<{ id: string; title: string }>>();
    booksSnapshot.docs.forEach((document) => {
      const book = safeUnwrapRecord<StoredBook>(document.data());
      const work = asRecord(book.work);
      const title = typeof work.title === 'string' && work.title.trim() ? work.title.trim() : 'Untitled book';
      asStringArray(book.collections).forEach((collectionName) => {
        const existing = memberships.get(collectionName) ?? [];
        existing.push({ id: document.id, title });
        memberships.set(collectionName, existing);
      });
    });
    return {
      section,
      page: 0,
      pageSize: definitions.length,
      hasMore: false,
      total: definitions.length,
      items: definitions.map((definition, index) => {
        const name = typeof definition.name === 'string' && definition.name.trim() ? definition.name.trim() : `Collection ${index + 1}`;
        const members = memberships.get(name) ?? [];
        return {
          id: typeof definition.id === 'string' && definition.id ? definition.id : `collection-${index}`,
          label: name,
          count: members.length,
          membersPreview: members.slice(0, 10),
          raw: serializeFirestoreValue(definition),
        };
      }),
    };
  }

  if (section === 'books') {
    // Admin inspection must paginate by human-readable title, not random UUID.
    // Sort the complete collection BEFORE slicing pages so A-Z is correct across
    // all pages, including older documents that lack a searchable title field.
    // This is a read-only, owner/admin-triggered inspection path, not app sync.
    const bookSnapshot = await userRef.collection('books').get();
    const normalizedBookQuery = bookQuery.trim().toLocaleLowerCase();
    const matchingBooks = bookSnapshot.docs.filter((document) => {
      if (!normalizedBookQuery) return true;
      const book = safeUnwrapRecord<StoredBook>(document.data());
      const work = asRecord(book.work);
      const editions = asRecordArray(book.editions);
      const searchable = [document.id, work.title, work.author, ...editions.flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])];
      return searchable.some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(normalizedBookQuery));
    });
    const sortedBooks = matchingBooks.sort((left, right) => {
      const titleOf = (document: FirebaseFirestore.QueryDocumentSnapshot) => {
        const book = safeUnwrapRecord<StoredBook>(document.data());
        const title = asRecord(book.work).title;
        return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled book';
      };
      return titleOf(left).localeCompare(titleOf(right), undefined, { sensitivity: 'base', numeric: true })
        || left.id.localeCompare(right.id);
    });
    const docs = sortedBooks.slice(page * pageSize, (page + 1) * pageSize);
    const hasMore = (page + 1) * pageSize < sortedBooks.length;
    const items = docs.map((document) => {
      const stored = document.data();
      const book = unwrapData<StoredBook>(stored);
      const work = asRecord(book.work);
      const editions = asRecordArray(book.editions);
      const activeEditionId = typeof book.activeEditionId === 'string' ? book.activeEditionId : '';
      const activeEdition = editions.find((edition) => edition.id === activeEditionId) ?? editions[0] ?? {};
      const isbn = normalizeIsbn(activeEdition.isbn13) || normalizeIsbn(activeEdition.isbn10) || normalizeIsbn(activeEdition.isbn);
      return {
        id: document.id,
        label: typeof work.title === 'string' && work.title.trim() ? work.title.trim() : 'Untitled book',
        subtitle: typeof work.author === 'string' ? work.author : '',
        collections: asStringArray(book.collections),
        readingStatus: typeof book.readingStatus === 'string' ? book.readingStatus : '',
        activeEditionId,
        isbn,
        sourceOfImport: typeof book.sourceOfImport === 'string' ? book.sourceOfImport : '',
        updatedAt: timestampToIso(stored.updatedAt),
        clientUpdatedAt: typeof stored.clientUpdatedAt === 'string' ? stored.clientUpdatedAt : null,
        raw: serializeFirestoreValue(stored),
      };
    });
    return { section, page, pageSize, hasMore, total: sortedBooks.length, items };
  }

  if (section === 'sessions') {
    const { docs, hasMore } = await getPagedDocuments(userRef.collection('sessions'), page, pageSize);
    return {
      section, page, pageSize, hasMore,
      items: docs.map((document) => {
        const stored = document.data();
        const session = safeUnwrapRecord<Record<string, unknown>>(stored);
        return {
          id: document.id,
          label: typeof session.date === 'string' ? session.date : document.id,
          subtitle: typeof session.bookId === 'string' ? `Book ${session.bookId}` : '',
          updatedAt: timestampToIso(stored.updatedAt),
          clientUpdatedAt: typeof stored.clientUpdatedAt === 'string' ? stored.clientUpdatedAt : null,
          raw: serializeFirestoreValue(stored),
        };
      }),
    };
  }

  if (section === 'auxiliary') {
    const { docs, hasMore } = await getPagedDocuments(userRef.collection('auxiliary'), page, pageSize);
    return {
      section, page, pageSize, hasMore,
      items: docs.map((document) => ({
        id: document.id,
        label: friendlyAuxiliaryLabel(document.id),
        subtitle: document.id,
        updatedAt: timestampToIso(document.get('updatedAt')),
        clientUpdatedAt: typeof document.get('clientUpdatedAt') === 'string' ? document.get('clientUpdatedAt') : null,
        raw: serializeFirestoreValue(document.data()),
      })),
    };
  }

  if (section === 'profile') {
    const document = await userRef.collection('profile').doc('current').get();
    return {
      section, page: 0, pageSize: 1, hasMore: false,
      items: document.exists ? [{ id: 'current', label: 'Current profile', raw: serializeFirestoreValue(document.data()) }] : [],
    };
  }

  if (section === 'photoMemories') {
    const { docs, hasMore } = await getPagedDocuments(userRef.collection('photoMemories'), page, pageSize);
    return {
      section, page, pageSize, hasMore,
      items: docs.map((document) => ({
        id: document.id,
        label: document.get('deleted') === true ? 'Deleted Photo Memory' : 'Photo Memory',
        subtitle: document.id,
        raw: serializeFirestoreValue(document.data()),
      })),
    };
  }

  if (section === 'syncState') {
    const snapshot = await userRef.collection('syncState').get();
    return {
      section, page: 0, pageSize: snapshot.size, hasMore: false,
      items: snapshot.docs.map((document) => ({ id: document.id, label: document.id, raw: serializeFirestoreValue(document.data()) })),
    };
  }

  if (section === 'deletions') {
    // Read-only evidence of synchronized removals. Never restore or delete
    // records as a side effect of inspection.
    const snapshot = await userRef.collection('syncTombstones')
      .orderBy('deletedAt', 'desc')
      .offset(page * pageSize)
      .limit(pageSize + 1)
      .get();
    const docs = snapshot.docs.slice(0, pageSize);
    return {
      section, page, pageSize, hasMore: snapshot.size > pageSize,
      items: docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          label: `${typeof data.kind === 'string' ? data.kind : 'Record'} deletion`,
          subtitle: typeof data.recordId === 'string' ? data.recordId : document.id,
          updatedAt: timestampToIso(data.deletedAt),
          clientUpdatedAt: typeof data.clientUpdatedAt === 'string' ? data.clientUpdatedAt : null,
          raw: serializeFirestoreValue(data),
        };
      }),
    };
  }

  if (section === 'recoveryPoints') {
    const snapshot = await userRef.collection('recoverySnapshots')
      .orderBy('createdAtClient', 'desc')
      .offset(page * pageSize)
      .limit(pageSize + 1)
      .get();
    const docs = snapshot.docs.slice(0, pageSize);
    const hasMore = snapshot.size > pageSize;
    return {
      section, page, pageSize, hasMore,
      items: docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          label: typeof data.reason === 'string' ? data.reason : 'Recovery point',
          subtitle: typeof data.createdAtClient === 'string' ? data.createdAtClient : timestampToIso(data.createdAt) ?? '',
          counts: {
            books: typeof data.bookCount === 'number' ? data.bookCount : 0,
            sessions: typeof data.sessionCount === 'number' ? data.sessionCount : 0,
            auxiliary: typeof data.auxiliaryCount === 'number' ? data.auxiliaryCount : 0,
            photoMemories: typeof data.photoMemoryCount === 'number' ? data.photoMemoryCount : 0,
          },
          raw: serializeFirestoreValue(data),
        };
      }),
    };
  }

  const entitlement = await db.doc(`entitlements/${targetUserId}`).get();
  return {
    section: 'entitlement', page: 0, pageSize: 1, hasMore: false,
    items: entitlement.exists ? [{ id: targetUserId, label: 'Entitlement', raw: serializeFirestoreValue(entitlement.data()) }] : [],
  };
}

/**
 * Owner-only, strictly read-only investigation of missing book IDs.
 * Never creates records, changes tombstones, or initiates recovery.
 */
export const inspectMissingBookEvidence = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  memory: '512MiB',
  timeoutSeconds: 120,
}, async (request) => {
  await requireAdmin(request, ['owner']);
  const input = request.data as { targetUserId?: unknown; recordIds?: unknown } | undefined;
  const targetUserId = typeof input?.targetUserId === 'string' ? input.targetUserId.trim() : '';
  const recordIds = Array.isArray(input?.recordIds) ? input.recordIds : [];
  if (!targetUserId || targetUserId.length > 128 || recordIds.length < 1 || recordIds.length > 10
    || recordIds.some((id) => typeof id !== 'string' || !/^book-[a-zA-Z0-9-]{1,100}$/.test(id))) {
    throw new HttpsError('invalid-argument', 'A valid reader and up to ten book IDs are required.');
  }
  const ids = [...new Set(recordIds as string[])];
  const user = getFirestore().doc(`users/${targetUserId}`);
  const snapshotIndex = await user.collection('recoverySnapshots').orderBy('createdAtClient', 'desc').limit(30).get();
  const results = await Promise.all(ids.map(async (id) => {
    const [live, tombstone, snapshots] = await Promise.all([
      user.collection('books').doc(id).get(),
      user.collection('syncTombstones').doc(`books_${id}`).get(),
      Promise.all(snapshotIndex.docs.map(async (snapshot) => {
        const record = await snapshot.ref.collection('books').doc(id).get();
        if (!record.exists) return null;
        const stored = record.data() ?? {};
        const book = safeUnwrapRecord<StoredBook>(stored);
        const work = asRecord(book.work);
        return {
          snapshotId: snapshot.id,
          createdAtClient: snapshot.get('createdAtClient') ?? null,
          title: typeof work.title === 'string' ? work.title : null,
          author: typeof work.author === 'string' ? work.author : null,
          record: serializeFirestoreValue(stored),
        };
      })),
    ]);
    const liveStored = live.data() ?? {};
    const liveWork = asRecord(safeUnwrapRecord<StoredBook>(liveStored).work);
    return {
      id,
      liveExists: live.exists,
      liveTitle: live.exists && typeof liveWork.title === 'string' ? liveWork.title : null,
      liveRecord: live.exists ? serializeFirestoreValue(liveStored) : null,
      tombstone: tombstone.exists ? serializeFirestoreValue(tombstone.data()) : null,
      snapshotMatches: snapshots.filter((entry) => entry !== null),
    };
  }));
  return {
    readOnly: true,
    snapshotsInspected: snapshotIndex.size,
    snapshotLimit: 30,
    results,
  };
});

export const getAdminDashboard = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { admin } = await requireAdmin(request);
  const db = getFirestore();
  const input = request.data as { query?: unknown } | undefined;
  const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';

  const [directorySnapshot, entitlementsSnapshot, auditSnapshot, adminsSnapshot] = await Promise.all([
    db.collection('userDirectory').orderBy('lastSeenAt', 'desc').limit(100).get(),
    db.collection('entitlements').limit(250).get(),
    db.collection('adminAudit').orderBy('createdAt', 'desc').limit(50).get(),
    db.collection('admins').orderBy('email').get(),
  ]);

  const entitlements = new Map(entitlementsSnapshot.docs.map((document) => [document.id, document.data()]));

  const users = directorySnapshot.docs
    .map((document) => {
      const directory = document.data();
      const entitlement = entitlements.get(document.id) ?? {};
      const email = typeof directory.email === 'string' ? directory.email : '';
      const displayName = typeof directory.displayName === 'string' ? directory.displayName : '';
      const matches = !query || email.toLowerCase().includes(query) || displayName.toLowerCase().includes(query) || document.id.toLowerCase().includes(query);
      if (!matches) return null;

      return {
        uid: document.id,
        email,
        displayName,
        photoUrl: typeof directory.photoUrl === 'string' ? directory.photoUrl : '',
        emailVerified: directory.emailVerified === true,
        lastSeenAt: timestampToIso(directory.lastSeenAt),
        basePlan: entitlement.basePlan === 'premium' ? 'premium' : 'free',
        subscriptionStatus: typeof entitlement.subscriptionStatus === 'string' ? entitlement.subscriptionStatus : 'none',
        vipEnabled: entitlement.vipEnabled === true,
        courtesyPremiumUntil: timestampToIso(entitlement.courtesyPremiumUntil),
        paidPremiumUntil: timestampToIso(entitlement.paidPremiumUntil),
      };
    })
    .filter((user): user is NonNullable<typeof user> => user !== null);

  const now = Date.now();
  const totals = {
    users: entitlementsSnapshot.size,
    vip: entitlementsSnapshot.docs.filter((document) => document.get('vipEnabled') === true).length,
    courtesy: entitlementsSnapshot.docs.filter((document) => {
      const until = document.get('courtesyPremiumUntil');
      return until instanceof Timestamp && until.toMillis() > now;
    }).length,
    paid: entitlementsSnapshot.docs.filter((document) => {
      const status = document.get('subscriptionStatus');
      return status === 'active' || status === 'trialing';
    }).length,
  };

  const audit = auditSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      action: typeof data.action === 'string' ? data.action : 'unknown',
      targetEmail: typeof data.targetEmail === 'string' ? data.targetEmail : '',
      performedByEmail: typeof data.performedByEmail === 'string' ? data.performedByEmail : '',
      reason: typeof data.reason === 'string' ? data.reason : '',
      createdAt: timestampToIso(data.createdAt),
    };
  });

  const admins = adminsSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      uid: document.id,
      email: typeof data.email === 'string' ? data.email : '',
      role: (typeof data.role === 'string' ? data.role : 'viewer') as AdminRole,
      enabled: data.enabled === true,
      updatedAt: timestampToIso(data.updatedAt),
    };
  });

  return { role: admin.role, totals, users, audit, admins };
});

export const getAdminDataIntegrity = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  memory: '512MiB',
  timeoutSeconds: 120,
}, async (request) => {
  await requireAdmin(request, ['owner']);
  const input = request.data as { targetUserId?: unknown; detailSection?: unknown; page?: unknown; pageSize?: unknown; bookQuery?: unknown } | undefined;
  const targetUserId = typeof input?.targetUserId === 'string' ? input.targetUserId.trim() : '';
  if (!targetUserId || targetUserId.length > 128) throw new HttpsError('invalid-argument', 'A valid reader is required.');

  const validDetailSections: DetailSection[] = ['collections', 'books', 'sessions', 'auxiliary', 'profile', 'photoMemories', 'syncState', 'deletions', 'recoveryPoints', 'entitlement'];
  if (typeof input?.detailSection === 'string') {
    if (!validDetailSections.includes(input.detailSection as DetailSection)) throw new HttpsError('invalid-argument', 'Unsupported Firestore detail section.');
    const page = typeof input.page === 'number' && Number.isFinite(input.page) ? Math.max(0, Math.floor(input.page)) : 0;
    const requestedPageSize = typeof input.pageSize === 'number' && Number.isFinite(input.pageSize) ? Math.floor(input.pageSize) : 25;
    const pageSize = Math.min(50, Math.max(1, requestedPageSize));
    const bookQuery = typeof input.bookQuery === 'string' ? input.bookQuery.trim().slice(0, 120) : '';
    return { generatedAt: new Date().toISOString(), targetUserId, details: await getIntegrityDetail(targetUserId, input.detailSection as DetailSection, page, pageSize, bookQuery) };
  }

  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const warnings: string[] = [];
  console.info('Inkbound admin integrity: starting inspection.', { targetUserId });
  const [
    booksResult,
    sessionsResult,
    profileResult,
    auxiliaryResult,
    photoResult,
    recoveryResult,
    librarySyncResult,
    manualCoverCountResult,
  ] = await Promise.allSettled([
    userRef.collection('books').get(),
    userRef.collection('sessions').get(),
    userRef.collection('profile').doc('current').get(),
    userRef.collection('auxiliary').get(),
    userRef.collection('photoMemories').get(),
    userRef.collection('recoverySnapshots').get(),
    userRef.collection('syncState').doc('library').get(),
    userRef.collection('manualCoverAssignments').count().get(),
  ]);

  const describeFailure = (label: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === 'rejected') {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`${label}: ${message}`);
      console.error(`Inkbound admin integrity read failed for ${label}.`, result.reason);
    }
  };
  describeFailure('books', booksResult);
  describeFailure('sessions', sessionsResult);
  describeFailure('profile', profileResult);
  describeFailure('auxiliary', auxiliaryResult);
  describeFailure('photo memories', photoResult);
  describeFailure('recovery snapshots', recoveryResult);
  describeFailure('library sync state', librarySyncResult);
  describeFailure('manual cover index', manualCoverCountResult);

  console.info('Inkbound admin integrity: core reads settled.', {
    targetUserId,
    books: booksResult.status,
    sessions: sessionsResult.status,
    profile: profileResult.status,
    auxiliary: auxiliaryResult.status,
    photoMemories: photoResult.status,
    recoverySnapshots: recoveryResult.status,
    librarySync: librarySyncResult.status,
    manualCoverIndex: manualCoverCountResult.status,
  });

  const bookDocs = booksResult.status === 'fulfilled' ? booksResult.value.docs : [];
  const sessionDocs = sessionsResult.status === 'fulfilled' ? sessionsResult.value.docs : [];
  const profileSnapshot = profileResult.status === 'fulfilled' ? profileResult.value : null;
  const auxiliaryDocs = auxiliaryResult.status === 'fulfilled' ? auxiliaryResult.value.docs : [];
  const photoDocs = photoResult.status === 'fulfilled' ? photoResult.value.docs : [];
  const recoveryDocs = recoveryResult.status === 'fulfilled' ? recoveryResult.value.docs : [];
  const librarySyncSnapshot = librarySyncResult.status === 'fulfilled' ? librarySyncResult.value : null;
  const manualCoverAssignmentCount = manualCoverCountResult.status === 'fulfilled'
    ? manualCoverCountResult.value.data().count
    : 0;

  const books = bookDocs.map((document) => ({ documentId: document.id, book: safeUnwrapRecord<StoredBook>(document.data()) }));
  const sessions = sessionDocs.map((document) => ({ documentId: document.id, session: safeUnwrapRecord<StoredSession>(document.data()) }));
  const bookIds = new Set(books.map(({ documentId, book }) => typeof book.id === 'string' && book.id ? book.id : documentId));
  let activeCoverCount = 0;
  let anyCoverCount = 0;
  let importedBookCount = 0;
  let metadataVerifiedImportCount = 0;
  let visibleSummaryCount = 0;
  let publisherSummaryCount = 0;
  let missingActiveEditionCount = 0;
  let bookIdMismatchCount = 0;
  const duplicateIdentityBuckets = new Map<string, number>();

  books.forEach(({ documentId, book }) => {
    if (typeof book.id === 'string' && book.id && book.id !== documentId) bookIdMismatchCount += 1;
    const editions = asRecordArray(book.editions);
    const activeEditionId = typeof book.activeEditionId === 'string' ? book.activeEditionId : '';
    const activeEdition = activeEditionId ? editions.find((edition) => edition.id === activeEditionId) : editions[0];
    if (!activeEdition || (activeEditionId && !editions.some((edition) => edition.id === activeEditionId))) missingActiveEditionCount += 1;
    const activeCover = typeof activeEdition?.coverUrl === 'string' ? activeEdition.coverUrl.trim() : '';
    const hasAnyCover = editions.some((edition) => typeof edition.coverUrl === 'string' && edition.coverUrl.trim().length > 0);
    if (activeCover) activeCoverCount += 1;
    if (hasAnyCover) anyCoverCount += 1;
    const work = asRecord(book.work);
    const summary = typeof work.summary === 'string' ? work.summary.trim() : '';
    const publisherSummary = typeof work.publisherSummary === 'string'
      ? work.publisherSummary.trim()
      : typeof book['publisherSummary' as keyof StoredBook] === 'string' ? String(book['publisherSummary' as keyof StoredBook]).trim() : '';
    if (summary || publisherSummary) visibleSummaryCount += 1;
    if (publisherSummary) publisherSummaryCount += 1;
    const tags = asStringArray(book.privateTags).map((tag) => tag.toLowerCase());
    const source = typeof book.sourceOfImport === 'string' ? book.sourceOfImport.toLowerCase() : '';
    const imported = documentId.startsWith('book-import-') || source.includes('import') || tags.includes('imported');
    if (imported) {
      importedBookCount += 1;
      if (book.importMetadataVerified === true) metadataVerifiedImportCount += 1;
    }
    const isbn = editions.map((edition) => normalizeIsbn(edition.isbn13) || normalizeIsbn(edition.isbn10) || normalizeIsbn(edition.isbn)).find(Boolean) ?? '';
    const title = normalizeText(work.title);
    const author = normalizeText(work.author);
    const identity = isbn ? `isbn:${isbn}` : title && author ? `work:${title}::${author}` : '';
    if (identity) duplicateIdentityBuckets.set(identity, (duplicateIdentityBuckets.get(identity) ?? 0) + 1);
  });

  let sessionIdMismatchCount = 0;
  let orphanSessionCount = 0;
  let malformedSessionCount = 0;
  sessions.forEach(({ documentId, session }) => {
    if (typeof session.id === 'string' && session.id && session.id !== documentId) sessionIdMismatchCount += 1;
    const bookId = typeof session.bookId === 'string' ? session.bookId.trim() : '';
    if (!bookId) malformedSessionCount += 1;
    else if (!bookIds.has(bookId)) orphanSessionCount += 1;
  });

  const possibleDuplicateIdentityGroups = [...duplicateIdentityBuckets.values()].filter((count) => count > 1).length;
  const activePhotoMemories = photoDocs.filter((document) => document.get('deleted') !== true).length;
  const deletedPhotoMemories = photoDocs.length - activePhotoMemories;
  const recoveryPoints = recoveryDocs.map((document) => {
    const data = document.data();
    return { createdAtClient: typeof data.createdAtClient === 'string' ? data.createdAtClient : '', createdAt: timestampToIso(data.createdAt) };
  });
  recoveryPoints.sort((a, b) => (b.createdAtClient || b.createdAt || '').localeCompare(a.createdAtClient || a.createdAt || ''));

  let storageStatus: 'available' | 'unavailable' = 'available';
  try {
    // Do not enumerate every user file here. Storage inspection must remain
    // constant-time even for extremely large libraries (for example 50k books).
    // Bucket metadata is a lightweight health probe; exact media counts come
    // from Firestore indexes/records rather than walking the Storage bucket.
    await withTimeout(getStorage().bucket().getMetadata(), 5000, 'Storage health check');
  } catch (error) {
    storageStatus = 'unavailable';
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`storage health check: ${message}`);
    console.warn('Inkbound admin integrity storage health check unavailable.', error);
  }

  const criticalIssueCount = bookIdMismatchCount + sessionIdMismatchCount + missingActiveEditionCount + orphanSessionCount + malformedSessionCount;
  const syncState = librarySyncSnapshot?.data() ?? {};
  const expectedBookCount = typeof syncState.expectedBookCount === 'number' ? Math.max(0, syncState.expectedBookCount) : 0;
  const cloudBookCount = bookDocs.length;
  const backupRemaining = expectedBookCount > 0 ? Math.max(0, expectedBookCount - cloudBookCount) : 0;
  const backupComplete = expectedBookCount > 0 && cloudBookCount === expectedBookCount && syncState.status === 'complete';
  const backupCountMismatch = expectedBookCount > 0 && cloudBookCount !== expectedBookCount;

  console.info('Inkbound admin integrity: inspection completed.', {
    targetUserId,
    books: cloudBookCount,
    sessions: sessionDocs.length,
    warnings: warnings.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    targetUserId,
    health: criticalIssueCount === 0 ? 'healthy' : 'needs-attention',
    criticalIssueCount,
    library: {
      books: cloudBookCount,
      sessions: sessionDocs.length,
      activeCovers: activeCoverCount,
      booksWithAnyCover: anyCoverCount,
      missingActiveCovers: Math.max(0, cloudBookCount - activeCoverCount),
      visibleSummaries: visibleSummaryCount,
      publisherSummaries: publisherSummaryCount,
      importedBooks: importedBookCount,
      metadataVerifiedImports: metadataVerifiedImportCount,
      possibleDuplicateIdentityGroups,
    },
    backup: {
      tracked: expectedBookCount > 0,
      complete: backupComplete,
      expectedBooks: expectedBookCount,
      savedBooks: cloudBookCount,
      remainingBooks: backupRemaining,
      percentComplete: backupComplete ? 100 : backupCountMismatch ? Math.min(99, Math.round((Math.min(cloudBookCount, expectedBookCount) / expectedBookCount) * 100)) : 0,
      status: backupCountMismatch ? 'inventory-mismatch' : (typeof syncState.status === 'string' ? syncState.status : 'unverified'),
    },
    structure: {
      bookIdMismatches: bookIdMismatchCount,
      sessionIdMismatches: sessionIdMismatchCount,
      missingActiveEditions: missingActiveEditionCount,
      orphanSessions: orphanSessionCount,
      malformedSessions: malformedSessionCount,
    },
    cloud: {
      profilePresent: profileSnapshot?.exists ?? false,
      auxiliaryRecords: auxiliaryDocs.length,
      photoMemories: activePhotoMemories,
      deletedPhotoMemories,
      recoveryPoints: recoveryDocs.length,
      latestRecoveryPointAt: recoveryPoints[0]?.createdAtClient || recoveryPoints[0]?.createdAt || null,
    },
    warnings,
    storage: {
      status: storageStatus,
      inventoryMode: 'indexed',
      manualCoverAssignments: manualCoverAssignmentCount,
      photoMemoryRecords: photoDocs.length,
      exactFileCountEnumerated: false,
    },
  };
});

export const setAdminAccess = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { auth, admin } = await requireAdmin(request, ['owner']);
  const data = request.data as Record<string, unknown> | undefined;
  const targetUserId = typeof data?.targetUserId === 'string' ? data.targetUserId.trim() : '';
  const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
  const role = data?.role as AdminRole | undefined;
  const enabled = data?.enabled === true;
  const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';
  const validRoles: AdminRole[] = ['owner', 'support', 'billing', 'viewer'];
  if (!targetUserId || !email || !role || !validRoles.includes(role) || !reason) throw new HttpsError('invalid-argument', 'User, email, role, and reason are required.');
  if (targetUserId === auth.uid && !enabled) throw new HttpsError('failed-precondition', 'You cannot disable your own administrator access.');
  const db = getFirestore();
  const adminRef = db.doc(`admins/${targetUserId}`);
  const previous = (await adminRef.get()).data() ?? null;
  await adminRef.set({ email, role, enabled, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid, ...(previous ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: auth.uid }) }, { merge: true });
  await db.collection('adminAudit').add({ action: enabled ? 'set_admin_access' : 'disable_admin_access', targetUserId, targetEmail: email, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { role, enabled }, createdAt: FieldValue.serverTimestamp() });
  return { success: true };
});

/**
 * Read-only record-ID inventory audit. Does not restore, delete, or modify data.
 * Local IDs are supplied by the inspecting device, never treated as authoritative
 * deletion instructions.
 */
export const auditAdminLibraryInventory = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  memory: '512MiB',
  timeoutSeconds: 120,
}, async (request) => {
  await requireAdmin(request, ['owner']);
  const input = request.data as { targetUserId?: unknown; localBooks?: unknown } | undefined;
  const uid = typeof input?.targetUserId === 'string' ? input.targetUserId.trim() : '';
  if (!uid || uid.length > 128) throw new HttpsError('invalid-argument', 'A valid reader is required.');
  if (!Array.isArray(input?.localBooks) || input.localBooks.length > 10000) {
    throw new HttpsError('invalid-argument', 'Provide the inspecting device library inventory (up to 10,000 books).');
  }
  const local = new Map<string, { id: string; title: string }>();
  for (const item of input.localBooks) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { id?: unknown; title?: unknown };
    if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 256) continue;
    local.set(record.id, { id: record.id, title: typeof record.title === 'string' ? record.title.slice(0, 200) : '' });
  }
  const user = getFirestore().doc(`users/${uid}`);
  const [cloudSnapshot, tombstoneSnapshot, manifestSnapshot] = await Promise.all([
    user.collection('books').get(),
    user.collection('syncTombstones').get(),
    user.collection('syncState').doc('library').get(),
  ]);
  const cloud = new Map(cloudSnapshot.docs.map((entry) => {
    const data = entry.data();
    const work = asRecord(data.work);
    return [entry.id, {
      id: entry.id,
      title: String(work.title ?? data.title ?? '').slice(0, 200),
      updatedAt: timestampToIso(data.updatedAt),
    }] as const;
  }));
  const deleted = new Map<string, number>();
  tombstoneSnapshot.docs.forEach((entry) => {
    const data = entry.data();
    if (data.kind !== 'books' || typeof data.recordId !== 'string' || !(data.deletedAt instanceof Timestamp)) return;
    deleted.set(data.recordId, Math.max(deleted.get(data.recordId) ?? 0, data.deletedAt.toMillis()));
  });
  const cloudOnly = [...cloud.values()].filter((book) => !local.has(book.id)).map((book) => ({
    ...book, tombstoned: deleted.has(book.id), tombstoneAt: deleted.has(book.id) ? new Date(deleted.get(book.id)!).toISOString() : null,
  }));
  const localOnly = [...local.values()].filter((book) => !cloud.has(book.id));
  const tombstonedButPresent = [...cloud.values()].filter((book) => deleted.has(book.id)).map((book) => ({
    ...book, tombstoneAt: new Date(deleted.get(book.id)!).toISOString(),
  }));
  const manifest = manifestSnapshot.data() ?? {};
  return {
    generatedAt: new Date().toISOString(),
    deviceCount: local.size,
    cloudCount: cloud.size,
    checkpointExpected: typeof manifest.expectedBookCount === 'number' ? manifest.expectedBookCount : null,
    checkpointStatus: typeof manifest.status === 'string' ? manifest.status : null,
    cloudOnly, localOnly, tombstonedButPresent,
    note: 'Read-only comparison against this device. Differences can include pending changes; no records were modified.',
  };
});
