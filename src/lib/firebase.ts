import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  AppCheck,
  CustomProvider,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  Firestore,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { Functions, connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { FirebaseStorage, connectStorageEmulator, getStorage } from 'firebase/storage';
import { getNativeAppCheckToken } from '../platform/runtimeNativeAppCheck';
import { isNativeRuntime } from '../platform/runtimePlatform';

const readEnv = (value: string | undefined): string => value?.trim() ?? '';
const readBooleanEnv = (value: string | undefined): boolean => readEnv(value).toLowerCase() === 'true';

const firebaseConfig = {
  apiKey: readEnv(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: readEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: readEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: readEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: readEnv(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: readEnv(import.meta.env.VITE_FIREBASE_APP_ID),
};

const appCheckSiteKey = readEnv(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY);

const requiredFirebaseFields = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
};

export const missingFirebaseEnvironmentVariables = Object.entries(requiredFirebaseFields)
  .filter(([, value]) => !value)
  .map(([name]) => name);

export const isFirebaseConfigured = missingFirebaseEnvironmentVariables.length === 0;

const requestedFirebaseMode = readEnv(import.meta.env.VITE_FIREBASE_MODE).toLowerCase();

// Emulator routing must be explicit. A normal `npm run dev` session is also how
// we perform browser beta verification, so silently redirecting Auth to :9099
// makes Google sign-in fail whenever the local emulator suite is not running.
// Set VITE_FIREBASE_MODE=emulator only for an intentional emulator session.
export const useFirebaseEmulators = import.meta.env.DEV && requestedFirebaseMode === 'emulator';
export const firebaseRuntimeMode = useFirebaseEmulators ? 'emulator' : 'production';

// In development, production writes require explicit intent. Either the dedicated
// write flag or VITE_FIREBASE_MODE=production is sufficient. This keeps an ordinary
// blank-mode DEV session read-only, while making intentional live-cloud beta tests
// fully writable instead of allowing local-only changes that disappear on rehydrate.
const explicitProductionMode = import.meta.env.DEV && requestedFirebaseMode === 'production';
export const allowProductionFirebaseWrites =
  useFirebaseEmulators ||
  !import.meta.env.DEV ||
  explicitProductionMode ||
  readBooleanEnv(import.meta.env.VITE_ALLOW_PROD_FIREBASE_WRITES);

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let readDb: Firestore | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;
let storage: FirebaseStorage | null = null;

/**
 * Firebase App Check debug mode is safe only in a development build. It lets a
 * localhost browser call App Check-protected production Functions without
 * weakening enforcement for actual beta/production clients.
 *
 * Firebase prints the generated debug token in the browser console the first
 * time this runs. Register that token once in Firebase Console -> App Check ->
 * your web app -> Manage debug tokens. Never copy the token into source control.
 */
function enableWebAppCheckDebugMode() {
  if (!import.meta.env.DEV || useFirebaseEmulators || isNativeRuntime()) return;
  const debugGlobal = globalThis as typeof globalThis & {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  };
  if (debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN === undefined) {
    debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
}

/**
 * Android App Check is intentionally initialized only after the native Play
 * Integrity adapter is registered. initializeAppCheck may immediately ask its
 * provider for a token when auto-refresh is enabled, so doing this at module
 * evaluation time would race the native bootstrap.
 */
export function initializeNativeFirebaseAppCheck(): AppCheck | null {
  if (!app || useFirebaseEmulators || !isNativeRuntime()) return appCheck;
  if (appCheck) return appCheck;

  appCheck = initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => getNativeAppCheckToken(),
    }),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  // Local live-cloud testing still honors App Check. DEV uses Firebase's debug
  // provider token, while deployed web builds use reCAPTCHA Enterprise and the
  // Android beta uses Play Integrity through initializeNativeFirebaseAppCheck().
  enableWebAppCheckDebugMode();

  if (!useFirebaseEmulators && !isNativeRuntime() && appCheckSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  auth = getAuth(app);

  readDb = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: useFirebaseEmulators
      ? memoryLocalCache()
      : persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
  });

  functions = getFunctions(app);
  storage = firebaseConfig.storageBucket ? getStorage(app) : null;

  if (useFirebaseEmulators) {
    const emulatorHost = window.location.hostname || '127.0.0.1';

    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(readDb, emulatorHost, 8080);
    connectFunctionsEmulator(functions, emulatorHost, 5001);
    if (storage) connectStorageEmulator(storage, emulatorHost, 9199);

    db = readDb;
    console.info(
      `Inkbound DEV mode: Firebase emulators are using ${emulatorHost}. Production data and billing are not being used.`,
    );
  } else {
    db = allowProductionFirebaseWrites ? readDb : null;

    if (!isNativeRuntime() && !appCheckSiteKey) {
      console.warn(
        'Inkbound production Firebase mode is missing VITE_FIREBASE_APP_CHECK_SITE_KEY. App Check-protected requests may be rejected.',
      );
    }

    if (import.meta.env.DEV && !allowProductionFirebaseWrites) {
      console.info(
        'Inkbound live-cloud verification: production reads/functions are enabled, but browser Firestore writes are blocked. Set VITE_FIREBASE_MODE=production (recommended for intentional beta testing) or VITE_ALLOW_PROD_FIREBASE_WRITES=true before changing production-backed reader data.',
      );
    }

    if (import.meta.env.DEV && explicitProductionMode) {
      console.info(
        'Inkbound live-cloud beta test mode: production reads, functions, and Firestore writes are enabled by explicit VITE_FIREBASE_MODE=production.',
      );
    }
  }
}

export { app, appCheck, auth, readDb, db, functions, storage };