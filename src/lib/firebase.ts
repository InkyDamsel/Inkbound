import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import {
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { Functions, getFunctions } from 'firebase/functions';
import { FirebaseStorage, getStorage } from 'firebase/storage';

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

// Local development must be able to READ the signed-in reader's production data
// so a second computer can restore the same library, profile, and entitlements.
// Production writes remain separately protected unless explicitly enabled.
export const allowProductionFirebaseWrites =
  !import.meta.env.DEV || readBooleanEnv(import.meta.env.VITE_ALLOW_PROD_FIREBASE_WRITES);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let readDb: Firestore | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;
let storage: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);

  // One Firestore instance is initialized for authenticated reads in every
  // environment. Code that may write must continue importing `db`, which is null
  // in protected local development. Read-only code should import `readDb`.
  readDb = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
  db = allowProductionFirebaseWrites ? readDb : null;

  if (!allowProductionFirebaseWrites) {
    console.info(
      'Inkbound development safety: production Firestore writes are disabled. Cloud reads remain enabled so this device can restore the signed-in account. Set VITE_ALLOW_PROD_FIREBASE_WRITES=true only when intentionally testing live cloud writes.',
    );
  }

  // Callable functions remain available in development because account access and
  // book search do not require browser-side Firestore writes.
  functions = getFunctions(app);
  storage = firebaseConfig.storageBucket ? getStorage(app) : null;
}

export { app, auth, readDb, db, functions, storage };
