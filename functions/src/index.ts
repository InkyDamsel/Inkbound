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

// Firebase Auth remains mandatory. Android native App Check attestation can be unavailable
// while the account session is valid; do not block entitlement reads on attestation.
export const getMyEntitlement = onCall({ enforceAppCheck: false }, async (request) => {
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

// Require Firebase Auth, exact confirmation, and a recent sign-in below. Native
// App Check must not prevent a legitimate reader from deleting their account.
export const deleteMyAccount = onCall({ enforceAppCheck: false }, async (request) => {
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
export { searchSeriesDetectiveHardcover, searchSeriesDetectiveGoogleBooks, searchSeriesDetectivePenguinRandomHouse } from './seriesDetectiveCatalog.js';

export { fetchShareImage } from './shareMedia.js';


/**
 * Owner-only, server-side Wikidata evidence lookup. The client never receives
 * raw catalog provenance unless Firestore's admin record authorizes the call.
 * This endpoint is read-only and does not update a reader's library.
 */
export const inspectSeriesWikidataEvidence = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, maxInstances: 5 },
  async (request: CallableRequest<{ title?: string; author?: string; seriesName?: string }>) => {
    const identity = requireAuthenticated(request);
    await requireAdmin(identity.uid, ['owner']);
    const title = requireString(request.data?.title, 'title', 180);
    const author = requireString(request.data?.author, 'author', 120);
    const seriesName = requireString(request.data?.seriesName, 'seriesName', 160);
    const query = `SELECT DISTINCT ?work ?workLabel ?authorLabel ?series ?seriesLabel ?ordinal WHERE {
      ?work p:P179 ?statement .
      ?statement ps:P179 ?series .
      OPTIONAL { ?statement pq:P1545 ?ordinal . }
      ?work wdt:P50 ?author .
      ?work rdfs:label ?workLabel .
      ?author rdfs:label ?authorLabel .
      ?series rdfs:label ?seriesLabel .
      FILTER(LANG(?workLabel) = "en" && LANG(?authorLabel) = "en" && LANG(?seriesLabel) = "en")
      FILTER(LCASE(STR(?workLabel)) = LCASE(${JSON.stringify(title)}))
    } LIMIT 50`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let httpStatus: number | null = null;
    let retryAfter: string | null = null;
    let rawRecords = 0;
    let rejectedRecords = 0;
    const diagnostics = (errorCategory: string | null = null) => ({
      durationMs: Date.now() - startedAt,
      requestsMade: 1,
      rawRecords,
      rejectedRecords,
      httpStatus,
      retryAfter,
      errorCategory,
      timeoutMs: 12000,
      provider: 'wikidata',
    });
    try {
      const response = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'InkboundSeriesDetective/1.0 (admin diagnostic)' },
        signal: controller.signal,
      });
      httpStatus = response.status;
      retryAfter = response.headers.get('retry-after');
      if (!response.ok) return {
        status: 'provider-unavailable', claims: [],
        diagnostics: diagnostics(response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'upstream-server-error' : 'upstream-http-error'),
      };
      const payload = await response.json() as { results?: { bindings?: Array<Record<string, { value: string }>> } };
      if (!Array.isArray(payload.results?.bindings)) {
        return { status: 'provider-unavailable', claims: [], diagnostics: diagnostics('invalid-response-shape') };
      }
      rawRecords = payload.results.bindings.length;
      const normalized = (value: string) => value.trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ');
      const matching = payload.results.bindings.filter(row =>
        normalized(row.authorLabel?.value ?? '') === normalized(author)
        && normalized(row.seriesLabel?.value ?? '') === normalized(seriesName));
      rejectedRecords = rawRecords - matching.length;
      const claims = matching.slice(0, 30).map(row => ({
        workId: row.work?.value?.match(/Q\\d+$/)?.[0] ?? '',
        seriesId: row.series?.value?.match(/Q\\d+$/)?.[0] ?? '',
        workTitle: row.workLabel?.value ?? '',
        author: row.authorLabel?.value ?? '',
        series: row.seriesLabel?.value ?? '',
        ordinal: row.ordinal?.value ?? null,
        origin: 'wikidata:P179',
      }));
      return { status: claims.length ? 'matched' : 'no-matching-claim', claims, diagnostics: diagnostics() };
    } catch (error: unknown) {
      const category = controller.signal.aborted ? 'timeout'
        : error instanceof SyntaxError ? 'invalid-json'
        : error instanceof TypeError ? 'network-error'
        : 'unexpected-provider-error';
      return { status: 'provider-unavailable', claims: [], diagnostics: diagnostics(category) };
    } finally {
      clearTimeout(timeout);
    }
  },
);
