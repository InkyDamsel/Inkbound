import { CapacitorHttp, registerPlugin } from '@capacitor/core';
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
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import { configureRuntimeAuthentication } from './runtimeAuthentication';
import { configureRuntimeExport } from './runtimeExport';
import { configureRuntimeLifecycle } from './runtimeLifecycle';
import { configureRuntimeMedia } from './runtimeMedia';
import { initializeNativeSecurityRuntime } from './runtimeNativeSecurityBootstrap';
import {
  PremiumBillingPlan,
  configureRuntimePremiumPurchase,
  signalPremiumEntitlementRefresh,
} from './runtimePremiumPurchase';
import { configureRuntimeReauthentication } from './runtimeReauthentication';
import { isAndroidRuntime } from './runtimePlatform';
import { isNativeDebugBuild } from './runtimeBarcodeScanner';
import {
  configureRuntimeSubscriptionManagement,
  getStripeSubscriptionPortalUrl,
} from './runtimeSubscriptionManagement';

interface PlayPurchaseResult {
  purchaseToken?: string;
  purchased?: boolean;
  pending?: boolean;
  acknowledged?: boolean;
  canceled?: boolean;
}

interface InkboundPlayBillingPlugin {
  purchase(options: { basePlanId: PremiumBillingPlan; obfuscatedAccountId: string }): Promise<PlayPurchaseResult>;
  restore(): Promise<{ purchases: PlayPurchaseResult[] }>;
  acknowledge(options: { purchaseToken: string }): Promise<void>;
  manage(): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
}

const PlayBilling = registerPlugin<InkboundPlayBillingPlugin>('InkboundPlayBilling');

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
  if (!supported.value) {
    throw new Error('Android sharing is unavailable on this device.');
  }
  await Share.share({
    files: [uri],
    title,
    text,
    dialogTitle: title ?? 'Share Inkbound export',
  });
};

const requestNativeGoogleCredential = async () => FirebaseAuthentication.signInWithGoogle({
  skipNativeAuth: true,
  useCredentialManager: true,
});

const requestNativeAppleCredential = async () => FirebaseAuthentication.signInWithApple({
  skipNativeAuth: true,
});

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const verifyPlayPurchase = async (purchase: PlayPurchaseResult) => {
  const purchaseToken = purchase.purchaseToken?.trim() ?? '';
  if (!purchaseToken) throw new Error('Google Play did not return a purchase token.');
  if (purchase.pending && !purchase.purchased) throw new Error('Your Google Play purchase is pending. Premium will unlock after Google confirms payment.');
  if (!purchase.purchased) throw new Error('Google Play has not completed this Premium purchase.');
  if (!functions) throw new Error('Inkbound billing verification is unavailable right now.');

  const verifySubscription = httpsCallable<{ purchaseToken: string }, { verified: boolean }>(
    functions,
    'verifyGooglePlaySubscription',
  );
  const response = await verifySubscription({ purchaseToken });
  if (!response.data.verified) throw new Error('Google Play could not verify Inkbound Premium.');

  if (!purchase.acknowledged) await PlayBilling.acknowledge({ purchaseToken });
  signalPremiumEntitlementRefresh();
};

/**
 * Installs Android-native service adapters while preserving Inkbound's existing
 * Firebase JS clients as the single auth/App Check/session/entitlement authority.
 *
 * Native plugins supply device capabilities only:
 * - Play Integrity -> Firebase JS App Check CustomProvider
 * - Google native sign-in -> Firebase JS Auth credential
 * - Google Play Billing -> verified Firebase Premium entitlement
 * - Capacitor App lifecycle -> Inkbound runtime resume signal
 * - Filesystem/Share -> user-owned export/share flows
 */
export async function initializeAndroidRuntime() {
  if (!isAndroidRuntime()) return;

  const nativeDebugBuild = await isNativeDebugBuild();
  // A normal Android app built with android:sync must not switch Firebase
  // to its debug-token provider merely because Android Studio installed a
  // debuggable native variant. Only explicit scanner-diagnostics builds opt in.
  // App Check enforcement remains enabled in both configurations.
  const scannerDiagnosticsBuild = import.meta.env.MODE === 'scanner-debug';
  const enableNativeAppCheckDebug = scannerDiagnosticsBuild && nativeDebugBuild;
  const nativeAppCheckReady = FirebaseAppCheck.initialize({
    isTokenAutoRefreshEnabled: true,
    ...(enableNativeAppCheckDebug ? { debugToken: true } : {}),
  });
  if (enableNativeAppCheckDebug) {
    console.info('Inkbound scanner diagnostic build: Firebase App Check debug provider enabled. This test build requires a registered Firebase debug token.');
  }

  configureRuntimeAuthentication({
    supportsAppleSignIn: true,
    // Android Firebase Auth persistence is now configured when the Auth instance
    // is created in lib/firebase.ts. Re-running setPersistence here can race the
    // startup restoration inside a Capacitor WebView and falsely report that the
    // account cannot be kept signed in.
    preparePersistence: async () => undefined,
    signInWithGoogle: async (firebaseAuth) => {
      const result = await requestNativeGoogleCredential();
      const idToken = result.credential?.idToken ?? '';
      const accessToken = result.credential?.accessToken ?? '';
      if (!idToken) {
        throw new Error('Google sign-in did not return an Android identity token.');
      }
      await signInWithCredential(
        firebaseAuth,
        GoogleAuthProvider.credential(idToken, accessToken || undefined),
      );
    },
    signInWithApple: async (firebaseAuth) => {
      const result = await requestNativeAppleCredential();
      const idToken = result.credential?.idToken ?? '';
      const nonce = result.credential?.nonce ?? '';
      if (!idToken) {
        throw new Error('Apple sign-in did not return an Android identity token.');
      }
      const provider = new OAuthProvider('apple.com');
      await signInWithCredential(
        firebaseAuth,
        provider.credential({ idToken, rawNonce: nonce || undefined }),
      );
    },
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
        if (!idToken) {
          throw new Error('Apple verification did not return an Android identity token.');
        }
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

  configureRuntimePremiumPurchase({
    isAvailable: () => Boolean(auth?.currentUser && functions),
    canRestore: () => Boolean(auth?.currentUser && functions),
    canShowPurchaseOptions: () => true,
    purchase: async (plan) => {
      const uid = auth?.currentUser?.uid;
      if (!uid) throw new Error('Sign in before starting a Premium subscription.');
      const purchase = await PlayBilling.purchase({
        basePlanId: plan,
        obfuscatedAccountId: await sha256Hex(uid),
      });
      if (purchase.canceled) return;
      await verifyPlayPurchase(purchase);
    },
    restore: async () => {
      if (!auth?.currentUser) throw new Error('Sign in before restoring Premium.');
      const result = await PlayBilling.restore();
      let restored = 0;
      for (const purchase of result.purchases ?? []) {
        if (!purchase.purchased) continue;
        await verifyPlayPurchase(purchase);
        restored += 1;
      }
      if (restored > 0) signalPremiumEntitlementRefresh();
      return restored;
    },
  });

  configureRuntimeSubscriptionManagement({
    isAvailable: () => Boolean(auth?.currentUser && functions),
    open: async (provider) => {
      if (provider === 'google_play') {
        await PlayBilling.manage();
        return;
      }
      const url = await getStripeSubscriptionPortalUrl();
      await PlayBilling.openExternal({ url });
    },
  });

  configureRuntimeMedia({
    fetchDataUrl: async (url) => {
      if (!url) return '';
      if (url.startsWith('data:')) return url;

      // Local bundled assets still use the WebView's normal fetch path.
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
      const path = exportCachePath(filename);
      const result = await Filesystem.writeFile({
        path,
        data: contents,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await shareCachedFile(result.uri, `Export ${sanitizeExportFilename(filename)}`);
    },
    exportBinaryFile: async ({ filename, contents }) => {
      const path = exportCachePath(filename);
      const result = await Filesystem.writeFile({
        path,
        data: await blobToBase64(contents),
        directory: Directory.Cache,
        recursive: true,
      });
      await shareCachedFile(result.uri, `Export ${sanitizeExportFilename(filename)}`);
    },
    shareBinaryFile: async ({ filename, contents, title, text }) => {
      const path = exportCachePath(filename);
      const result = await Filesystem.writeFile({
        path,
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
      return {
        token: result.token,
        expireTimeMillis: result.expireTimeMillis,
      };
    },
  });

  void nativeAppCheckReady.catch((error) => {
    console.error('Inkbound Android App Check could not initialize.', error);
  });
}
