import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const resendApiKey = defineSecret('RESEND_API_KEY');
const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENFORCE_APP_CHECK = !IS_FUNCTIONS_EMULATOR;

const SENDER = 'Inkbound <inkbound@inkydameinteractive.com>';
const REPLY_TO = 'inkbound_support@inkydameinteractive.com';
const APP_RETURN_URL = 'https://inkbound.inkydameinteractive.com/app';

export const sendVerificationEmail = onCall(
  {
    // Verification must remain available to newly registered readers whose
    // native App Check attestation is not yet ready. Firebase Auth is still
    // mandatory and the recipient is taken from the authenticated user record.
    enforceAppCheck: false,
    secrets: [resendApiKey],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in to request a verification email.');
    }

    const auth = getAuth();
    const user = await auth.getUser(uid);

    if (!user.email) {
      throw new HttpsError('failed-precondition', 'This account does not have an email address.');
    }

    if (user.emailVerified) {
      return { success: true, alreadyVerified: true };
    }

    // Prefer returning readers to the live Inkbound app after verification. If
    // Firebase Auth has not yet allow-listed that continue URL, fall back to the
    // standard Firebase action handler so verification email delivery still works.
    let verificationLink: string;
    try {
      verificationLink = await auth.generateEmailVerificationLink(user.email, {
        url: APP_RETURN_URL,
        handleCodeInApp: false,
      });
    } catch (error) {
      console.warn('Inkbound verification continue URL was rejected; using the default Firebase action handler.', {
        uid,
        code: firebaseErrorCode(error),
      });
      try {
        verificationLink = await auth.generateEmailVerificationLink(user.email);
      } catch (fallbackError) {
        console.error('Firebase could not generate an Inkbound verification link.', {
          uid,
          code: firebaseErrorCode(fallbackError),
        });
        throw new HttpsError(
          'internal',
          `Inkbound could not generate the verification link (${firebaseErrorCode(fallbackError) || 'unknown Firebase Auth error'}).`,
        );
      }
    }

    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey.value()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: SENDER,
          to: [user.email],
          reply_to: REPLY_TO,
          subject: 'Verify your email for Inkbound',
          html: buildVerificationEmail({
            verificationLink,
            email: user.email,
            displayName: user.displayName,
          }),
          text: buildVerificationEmailText({
            verificationLink,
            displayName: user.displayName,
          }),
        }),
      });
    } catch (error) {
      console.error('Inkbound could not reach Resend.', { uid, error });
      throw new HttpsError('unavailable', 'Inkbound could not reach the email delivery service. Please try again.');
    }

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;

    if (!response.ok) {
      const providerMessage = sanitizeProviderMessage(payload?.message || payload?.name || 'No provider message');
      console.error('Resend verification email failed', {
        uid,
        status: response.status,
        message: providerMessage,
      });
      throw new HttpsError(
        'failed-precondition',
        `Inkbound email delivery was rejected (${response.status}): ${providerMessage}`,
      );
    }

    console.info('Verification email sent', {
      uid,
      resendEmailId: payload?.id,
    });

    return { success: true, alreadyVerified: false };
  },
);

function buildVerificationEmail({
  verificationLink,
  email,
  displayName,
}: {
  verificationLink: string;
  email: string;
  displayName?: string;
}): string {
  const greetingName = displayName?.trim() || 'Reader';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Verify your Inkbound email</title>
</head>
<body style="margin:0;padding:0;background:#171116;color:#f7f0e8;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#171116;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#241a22;border:1px solid #5e4558;border-radius:22px;overflow:hidden;">
        <tr><td style="background:#3d2839;padding:38px 32px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:34px;font-weight:bold;color:#fff8ef;letter-spacing:.3px;">Inkbound</div>
          <div style="margin-top:8px;color:#d9c8d3;font-size:14px;">Your reading life, remembered.</div>
        </td></tr>
        <tr><td style="padding:42px 36px;">
          <h1 style="margin:0;color:#fff8ef;font-family:Georgia,serif;font-size:28px;line-height:1.3;">One quick step before your next chapter</h1>
          <p style="margin:24px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Hello ${escapeHtml(greetingName)},</p>
          <p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Verify <strong>${escapeHtml(email)}</strong> to finish creating your Inkbound account and keep your library, reading sessions, memories, and progress connected across your devices.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:32px auto;">
            <tr><td align="center" style="background:#a66f91;border-radius:999px;">
              <a href="${escapeHtml(verificationLink)}" style="display:inline-block;padding:15px 30px;color:#171116;font-size:16px;font-weight:bold;text-decoration:none;">Verify My Email</a>
            </td></tr>
          </table>
          <p style="margin:0;color:#bdaeb8;font-size:14px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p>
          <p style="margin:10px 0 0;overflow-wrap:anywhere;color:#d6a8c4;font-size:13px;line-height:1.5;">${escapeHtml(verificationLink)}</p>
          <hr style="margin:32px 0;border:0;border-top:1px solid #5e4558;">
          <p style="margin:0;color:#a99aa4;font-size:13px;line-height:1.6;">If you did not create an Inkbound account, you can safely ignore this message.</p>
        </td></tr>
        <tr><td style="background:#1d151c;padding:22px 32px;color:#9f909a;font-size:12px;line-height:1.6;text-align:center;">Inkbound is created by Inky Dame Interactive.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildVerificationEmailText({
  verificationLink,
  displayName,
}: {
  verificationLink: string;
  displayName?: string;
}): string {
  const greetingName = displayName?.trim() || 'Reader';
  return `Hello ${greetingName},\n\nOne quick step before your next chapter.\n\nVerify your email to finish creating your Inkbound account:\n\n${verificationLink}\n\nIf you did not create an Inkbound account, you can safely ignore this message.\n\nInkbound\nInky Dame Interactive`;
}

function firebaseErrorCode(error: unknown): string {
  if (typeof error !== 'object' || !error || !('code' in error)) return '';
  return String((error as { code?: unknown }).code ?? '').slice(0, 120);
}

function sanitizeProviderMessage(message: string): string {
  return message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 180) || 'Unknown email provider error';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
