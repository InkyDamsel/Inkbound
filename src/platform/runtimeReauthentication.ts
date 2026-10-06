import {
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { isNativeRuntime } from './runtimePlatform';

export type ReauthenticationRequirement = 'apple' | 'google' | 'password' | 'unsupported';

export interface RuntimeReauthenticationOptions {
  password?: string;
}

export interface RuntimeReauthenticationAdapter {
  getRequirement(user: User): ReauthenticationRequirement;
  reauthenticate(user: User, options?: RuntimeReauthenticationOptions): Promise<void>;
}

const browserReauthenticationAdapter: RuntimeReauthenticationAdapter = {
  getRequirement: (user) => {
    const providers = new Set(user.providerData.map((provider) => provider.providerId));
    if (providers.has('apple.com')) return 'apple';
    if (providers.has('google.com')) return 'google';
    if (providers.has('password')) return 'password';
    return 'unsupported';
  },
  reauthenticate: async (user, options = {}) => {
    const requirement = browserReauthenticationAdapter.getRequirement(user);

    if (requirement === 'apple') {
      throw new Error('Apple account verification requires the native authentication adapter on this device.');
    }

    if (requirement === 'google') {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await reauthenticateWithPopup(user, provider);
      await user.getIdToken(true);
      return;
    }

    if (requirement === 'password') {
      const email = user.email?.trim();
      const password = options.password ?? '';
      if (!email || !password) {
        throw new Error('Enter your password to verify this account before deleting it.');
      }
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
      await user.getIdToken(true);
      return;
    }

    throw new Error('This sign-in method needs a native reauthentication adapter before account deletion can continue.');
  },
};

const nativeSafeReauthenticationAdapter: RuntimeReauthenticationAdapter = {
  getRequirement: (user) => {
    const providers = new Set(user.providerData.map((provider) => provider.providerId));
    // Email/password reauthentication is supported by the shared Firebase SDK and
    // does not require a browser surface. Apple/Google require the native auth
    // adapter so we never fall back to browser reauthentication inside a WebView.
    if (providers.has('password')) return 'password';
    return 'unsupported';
  },
  reauthenticate: async (user, options = {}) => {
    if (nativeSafeReauthenticationAdapter.getRequirement(user) === 'password') {
      const email = user.email?.trim();
      const password = options.password ?? '';
      if (!email || !password) {
        throw new Error('Enter your password to verify this account before deleting it.');
      }
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
      await user.getIdToken(true);
      return;
    }

    throw new Error('This provider requires the native authentication adapter before account verification can continue.');
  },
};

let activeReauthenticationAdapter: RuntimeReauthenticationAdapter = isNativeRuntime()
  ? nativeSafeReauthenticationAdapter
  : browserReauthenticationAdapter;

/**
 * Platform boundary for security-sensitive account verification.
 * Native iOS/Android shells install an adapter backed by native authentication
 * without changing Settings or account-deletion UI logic.
 */
export function configureRuntimeReauthentication(adapter: RuntimeReauthenticationAdapter) {
  activeReauthenticationAdapter = adapter;
}

export function getRuntimeReauthenticationRequirement(user: User): ReauthenticationRequirement {
  return activeReauthenticationAdapter.getRequirement(user);
}

export function reauthenticateRuntimeUser(user: User, options?: RuntimeReauthenticationOptions) {
  return activeReauthenticationAdapter.reauthenticate(user, options);
}
