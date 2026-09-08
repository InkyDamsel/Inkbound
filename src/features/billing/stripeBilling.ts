import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

export type BillingCycle = 'monthly' | 'annual';

function requireFunctions() {
  if (!functions) throw new Error('Inkbound billing is unavailable right now.');
  return functions;
}

export async function startStripeCheckout(cycle: BillingCycle): Promise<void> {
  const createCheckoutSession = httpsCallable<{ cycle: BillingCycle }, { url: string }>(
    requireFunctions(),
    'createStripeCheckoutSession',
  );
  const response = await createCheckoutSession({ cycle });
  const url = response.data?.url?.trim();
  if (!url) throw new Error('Inkbound could not open Stripe Checkout.');
  window.location.assign(url);
}

export async function openStripeBillingPortal(): Promise<void> {
  const createPortalSession = httpsCallable<undefined, { url: string }>(
    requireFunctions(),
    'createStripePortalSession',
  );
  const response = await createPortalSession();
  const url = response.data?.url?.trim();
  if (!url) throw new Error('Inkbound could not open the billing portal.');
  window.location.assign(url);
}
