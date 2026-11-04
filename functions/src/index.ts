import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { DocumentReference, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { refreshGooglePlayEntitlementForUser } from './billing.js';

const adminApp = getApps()[0] ?? initializeApp();

const db = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);
const storageBucket = getStorage(adminApp).bucket();

const OWNER_EMAILS = new Set([
  'blackdame494@gmail.com',
  'inkbound@inkydameinteractive.com',
]);

const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENFORCE_APP_CHECK = !IS_FUNCTIONS_EMULATOR;
const PREMIUM_TRIAL_DAYS = 7;
const PREMIUM_TRIAL_MS = PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000;

type AdminRole = 'owner' | 'support' | 'billing' | 'viewer';
type EntitlementSource = 'free' | 'subscription' | 'vip' | 'courtesy' | 'trial';

interface AdminRecord { enabled: boolean; role: AdminRole; email: string; }

function requireAuthenticated(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  return request.auth;
}

async function requireAdmin(uid: string, allowedRoles: AdminRole[] = ['owner']) {
  const snapshot = await db.doc(`admins/${uid}`).get();
  const record = snapshot.data() as AdminRecord | undefined;
  if (!record?.enabled || !allowedRoles.includes(record.role)) throw new HttpsError('permission-denied', 'This action requires administrator access.');
  return record;
}

function normalizeEmail(value: unknown): string { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function requireString(value: unknown, fieldName: string, maxLength = 500): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${fieldName} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new HttpsError('invalid-argument', `${fieldName} is invalid.`);
  return normalized;
}
function timestampLikeToMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'string') { const parsed = new Date(value).getTime(); return Number.isNaN(parsed) ? 0 : parsed; }
  return 0;
}
function timestampToIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }
  return null;
}
function paidSubscriptionIsActive(entitlement: Record<string, unknown> | undefined): boolean {
  if (!entitlement) return false;
  const status = entitlement.subscriptionStatus;
  const paidUntil = timestampLikeToMillis(entitlement.paidPremiumUntil);
  if (status === 'active' || status === 'trialing') return paidUntil === 0 || paidUntil > Date.now();
  return status === 'canceled' && paidUntil > Date.now();
}
function timedPremiumIsActive(value: unknown): boolean {
  return timestampLikeToMillis(value) > Date.now();
}

async function eraseInkboundUser(uid: string) {
  await Promise.all([db.recursiveDelete(db.doc(`users/${uid}`)), db.doc(`userDirectory/${uid}`).delete(), db.doc(`entitlements/${uid}`).delete(), db.doc(`admins/${uid}`).delete()]);
  const billingSnapshots = await db.collection('billingSubscriptions').where('uid', '==', uid).get();
  await Promise.all(billingSnapshots.docs.map((item) => item.ref.delete()));
  const auditSnapshots = await Promise.all([db.collection('adminAudit').where('targetUserId', '==', uid).get(), db.collection('adminAudit').where('performedBy', '==', uid).get()]);
  const auditRefs = new Map<string, DocumentReference>();
  auditSnapshots.forEach((snapshot) => snapshot.docs.forEach((item) => auditRefs.set(item.ref.path, item.ref)));
  await Promise.all(Array.from(auditRefs.values()).map((item) => item.delete()));
  // Do not report successful account deletion if user-owned uploads could not be removed.
  // Leave the Auth identity intact so the user can retry after a transient Storage failure.
  await storageBucket.deleteFiles({ prefix: `users/${uid}/` });
  await adminAuth.deleteUser(uid).catch((error: unknown) => { const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''; if (code !== 'auth/user-not-found') throw error; });
}

async function writeAudit(input: { action: string; targetUserId: string; targetEmail?: string; performedBy: string; performedByEmail?: string; reason: string; previousValue: unknown; newValue: unknown; }) {
  await db.collection('adminAudit').add({ ...input, createdAt: FieldValue.serverTimestamp() });
}

async function startPremiumTrialForUser(uid: string): Promise<Timestamp> {
  const entitlementRef = db.doc(`entitlements/${uid}`);
  return db.runTransaction<Timestamp>(async (transaction) => {
    const snapshot = await transaction.get(entitlementRef);
    const entitlement = snapshot.data() ?? {};

    if (entitlement.trialStartedAt) {
      throw new HttpsError('failed-precondition', 'Your Inkbound Premium trial has already been used.');
    }
    if (entitlement.vipEnabled === true || paidSubscriptionIsActive(entitlement) || timedPremiumIsActive(entitlement.courtesyPremiumUntil)) {
      throw new HttpsError('failed-precondition', 'This account already has Premium access.');
    }

    const now = Timestamp.now();
    const until = Timestamp.fromMillis(now.toMillis() + PREMIUM_TRIAL_MS);
    transaction.set(entitlementRef, {
      basePlan: 'premium',
      trialStartedAt: now,
      trialPremiumUntil: until,
      effectiveSource: 'trial' satisfies EntitlementSource,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: snapshot.exists ? snapshot.get('createdAt') ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true });
    return until;
  });
}

export const bootstrapOwner = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const email = normalizeEmail(auth.token.email); const emailVerified = auth.token.email_verified === true;
  if (!emailVerified || !OWNER_EMAILS.has(email)) throw new HttpsError('permission-denied', 'This account is not approved for owner access.');
  await db.doc(`admins/${auth.uid}`).set({ enabled: true, role: 'owner', email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { enabled: true, role: 'owner' };
});

export const syncUserDirectory = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const email = normalizeEmail(auth.token.email);
  const input = request.data as Record<string, unknown> | undefined;
  const platform = typeof input?.platform === 'string' ? input.platform.trim().slice(0, 40) : '';
  const appVersion = typeof input?.appVersion === 'string' ? input.appVersion.trim().slice(0, 80) : '';
  const buildNumber = typeof input?.buildNumber === 'string' ? input.buildNumber.trim().slice(0, 80) : '';
  const userAgent = typeof input?.userAgent === 'string' ? input.userAgent.trim().slice(0, 500) : '';
  const directoryRef = db.doc(`userDirectory/${auth.uid}`);
  const existingDirectory = await directoryRef.get();
  const existingDisplayName = typeof existingDirectory.get('displayName') === 'string' ? String(existingDirectory.get('displayName')).trim() : '';
  const tokenDisplayName = typeof auth.token.name === 'string' ? auth.token.name.trim() : '';
  const existingPhotoUrl = typeof existingDirectory.get('photoUrl') === 'string' ? String(existingDirectory.get('photoUrl')).trim() : '';
  const tokenPhotoUrl = typeof auth.token.picture === 'string' ? auth.token.picture.trim() : '';
  await directoryRef.set({
    uid: auth.uid,
    email,
    displayName: existingDisplayName || tokenDisplayName,
    photoUrl: existingPhotoUrl || tokenPhotoUrl,
    emailVerified: auth.token.email_verified === true,
    lastSeenAt: FieldValue.serverTimestamp(),
    ...(platform ? { lastPlatform: platform } : {}),
    ...(appVersion ? { lastAppVersion: appVersion } : {}),
    ...(buildNumber ? { lastBuildNumber: buildNumber } : {}),
    ...(userAgent ? { lastUserAgent: userAgent } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const entitlementRef = db.doc(`entitlements/${auth.uid}`); const entitlement = await entitlementRef.get(); const seedOwnerVipInDev = IS_FUNCTIONS_EMULATOR && OWNER_EMAILS.has(email);
  if (!entitlement.exists) await entitlementRef.set({ basePlan: seedOwnerVipInDev ? 'premium' : 'free', subscriptionStatus: 'none', vipEnabled: seedOwnerVipInDev, effectiveSource: (seedOwnerVipInDev ? 'vip' : 'free') satisfies EntitlementSource, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  else if (seedOwnerVipInDev && entitlement.get('vipEnabled') !== true) await entitlementRef.set({ basePlan: 'premium', vipEnabled: true, effectiveSource: 'vip' satisfies EntitlementSource, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { synced: true };
});

export const getMyEntitlement = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request);
  const data = request.data as Record<string, unknown> | undefined;

  if (data?.action === 'startTrial') {
    await startPremiumTrialForUser(auth.uid);
  }

  await refreshGooglePlayEntitlementForUser(auth.uid).catch((error) => console.warn('Could not refresh Google Play entitlement during account refresh.', error));
  const entitlement = (await db.doc(`entitlements/${auth.uid}`).get()).data() ?? {};
  return {
    subscriptionStatus: typeof entitlement.subscriptionStatus === 'string' ? entitlement.subscriptionStatus : 'none',
    subscriptionProvider: typeof entitlement.subscriptionProvider === 'string' ? entitlement.subscriptionProvider : null,
    paidPremiumUntil: timestampToIso(entitlement.paidPremiumUntil),
    vipEnabled: entitlement.vipEnabled === true,
    courtesyPremiumUntil: timestampToIso(entitlement.courtesyPremiumUntil),
    trialStartedAt: timestampToIso(entitlement.trialStartedAt),
    trialPremiumUntil: timestampToIso(entitlement.trialPremiumUntil),
    trialAvailable: !entitlement.trialStartedAt,
  };
});

export const deleteMyAccount = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const data = request.data as Record<string, unknown> | undefined; const confirmation = requireString(data?.confirmation, 'confirmation', 64).toUpperCase();
  if (confirmation !== 'DELETE MY ACCOUNT') throw new HttpsError('failed-precondition', 'Account deletion requires the exact confirmation phrase.');
  const authTime = Number(auth.token.auth_time ?? 0) * 1000;
  if (!authTime || Date.now() - authTime > 10 * 60 * 1000) throw new HttpsError('failed-precondition', 'For your security, verify your account again before deleting it.');
  await eraseInkboundUser(auth.uid); return { success: true };
});

export const eraseUserAccountByAdmin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const admin = await requireAdmin(auth.uid, ['owner']); const data = request.data as Record<string, unknown> | undefined;
  const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128); const targetEmail = normalizeEmail(data?.targetEmail); const reason = requireString(data?.reason, 'reason', 1000); const confirmation = requireString(data?.confirmation, 'confirmation', 320).toLowerCase();
  if (!targetEmail) throw new HttpsError('invalid-argument', 'The target email is required.');
  if (targetUserId === auth.uid) throw new HttpsError('failed-precondition', 'Use the personal account-deletion flow to delete your own account.');
  if (OWNER_EMAILS.has(targetEmail)) throw new HttpsError('failed-precondition', 'Protected owner accounts cannot be erased from the admin dashboard.');
  if (confirmation !== `erase ${targetEmail}`) throw new HttpsError('failed-precondition', `Type ERASE ${targetEmail} exactly to confirm.`);
  const directorySnapshot = await db.doc(`userDirectory/${targetUserId}`).get(); const directoryEmail = normalizeEmail(directorySnapshot.get('email'));
  if (!directorySnapshot.exists || directoryEmail !== targetEmail) throw new HttpsError('failed-precondition', 'The selected reader no longer matches this account. Refresh and try again.');
  if (paidSubscriptionIsActive((await db.doc(`entitlements/${targetUserId}`).get()).data())) throw new HttpsError('failed-precondition', 'Cancel the reader\'s paid subscription before erasing the account so billing cannot continue after login removal.');
  await eraseInkboundUser(targetUserId); await writeAudit({ action: 'admin_erased_user_account', targetUserId: 'deleted', targetEmail: '[deleted]', performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: null, newValue: { erased: true } }); return { success: true };
});

export const grantVip = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const admin = await requireAdmin(auth.uid, ['owner']); const data = request.data as Record<string, unknown> | undefined; const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128); const reason = requireString(data?.reason, 'reason'); const targetEmail = normalizeEmail(data?.targetEmail); const entitlementRef = db.doc(`entitlements/${targetUserId}`); const previous = (await entitlementRef.get()).data() ?? null;
  await entitlementRef.set({ basePlan: 'premium', vipEnabled: true, vipGrantedAt: FieldValue.serverTimestamp(), vipGrantedBy: auth.uid, vipReason: reason, effectiveSource: 'vip' satisfies EntitlementSource, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true }); await writeAudit({ action: 'grant_vip', targetUserId, targetEmail, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { vipEnabled: true } }); return { success: true };
});
export const revokeVip = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const admin = await requireAdmin(auth.uid, ['owner']); const data = request.data as Record<string, unknown> | undefined; const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128); const reason = requireString(data?.reason, 'reason'); const targetEmail = normalizeEmail(data?.targetEmail); const entitlementRef = db.doc(`entitlements/${targetUserId}`); const previous = (await entitlementRef.get()).data() ?? null;
  await entitlementRef.set({ vipEnabled: false, vipRevokedAt: FieldValue.serverTimestamp(), vipRevokedBy: auth.uid, vipRevokeReason: reason, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true }); await writeAudit({ action: 'revoke_vip', targetUserId, targetEmail, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { vipEnabled: false } }); return { success: true };
});
export const addCourtesyTime = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const auth = requireAuthenticated(request); const admin = await requireAdmin(auth.uid, ['owner', 'support', 'billing']); const data = request.data as Record<string, unknown> | undefined; const targetUserId = requireString(data?.targetUserId, 'targetUserId', 128); const reason = requireString(data?.reason, 'reason'); const targetEmail = normalizeEmail(data?.targetEmail); const days = Number(data?.days);
  if (!Number.isInteger(days) || days < 1 || days > 730) throw new HttpsError('invalid-argument', 'Courtesy days must be between 1 and 730.');
  const entitlementRef = db.doc(`entitlements/${targetUserId}`); let previous: unknown = null;
  const courtesyPremiumUntil = await db.runTransaction<Timestamp>(async (transaction) => { const snapshot = await transaction.get(entitlementRef); previous = snapshot.data() ?? null; const currentUntil = snapshot.get('courtesyPremiumUntil') as Timestamp | undefined; const now = Timestamp.now(); const startingMillis = currentUntil && currentUntil.toMillis() > now.toMillis() ? currentUntil.toMillis() : now.toMillis(); const calculatedUntil = Timestamp.fromMillis(startingMillis + days * 24 * 60 * 60 * 1000); transaction.set(entitlementRef, { basePlan: 'premium', courtesyPremiumUntil: calculatedUntil, courtesyGrantedAt: FieldValue.serverTimestamp(), courtesyGrantedBy: auth.uid, courtesyReason: reason, effectiveSource: 'courtesy' satisfies EntitlementSource, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true }); return calculatedUntil; });
  const courtesyIso = courtesyPremiumUntil.toDate().toISOString(); await writeAudit({ action: 'add_courtesy_time', targetUserId, targetEmail, performedBy: auth.uid, performedByEmail: admin.email, reason, previousValue: previous, newValue: { days, courtesyPremiumUntil: courtesyIso } }); return { success: true, courtesyPremiumUntil: courtesyIso };
});

export { createStripeCheckoutSession, createStripeBillingPortalSession, stripeBillingWebhook, verifyGooglePlaySubscription } from './billing.js';
export {
  getAdminDashboard,
  correctAdminUserEmail,
  mergeAdminUserAccounts,
  resendAdminVerificationEmail,
  sendAdminPasswordResetEmail,
  addAdminSupportNote,
} from './readerDirectoryMaintenance.js';
export { getAdminDataIntegrity, auditAdminLibraryInventory, removeAdminCloudOnlyBook, inspectMissingBookEvidence, setAdminAccess } from './adminDashboard.js';
export { listAdminRecoveryPoints, restoreAdminRecoveryPoint } from './adminRecovery.js';
export { previewAdminRecoveryPoint, listAdminRecoveryBooksForMonth, restoreAdminRecoverySelection } from './adminSelectiveRecovery.js';
export { searchHardcoverBooks } from './bookSearch.js';
export { submitMetadataContribution, getMetadataContributions, reviewMetadataContribution } from './metadataContributions.js';
export { sendVerificationEmail } from './sendVerificationEmail.js';
export { sendPasswordResetEmail } from './sendPasswordResetEmail.js';
export { searchSeriesDetectivePenguinRandomHouse } from './seriesDetectiveCatalog.js';

export { fetchShareImage } from './shareMedia.js';
