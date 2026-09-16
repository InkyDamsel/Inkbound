import { registerPlugin } from '@capacitor/core';
import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { App as CapacitorApp } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithCredential,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import { configureRuntimeAuthentication } from './runtimeAuthentication';
import { configureRuntimeExport } from './runtimeExport';
import { configureRuntimeLifecycle } from './runtimeLifecycle';
import { initializeNativeSecurityRuntime } from './runtimeNativeSecurityBootstrap';
import {
  PremiumBillingPlan,
  configureRuntimePremiumPurchase,
  signalPremiumEntitlementRefresh,
} from './runtimePremiumPurchase';
import { configureRuntimeReauthentication } from './runtimeReauthentication';
import { isAndroidRuntime } from './runtimePlatform';
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
const NATIVE_APP_CHECK_TIMEOUT_MS = 5000;

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

const withNativeSecurityTimeout = <T>(operation: Promise<T>, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out before Android security services responded.`));
    }, NATIVE_APP_CHECK_TIMEOUT_MS);

    operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });

const requestNativeGoogleCredential = async () => FirebaseAuthentication.signInWithGoogle({
  skipNativeAuth: true,
  // Credential Manager can return NoCredentialException even when a Google
  // account exists on the device. Use the established Google account picker
  // instead; the returned token still becomes the canonical Firebase JS
  // credential below.
  useCredentialManager: false,
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
 * Authentication/lifecycle/export adapters are installed before App Check is
 * started. A Play Integrity/App Check failure must never prevent email auth or
 * native Google auth from being wired into the already-open application shell.
 */
export async function initializeAndroidRuntime() {
  if (!isAndroidRuntime()) return;

  configureRuntimeAuthentication({
    // Android Firebase Auth persistence is configured when Auth is created in
    // lib/firebase.ts. Do not switch persistence during startup restoration.
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

  // Preflight only the native Android App Check layer here. Do NOT initialize
  // Firebase JS App Check while the reader is signed out. In a Capacitor WebView
  // the JS App Check bridge can block Firebase JS Auth requests even though the
  // native Play Integrity token itself is valid. Authentication must complete
  // first; protected Firestore/Functions work starts immediately afterward.
  await withNativeSecurityTimeout(
    FirebaseAppCheck.initialize({ isTokenAutoRefreshEnabled: true }),
    'Android App Check initialization',
  );
  await withNativeSecurityTimeout(
    FirebaseAppCheck.getToken({ forceRefresh: false }),
    'Android App Check token',
  );

  const appCheckAdapter = {
    getToken: async (forceRefresh = false) => {
      const result = await withNativeSecurityTimeout(
        FirebaseAppCheck.getToken({ forceRefresh }),
        'Android App Check token',
      );
      return {
        token: result.token,
        expireTimeMillis: result.expireTimeMillis,
      };
    },
  };

  let protectedRuntimeActivated = false;
  const activateProtectedRuntime = () => {
    if (protectedRuntimeActivated) return;
    protectedRuntimeActivated = true;
    try {
      initializeNativeSecurityRuntime(appCheckAdapter);
      console.info('[Inkbound startup] Android protected Firebase services activated after authentication.');
    } catch (error) {
      protectedRuntimeActivated = false;
      console.error('Inkbound Android protected Firebase services could not activate after authentication.', error);
    }
  };

  // Existing persisted sessions activate protected services as soon as Firebase
  // restores the user. Fresh installs stay auth-only until email/Google sign-in
  // has completely succeeded, preventing App Check from deadlocking that request.
  if (auth?.currentUser) activateProtectedRuntime();
  if (auth) {
    onAuthStateChanged(auth, (user) => {
      if (user) activateProtectedRuntime();
    });
  }
}