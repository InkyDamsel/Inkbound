import { registerPlugin } from '@capacitor/core';
import { FirebaseAppCheck } from '@capacitor-firebase/app-check';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { App as CapacitorApp } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { signInWithCustomToken, signOut as signOutJsAuth } from 'firebase/auth';
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

interface NativeAuthBridgeResponse {
  customToken?: string;
  uid?: string;
}

const PlayBilling = registerPlugin<InkboundPlayBillingPlugin>('InkboundPlayBilling');
const NATIVE_AUTH_BRIDGE_URL = 'https://us-central1-inkbound-app.cloudfunctions.net/exchangeNativeAuthSession';
const NATIVE_AUTH_STEP_TIMEOUT_MS = 15000;
const NATIVE_AUTH_BRIDGE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
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
}

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
  if (!supported.value) throw new Error('Android sharing is unavailable on this device.');
  await Share.share({ files: [uri], title, text, dialogTitle: title ?? 'Share Inkbound export' });
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

function readBridgeResult(payload: unknown): NativeAuthBridgeResponse {
  if (!payload || typeof payload !== 'object') return {};
  const body = payload as Record<string, unknown>;
  const candidate = body.result ?? body.data;
  return candidate && typeof candidate === 'object' ? candidate as NativeAuthBridgeResponse : {};
}

async function exchangeNativeIdToken(nativeIdToken: string): Promise<NativeAuthBridgeResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), NATIVE_AUTH_BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(NATIVE_AUTH_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { nativeIdToken } }),
      signal: controller.signal,
    });

    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* handled below */ }

    if (!response.ok) {
      const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
      const message = typeof error.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Inkbound could not verify the Android sign-in session.';
      throw new Error(message);
    }

    return readBridgeResult(payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Inkbound account verification timed out. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function bridgeNativeFirebaseSessionToJs(firebaseAuth: NonNullable<typeof auth>): Promise<void> {
  const nativeUser = (await withTimeout(
    FirebaseAuthentication.getCurrentUser(),
    NATIVE_AUTH_STEP_TIMEOUT_MS,
    'Inkbound could not read the Android account session.',
  )).user;
  if (!nativeUser?.uid) throw new Error('Android authentication did not create a Firebase user session.');

  if (firebaseAuth.currentUser?.uid === nativeUser.uid) return;

  const tokenResult = await withTimeout(
    FirebaseAuthentication.getIdToken({ forceRefresh: true }),
    NATIVE_AUTH_STEP_TIMEOUT_MS,
    'Inkbound could not obtain the Android account token.',
  );
  const nativeIdToken = tokenResult.token?.trim() ?? '';
  if (!nativeIdToken) throw new Error('Android authentication did not return a Firebase identity token.');

  const bridgeResult = await exchangeNativeIdToken(nativeIdToken);
  const customToken = bridgeResult.customToken?.trim() ?? '';
  const bridgedUid = bridgeResult.uid?.trim() ?? '';
  if (!customToken || bridgedUid !== nativeUser.uid) {
    throw new Error('Inkbound could not verify the Android Firebase account handoff.');
  }

  const jsResult = await withTimeout(
    signInWithCustomToken(firebaseAuth, customToken),
    NATIVE_AUTH_STEP_TIMEOUT_MS,
    'Inkbound could not finish the Android account handoff.',
  );
  if (jsResult.user.uid !== nativeUser.uid) {
    await signOutJsAuth(firebaseAuth).catch(() => undefined);
    throw new Error('Inkbound blocked an Android account handoff with a mismatched Firebase user.');
  }
}

async function verifyPlayPurchase(purchase: PlayPurchaseResult) {
  const purchaseToken = purchase.purchaseToken?.trim() ?? '';
  if (!purchaseToken) throw new Error('Google Play did not return a purchase token.');
  if (purchase.pending && !purchase.purchased) throw new Error('Your Google Play purchase is pending. Premium will unlock after Google confirms payment.');
  if (!purchase.purchased) throw new Error('Google Play has not completed this Premium purchase.');
  if (!functions) throw new Error('Inkbound billing verification is unavailable right now.');

  const verifySubscription = httpsCallable<{ purchaseToken: string }, { verified: boolean }>(functions, 'verifyGooglePlaySubscription');
  const response = await verifySubscription({ purchaseToken });
  if (!response.data.verified) throw new Error('Google Play could not verify Inkbound Premium.');
  if (!purchase.acknowledged) await PlayBilling.acknowledge({ purchaseToken });
  signalPremiumEntitlementRefresh();
}

export async function initializeAndroidRuntime() {
  if (!isAndroidRuntime()) return;

  const nativeAppCheckReady = FirebaseAppCheck.initialize({ isTokenAutoRefreshEnabled: true });

  configureRuntimeAuthentication({
    preparePersistence: async () => undefined,
    restoreSession: async (firebaseAuth) => {
      const nativeUser = (await FirebaseAuthentication.getCurrentUser()).user;
      if (!nativeUser?.uid) return;
      await bridgeNativeFirebaseSessionToJs(firebaseAuth);
    },
    signInWithEmail: async (firebaseAuth, email, password) => {
      await withTimeout(
        FirebaseAuthentication.signInWithEmailAndPassword({
          email: email.trim(),
          password,
          skipNativeAuth: false,
        }),
        NATIVE_AUTH_STEP_TIMEOUT_MS,
        'Email sign-in timed out before Firebase responded.',
      );
      await bridgeNativeFirebaseSessionToJs(firebaseAuth);
    },
    createEmailAccount: async (firebaseAuth, email, password) => {
      await withTimeout(
        FirebaseAuthentication.createUserWithEmailAndPassword({
          email: email.trim(),
          password,
          skipNativeAuth: false,
        }),
        NATIVE_AUTH_STEP_TIMEOUT_MS,
        'Account creation timed out before Firebase responded.',
      );
      await bridgeNativeFirebaseSessionToJs(firebaseAuth);
    },
    signInWithGoogle: async (firebaseAuth) => {
      await withTimeout(
        FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: false, useCredentialManager: false }),
        NATIVE_AUTH_STEP_TIMEOUT_MS,
        'Google sign-in timed out before Firebase responded.',
      );
      await bridgeNativeFirebaseSessionToJs(firebaseAuth);
    },
    signOut: async (firebaseAuth) => {
      await Promise.allSettled([
        FirebaseAuthentication.signOut(),
        signOutJsAuth(firebaseAuth),
      ]);
    },
  });

  if (auth) {
    void bridgeNativeFirebaseSessionToJs(auth).catch((error) => {
      console.warn('Inkbound Android could not restore the native Firebase account into the JS session.', error);
    });
  }

  configureRuntimeReauthentication({
    getRequirement: (user) => {
      const providers = new Set(user.providerData.map((provider) => provider.providerId));
      if (providers.has('google.com')) return 'google';
      if (providers.has('password')) return 'password';
      return 'unsupported';
    },
    reauthenticate: async (user, options = {}) => {
      if (!auth) throw new Error('Inkbound authentication is unavailable.');
      const providers = new Set(user.providerData.map((provider) => provider.providerId));

      if (providers.has('google.com')) {
        await withTimeout(
          FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: false, useCredentialManager: false }),
          NATIVE_AUTH_STEP_TIMEOUT_MS,
          'Google verification timed out.',
        );
      } else if (providers.has('password')) {
        const email = user.email?.trim();
        const password = options.password ?? '';
        if (!email || !password) throw new Error('Enter your password to verify this account before deleting it.');
        await withTimeout(
          FirebaseAuthentication.signInWithEmailAndPassword({ email, password, skipNativeAuth: false }),
          NATIVE_AUTH_STEP_TIMEOUT_MS,
          'Password verification timed out.',
        );
      } else {
        throw new Error('This sign-in method cannot be verified on Android yet.');
      }

      const nativeUser = (await FirebaseAuthentication.getCurrentUser()).user;
      if (nativeUser?.uid !== user.uid) {
        throw new Error('The verified Android account does not match the signed-in Inkbound account.');
      }
      await bridgeNativeFirebaseSessionToJs(auth);
      await auth.currentUser?.getIdToken(true);
    },
  });

  configureRuntimePremiumPurchase({
    isAvailable: () => Boolean(auth?.currentUser && functions),
    canRestore: () => Boolean(auth?.currentUser && functions),
    purchase: async (plan) => {
      const uid = auth?.currentUser?.uid;
      if (!uid) throw new Error('Sign in before starting a Premium subscription.');
      const purchase = await PlayBilling.purchase({ basePlanId: plan, obfuscatedAccountId: await sha256Hex(uid) });
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
      const result = await Filesystem.writeFile({ path, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      await shareCachedFile(result.uri, `Export ${sanitizeExportFilename(filename)}`);
    },
    exportBinaryFile: async ({ filename, contents }) => {
      const path = exportCachePath(filename);
      const result = await Filesystem.writeFile({ path, data: await blobToBase64(contents), directory: Directory.Cache, recursive: true });
      await shareCachedFile(result.uri, `Export ${sanitizeExportFilename(filename)}`);
    },
    shareBinaryFile: async ({ filename, contents, title, text }) => {
      const path = exportCachePath(filename);
      const result = await Filesystem.writeFile({ path, data: await blobToBase64(contents), directory: Directory.Cache, recursive: true });
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
    console.error('Inkbound Android App Check could not initialize.', error);
  });
}
