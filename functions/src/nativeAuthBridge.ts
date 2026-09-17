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
 * authenticated the user. Security comes from the native Firebase ID token: the
 * caller never supplies a UID and the custom token is minted only for the UID
 * verified from that signed Firebase token.
 */
export const exchangeNativeAuthSession = onCall({
  enforceAppCheck: false,
  timeoutSeconds: 15,
}, async (request) => {
  const data = request.data as Record<string, unknown> | undefined;
  const nativeIdToken = typeof data?.nativeIdToken === 'string' ? data.nativeIdToken.trim() : '';

  if (!nativeIdToken || nativeIdToken.length > 8192) {
    throw new HttpsError('invalid-argument', 'A valid native Firebase session is required.');
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(nativeIdToken, true);
    uid = decoded.uid;
  } catch (error) {
    console.warn('Inkbound native auth bridge rejected the Firebase ID token.', error);
    throw new HttpsError('unauthenticated', 'The Android sign-in session could not be verified. Please sign in again.');
  }

  try {
    const customToken = await adminAuth.createCustomToken(uid);
    return { customToken, uid };
  } catch (error) {
    console.error('Inkbound native auth bridge could not mint the canonical JS session token. Verify the runtime service account has iam.serviceAccounts.signBlob (Service Account Token Creator).', error);
    throw new HttpsError('internal', 'Inkbound could not finish creating the Android account session.');
  }
});
