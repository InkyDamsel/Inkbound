import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { auth as authV1 } from 'firebase-functions/v1';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

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

async function requireAdmin(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const snapshot = await db.doc(`admins/${request.auth.uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled) throw new HttpsError('permission-denied', 'Administrator access is required.');
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
    console.warn(`Could not remove every Storage object for deleted Firebase user ${uid}.`, error);
  });
}

async function canonicalDirectoryRecord(user: UserRecord) {
  const [profileSnapshot, directorySnapshot] = await Promise.all([
    db.doc(`users/${user.uid}/profile/current`).get(),
    db.doc(`userDirectory/${user.uid}`).get(),
  ]);

  const profile = profileData(profileSnapshot.data() ?? {});
  const existing = directorySnapshot.data() ?? {};

  const displayName = text(profile.displayName)
    || text(user.displayName)
    || text(existing.displayName);
  const photoUrl = text(profile.avatarImage)
    || text(user.photoURL)
    || text(existing.photoUrl);

  return {
    uid: user.uid,
    email: text(user.email).toLowerCase(),
    displayName,
    photoUrl,
    emailVerified: user.emailVerified,
    authProviderIds: user.providerData.map((provider) => provider.providerId),
    updatedAt: FieldValue.serverTimestamp(),
    ...(directorySnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };
}

async function upsertCanonicalDirectoryForUid(uid: string) {
  let user: UserRecord;
  try {
    user = await auth.getUser(uid);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code === 'auth/user-not-found') {
      await removeInkboundDataForUid(uid);
      return;
    }
    throw error;
  }

  const record = await canonicalDirectoryRecord(user);
  await db.doc(`userDirectory/${uid}`).set(record, { merge: true });
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

  const authByUid = new Map(authUsers.map((user) => [user.uid, user]));
  const staleUids = new Set<string>();

  directorySnapshot.docs.forEach((document) => {
    if (!authByUid.has(document.id)) staleUids.add(document.id);
  });
  entitlementsSnapshot.docs.forEach((document) => {
    if (!authByUid.has(document.id)) staleUids.add(document.id);
  });

  await Promise.all([...staleUids].map((uid) => removeInkboundDataForUid(uid)));

  const canonicalRecords = await Promise.all(authUsers.map(async (user) => ({
    user,
    record: await canonicalDirectoryRecord(user),
  })));

  await Promise.all(canonicalRecords.map(({ user, record }) =>
    db.doc(`userDirectory/${user.uid}`).set(record, { merge: true })));

  return { authUsers, staleUids };
}

/** Firebase Auth is the canonical account list for the Administration reader list. */
export const getAdminDashboard = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const admin = await requireAdmin(request);
  const input = request.data as { query?: unknown } | undefined;
  const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';

  const { authUsers } = await reconcileDirectory();
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
    .sort((a, b) => {
      const aName = a.displayName || a.email;
      const bName = b.displayName || b.email;
      return aName.localeCompare(bName);
    });

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

/** Remove all Inkbound data when a Firebase Auth account is deleted anywhere. */
export const cleanupInkboundAfterAuthDelete = authV1.user().onDelete(async (user) => {
  await removeInkboundDataForUid(user.uid);
});

/** Keep reader-entered profile name/photo reflected in the derived admin directory. */
export const syncReaderDirectoryFromProfile = onDocumentWritten(
  'users/{uid}/profile/current',
  async (event) => {
    await upsertCanonicalDirectoryForUid(event.params.uid);
  },
);

/** Hourly safety net for any historic or missed Auth deletions/directory drift. */
export const reconcileReaderDirectory = onSchedule('every 1 hours', async () => {
  const { authUsers, staleUids } = await reconcileDirectory();
  console.info('Inkbound reader directory reconciliation complete.', {
    authUsers: authUsers.length,
    staleUsersRemoved: staleUids.size,
  });
});
