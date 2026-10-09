import { CapacitorHttp } from '@capacitor/core';
import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { App as CapacitorApp } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  reauthenticateWithCredential,
  signInWithCredential,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { configureRuntimeAuthentication } from './runtimeAuthentication';
import { configureRuntimeExport } from './runtimeExport';
import { configureRuntimeLifecycle } from './runtimeLifecycle';
import { configureRuntimeMedia } from './runtimeMedia';
import { initializeNativeSecurityRuntime } from './runtimeNativeSecurityBootstrap';
import { configureRuntimePremiumPurchase } from './runtimePremiumPurchase';
import { configureRuntimeReauthentication } from './runtimeReauthentication';
import { isIOSRuntime } from './runtimePlatform';

const sanitizeExportFilename = (filename: string) => {
  const cleaned = filename.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '');
  return cleaned || 'inkbound-export';
};

const exportCachePath = (filename: string) =>
  `inkbound-exports/${Date.now()}-${crypto.randomUUID()}/${sanitizeExportFilename(filename)}`;

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const shareCachedFile = async (uri: string, title?: string, text?: string) => {
  const supported = await Share.canShare();
  if (!supported.value) throw new Error('Sharing is unavailable on this device.');
  await Share.share({ files: [uri], title, text, dialogTitle: title ?? 'Share Inkbound export' });
};

const requestNativeGoogleCredential = async () => FirebaseAuthentication.signInWithGoogle({
  skipNativeAuth: true,
});

const requestNativeAppleCredential = async () => FirebaseAuthentication.signInWithApple({
  skipNativeAuth: true,
});

const signIntoFirebaseWithApple = async () => {
  const result = await requestNativeAppleCredential();
  const idToken = result.credential?.idToken ?? '';
  const nonce = result.credential?.nonce ?? '';
  if (!idToken) throw new Error('Apple sign-in did not return an identity token.');
  const provider = new OAuthProvider('apple.com');
  await signInWithCredential(auth!, provider.credential({
    idToken,
    rawNonce: nonce || undefined,
  }));
};

/**
 * iOS native service adapters.
 *
 * The Firebase JS clients remain Inkbound's single auth/App Check/data authority.
 * Native iOS supplies Apple/Google identity, App Attest/DeviceCheck tokens,
 * lifecycle events, and native file/share capabilities.
 *
 * StoreKit purchasing is intentionally not enabled here until Inkbound Premium
 * subscriptions are opened on iOS and verified by the canonical entitlement
 * service. The first App Store launch therefore cannot accidentally route a
 * digital purchase through Stripe or Google Play.
 */
export async function initializeIOSRuntime() {
  if (!isIOSRuntime()) return;

  const nativeAppCheckReady = FirebaseAppCheck.initialize({
    isTokenAutoRefreshEnabled: true,
  });

  configureRuntimeAuthentication({
    supportsAppleSignIn: true,
    preparePersistence: async () => undefined,
    signInWithGoogle: async (firebaseAuth) => {
      const result = await requestNativeGoogleCredential();
      const idToken = result.credential?.idToken ?? '';
      const accessToken = result.credential?.accessToken ?? '';
      if (!idToken) throw new Error('Google sign-in did not return an iOS identity token.');
      await signInWithCredential(
        firebaseAuth,
        GoogleAuthProvider.credential(idToken, accessToken || undefined),
      );
    },
    signInWithApple: async () => {
      if (!auth) throw new Error('Apple sign-in is unavailable right now.');
      await signIntoFirebaseWithApple();
    },
  });

  configureRuntimePremiumPurchase({
    isAvailable: () => false,
    canRestore: () => false,
    canShowPurchaseOptions: () => false,
    purchase: async () => {
      throw new Error('Premium purchasing is not open in the iOS app yet.');
    },
    restore: async () => 0,
  });

  configureRuntimeReauthentication({
    getRequirement: (user) => {
      const providers = new Set(user.providerData.map((provider) => provider.providerId));
      if (providers.has('apple.com')) return 'apple';
      if (providers.has('google.com')) return 'google';
      if (providers.has('password')) return 'password';
      return 'unsupported';
    },
    reauthenticate: async (user, options = {}) => {
      const providers = new Set(user.providerData.map((provider) => provider.providerId));

      if (providers.has('apple.com')) {
        const result = await requestNativeAppleCredential();
        const idToken = result.credential?.idToken ?? '';
        const nonce = result.credential?.nonce ?? '';
        if (!idToken) throw new Error('Apple verification did not return an identity token.');
        const provider = new OAuthProvider('apple.com');
        await reauthenticateWithCredential(
          user,
          provider.credential({ idToken, rawNonce: nonce || undefined }),
        );
        await user.getIdToken(true);
        return;
      }

      if (providers.has('google.com')) {
        const result = await requestNativeGoogleCredential();
        const idToken = result.credential?.idToken ?? '';
        const accessToken = result.credential?.accessToken ?? '';
        if (!idToken) throw new Error('Google verification did not return an iOS identity token.');
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
        if (!email || !password) throw new Error('Enter your password to verify this account before deleting it.');
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
        await user.getIdToken(true);
        return;
      }

      throw new Error('This sign-in method cannot be verified on iOS yet.');
    },
  });

  configureRuntimeMedia({
    fetchDataUrl: async (url) => {
      if (!url) return '';
      if (url.startsWith('data:')) return url;

      if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
        try {
          const response = await fetch(url);
          if (!response.ok) return '';
          const blob = await response.blob();
          return `data:${blob.type || 'application/octet-stream'};base64,${await blobToBase64(blob)}`;
        } catch {
          return '';
        }
      }

      try {
        const response = await CapacitorHttp.get({ url, responseType: 'arraybuffer' });
        if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string') return '';
        if (response.data.startsWith('data:')) return response.data;
        const headers = response.headers ?? {};
        const mime = String(headers['content-type'] ?? headers['Content-Type'] ?? 'image/jpeg')
          .split(';')[0]
          .trim() || 'image/jpeg';
        return `data:${mime};base64,${response.data}`;
      } catch {
        return '';
      }
    },
  });

  configureRuntimeExport({
    exportTextFile: async ({ filename, contents }) => {
      const result = await Filesystem.writeFile({
        path: exportCachePath(filename),
        data: contents,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await shareCachedFile(result.uri, `Export ${sanitizeExportFilename(filename)}`);
    },
    exportBinaryFile: async ({ filename, contents }) => {
      const result = await Filesystem.writeFile({
        path: exportCachePath(filename),
        data: await blobToBase64(contents),
        directory: Directory.Cache,
        recursive: true,
      });
      await shareCachedFile(result.uri, `Export ${sanitizeExportFilename(filename)}`);
    },
    shareBinaryFile: async ({ filename, contents, title, text }) => {
      const result = await Filesystem.writeFile({
        path: exportCachePath(filename),
        data: await blobToBase64(contents),
        directory: Directory.Cache,
        recursive: true,
      });
      await shareCachedFile(result.uri, title ?? sanitizeExportFilename(filename), text);
      return 'shared';
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

  initializeNativeSecurityRuntime({
    getToken: async (forceRefresh = false) => {
      await nativeAppCheckReady;
      const result = await FirebaseAppCheck.getToken({ forceRefresh });
      return { token: result.token, expireTimeMillis: result.expireTimeMillis };
    },
  });

  void nativeAppCheckReady.catch((error) => {
    console.error('Inkbound iOS App Check could not initialize.', error);
  });
}
