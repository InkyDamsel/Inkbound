import { useEffect } from 'react';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { app, useFirebaseEmulators } from '../lib/firebase';

let appCheckInitialized = false;

const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim() ?? '';

/**
 * Starts Firebase App Check once for real-cloud runtimes.
 *
 * IMPORTANT FOR RELEASE:
 * - Register the Inkbound web app with App Check / reCAPTCHA Enterprise.
 * - Put that public site key in VITE_FIREBASE_APP_CHECK_SITE_KEY.
 * - Only enable Firebase App Check enforcement after a production smoke test
 *   confirms valid tokens are reaching Firestore, Functions, and Storage.
 *
 * Emulator development intentionally skips App Check so local development stays
 * deterministic and does not depend on external attestation services.
 */
export function FirebaseAppCheckBridge() {
  useEffect(() => {
    if (!app || useFirebaseEmulators || appCheckInitialized) return;

    if (!siteKey) {
      if (import.meta.env.PROD) {
        console.error(
          'Inkbound production is missing VITE_FIREBASE_APP_CHECK_SITE_KEY. App Check is not active.',
        );
      }
      return;
    }

    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckInitialized = true;
    } catch (error) {
      console.error('Inkbound could not initialize Firebase App Check.', error);
    }
  }, []);

  return null;
}
