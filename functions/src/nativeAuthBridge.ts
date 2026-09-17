import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const adminApp = getApps()[0] ?? initializeApp();
const adminAuth = getAuth(adminApp);

/**
 * Android auth bootstrap bridge.
 *
 * This callable deliberately does not require App Check because it is used to
 * bootstrap the JS Firebase session after the native Firebase SDK has already
 * authenticated the user. Sideloaded physical-device release builds are not
 * guaranteed to receive a Play Integrity verdict, so requiring App Check here
 * would make local release verification impossible.
 *
 * Security comes from the native Firebase ID token itself: it is verified by the
 * Admin SDK with revocation checking enabled, and the returned custom token is
 * minted only for that exact same Firebase UID. The caller cannot choose another
 * UID or gain privileges by using this bridge.
 */
export const exchangeNativeAuthSession = onCall({ enforceAppCheck: false }, async (request) => {
  const data = request.data as Record<string, unknown> | undefined;
  const nativeIdToken = typeof data?.nativeIdToken === 'string' ? data.nativeIdToken.trim() : '';

  if (!nativeIdToken || nativeIdToken.length > 8192) {
    throw new HttpsError('invalid-argument', 'A valid native Firebase session is required.');
  }

  try {
    const decoded = await adminAuth.verifyIdToken(nativeIdToken, true);
    const customToken = await adminAuth.createCustomToken(decoded.uid);
    return { customToken, uid: decoded.uid };
  } catch (error) {
    console.warn('Inkbound native auth bridge rejected a token.', error);
    throw new HttpsError('unauthenticated', 'The Android sign-in session could not be verified. Please sign in again.');
  }
});
