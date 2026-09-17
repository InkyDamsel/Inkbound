import {
  Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { isNativeRuntime } from './runtimePlatform';

export interface RuntimeAuthenticationAdapter {
  preparePersistence(auth: Auth): Promise<void>;
  restoreSession(auth: Auth): Promise<void>;
  signInWithGoogle(auth: Auth): Promise<void>;
  signInWithEmail(auth: Auth, email: string, password: string): Promise<void>;
  createEmailAccount(auth: Auth, email: string, password: string): Promise<void>;
  signOut(auth: Auth): Promise<void>;
}

function firebaseAuthCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

async function prepareBrowserPersistence(auth: Auth): Promise<void> {
  const persistenceOptions = [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence];
  let lastError: unknown;
  for (const persistence of persistenceOptions) {
    try {
      await setPersistence(auth, persistence);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn('Inkbound could not enable Firebase auth persistence. Continuing with the current Firebase auth state.', lastError);
}

const browserAuthenticationAdapter: RuntimeAuthenticationAdapter = {
  preparePersistence: prepareBrowserPersistence,
  restoreSession: async () => undefined,
  signInWithEmail: async (auth, email, password) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  },
  createEmailAccount: async (auth, email, password) => {
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  },
  signInWithGoogle: async (auth) => {
    if (isNativeRuntime()) throw new Error('Google sign-in is not connected to the Android app build yet.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const code = firebaseAuthCode(error);
      const popupCouldNotOpen = code === 'auth/popup-blocked'
        || code === 'auth/operation-not-supported-in-this-environment';
      if (!popupCouldNotOpen) throw error;
      await signInWithRedirect(auth, provider);
    }
  },
  signOut: async (auth) => signOut(auth),
};

let activeAuthenticationAdapter: RuntimeAuthenticationAdapter = browserAuthenticationAdapter;

export function configureRuntimeAuthentication(adapter: RuntimeAuthenticationAdapter) {
  activeAuthenticationAdapter = adapter;
}

export function prepareRuntimeAuthPersistence(auth: Auth) {
  return activeAuthenticationAdapter.preparePersistence(auth);
}

export function restoreRuntimeAuthSession(auth: Auth) {
  return activeAuthenticationAdapter.restoreSession(auth);
}

export function signInRuntimeWithGoogle(auth: Auth) {
  return activeAuthenticationAdapter.signInWithGoogle(auth);
}

export function signInRuntimeWithEmail(auth: Auth, email: string, password: string) {
  return activeAuthenticationAdapter.signInWithEmail(auth, email, password);
}

export function createRuntimeEmailAccount(auth: Auth, email: string, password: string) {
  return activeAuthenticationAdapter.createEmailAccount(auth, email, password);
}

export function signOutRuntime(auth: Auth) {
  return activeAuthenticationAdapter.signOut(auth);
}
