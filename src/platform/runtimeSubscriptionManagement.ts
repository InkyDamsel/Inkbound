import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import { isNativeRuntime } from './runtimePlatform';

export type SubscriptionProvider = 'stripe' | 'google_play';

interface EntitlementProviderResponse {
  subscriptionProvider?: SubscriptionProvider | null;
}

export interface RuntimeSubscriptionManagementAdapter {
  isAvailable(): boolean;
  open(provider: SubscriptionProvider): Promise<void>;
}

const PLAY_MANAGEMENT_URL = 'https://play.google.com/store/account/subscriptions?sku=inkbound_premium&package=com.inkydameinteractive.inkbound';

async function getSubscriptionProvider(): Promise<SubscriptionProvider> {
  if (!functions || !auth?.currentUser) throw new Error('Sign in before managing your subscription.');
  const getEntitlement = httpsCallable<undefined, EntitlementProviderResponse>(functions, 'getMyEntitlement');
  const response = await getEntitlement();
  const provider = response.data.subscriptionProvider;
  if (provider !== 'stripe' && provider !== 'google_play') {
    throw new Error('Inkbound could not determine where this subscription is billed.');
  }
  return provider;
}

async function createStripePortalUrl(): Promise<string> {
  if (!functions || !auth?.currentUser) throw new Error('Sign in before managing your subscription.');
  const createPortal = httpsCallable<undefined, { url: string }>(functions, 'createStripeBillingPortalSession');
  const response = await createPortal();
  const url = response.data.url?.trim();
  if (!url) throw new Error('Inkbound could not open Stripe subscription management.');
  return url;
}

const browserSubscriptionManagementAdapter: RuntimeSubscriptionManagementAdapter = {
  isAvailable: () => !isNativeRuntime() && Boolean(functions && auth?.currentUser),
  open: async (provider) => {
    if (isNativeRuntime()) throw new Error('Subscription management is not connected to this app store build yet.');
    if (typeof window === 'undefined') throw new Error('Subscription management is unavailable in this browser.');
    if (provider === 'google_play') {
      window.location.assign(PLAY_MANAGEMENT_URL);
      return;
    }
    window.location.assign(await createStripePortalUrl());
  },
};

let activeSubscriptionManagementAdapter = browserSubscriptionManagementAdapter;

/**
 * Platform boundary for opening the billing surface that owns a subscription.
 * The subscription provider comes from the canonical Firebase entitlement, so a
 * Play subscriber can manage Play from web and a Stripe subscriber can manage
 * Stripe from Android without pretending the current device owns the purchase.
 */
export function configureRuntimeSubscriptionManagement(adapter: RuntimeSubscriptionManagementAdapter) {
  activeSubscriptionManagementAdapter = adapter;
}

export function canManageRuntimeSubscription(): boolean {
  return activeSubscriptionManagementAdapter.isAvailable();
}

export async function openRuntimeSubscriptionManagement(): Promise<void> {
  const provider = await getSubscriptionProvider();
  return activeSubscriptionManagementAdapter.open(provider);
}

export async function getStripeSubscriptionPortalUrl(): Promise<string> {
  return createStripePortalUrl();
}
