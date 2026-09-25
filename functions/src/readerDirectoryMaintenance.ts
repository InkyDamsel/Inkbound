import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { defineSecret } from 'firebase-functions/params';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);
const auth = getAuth(adminApp);
const bucket = getStorage(adminApp).bucket();
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const resendApiKey = defineSecret('RESEND_API_KEY');
const EMAIL_SENDER = 'Inkbound <inkbound@inkydameinteractive.com>';
const EMAIL_REPLY_TO = 'inkbound_support@inkydameinteractive.com';
const APP_RETURN_URL = 'https://inkbound.inkydameinteractive.com/app';
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
    db.collection('adminAudit').orderBy('createdAt', 'desc').limit(200).get(),
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
        authProviderIds: user.providerData.map((provider) => provider.providerId),
        accountCreatedAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
        lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
        lastSeenAt: timestampToIso(record.lastSeenAt),
        lastPlatform: text(record.lastPlatform),
        lastAppVersion: text(record.lastAppVersion),
        lastBuildNumber: text(record.lastBuildNumber),
        lastUserAgent: text(record.lastUserAgent),
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
      targetUserId: typeof data.targetUserId === 'string' ? data.targetUserId : '',
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendInkboundEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sent: boolean; providerId?: string; error?: string }> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey.value()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_SENDER,
        to: [input.to],
        reply_to: EMAIL_REPLY_TO,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
    if (!response.ok) {
      const message = text(payload?.message || payload?.name || `Resend returned HTTP ${response.status}`);
      console.error('Inkbound admin notification email was rejected.', {
        to: input.to,
        status: response.status,
        message,
      });
      return { sent: false, error: message || 'Email delivery was rejected.' };
    }

    return { sent: true, providerId: payload?.id };
  } catch (error) {
    console.error('Inkbound admin notification email could not reach Resend.', {
      to: input.to,
      error,
    });
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'Email delivery service unavailable.',
    };
  }
}

function emailShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#171116;color:#f7f0e8;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#171116;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#241a22;border:1px solid #5e4558;border-radius:22px;overflow:hidden;">
<tr><td style="background:#3d2839;padding:38px 32px;text-align:center;"><div style="font-family:Georgia,serif;font-size:34px;font-weight:bold;color:#fff8ef;">Inkbound</div><div style="margin-top:8px;color:#d9c8d3;font-size:14px;">Your reading life, remembered.</div></td></tr>
<tr><td style="padding:42px 36px;"><h1 style="margin:0;color:#fff8ef;font-family:Georgia,serif;font-size:28px;line-height:1.3;">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="background:#1d151c;padding:22px 32px;color:#9f909a;font-size:12px;line-height:1.6;text-align:center;">Inkbound is created by Inky Dame Interactive.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendCorrectedEmailVerification(user: UserRecord, newEmail: string) {
  let verificationLink: string;
  try {
    verificationLink = await auth.generateEmailVerificationLink(newEmail, {
      url: APP_RETURN_URL,
      handleCodeInApp: false,
    });
  } catch {
    verificationLink = await auth.generateEmailVerificationLink(newEmail);
  }

  const name = text(user.displayName) || 'Reader';
  const body = `
<p style="margin:24px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Hello ${escapeHtml(name)},</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Your Inkbound account email was updated to <strong>${escapeHtml(newEmail)}</strong> by Inkbound support.</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Please verify the corrected address so your account can continue using it normally.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:32px auto;"><tr><td align="center" style="background:#a66f91;border-radius:999px;"><a href="${escapeHtml(verificationLink)}" style="display:inline-block;padding:15px 30px;color:#171116;font-size:16px;font-weight:bold;text-decoration:none;">Verify My Email</a></td></tr></table>
<p style="margin:0;color:#bdaeb8;font-size:14px;line-height:1.6;">If you did not request this correction, reply to this email and Inkbound support will help you.</p>`;

  return sendInkboundEmail({
    to: newEmail,
    subject: 'Your Inkbound email was updated — please verify it',
    html: emailShell('Your email address was corrected', body),
    text: `Hello ${name},\n\nYour Inkbound account email was updated to ${newEmail} by Inkbound support.\n\nPlease verify the corrected address:\n${verificationLink}\n\nIf you did not request this correction, reply to this email and Inkbound support will help you.\n\nInkbound\nInky Dame Interactive`,
  });
}

async function sendMergeCompletedEmail(user: UserRecord, sourceEmail: string, destinationEmail: string) {
  const name = text(user.displayName) || 'Reader';
  const body = `
<p style="margin:24px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Hello ${escapeHtml(name)},</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Inkbound support completed an account merge for you.</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">The account using <strong>${escapeHtml(sourceEmail)}</strong> was merged into <strong>${escapeHtml(destinationEmail)}</strong>. The destination account is now the account you should use to sign in.</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Your non-conflicting Inkbound library data was copied before the old login was removed.</p>
<p style="margin:24px 0 0;color:#bdaeb8;font-size:14px;line-height:1.6;">If you did not request this merge or anything looks wrong, reply to this email and Inkbound support will help you.</p>`;

  return sendInkboundEmail({
    to: destinationEmail,
    subject: 'Your Inkbound accounts were merged',
    html: emailShell('Your Inkbound account merge is complete', body),
    text: `Hello ${name},\n\nInkbound support completed an account merge for you.\n\n${sourceEmail} was merged into ${destinationEmail}. Use ${destinationEmail} to sign in from now on.\n\nYour non-conflicting Inkbound library data was copied before the old login was removed.\n\nIf you did not request this merge or anything looks wrong, reply to this email and Inkbound support will help you.\n\nInkbound\nInky Dame Interactive`,
  });
}

async function sendAdminVerificationEmail(user: UserRecord) {
  const email = normalizedEmail(user.email);
  if (!email) throw new HttpsError('failed-precondition', 'This account does not have an email address.');
  if (user.emailVerified) return { sent: true, alreadyVerified: true };

  let verificationLink: string;
  try {
    verificationLink = await auth.generateEmailVerificationLink(email, {
      url: APP_RETURN_URL,
      handleCodeInApp: false,
    });
  } catch {
    verificationLink = await auth.generateEmailVerificationLink(email);
  }

  const name = text(user.displayName) || 'Reader';
  const body = `
<p style="margin:24px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Hello ${escapeHtml(name)},</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Inkbound support sent you a fresh verification link for <strong>${escapeHtml(email)}</strong>.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:32px auto;"><tr><td align="center" style="background:#a66f91;border-radius:999px;"><a href="${escapeHtml(verificationLink)}" style="display:inline-block;padding:15px 30px;color:#171116;font-size:16px;font-weight:bold;text-decoration:none;">Verify My Email</a></td></tr></table>
<p style="margin:0;color:#bdaeb8;font-size:14px;line-height:1.6;">If you did not request help with your Inkbound account, reply to this email and support will help you.</p>`;

  const sent = await sendInkboundEmail({
    to: email,
    subject: 'Verify your Inkbound email',
    html: emailShell('Verify your Inkbound email', body),
    text: `Hello ${name},\n\nInkbound support sent you a fresh verification link for ${email}.\n\nVerify your email:\n${verificationLink}\n\nIf you did not request help with your Inkbound account, reply to this email.\n\nInkbound\nInky Dame Interactive`,
  });
  return { ...sent, alreadyVerified: false };
}

async function sendAdminPasswordReset(user: UserRecord) {
  const email = normalizedEmail(user.email);
  if (!email) throw new HttpsError('failed-precondition', 'This account does not have an email address.');

  let resetLink: string;
  try {
    resetLink = await auth.generatePasswordResetLink(email, { url: APP_RETURN_URL, handleCodeInApp: false });
  } catch {
    resetLink = await auth.generatePasswordResetLink(email);
  }

  const name = text(user.displayName) || 'Reader';
  const body = `
<p style="margin:24px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Hello ${escapeHtml(name)},</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Inkbound support sent you a password reset link for <strong>${escapeHtml(email)}</strong>.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:32px auto;"><tr><td align="center" style="background:#a66f91;border-radius:999px;"><a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:15px 30px;color:#171116;font-size:16px;font-weight:bold;text-decoration:none;">Reset My Password</a></td></tr></table>
<p style="margin:0;color:#bdaeb8;font-size:14px;line-height:1.6;">If you did not request help signing in, you can ignore this message or reply to contact support.</p>`;

  return sendInkboundEmail({
    to: email,
    subject: 'Reset your Inkbound password',
    html: emailShell('Reset your Inkbound password', body),
    text: `Hello ${name},\n\nInkbound support sent you a password reset link for ${email}.\n\nReset your password:\n${resetLink}\n\nIf you did not request help signing in, you can ignore this message.\n\nInkbound\nInky Dame Interactive`,
  });
}

export const resendAdminVerificationEmail = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [resendApiKey],
}, async (request) => {
  const admin = await requireAdmin(request, ['owner', 'support']);
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = text(input?.targetUserId);
  const reason = requireReason(input?.reason);
  if (!targetUserId) throw new HttpsError('invalid-argument', 'A reader is required.');

  const user = await auth.getUser(targetUserId).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'That Firebase account no longer exists.');
  const result = await sendAdminVerificationEmail(user);

  await writeOwnerAudit({
    action: 'resend_verification_email',
    targetUserId,
    targetEmail: normalizedEmail(user.email),
    performedBy: request.auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: { emailVerified: user.emailVerified },
    newValue: { notificationSent: result.sent, alreadyVerified: result.alreadyVerified },
  });

  return {
    success: true,
    alreadyVerified: result.alreadyVerified,
    notificationSent: result.sent,
    notificationError: result.sent ? null : result.error ?? 'Email notification could not be sent.',
  };
});

export const sendAdminPasswordResetEmail = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [resendApiKey],
}, async (request) => {
  const admin = await requireAdmin(request, ['owner', 'support']);
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = text(input?.targetUserId);
  const reason = requireReason(input?.reason);
  if (!targetUserId) throw new HttpsError('invalid-argument', 'A reader is required.');

  const user = await auth.getUser(targetUserId).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'That Firebase account no longer exists.');
  const result = await sendAdminPasswordReset(user);

  await writeOwnerAudit({
    action: 'send_password_reset_email',
    targetUserId,
    targetEmail: normalizedEmail(user.email),
    performedBy: request.auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: null,
    newValue: { notificationSent: result.sent },
  });

  return {
    success: true,
    notificationSent: result.sent,
    notificationError: result.sent ? null : result.error ?? 'Email notification could not be sent.',
  };
});

export const addAdminSupportNote = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const admin = await requireAdmin(request, ['owner', 'support']);
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const input = request.data as Record<string, unknown> | undefined;
  const targetUserId = text(input?.targetUserId);
  const note = requireReason(input?.note);
  if (!targetUserId) throw new HttpsError('invalid-argument', 'A reader is required.');
  const user = await auth.getUser(targetUserId).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'That Firebase account no longer exists.');

  await writeOwnerAudit({
    action: 'support_note',
    targetUserId,
    targetEmail: normalizedEmail(user.email),
    performedBy: request.auth.uid,
    performedByEmail: admin.email,
    reason: note,
    previousValue: null,
    newValue: null,
  });

  return { success: true };
});

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
      targetId = `merged-${source.parent?.parent?.id ?? 'source'}-${document.id}`;
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

export const correctAdminUserEmail = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [resendApiKey] }, async (request) => {
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

  const notification = await sendCorrectedEmailVerification(user, newEmail).catch((error: unknown) => ({
    sent: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  await writeOwnerAudit({
    action: 'correct_user_email',
    targetUserId,
    targetEmail: newEmail,
    performedBy: request.auth.uid,
    performedByEmail: admin.email,
    reason,
    previousValue: { email: currentEmail },
    newValue: { email: newEmail, emailVerified: false, notificationSent: notification.sent },
  });

  return {
    success: true,
    email: newEmail,
    verificationEmailSent: notification.sent,
    notificationError: notification.sent ? null : notification.error ?? 'Email notification could not be sent.',
  };
});

export const mergeAdminUserAccounts = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  memory: '512MiB',
  timeoutSeconds: 120,
  secrets: [resendApiKey],
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

  const mergeNotification = await sendMergeCompletedEmail(targetUser, sourceEmail, targetEmail).catch((error: unknown) => ({
    sent: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  return {
    success: true,
    destinationUserId: targetUser.uid,
    destinationEmail: targetEmail,
    notificationSent: mergeNotification.sent,
    notificationError: mergeNotification.sent ? null : mergeNotification.error ?? 'Email notification could not be sent.',
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
