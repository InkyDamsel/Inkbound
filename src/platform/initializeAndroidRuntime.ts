import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { App as CapacitorApp } from '@capacitor/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  browserLocalPersistence,
  reauthenticateWithCredential,
  setPersistence,
  signInWithCredential,
} from 'firebase/auth';
import { configureRuntimeAuthentication } from './runtimeAuthentication';
import { configureRuntimeLifecycle } from './runtimeLifecycle';
import { initializeNativeSecurityRuntime } from './runtimeNativeSecurityBootstrap';
import { configureRuntimeReauthentication } from './runtimeReauthentication';
import { isAndroidRuntime } from './runtimePlatform';

/**
 * Installs Android-native service adapters while preserving Inkbound's existing
 * Firebase JS clients as the single auth/App Check/session authority.
 *
 * Native plugins supply device capabilities only:
 * - Play Integrity -> Firebase JS App Check CustomProvider
 * - Google Credential Manager -> Firebase JS Auth credential
 * - Capacitor App lifecycle -> Inkbound runtime resume signal
 */
export async function initializeAndroidRuntime() {
  if (!isAndroidRuntime()) return;

  // Native App Check must be initialized before its token source is bound to the
  // Firebase JS SDK, but Android is not marked ready until every adapter below is
  // configured. That prevents account/security providers from racing startup.
  await FirebaseAppCheck.initialize({
    isTokenAutoRefreshEnabled: true,
  });

  configureRuntimeAuthentication({
    preparePersistence: async (auth) => {
      await setPersistence(auth, browserLocalPersistence);
    },
    signInWithGoogle: async (auth) => {
      const result = await FirebaseAuthentication.signInWithGoogle({
        skipNativeAuth: true,
        useCredentialManager: true,
      });
      const idToken = result.credential?.idToken ?? '';
      const accessToken = result.credential?.accessToken ?? '';
      if (!idToken) {
        throw new Error('Google sign-in did not return an Android identity token.');
      }
      await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(idToken, accessToken || undefined),
      );
    },
  });

  configureRuntimeReauthentication({
    getRequirement: (user) => {
      const providers = new Set(user.providerData.map((provider) => provider.providerId));
      if (providers.has('google.com')) return 'google';
      if (providers.has('password')) return 'password';
      return 'unsupported';
    },
    reauthenticate: async (user, options = {}) => {
      const providers = new Set(user.providerData.map((provider) => provider.providerId));

      if (providers.has('google.com')) {
        const result = await FirebaseAuthentication.signInWithGoogle({
          skipNativeAuth: true,
          useCredentialManager: true,
        });
        const idToken = result.credential?.idToken ?? '';
        const accessToken = result.credential?.accessToken ?? '';
        if (!idToken) {
          throw new Error('Google verification did not return an Android identity token.');
        }
        await reauthenticateWithCredential(
          user,
          GoogleAuthProvider.credential(idToken, accessToken || undefined),
        );
        await user.getIdToken(true);
        return;
      }

      if (providers.has('password')) {
        const email = user.email?.trim();
        const password = options.password ?? '';
        if (!email || !password) {
          throw new Error('Enter your password to verify this account before deleting it.');
        }
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
        await user.getIdToken(true);
        return;
      }

      throw new Error('This sign-in method cannot be verified on Android yet.');
    },
  });

  configureRuntimeLifecycle({
    subscribeToResume: (listener) => {
      let removed = false;
      const handlePromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive && !removed) listener();
      });

      const handleOnline = () => listener();
      window.addEventListener('online', handleOnline);

      return () => {
        removed = true;
        window.removeEventListener('online', handleOnline);
        void handlePromise.then((handle) => handle.remove());
      };
    },
  });

  // This is intentionally last. It binds native Play Integrity tokens to the
  // single Firebase JS App Check instance and only then releases NativeRuntimeGate.
  initializeNativeSecurityRuntime({
    getToken: async (forceRefresh = false) => {
      const result = await FirebaseAppCheck.getToken({ forceRefresh });
      return {
        token: result.token,
        expireTimeMillis: result.expireTimeMillis,
      };
    },
  });
}
