export interface RuntimeSubscriptionManagementAdapter {
  isAvailable(): boolean;
  open(): Promise<void>;
}

const webBillingPortalUrl = import.meta.env.VITE_BILLING_PORTAL_URL?.trim() ?? '';

const browserSubscriptionManagementAdapter: RuntimeSubscriptionManagementAdapter = {
  isAvailable: () => Boolean(webBillingPortalUrl),
  open: async () => {
    if (!webBillingPortalUrl || typeof window === 'undefined') {
      throw new Error('Subscription management is not connected on this device yet.');
    }
    window.location.assign(webBillingPortalUrl);
  },
};

let activeSubscriptionManagementAdapter = browserSubscriptionManagementAdapter;

/**
 * Platform boundary for opening the billing surface that owns a subscription.
 * Web can use a secure billing portal; native iOS/Android shells can install
 * adapters that open App Store or Google Play subscription management instead.
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
