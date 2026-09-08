import { createHmac, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_MONTHLY_PRICE_ID = defineSecret('STRIPE_MONTHLY_PRICE_ID');
const STRIPE_ANNUAL_PRICE_ID = defineSecret('STRIPE_ANNUAL_PRICE_ID');

const APP_ORIGIN = 'https://inkbound.inkydameinteractive.com';
const STRIPE_API = 'https://api.stripe.com/v1';
const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENFORCE_APP_CHECK = !IS_FUNCTIONS_EMULATOR;

type InkboundSubscriptionStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';
type StripeEvent = { type?: string; data?: { object?: Record<string, unknown> } };
type StripeSubscription = Record<string, unknown> & {
  id?: string;
  status?: string;
  customer?: string | { id?: string } | null;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<Record<string, unknown> & { current_period_end?: number; price?: { id?: string } }> };
};

type StripeCheckoutSession = Record<string, unknown> & {
  id?: string;
  url?: string | null;
  customer?: string | { id?: string } | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
};

function requireAuth(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to manage Inkbound Premium.');
  return request.auth;
}

async function stripePost(path: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY.value()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'object' && payload.error && 'message' in payload.error
      ? String((payload.error as { message?: unknown }).message ?? '')
      : 'Stripe request failed.';
    throw new Error(message || 'Stripe request failed.');
  }
  return payload;
}

function normalizeCustomerId(customer: StripeSubscription['customer'] | StripeCheckoutSession['customer']): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : typeof customer.id === 'string' ? customer.id : null;
}

function toInkboundStatus(status: unknown): InkboundSubscriptionStatus {
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trialing';
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'past_due';
  return 'canceled';
}

function subscriptionPeriodEnd(subscription: StripeSubscription): number {
  const rootPeriodEnd = Number(subscription.current_period_end ?? 0);
  const itemPeriodEnd = subscription.items?.data?.reduce(
    (latest, item) => Math.max(latest, Number(item.current_period_end ?? 0)),
    0,
  ) ?? 0;
  return Math.max(rootPeriodEnd, itemPeriodEnd);
}

async function findUidForSubscription(subscription: StripeSubscription): Promise<string | null> {
  const metadataUid = subscription.metadata?.firebaseUid?.trim();
  if (metadataUid) return metadataUid;

  const customerId = normalizeCustomerId(subscription.customer);
  if (!customerId) return null;

  const snapshot = await db.collection('entitlements').where('stripeCustomerId', '==', customerId).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0].id;
}

async function syncSubscription(subscription: StripeSubscription) {
  const uid = await findUidForSubscription(subscription);
  const subscriptionId = typeof subscription.id === 'string' ? subscription.id : '';
  if (!uid || !subscriptionId) {
    console.warn('Inkbound Stripe webhook could not resolve a Firebase uid/subscription id.', subscriptionId || '[missing]');
    return;
  }

  const customerId = normalizeCustomerId(subscription.customer);
  const periodEndSeconds = subscriptionPeriodEnd(subscription);
  const paidPremiumUntil = periodEndSeconds > 0 ? Timestamp.fromMillis(periodEndSeconds * 1000) : null;
  const subscriptionStatus = toInkboundStatus(subscription.status);
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;

  await db.doc(`entitlements/${uid}`).set({
    basePlan: subscriptionStatus === 'active' || subscriptionStatus === 'trialing' ? 'premium' : 'free',
    subscriptionStatus,
    paidPremiumUntil,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeCancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    stripePriceId: priceId,
    effectiveSource: subscriptionStatus === 'active' || subscriptionStatus === 'trialing' ? 'subscription' : 'free',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function ensureStripeCustomer(uid: string, email: string | undefined): Promise<string> {
  const entitlementRef = db.doc(`entitlements/${uid}`);
  const existing = await entitlementRef.get();
  const savedCustomerId = typeof existing.get('stripeCustomerId') === 'string'
    ? String(existing.get('stripeCustomerId')).trim()
    : '';
  if (savedCustomerId) return savedCustomerId;

  const body = new URLSearchParams();
  if (email) body.set('email', email);
  body.set('metadata[firebaseUid]', uid);
  const customer = await stripePost('/customers', body);
  const customerId = typeof customer.id === 'string' ? customer.id : '';
  if (!customerId) throw new Error('Stripe did not return a customer id.');

  await entitlementRef.set({ stripeCustomerId: customerId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return customerId;
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(',');
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2) ?? '';
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return signatures.some((signature) => {
    const actualBuffer = Buffer.from(signature, 'utf8');
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  });
}

export const createStripeCheckoutSession = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [STRIPE_SECRET_KEY, STRIPE_MONTHLY_PRICE_ID, STRIPE_ANNUAL_PRICE_ID],
}, async (request) => {
  const auth = requireAuth(request);
  const input = request.data as { cycle?: unknown } | undefined;
  const cycle = input?.cycle === 'annual' ? 'annual' : input?.cycle === 'monthly' ? 'monthly' : null;
  if (!cycle) throw new HttpsError('invalid-argument', 'Choose monthly or annual billing.');

  const priceId = cycle === 'monthly' ? STRIPE_MONTHLY_PRICE_ID.value() : STRIPE_ANNUAL_PRICE_ID.value();
  if (!priceId) throw new HttpsError('failed-precondition', 'Inkbound Premium billing is not configured yet.');

  try {
    const customerId = await ensureStripeCustomer(auth.uid, typeof auth.token.email === 'string' ? auth.token.email : undefined);
    const body = new URLSearchParams({
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      allow_promotion_codes: 'true',
      client_reference_id: auth.uid,
      'subscription_data[metadata][firebaseUid]': auth.uid,
      'metadata[firebaseUid]': auth.uid,
      'metadata[billingCycle]': cycle,
      success_url: `${APP_ORIGIN}/?billing=success`,
      cancel_url: `${APP_ORIGIN}/?billing=cancelled`,
    });
    const session = await stripePost('/checkout/sessions', body) as StripeCheckoutSession;
    const url = typeof session.url === 'string' ? session.url.trim() : '';
    if (!url) throw new Error('Stripe did not return a checkout URL.');
    return { url };
  } catch (error) {
    console.error('Inkbound could not create a Stripe Checkout session.', error);
    throw new HttpsError('internal', 'Inkbound could not start secure checkout right now.');
  }
});

export const createStripePortalSession = onCall({
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [STRIPE_SECRET_KEY],
}, async (request) => {
  const auth = requireAuth(request);
  const entitlement = await db.doc(`entitlements/${auth.uid}`).get();
  const customerId = typeof entitlement.get('stripeCustomerId') === 'string'
    ? String(entitlement.get('stripeCustomerId')).trim()
    : '';
  if (!customerId) throw new HttpsError('failed-precondition', 'No Stripe billing account exists for this Inkbound account yet.');

  try {
    const session = await stripePost('/billing_portal/sessions', new URLSearchParams({
      customer: customerId,
      return_url: APP_ORIGIN,
    }));
    const url = typeof session.url === 'string' ? session.url.trim() : '';
    if (!url) throw new Error('Stripe did not return a portal URL.');
    return { url };
  } catch (error) {
    console.error('Inkbound could not create a Stripe billing portal session.', error);
    throw new HttpsError('internal', 'Inkbound could not open subscription management right now.');
  }
});

export const stripeWebhook = onRequest({
  secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
}, async (request, response) => {
  const signature = request.header('stripe-signature');
  if (!signature || !verifyStripeSignature(request.rawBody, signature, STRIPE_WEBHOOK_SECRET.value())) {
    response.status(400).send('Invalid Stripe signature.');
    return;
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(request.rawBody.toString('utf8')) as StripeEvent;
  } catch {
    response.status(400).send('Invalid Stripe payload.');
    return;
  }

  try {
    const object = event.data?.object;
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        if (object) await syncSubscription(object as StripeSubscription);
        break;
      case 'checkout.session.completed': {
        if (!object) break;
        const session = object as StripeCheckoutSession;
        const uid = session.client_reference_id?.trim() || session.metadata?.firebaseUid?.trim();
        const customerId = normalizeCustomerId(session.customer);
        if (uid && customerId) {
          await db.doc(`entitlements/${uid}`).set({ stripeCustomerId: customerId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        break;
      }
      default:
        break;
    }

    response.status(200).send('ok');
  } catch (error) {
    console.error('Inkbound Stripe webhook processing failed.', event.type, error);
    response.status(500).send('Webhook processing failed.');
  }
});
