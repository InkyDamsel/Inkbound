import {
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';

export type ReauthenticationRequirement = 'google' | 'password' | 'unsupported';

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
    if (providers.has('google.com')) return 'google';
    if (providers.has('password')) return 'password';
    return 'unsupported';
  },
  reauthenticate: async (user, options = {}) => {
    const requirement = browserReauthenticationAdapter.getRequirement(user);

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

let activeReauthenticationAdapter: RuntimeReauthenticationAdapter = browserReauthenticationAdapter;

/**
 * Platform boundary for security-sensitive account verification.
 * Native iOS/Android shells can install an adapter backed by Apple/Google/native
 * authentication without changing Settings or account-deletion UI logic.
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
