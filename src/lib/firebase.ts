import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  AppCheck,
  CustomProvider,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
} from 'firebase/auth';
import {
  Firestore,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
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

export const useFirebaseEmulators = import.meta.env.DEV && requestedFirebaseMode === 'emulator';
export const firebaseRuntimeMode = useFirebaseEmulators ? 'emulator' : 'production';

const explicitProductionMode = import.meta.env.DEV && requestedFirebaseMode === 'production';
export const allowProductionFirebaseWrites =
  useFirebaseEmulators ||
  !import.meta.env.DEV ||
  explicitProductionMode ||
  readBooleanEnv(import.meta.env.VITE_ALLOW_PROD_FIREBASE_WRITES);

export const allowProductionFirebaseFunctions =
  useFirebaseEmulators ||
  !import.meta.env.DEV ||
  explicitProductionMode ||
  readBooleanEnv(import.meta.env.VITE_ALLOW_PROD_FIREBASE_FUNCTIONS);

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let readDb: Firestore | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;
let storage: FirebaseStorage | null = null;

function isIosBrowserRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent ?? '';
  const platform = navigator.platform ?? '';
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function enableWebAppCheckDebugMode() {
  if (!import.meta.env.DEV || useFirebaseEmulators || isNativeRuntime()) return;
  const debugGlobal = globalThis as typeof globalThis & {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  };
  if (debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN === undefined) {
    debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
}

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

  enableWebAppCheckDebugMode();

  if (!useFirebaseEmulators && !isNativeRuntime() && appCheckSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  // Web owns its normal durable Firebase JS Auth session. Android deliberately
  // keeps the JS mirror in memory only: native Firebase Auth owns durable device
  // persistence, and initializeAndroidRuntime restores that verified native UID
  // into this JS session on every launch. This avoids WebView IndexedDB/local
  // persistence deadlocks while preserving one JS Auth identity for Firestore,
  // Functions and the rest of Inkbound during the running app session.
  auth = isNativeRuntime()
    ? initializeAuth(app, { persistence: inMemoryPersistence })
    : getAuth(app);

  const forceIosLongPolling = !isNativeRuntime() && isIosBrowserRuntime();
  readDb = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: memoryLocalCache(),
    ...(forceIosLongPolling ? {
      experimentalForceLongPolling: true,
      experimentalLongPollingOptions: { timeoutSeconds: 30 },
    } : {}),
  });

  functions = allowProductionFirebaseFunctions ? getFunctions(app) : null;
  storage = firebaseConfig.storageBucket ? getStorage(app) : null;

  if (useFirebaseEmulators) {
    const emulatorHost = window.location.hostname || '127.0.0.1';

    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(readDb, emulatorHost, 8080);
    if (functions) connectFunctionsEmulator(functions, emulatorHost, 5001);
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
        'Inkbound protected DEV mode: production Firestore writes and production Cloud Functions are blocked. The local working copy is used without production Firestore collection reads. Set VITE_FIREBASE_MODE=production only for intentional live-cloud beta verification.',
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
