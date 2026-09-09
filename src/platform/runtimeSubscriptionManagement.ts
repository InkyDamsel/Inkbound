import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import { isNativeRuntime } from './runtimePlatform';

export interface RuntimeSubscriptionManagementAdapter {
  isAvailable(): boolean;
  open(): Promise<void>;
}

const browserSubscriptionManagementAdapter: RuntimeSubscriptionManagementAdapter = {
  // A Google Play build must never fall back to Stripe. Native runtimes install
  // their store-owned adapter during Android initialization.
  isAvailable: () => !isNativeRuntime() && Boolean(functions && auth?.currentUser),
  open: async () => {
    if (isNativeRuntime()) {
      throw new Error('Subscription management is not connected to this app store build yet.');
    }
    if (!functions || !auth?.currentUser || typeof window === 'undefined') {
      throw new Error('Sign in before managing your subscription.');
    }
    const createPortal = httpsCallable<undefined, { url: string }>(functions, 'createStripeBillingPortalSession');
    const response = await createPortal();
    const url = response.data.url?.trim();
    if (!url) throw new Error('Inkbound could not open Stripe subscription management.');
    window.location.assign(url);
  },
};

let activeSubscriptionManagementAdapter = browserSubscriptionManagementAdapter;

/**
 * Platform boundary for opening the billing surface that owns a subscription.
 * Web uses a server-created Stripe Billing Portal session; Android installs a
 * Google Play adapter. Apple remains out of scope until the iOS shell is started.
 */
export function configureRuntimeSubscriptionManagement(
  adapter: RuntimeSubscriptionManagementAdapter,
) {
  activeSubscriptionManagementAdapter = adapter;
}

export function canManageRuntimeSubscription(): boolean {
  return activeSubscriptionManagementAdapter.isAvailable();
}

export function openRuntimeSubscriptionManagement(): Promise<void> {
  return activeSubscriptionManagementAdapter.open();
}
