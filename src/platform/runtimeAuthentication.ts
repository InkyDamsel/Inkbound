import {
  Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth';
import { isNativeRuntime } from './runtimePlatform';

export interface RuntimeAuthenticationAdapter {
  preparePersistence(auth: Auth): Promise<void>;
  signInWithGoogle(auth: Auth): Promise<void>;
}

const browserAuthenticationAdapter: RuntimeAuthenticationAdapter = {
  preparePersistence: async (auth) => {
    // Firebase's browser-local persistence remains suitable for the Capacitor
    // WebView. Native adapters only need to replace provider flows that depend on
    // browser popup/redirect semantics.
    await setPersistence(auth, browserLocalPersistence);
  },
  signInWithGoogle: async (auth) => {
    if (isNativeRuntime()) {
      throw new Error('Google sign-in is not connected to the Android app build yet. Use email/password while the native Google sign-in adapter is being configured.');
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
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
