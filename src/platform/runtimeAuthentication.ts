import {
  Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth';

export interface RuntimeAuthenticationAdapter {
  preparePersistence(auth: Auth): Promise<void>;
  signInWithGoogle(auth: Auth): Promise<void>;
}

const browserAuthenticationAdapter: RuntimeAuthenticationAdapter = {
  preparePersistence: async (auth) => {
    await setPersistence(auth, browserLocalPersistence);
  },
  signInWithGoogle: async (auth) => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  },
};

let activeAuthenticationAdapter: RuntimeAuthenticationAdapter = browserAuthenticationAdapter;

/**
 * Platform boundary for authentication behaviors that differ between web and
 * installed mobile apps. Native shells can install Google/Apple-aware adapters
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
