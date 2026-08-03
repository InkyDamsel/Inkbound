import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const db = getFirestore();

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

function requireAuthenticated(request: Parameters<Parameters<typeof onCall>[0]>[0]) {
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

  const adminRef = db.doc(`admins/${auth.uid}`);
  await adminRef.set(
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

export const grantVip = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const admin = await requireAdmin(auth.uid, ['owner']);
  const targetUserId = requireString(request.data?.targetUserId, 'targetUserId', 128);
  const reason = requireString(request.data?.reason, 'reason');
  const targetEmail = normalizeEmail(request.data?.targetEmail);
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

  await writeAudit({
    action: 'grant_vip',
    targetUserId,
    targetEmail,
    performedBy: auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: previous,
    newValue: { vipEnabled: true },
  });

  return { success: true };
});

export const revokeVip = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const admin = await requireAdmin(auth.uid, ['owner']);
  const targetUserId = requireString(request.data?.targetUserId, 'targetUserId', 128);
  const reason = requireString(request.data?.reason, 'reason');
  const targetEmail = normalizeEmail(request.data?.targetEmail);
  const entitlementRef = db.doc(`entitlements/${targetUserId}`);
  const previous = (await entitlementRef.get()).data() ?? null;

  await entitlementRef.set(
    {
      vipEnabled: false,
      vipRevokedAt: FieldValue.serverTimestamp(),
      vipRevokedBy: auth.uid,
      vipRevokeReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    },
    { merge: true },
  );

  await writeAudit({
    action: 'revoke_vip',
    targetUserId,
    targetEmail,
    performedBy: auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: previous,
    newValue: { vipEnabled: false },
  });

  return { success: true };
});

export const addCourtesyTime = onCall(async (request) => {
  const auth = requireAuthenticated(request);
  const admin = await requireAdmin(auth.uid, ['owner', 'support', 'billing']);
  const targetUserId = requireString(request.data?.targetUserId, 'targetUserId', 128);
  const reason = requireString(request.data?.reason, 'reason');
  const targetEmail = normalizeEmail(request.data?.targetEmail);
  const days = Number(request.data?.days);

  if (!Number.isInteger(days) || days < 1 || days > 730) {
    throw new HttpsError('invalid-argument', 'Courtesy days must be between 1 and 730.');
  }

  const entitlementRef = db.doc(`entitlements/${targetUserId}`);
  let previous: FirebaseFirestore.DocumentData | null = null;
  let courtesyPremiumUntil: Timestamp;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(entitlementRef);
    previous = snapshot.data() ?? null;
    const currentUntil = snapshot.get('courtesyPremiumUntil') as Timestamp | undefined;
    const now = Timestamp.now();
    const startingMillis = currentUntil && currentUntil.toMillis() > now.toMillis()
      ? currentUntil.toMillis()
      : now.toMillis();

    courtesyPremiumUntil = Timestamp.fromMillis(startingMillis + days * 24 * 60 * 60 * 1000);

    transaction.set(
      entitlementRef,
      {
        basePlan: 'premium',
        courtesyPremiumUntil,
        courtesyGrantedAt: FieldValue.serverTimestamp(),
        courtesyGrantedBy: auth.uid,
        courtesyReason: reason,
        effectiveSource: 'courtesy' satisfies EntitlementSource,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      },
      { merge: true },
    );
  });

  await writeAudit({
    action: 'add_courtesy_time',
    targetUserId,
    targetEmail,
    performedBy: auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: previous,
    newValue: { days, courtesyPremiumUntil: courtesyPremiumUntil!.toDate().toISOString() },
  });

  return {
    success: true,
    courtesyPremiumUntil: courtesyPremiumUntil!.toDate().toISOString(),
  };
});
