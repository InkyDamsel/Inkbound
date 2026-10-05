import {
  Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { isNativeRuntime } from './runtimePlatform';

export interface RuntimeAuthenticationAdapter {
  preparePersistence(auth: Auth): Promise<void>;
  signInWithGoogle(auth: Auth): Promise<void>;
  signInWithApple?(auth: Auth): Promise<void>;
}

function firebaseAuthCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

async function prepareBrowserPersistence(auth: Auth): Promise<void> {
  const persistenceOptions = [
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ];

  let lastError: unknown;
  for (const persistence of persistenceOptions) {
    try {
      await setPersistence(auth, persistence);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  // Authentication itself is more important than persistence. If a browser is
  // blocking every storage mechanism, Firebase can still attempt the sign-in
  // instead of Inkbound failing before credentials are even checked.
  console.warn('Inkbound could not enable Firebase auth persistence. Continuing with the current Firebase auth state.', lastError);
}

const browserAuthenticationAdapter: RuntimeAuthenticationAdapter = {
  preparePersistence: async (auth) => {
    await prepareBrowserPersistence(auth);
  },
  signInWithGoogle: async (auth) => {
    if (isNativeRuntime()) {
      throw new Error('Google sign-in is not connected to the Android app build yet. Use email/password while the native Google sign-in adapter is being configured.');
    }

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const code = firebaseAuthCode(error);
      const popupCouldNotOpen = code === 'auth/popup-blocked'
        || code === 'auth/operation-not-supported-in-this-environment';

      if (!popupCouldNotOpen) throw error;

      // Some browsers/extensions block Firebase popup handshakes. Redirect is a
      // safe browser fallback and onAuthStateChanged restores the signed-in user
      // when Inkbound returns from Google.
      await signInWithRedirect(auth, provider);
    }
  },
};

let activeAuthenticationAdapter: RuntimeAuthenticationAdapter = browserAuthenticationAdapter;

/**
 * Platform boundary for authentication behaviors that differ between web and
 * installed mobile apps. Android installs the native Google/Firebase adapter
 * without changing AccountSyncContext or feature UI.
 */
export function configureRuntimeAuthentication(adapter: RuntimeAuthenticationAdapter) {
  activeAuthenticationAdapter = adapter;
}

export function prepareRuntimeAuthPersistence(auth: Auth) {
  return activeAuthenticationAdapter.preparePersistence(auth);
}

export function signInRuntimeWithGoogle(auth: Auth) {
  return activeAuthenticationAdapter.signInWithGoogle(auth);
}

export function signInRuntimeWithApple(auth: Auth) {
  if (!activeAuthenticationAdapter.signInWithApple) {
    throw new Error('Apple sign-in is only available in the iOS app right now.');
  }
  return activeAuthenticationAdapter.signInWithApple(auth);
}
