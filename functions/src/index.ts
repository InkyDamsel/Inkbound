import { getAuth } from 'firebase-admin/auth';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const adminApp = initializeApp();

const db = getFirestore();
const adminAuth = getAuth(adminApp);
const storageBucket = getStorage(adminApp).bucket();

const OWNER_EMAILS = new Set([
  'blackdame494@gmail.com',
  'inkbound@inkydameinteractive.com',
]);

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';
type EntitlementSource = 'free' | 'subscription' | 'vip' | 'courtesy';

interface AdminRecord {
  enabled: boolean;
  role: AdminRole;
  email: string;
}

function requireAuthenticated(request: CallableRequest<unknown>) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  return request.auth;
}

async function requireAdmin(uid: string, allowedRoles: AdminRole[] = ['owner']) {
  const snapshot = await db.doc(`admins/${uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;

  if (!record?.enabled || !allowedRoles.includes(record.role)) {
    throw new HttpsError('permission-denied', 'This action requires administrator access.');
  }

  return record;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireString(value: unknown, fieldName: string, maxLength = 500): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${fieldName} is required.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${fieldName} is invalid.`);
  }

  return normalized;
}

async function writeAudit(input: {
  action: string;
  targetUserId: string;
  targetEmail?: string;
  performedBy: string;
  performedByEmail?: string;
  reason: string;
  previousValue: unknown;
  newValue: unknown;
}) {
  await db.collection('adminAudit').add({
    ...input,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export const bootstrapOwner = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const email = normalizeEmail(auth.token.email);
  const emailVerified = auth.token.email_verified === true;

  if (!emailVerified || !OWNER_EMAILS.has(email)) {
    throw new HttpsError('permission-denied', 'This account is not approved for owner access.');
  }

  await db.doc(`admins/${auth.uid}`).set(
    {
      enabled: true,
      role: 'owner',
      email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { enabled: true, role: 'owner' };
});

export const syncUserDirectory = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const email = normalizeEmail(auth.token.email);

  await db.doc(`userDirectory/${auth.uid}`).set(
    {
      uid: auth.uid,
      email,
      displayName: typeof auth.token.name === 'string' ? auth.token.name : '',
      photoUrl: typeof auth.token.picture === 'string' ? auth.token.picture : '',
      emailVerified: auth.token.email_verified === true,
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const entitlementRef = db.doc(`entitlements/${auth.uid}`);
  const entitlement = await entitlementRef.get();
  if (!entitlement.exists) {
    await entitlementRef.set({
      basePlan: 'free',
      subscriptionStatus: 'none',
      vipEnabled: false,
      effectiveSource: 'free' satisfies EntitlementSource,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return { synced: true };
});

export const deleteMyAccount = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const authTime = Number(auth.token.auth_time ?? 0) * 1000;
  const recentAuthWindowMs = 10 * 60 * 1000;

  if (!authTime || Date.now() - authTime > recentAuthWindowMs) {
    throw new HttpsError(
      'failed-precondition',
      'For your security, sign in with Google again before deleting your account.',
    );
  }

  const entitlementRef = db.doc(`entitlements/${auth.uid}`);
  const entitlementSnapshot = await entitlementRef.get();
  const entitlement = entitlementSnapshot.data() as
    | { subscriptionStatus?: string; paidPremiumUntil?: Timestamp }
    | undefined;
  const paidUntil = entitlement?.paidPremiumUntil instanceof Timestamp
    ? entitlement.paidPremiumUntil.toMillis()
    : 0;
  const paidSubscriptionStillActive =
    entitlement?.subscriptionStatus === 'active' ||
    entitlement?.subscriptionStatus === 'trialing' ||
    paidUntil > Date.now();

  if (paidSubscriptionStillActive) {
    throw new HttpsError(
      'failed-precondition',
      'Cancel your paid Inkbound subscription before deleting your account so billing cannot continue after your login is removed.',
    );
  }

  const uid = auth.uid;

  await Promise.all([
    db.recursiveDelete(db.doc(`users/${uid}`)),
    db.doc(`userDirectory/${uid}`).delete(),
    entitlementRef.delete(),
    db.doc(`admins/${uid}`).delete(),
  ]);

  const auditSnapshots = await Promise.all([
    db.collection('adminAudit').where('targetUserId', '==', uid).get(),
    db.collection('adminAudit').where('performedBy', '==', uid).get(),
  ]);
  const auditRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  auditSnapshots.forEach((snapshot) => {
    snapshot.docs.forEach((item) => auditRefs.set(item.ref.path, item.ref));
  });
  await Promise.all(Array.from(auditRefs.values()).map((item) => item.delete()));

  await storageBucket.deleteFiles({ prefix: `users/${uid}/` }).catch((error: unknown) => {
    console.warn(`Could not remove every Storage object for deleted user ${uid}.`, error);
  });

  await adminAuth.deleteUser(uid);
  return { success: true };
});

export const grantVip = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const admin = await requireAdmin(auth.uid, ['owner']);
  const data = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128);
  const reason = requireString(data?.reason, 'reason');
  const targetEmail = normalizeEmail(data?.targetEmail);
  const entitlementRef = db.doc(`entitlements/${targetUserId}`);
  const previous = (await entitlementRef.get()).data() ?? null;

  await entitlementRef.set(
    {
      basePlan: 'premium',
      vipEnabled: true,
      vipGrantedAt: FieldValue.serverTimestamp(),
      vipGrantedBy: auth.uid,
      vipReason: reason,
      effectiveSource: 'vip' satisfies EntitlementSource,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    },
    { merge: true },
  );

  await writeAudit({ action: 'grant_vip', targetUserId, targetEmail, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { vipEnabled: true } });
  return { success: true };
});

export const revokeVip = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const admin = await requireAdmin(auth.uid, ['owner']);
  const data = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128);
  const reason = requireString(data?.reason, 'reason');
  const targetEmail = normalizeEmail(data?.targetEmail);
  const entitlementRef = db.doc(`entitlements/${targetUserId}`);
  const previous = (await entitlementRef.get()).data() ?? null;

  await entitlementRef.set({ vipEnabled: false, vipRevokedAt: FieldValue.serverTimestamp(), vipRevokedBy: auth.uid, vipRevokeReason: reason, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true });
  await writeAudit({ action: 'revoke_vip', targetUserId, targetEmail, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { vipEnabled: false } });
  return { success: true };
});

export const addCourtesyTime = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const admin = await requireAdmin(auth.uid, ['owner', 'support', 'billing']);
  const data = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128);
  const reason = requireString(data?.reason, 'reason');
  const targetEmail = normalizeEmail(data?.targetEmail);
  const days = Number(data?.days);

  if (!Number.isInteger(days) || days < 1 || days > 730) {
    throw new HttpsError('invalid-argument', 'Courtesy days must be between 1 and 730.');
  }

  const entitlementRef = db.doc(`entitlements/${targetUserId}`);
  let previous: unknown = null;
  const courtesyPremiumUntil = await db.runTransaction<Timestamp>(async (transaction) => {
    const snapshot = await transaction.get(entitlementRef);
    previous = snapshot.data() ?? null;
    const currentUntil = snapshot.get('courtesyPremiumUntil') as Timestamp | undefined;
    const now = Timestamp.now();
    const startingMillis = currentUntil && currentUntil.toMillis() > now.toMillis() ? currentUntil.toMillis() : now.toMillis();
    const calculatedUntil = Timestamp.fromMillis(startingMillis + days * 24 * 60 * 60 * 1000);
    transaction.set(entitlementRef, { basePlan: 'premium', courtesyPremiumUntil: calculatedUntil, courtesyGrantedAt: FieldValue.serverTimestamp(), courtesyGrantedBy: auth.uid, courtesyReason: reason, effectiveSource: 'courtesy' satisfies EntitlementSource, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true });
    return calculatedUntil;
  });

  const courtesyIso = courtesyPremiumUntil.toDate().toISOString();
  await writeAudit({ action: 'add_courtesy_time', targetUserId, targetEmail, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { days, courtesyPremiumUntil: courtesyIso } });
  return { success: true, courtesyPremiumUntil: courtesyIso };
});

export { getAdminDashboard, setAdminAccess } from './adminDashboard.js';
export { searchHardcoverBooks } from './bookSearch.js';
