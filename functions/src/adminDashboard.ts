import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';

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
}

interface StoredSession {
  id?: unknown;
  bookId?: unknown;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
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

function unwrapData<T>(value: Record<string, unknown>): T {
  return ('data' in value ? value.data : value) as T;
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

/**
 * Owner-only, read-only account audit. This function intentionally performs no
 * writes and does not participate in the normal sync path. It inspects canonical
 * cloud records directly so the Administration UI can diagnose persistence and
 * import integrity without mounting another client-side source of truth.
 */
export const getAdminDataIntegrity = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await requireAdmin(request, ['owner']);
  const input = request.data as { targetUserId?: unknown } | undefined;
  const targetUserId = typeof input?.targetUserId === 'string' ? input.targetUserId.trim() : '';
  if (!targetUserId || targetUserId.length > 128) {
    throw new HttpsError('invalid-argument', 'A valid reader is required.');
  }

  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const [booksSnapshot, sessionsSnapshot, profileSnapshot, auxiliarySnapshot, photoSnapshot, recoverySnapshot] = await Promise.all([
    userRef.collection('books').get(),
    userRef.collection('sessions').get(),
    userRef.collection('profile').doc('current').get(),
    userRef.collection('auxiliary').get(),
    userRef.collection('photoMemories').get(),
    userRef.collection('recoverySnapshots').get(),
  ]);

  const books = booksSnapshot.docs.map((document) => ({
    documentId: document.id,
    book: unwrapData<StoredBook>(document.data()),
  }));
  const sessions = sessionsSnapshot.docs.map((document) => ({
    documentId: document.id,
    session: unwrapData<StoredSession>(document.data()),
  }));

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
    const activeEdition = activeEditionId
      ? editions.find((edition) => edition.id === activeEditionId)
      : editions[0];
    if (!activeEdition || (activeEditionId && !editions.some((edition) => edition.id === activeEditionId))) {
      missingActiveEditionCount += 1;
    }

    const activeCover = typeof activeEdition?.coverUrl === 'string' ? activeEdition.coverUrl.trim() : '';
    const hasAnyCover = editions.some((edition) => typeof edition.coverUrl === 'string' && edition.coverUrl.trim().length > 0);
    if (activeCover) activeCoverCount += 1;
    if (hasAnyCover) anyCoverCount += 1;

    const work = asRecord(book.work);
    const summary = typeof work.summary === 'string' ? work.summary.trim() : '';
    const publisherSummary = typeof work.publisherSummary === 'string'
      ? work.publisherSummary.trim()
      : typeof book['publisherSummary' as keyof StoredBook] === 'string'
        ? String(book['publisherSummary' as keyof StoredBook]).trim()
        : '';
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
  const activePhotoMemories = photoSnapshot.docs.filter((document) => document.get('deleted') !== true).length;
  const deletedPhotoMemories = photoSnapshot.size - activePhotoMemories;

  const recoveryPoints = recoverySnapshot.docs.map((document) => {
    const data = document.data();
    return {
      createdAtClient: typeof data.createdAtClient === 'string' ? data.createdAtClient : '',
      createdAt: timestampToIso(data.createdAt),
    };
  });
  recoveryPoints.sort((a, b) => (b.createdAtClient || b.createdAt || '').localeCompare(a.createdAtClient || a.createdAt || ''));

  let storageStatus: 'available' | 'unavailable' = 'available';
  let storageFileCount = 0;
  let bookCoverFileCount = 0;
  let photoMemoryFileCount = 0;
  let profileMediaFileCount = 0;
  try {
    const [files] = await getStorage().bucket().getFiles({ prefix: `users/${targetUserId}/` });
    storageFileCount = files.length;
    bookCoverFileCount = files.filter((file) => file.name.includes('/book-covers/')).length;
    photoMemoryFileCount = files.filter((file) => file.name.includes('/photo-memories/')).length;
    profileMediaFileCount = files.filter((file) => file.name.includes('/profile/')).length;
  } catch {
    storageStatus = 'unavailable';
  }

  const criticalIssueCount = bookIdMismatchCount
    + sessionIdMismatchCount
    + missingActiveEditionCount
    + orphanSessionCount
    + malformedSessionCount;

  return {
    generatedAt: new Date().toISOString(),
    targetUserId,
    health: criticalIssueCount === 0 ? 'healthy' : 'needs-attention',
    criticalIssueCount,
    library: {
      books: booksSnapshot.size,
      sessions: sessionsSnapshot.size,
      activeCovers: activeCoverCount,
      booksWithAnyCover: anyCoverCount,
      missingActiveCovers: Math.max(0, booksSnapshot.size - activeCoverCount),
      visibleSummaries: visibleSummaryCount,
      publisherSummaries: publisherSummaryCount,
      importedBooks: importedBookCount,
      metadataVerifiedImports: metadataVerifiedImportCount,
      possibleDuplicateIdentityGroups,
    },
    structure: {
      bookIdMismatches: bookIdMismatchCount,
      sessionIdMismatches: sessionIdMismatchCount,
      missingActiveEditions: missingActiveEditionCount,
      orphanSessions: orphanSessionCount,
      malformedSessions: malformedSessionCount,
    },
    cloud: {
      profilePresent: profileSnapshot.exists,
      auxiliaryRecords: auxiliarySnapshot.size,
      photoMemories: activePhotoMemories,
      deletedPhotoMemories,
      recoveryPoints: recoverySnapshot.size,
      latestRecoveryPointAt: recoveryPoints[0]?.createdAtClient || recoveryPoints[0]?.createdAt || null,
    },
    storage: {
      status: storageStatus,
      files: storageFileCount,
      bookCoverFiles: bookCoverFileCount,
      photoMemoryFiles: photoMemoryFileCount,
      profileMediaFiles: profileMediaFileCount,
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

  if (!targetUserId || !email || !role || !validRoles.includes(role) || !reason) {
    throw new HttpsError('invalid-argument', 'User, email, role, and reason are required.');
  }
  if (targetUserId === auth.uid && !enabled) {
    throw new HttpsError('failed-precondition', 'You cannot disable your own administrator access.');
  }

  const db = getFirestore();
  const adminRef = db.doc(`admins/${targetUserId}`);
  const previous = (await adminRef.get()).data() ?? null;

  await adminRef.set({
    email,
    role,
    enabled,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.uid,
    ...(previous ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: auth.uid }),
  }, { merge: true });

  await db.collection('adminAudit').add({
    action: enabled ? 'set_admin_access' : 'disable_admin_access',
    targetUserId,
    targetEmail: email,
    performedBy: auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: previous,
    newValue: { role, enabled },
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true };
});
