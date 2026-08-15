import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  AppCheck,
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

// DEV/PRODUCTION BOUNDARY
// Normal `npm run dev` sessions use the Firebase Local Emulator Suite so routine
// development cannot create Firestore/Functions/Storage charges or modify real
// reader data. Set VITE_FIREBASE_MODE=production only for an intentional live-cloud
// verification session. Production builds always use the real Firebase services.
const requestedFirebaseMode = readEnv(import.meta.env.VITE_FIREBASE_MODE).toLowerCase();
export const useFirebaseEmulators = import.meta.env.DEV && requestedFirebaseMode !== 'production';
export const firebaseRuntimeMode = useFirebaseEmulators ? 'emulator' : 'production';

// Browser-side production writes are still protected during an intentional live
// development session. The flag has no effect on emulator writes or production builds.
export const allowProductionFirebaseWrites =
  useFirebaseEmulators ||
  !import.meta.env.DEV ||
  readBooleanEnv(import.meta.env.VITE_ALLOW_PROD_FIREBASE_WRITES);

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let readDb: Firestore | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;
let storage: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  // Production Firebase services share the same App Check instance. This must be
  // initialized before protected Functions/Firestore/Storage requests are made so
  // legitimate Inkbound clients receive and refresh reCAPTCHA Enterprise tokens.
  // Emulator development intentionally skips App Check so local workflows remain
  // usable without production reCAPTCHA configuration.
  if (!useFirebaseEmulators && appCheckSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  auth = getAuth(app);

  // Emulator data must never share the persistent browser cache used by production.
  // Keeping development Firestore in memory also makes it obvious that the Emulator
  // Suite is the source of truth while testing locally.
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
    // IMPORTANT: use the hostname that loaded Inkbound, not 127.0.0.1. When Inkbound
    // is opened from another phone/PC/Mac at http://192.168.x.x:3000, 127.0.0.1 would
    // point back to that test device instead of the development computer running the
    // Firebase Emulator Suite. firebase.json binds the emulators to 0.0.0.0 so this
    // hostname works for both localhost and same-network device testing.
    const emulatorHost = window.location.hostname || '127.0.0.1';

    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(readDb, emulatorHost, 8080);
    connectFunctionsEmulator(functions, emulatorHost, 5001);
    if (storage) connectStorageEmulator(storage, emulatorHost, 9199);

    // Local writes are safe and expected because they stay inside the emulators.
    db = readDb;
    console.info(
      `Inkbound DEV mode: Firebase emulators are using ${emulatorHost}. Production data and billing are not being used.`,
    );
  } else {
    // Production and intentional live-cloud verification share one Firestore reader.
    // During localhost live-cloud checks, writes remain null unless separately enabled.
    db = allowProductionFirebaseWrites ? readDb : null;

    if (!appCheckSiteKey) {
      console.warn(
        'Inkbound production Firebase mode is missing VITE_FIREBASE_APP_CHECK_SITE_KEY. App Check-protected requests may be rejected.',
      );
    }

    if (import.meta.env.DEV && !allowProductionFirebaseWrites) {
      console.info(
        'Inkbound live-cloud verification: production reads/functions are enabled, but browser Firestore writes are blocked. Set VITE_ALLOW_PROD_FIREBASE_WRITES=true only for an intentional production write test.',
      );
    }
  }
}

export { app, appCheck, auth, readDb, db, functions, storage };
