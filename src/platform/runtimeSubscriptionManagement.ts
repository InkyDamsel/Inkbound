import { isNativeRuntime } from './runtimePlatform';

export interface RuntimeSubscriptionManagementAdapter {
  isAvailable(): boolean;
  open(): Promise<void>;
}

const webBillingPortalUrl = import.meta.env.VITE_BILLING_PORTAL_URL?.trim() ?? '';

const browserSubscriptionManagementAdapter: RuntimeSubscriptionManagementAdapter = {
  // A Google Play build must never fall back to a web billing portal. Native
  // runtimes stay unavailable until their store-owned adapter is installed.
  isAvailable: () => !isNativeRuntime() && Boolean(webBillingPortalUrl),
  open: async () => {
    if (isNativeRuntime()) {
      throw new Error('Subscription management is not connected to this app store build yet.');
    }
    if (!webBillingPortalUrl || typeof window === 'undefined') {
      throw new Error('Subscription management is not connected on this device yet.');
    }
    window.location.assign(webBillingPortalUrl);
  },
};

let activeSubscriptionManagementAdapter = browserSubscriptionManagementAdapter;

/**
 * Platform boundary for opening the billing surface that owns a subscription.
 * Web can use a secure billing portal; Android installs a Google Play adapter.
 * Apple remains intentionally out of scope until the iOS shell is started.
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
