import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

async function requireAdmin(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');

  const db = getFirestore();
  const snapshot = await db.doc(`admins/${request.auth.uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled) throw new HttpsError('permission-denied', 'Administrator access is required.');

  return { auth: request.auth, admin: record };
}

export const getAdminDashboard = onCall(async (request) => {
  const { admin } = await requireAdmin(request);
  const db = getFirestore();
  const input = request.data as { query?: unknown } | undefined;
  const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';

  const [directorySnapshot, entitlementsSnapshot, auditSnapshot] = await Promise.all([
    db.collection('userDirectory').orderBy('lastSeenAt', 'desc').limit(100).get(),
    db.collection('entitlements').limit(250).get(),
    db.collection('adminAudit').orderBy('createdAt', 'desc').limit(50).get(),
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

  return { role: admin.role, totals, users, audit };
});
