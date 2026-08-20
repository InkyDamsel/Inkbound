import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const resendApiKey = defineSecret('RESEND_API_KEY');
const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENFORCE_APP_CHECK = !IS_FUNCTIONS_EMULATOR;

const SENDER = 'Inkbound <inkbound@inkydameinteractive.com>';
const REPLY_TO = 'inkbound_support@inkydameinteractive.com';
const APP_RETURN_URL = 'https://inkbound.inkydameinteractive.com/app';

export const sendPasswordResetEmail = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, secrets: [resendApiKey] },
  async (request) => {
    const email = typeof request.data?.email === 'string' ? request.data.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@') || email.length > 320) {
      throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    }

    const auth = getAuth();
    let resetLink: string;
    try {
      resetLink = await auth.generatePasswordResetLink(email, { url: APP_RETURN_URL, handleCodeInApp: false });
    } catch (error) {
      const code = firebaseErrorCode(error);
      if (code.includes('user-not-found')) return { success: true };
      console.warn('Inkbound password-reset continue URL was rejected; using the default Firebase action handler.', { code });
      try {
        resetLink = await auth.generatePasswordResetLink(email);
      } catch (fallbackError) {
        const fallbackCode = firebaseErrorCode(fallbackError);
        if (fallbackCode.includes('user-not-found')) return { success: true };
        console.error('Firebase could not generate an Inkbound password-reset link.', { code: fallbackCode });
        throw new HttpsError('internal', 'Inkbound could not prepare the password reset email. Please try again.');
      }
    }

    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: SENDER,
          to: [email],
          reply_to: REPLY_TO,
          subject: 'Reset your Inkbound password',
          html: buildPasswordResetEmail(resetLink),
          text: buildPasswordResetEmailText(resetLink),
        }),
      });
    } catch (error) {
      console.error('Inkbound could not reach Resend for password reset.', { error });
      throw new HttpsError('unavailable', 'Inkbound could not reach the email delivery service. Please try again.');
    }

    const payload = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
    if (!response.ok) {
      console.error('Resend password reset email failed', { status: response.status, message: payload?.message || payload?.name });
      throw new HttpsError('internal', 'Inkbound could not send the password reset email. Please try again.');
    }

    console.info('Password reset email sent', { resendEmailId: payload?.id });
    return { success: true };
  },
);

function buildPasswordResetEmail(resetLink: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reset your Inkbound password</title></head>
<body style="margin:0;padding:0;background:#171116;color:#f7f0e8;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#171116;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#241a22;border:1px solid #5e4558;border-radius:22px;overflow:hidden;">
<tr><td style="background:#3d2839;padding:38px 32px;text-align:center;"><div style="font-family:Georgia,serif;font-size:34px;font-weight:bold;color:#fff8ef;letter-spacing:.3px;">Inkbound</div><div style="margin-top:8px;color:#d9c8d3;font-size:14px;">Your reading life, remembered.</div></td></tr>
<tr><td style="padding:42px 36px;"><h1 style="margin:0;color:#fff8ef;font-family:Georgia,serif;font-size:28px;line-height:1.3;">Reset your Inkbound password</h1>
<p style="margin:24px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">Hello Reader,</p>
<p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#efe5ec;">We received a request to reset the password for your Inkbound account. Use the button below to choose a new password and get back to your reading life.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:32px auto;"><tr><td align="center" style="background:#a66f91;border-radius:999px;"><a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:15px 30px;color:#171116;font-size:16px;font-weight:bold;text-decoration:none;">Reset My Password</a></td></tr></table>
<p style="margin:0;color:#bdaeb8;font-size:14px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p><p style="margin:10px 0 0;overflow-wrap:anywhere;color:#d6a8c4;font-size:13px;line-height:1.5;">${escapeHtml(resetLink)}</p>
<hr style="margin:32px 0;border:0;border-top:1px solid #5e4558;"><p style="margin:0;color:#a99aa4;font-size:13px;line-height:1.6;">If you did not request a password reset, you can safely ignore this email. Your password will not change.</p></td></tr>
<tr><td style="background:#1d151c;padding:22px 32px;color:#9f909a;font-size:12px;line-height:1.6;text-align:center;">Inkbound is created by Inky Dame Interactive.</td></tr></table></td></tr></table></body></html>`;
}

function buildPasswordResetEmailText(resetLink: string): string {
  return `Hello Reader,\n\nWe received a request to reset the password for your Inkbound account.\n\nReset your password:\n${resetLink}\n\nIf you did not request a password reset, you can safely ignore this email. Your password will not change.\n\nInkbound\nInky Dame Interactive`;
}

function firebaseErrorCode(error: unknown): string {
  if (typeof error !== 'object' || !error || !('code' in error)) return '';
  return String((error as { code?: unknown }).code ?? '').slice(0, 120);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
}
