import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import { isNativeRuntime } from './runtimePlatform';

export type PremiumBillingPlan = 'monthly' | 'annual';

export interface RuntimePremiumPurchaseAdapter {
  isAvailable(): boolean;
  canRestore(): boolean;
  canShowPurchaseOptions(): boolean;
  purchase(plan: PremiumBillingPlan): Promise<void>;
  restore(): Promise<number>;
}

const refreshEntitlement = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('inkbound:entitlement-refresh'));
};

const browserPremiumPurchaseAdapter: RuntimePremiumPurchaseAdapter = {
  isAvailable: () => !isNativeRuntime() && Boolean(functions && auth?.currentUser),
  canRestore: () => false,
  canShowPurchaseOptions: () => true,
  purchase: async (plan) => {
    if (isNativeRuntime()) throw new Error('Google Play Billing is not connected to this Android build yet.');
    if (!functions || !auth?.currentUser) throw new Error('Sign in before starting a Premium subscription.');
    const createCheckout = httpsCallable<{ plan: PremiumBillingPlan }, { url: string }>(functions, 'createStripeCheckoutSession');
    const response = await createCheckout({ plan });
    const url = response.data.url?.trim();
    if (!url) throw new Error('Inkbound could not open Stripe Checkout.');
    window.location.assign(url);
  },
  restore: async () => {
    refreshEntitlement();
    return 0;
  },
};

let activePremiumPurchaseAdapter = browserPremiumPurchaseAdapter;

export function configureRuntimePremiumPurchase(adapter: RuntimePremiumPurchaseAdapter) {
  activePremiumPurchaseAdapter = adapter;
}

export function canPurchaseRuntimePremium(): boolean {
  return activePremiumPurchaseAdapter.isAvailable();
}

export function canRestoreRuntimePremium(): boolean {
  return activePremiumPurchaseAdapter.canRestore();
}

export function canShowRuntimePremiumPurchaseOptions(): boolean {
  return activePremiumPurchaseAdapter.canShowPurchaseOptions();
}

export function purchaseRuntimePremium(plan: PremiumBillingPlan): Promise<void> {
  return activePremiumPurchaseAdapter.purchase(plan);
}

export function restoreRuntimePremium(): Promise<number> {
  return activePremiumPurchaseAdapter.restore();
}

export function signalPremiumEntitlementRefresh() {
  refreshEntitlement();
}
