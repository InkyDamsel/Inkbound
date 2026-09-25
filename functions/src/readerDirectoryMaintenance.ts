import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);
const auth = getAuth(adminApp);
const bucket = getStorage(adminApp).bucket();
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const OWNER_EMAILS = new Set([
  'blackdame494@gmail.com',
  'inkbound@inkydameinteractive.com',
]);

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function profileData(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord('data' in value ? value.data : value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

async function requireAdmin(request: CallableRequest<unknown>, allowedRoles?: AdminRole[]) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const snapshot = await db.doc(`admins/${request.auth.uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled || (allowedRoles && !allowedRoles.includes(record.role))) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return record;
}

async function removeInkboundDataForUid(uid: string) {
  await Promise.all([
    db.recursiveDelete(db.doc(`users/${uid}`)),
    db.doc(`userDirectory/${uid}`).delete(),
    db.doc(`entitlements/${uid}`).delete(),
    db.doc(`admins/${uid}`).delete(),
  ]);

  await bucket.deleteFiles({ prefix: `users/${uid}/` }).catch((error: unknown) => {
    console.warn(`Could not remove every Storage object for stale Firebase user ${uid}.`, error);
  });
}

async function canonicalDirectoryRecord(user: UserRecord) {
  const [profileSnapshot, directorySnapshot] = await Promise.all([
    db.doc(`users/${user.uid}/profile/current`).get(),
    db.doc(`userDirectory/${user.uid}`).get(),
  ]);

  const profile = profileData(profileSnapshot.data() ?? {});
  const existing = directorySnapshot.data() ?? {};

  return {
    uid: user.uid,
    email: text(user.email).toLowerCase(),
    displayName: text(profile.displayName) || text(user.displayName) || text(existing.displayName),
    photoUrl: text(profile.avatarImage) || text(user.photoURL) || text(existing.photoUrl),
    emailVerified: user.emailVerified,
    authProviderIds: user.providerData.map((provider) => provider.providerId),
    updatedAt: FieldValue.serverTimestamp(),
    ...(directorySnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };
}

async function listAllAuthUsers(): Promise<UserRecord[]> {
  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function reconcileDirectory() {
  const [authUsers, directorySnapshot, entitlementsSnapshot] = await Promise.all([
    listAllAuthUsers(),
    db.collection('userDirectory').get(),
    db.collection('entitlements').get(),
  ]);

  const authUidSet = new Set(authUsers.map((user) => user.uid));
  const staleUids = new Set<string>();
  directorySnapshot.docs.forEach((document) => {
    if (!authUidSet.has(document.id)) staleUids.add(document.id);
  });
  entitlementsSnapshot.docs.forEach((document) => {
    if (!authUidSet.has(document.id)) staleUids.add(document.id);
  });

  await Promise.all([...staleUids].map((uid) => removeInkboundDataForUid(uid)));

  const canonicalRecords = await Promise.all(authUsers.map(async (user) => ({
    user,
    record: await canonicalDirectoryRecord(user),
  })));

  await Promise.all(canonicalRecords.map(({ user, record }) =>
    db.doc(`userDirectory/${user.uid}`).set(record, { merge: true })));

  return authUsers;
}

/**
 * Firebase Auth is the canonical account list. Each dashboard refresh reconciles
 * Firestore against Auth, removes stale Inkbound records for deleted Auth users,
 * and derives names/photos from the reader's canonical Inkbound profile.
 */
export const getAdminDashboard = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const admin = await requireAdmin(request);
  const input = request.data as { query?: unknown } | undefined;
  const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';

  const authUsers = await reconcileDirectory();
  const [directorySnapshot, entitlementsSnapshot, auditSnapshot, adminsSnapshot] = await Promise.all([
    db.collection('userDirectory').get(),
    db.collection('entitlements').get(),
    db.collection('adminAudit').orderBy('createdAt', 'desc').limit(50).get(),
    db.collection('admins').orderBy('email').get(),
  ]);

  const directory = new Map(directorySnapshot.docs.map((document) => [document.id, document.data()]));
  const entitlements = new Map(entitlementsSnapshot.docs.map((document) => [document.id, document.data()]));
  const authUidSet = new Set(authUsers.map((user) => user.uid));

  const users = authUsers
    .map((user) => {
      const record = directory.get(user.uid) ?? {};
      const entitlement = entitlements.get(user.uid) ?? {};
      const email = text(user.email).toLowerCase();
      const displayName = text(record.displayName) || text(user.displayName);
      const photoUrl = text(record.photoUrl) || text(user.photoURL);
      const matches = !query
        || email.includes(query)
        || displayName.toLowerCase().includes(query)
        || user.uid.toLowerCase().includes(query);
      if (!matches) return null;

      return {
        uid: user.uid,
        email,
        displayName,
        photoUrl,
        emailVerified: user.emailVerified,
        lastSeenAt: timestampToIso(record.lastSeenAt),
        basePlan: entitlement.basePlan === 'premium' ? 'premium' : 'free',
        subscriptionStatus: typeof entitlement.subscriptionStatus === 'string' ? entitlement.subscriptionStatus : 'none',
        vipEnabled: entitlement.vipEnabled === true,
        courtesyPremiumUntil: timestampToIso(entitlement.courtesyPremiumUntil),
        paidPremiumUntil: timestampToIso(entitlement.paidPremiumUntil),
      };
    })
    .filter((user): user is NonNullable<typeof user> => user !== null)
    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

  const activeEntitlements = entitlementsSnapshot.docs.filter((document) => authUidSet.has(document.id));
  const now = Date.now();
  const totals = {
    users: authUsers.length,
    vip: activeEntitlements.filter((document) => document.get('vipEnabled') === true).length,
    courtesy: activeEntitlements.filter((document) => {
      const until = document.get('courtesyPremiumUntil');
      return until instanceof Timestamp && until.toMillis() > now;
    }).length,
    paid: activeEntitlements.filter((document) => {
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

  const admins = adminsSnapshot.docs
    .filter((document) => authUidSet.has(document.id))
    .map((document) => {
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


function normalizedEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireReason(value: unknown): string {
  const reason = text(value);
  if (!reason || reason.length > 1000) throw new HttpsError('invalid-argument', 'A reason is required.');
  return reason;
}

function timestampMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function paidSubscriptionActive(entitlement: Record<string, unknown>): boolean {
  const status = text(entitlement.subscriptionStatus);
  const paidUntil = timestampMillis(entitlement.paidPremiumUntil);
  return status === 'active' || status === 'trialing' || (status === 'canceled' && paidUntil > Date.now());
}

async function writeOwnerAudit(input: {
  action: string;
  targetUserId: string;
  targetEmail: string;
  performedBy: string;
  performedByEmail: string;
  reason: string;
  previousValue: unknown;
  newValue: unknown;
}) {
  await db.collection('adminAudit').add({
    ...input,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function copyCollectionWithoutOverwrite(
  source: FirebaseFirestore.CollectionReference,
  target: FirebaseFirestore.CollectionReference,
  prefixOnCollision = false,
) {
  const sourceSnapshot = await source.get();
  if (sourceSnapshot.empty) return { copied: 0 };

  const collisions: string[] = [];
  const writes: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];

  for (const document of sourceSnapshot.docs) {
    let targetId = document.id;
    let targetRef = target.doc(targetId);
    let targetSnapshot = await targetRef.get();
    if (targetSnapshot.exists) {
      if (!prefixOnCollision) {
        // A prior interrupted merge may already have copied this exact record.
        // Treat byte-equivalent data as complete so the operation is retryable;
        // genuinely different records remain a hard conflict.
        if (JSON.stringify(targetSnapshot.data()) === JSON.stringify(document.data())) continue;
        collisions.push(document.id);
        continue;
      }
      targetId = `merged-${source.parent.parent?.id ?? 'source'}-${document.id}`;
      targetRef = target.doc(targetId);
      targetSnapshot = await targetRef.get();
      if (targetSnapshot.exists) {
        if (JSON.stringify(targetSnapshot.data()) === JSON.stringify(document.data())) continue;
        collisions.push(document.id);
        continue;
      }
    }
    writes.push({ id: targetId, data: document.data() });
  }

  if (collisions.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Account merge stopped before deleting anything because ${source.id} contains ${collisions.length} conflicting record${collisions.length === 1 ? '' : 's'}. Resolve the duplicate data first.`,
    );
  }

  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    writes.slice(index, index + 400).forEach((write) => batch.set(target.doc(write.id), write.data));
    await batch.commit();
  }

  return { copied: writes.length };
}

export const correctAdminUserEmail = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const admin = await requireAdmin(request, ['owner']);
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = text(input?.targetUserId);
  const currentEmail = normalizedEmail(input?.currentEmail);
  const newEmail = normalizedEmail(input?.newEmail);
  const reason = requireReason(input?.reason);

  if (!targetUserId || !currentEmail || !newEmail || !newEmail.includes('@')) {
    throw new HttpsError('invalid-argument', 'Reader, current email, and corrected email are required.');
  }
  if (OWNER_EMAILS.has(currentEmail) || OWNER_EMAILS.has(newEmail)) {
    throw new HttpsError('failed-precondition', 'Protected owner email addresses cannot be changed with this tool.');
  }

  const user = await auth.getUser(targetUserId).catch(() => null);
  if (!user || normalizedEmail(user.email) !== currentEmail) {
    throw new HttpsError('failed-precondition', 'The selected Firebase account no longer matches this email. Refresh Administration and try again.');
  }
  if (newEmail === currentEmail) throw new HttpsError('invalid-argument', 'The corrected email is the same as the current email.');

  const existing = await auth.getUserByEmail(newEmail).catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'auth/user-not-found') return null;
    throw error;
  });
  if (existing && existing.uid !== targetUserId) {
    throw new HttpsError('already-exists', 'That email already belongs to another Inkbound account. Use Merge Accounts instead.');
  }

  await auth.updateUser(targetUserId, { email: newEmail, emailVerified: false });
  await db.doc(`userDirectory/${targetUserId}`).set({
    email: newEmail,
    emailVerified: false,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const adminRef = db.doc(`admins/${targetUserId}`);
  if ((await adminRef.get()).exists) {
    await adminRef.set({ email: newEmail, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  await writeOwnerAudit({
    action: 'correct_user_email',
    targetUserId,
    targetEmail: newEmail,
    performedBy: request.auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: { email: currentEmail },
    newValue: { email: newEmail, emailVerified: false },
  });

  return { success: true, email: newEmail };
});

export const mergeAdminUserAccounts = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  memory: '512MiB',
  timeoutSeconds: 120,
}, async (request) => {
  const admin = await requireAdmin(request, ['owner']);
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const input = request.data as Record<string, unknown> | undefined;
  const sourceUserId = text(input?.sourceUserId);
  const sourceEmail = normalizedEmail(input?.sourceEmail);
  const targetEmail = normalizedEmail(input?.targetEmail);
  const reason = requireReason(input?.reason);
  const confirmation = text(input?.confirmation).toLowerCase();

  if (!sourceUserId || !sourceEmail || !targetEmail) {
    throw new HttpsError('invalid-argument', 'Source account and destination email are required.');
  }
  if (sourceEmail === targetEmail) throw new HttpsError('invalid-argument', 'Choose a different destination account.');
  if (OWNER_EMAILS.has(sourceEmail) || OWNER_EMAILS.has(targetEmail)) {
    throw new HttpsError('failed-precondition', 'Protected owner accounts cannot be merged with this tool.');
  }
  if (confirmation !== `merge ${sourceEmail} into ${targetEmail}`) {
    throw new HttpsError('failed-precondition', `Type MERGE ${sourceEmail} INTO ${targetEmail} exactly to confirm.`);
  }

  const [sourceUser, targetUser] = await Promise.all([
    auth.getUser(sourceUserId).catch(() => null),
    auth.getUserByEmail(targetEmail).catch(() => null),
  ]);
  if (!sourceUser || normalizedEmail(sourceUser.email) !== sourceEmail) {
    throw new HttpsError('failed-precondition', 'The selected source account changed. Refresh Administration and try again.');
  }
  if (!targetUser) throw new HttpsError('not-found', 'No destination account exists with that email.');
  if (targetUser.uid === sourceUserId) throw new HttpsError('invalid-argument', 'Source and destination resolve to the same Firebase account.');

  const [sourceEntitlementSnapshot, targetEntitlementSnapshot] = await Promise.all([
    db.doc(`entitlements/${sourceUserId}`).get(),
    db.doc(`entitlements/${targetUser.uid}`).get(),
  ]);
  const sourceEntitlement = sourceEntitlementSnapshot.data() ?? {};
  const targetEntitlement = targetEntitlementSnapshot.data() ?? {};
  if (paidSubscriptionActive(sourceEntitlement)) {
    throw new HttpsError('failed-precondition', 'The source account has active paid access. Resolve its billing subscription before merging accounts.');
  }

  const sourceRef = db.doc(`users/${sourceUserId}`);
  const targetRef = db.doc(`users/${targetUser.uid}`);

  const [books, sessions, photoMemories, auxiliary, recoverySnapshots] = await Promise.all([
    copyCollectionWithoutOverwrite(sourceRef.collection('books'), targetRef.collection('books')),
    copyCollectionWithoutOverwrite(sourceRef.collection('sessions'), targetRef.collection('sessions')),
    copyCollectionWithoutOverwrite(sourceRef.collection('photoMemories'), targetRef.collection('photoMemories')),
    copyCollectionWithoutOverwrite(sourceRef.collection('auxiliary'), targetRef.collection('auxiliary')),
    copyCollectionWithoutOverwrite(sourceRef.collection('recoverySnapshots'), targetRef.collection('recoverySnapshots'), true),
  ]);

  const [sourceProfile, targetProfile] = await Promise.all([
    sourceRef.collection('profile').doc('current').get(),
    targetRef.collection('profile').doc('current').get(),
  ]);
  if (sourceProfile.exists && !targetProfile.exists) {
    await targetRef.collection('profile').doc('current').set(sourceProfile.data() ?? {});
  }

  // syncState is device/account bookkeeping, not reader content. Do not copy the
  // source account's cursors/checkpoints into the destination account.

  const sourceCourtesy = timestampMillis(sourceEntitlement.courtesyPremiumUntil);
  const targetCourtesy = timestampMillis(targetEntitlement.courtesyPremiumUntil);
  const courtesyPremiumUntil = Math.max(sourceCourtesy, targetCourtesy);
  const vipEnabled = sourceEntitlement.vipEnabled === true || targetEntitlement.vipEnabled === true;
  const targetEntitlementPatch: Record<string, unknown> = {
    vipEnabled,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  };
  if (courtesyPremiumUntil > 0) targetEntitlementPatch.courtesyPremiumUntil = Timestamp.fromMillis(courtesyPremiumUntil);
  if (vipEnabled || courtesyPremiumUntil > Date.now()) targetEntitlementPatch.basePlan = 'premium';
  await db.doc(`entitlements/${targetUser.uid}`).set(targetEntitlementPatch, { merge: true });

  const [sourceFiles] = await bucket.getFiles({ prefix: `users/${sourceUserId}/` });
  for (const file of sourceFiles) {
    const suffix = file.name.slice(`users/${sourceUserId}/`.length);
    const destinationName = `users/${targetUser.uid}/${suffix}`;
    const destination = bucket.file(destinationName);
    const [exists] = await destination.exists();
    if (exists) {
      const [[sourceMetadata], [destinationMetadata]] = await Promise.all([
        file.getMetadata(),
        destination.getMetadata(),
      ]);
      const sameFile = sourceMetadata.size === destinationMetadata.size
        && Boolean(sourceMetadata.md5Hash)
        && sourceMetadata.md5Hash === destinationMetadata.md5Hash;
      if (sameFile) continue;
      throw new HttpsError('failed-precondition', `Account merge stopped because destination storage already contains a different ${suffix}. No source account was deleted.`);
    }
    await file.copy(destination);
  }

  await db.doc(`userDirectory/${targetUser.uid}`).set({
    uid: targetUser.uid,
    email: targetEmail,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeOwnerAudit({
    action: 'merge_user_accounts',
    targetUserId: targetUser.uid,
    targetEmail,
    performedBy: request.auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: { sourceUserId, sourceEmail },
    newValue: {
      destinationUserId: targetUser.uid,
      destinationEmail: targetEmail,
      copied: {
        books: books.copied,
        sessions: sessions.copied,
        photoMemories: photoMemories.copied,
        auxiliary: auxiliary.copied,
        recoverySnapshots: recoverySnapshots.copied,
        storageFiles: sourceFiles.length,
      },
    },
  });

  await removeInkboundDataForUid(sourceUserId);
  const billingSnapshots = await db.collection('billingSubscriptions').where('uid', '==', sourceUserId).get();
  await Promise.all(billingSnapshots.docs.map((document) => document.ref.delete()));
  await auth.deleteUser(sourceUserId);

  return {
    success: true,
    destinationUserId: targetUser.uid,
    destinationEmail: targetEmail,
    copied: {
      books: books.copied,
      sessions: sessions.copied,
      photoMemories: photoMemories.copied,
      auxiliary: auxiliary.copied,
      recoverySnapshots: recoverySnapshots.copied,
      storageFiles: sourceFiles.length,
    },
  };
});
