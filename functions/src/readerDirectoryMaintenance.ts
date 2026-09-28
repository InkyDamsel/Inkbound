import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);
const auth = getAuth(adminApp);
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

/**
 * Firebase Auth is the canonical account list for dashboard display.
 * Dashboard reads are intentionally non-destructive: account erasure belongs
 * only to explicit, confirmed deletion flows.
 */
export const getAdminDashboard = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const admin = await requireAdmin(request);
  const input = request.data as { query?: unknown } | undefined;
  const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';

  const authUsers = await listAllAuthUsers();
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
