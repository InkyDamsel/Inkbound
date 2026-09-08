import { openStripeBillingPortal } from '../features/billing/stripeBilling';
import { isNativeRuntime } from './runtimePlatform';

export interface RuntimeSubscriptionManagementAdapter {
  isAvailable(): boolean;
  open(): Promise<void>;
}

const browserSubscriptionManagementAdapter: RuntimeSubscriptionManagementAdapter = {
  // A Google Play build must never fall back to Stripe. Native runtimes stay
  // unavailable until their store-owned subscription adapter is installed.
  isAvailable: () => !isNativeRuntime(),
  open: async () => {
    if (isNativeRuntime()) {
      throw new Error('Subscription management is not connected to this app store build yet.');
    }
    await openStripeBillingPortal();
  },
};

let activeSubscriptionManagementAdapter = browserSubscriptionManagementAdapter;

/**
 * Platform boundary for opening the billing surface that owns a subscription.
 * Web uses Stripe's secure customer portal; Android installs a Google Play adapter.
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
