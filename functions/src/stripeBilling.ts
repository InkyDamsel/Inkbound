import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Stripe from 'stripe';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_MONTHLY_PRICE_ID = defineSecret('STRIPE_MONTHLY_PRICE_ID');
const STRIPE_ANNUAL_PRICE_ID = defineSecret('STRIPE_ANNUAL_PRICE_ID');

const APP_ORIGIN = 'https://inkbound.inkydameinteractive.com';
const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENFORCE_APP_CHECK = !IS_FUNCTIONS_EMULATOR;

type BillingCycle = 'monthly' | 'annual';
type InkboundSubscriptionStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';

function stripeClient() {
  return new Stripe(STRIPE_SECRET_KEY.value());
}

function requireAuth(request: Parameters<Parameters<typeof onCall>[1]>[0]) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to manage Inkbound Premium.');
  return request.auth;
}

function normalizeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

function toInkboundStatus(status: Stripe.Subscription.Status): InkboundSubscriptionStatus {
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trialing';
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'past_due';
  return 'canceled';
}

async function findUidForSubscription(subscription: Stripe.Subscription): Promise<string | null> {
  const metadataUid = subscription.metadata?.firebaseUid?.trim();
  if (metadataUid) return metadataUid;

  const customerId = normalizeCustomerId(subscription.customer);
  if (!customerId) return null;

  const snapshot = await db.collection('entitlements').where('stripeCustomerId', '==', customerId).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0].id;
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const uid = await findUidForSubscription(subscription);
  if (!uid) {
    console.warn('Inkbound Stripe webhook could not resolve a Firebase uid.', subscription.id);
    return;
  }

  const customerId = normalizeCustomerId(subscription.customer);
  const currentPeriodEndSeconds = subscription.items.data.reduce(
    (latest, item) => Math.max(latest, item.current_period_end ?? 0),
    0,
  );
  const paidPremiumUntil = currentPeriodEndSeconds > 0
    ? Timestamp.fromMillis(currentPeriodEndSeconds * 1000)
    : null;
  const subscriptionStatus = toInkboundStatus(subscription.status);

  await db.doc(`entitlements/${uid}`).set({
    basePlan: subscriptionStatus === 'active' || subscriptionStatus === 'trialing' ? 'premium' : 'free',
    subscriptionStatus,
    paidPremiumUntil,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripeCancelAtPeriodEnd: subscription.cancel_at_period_end,
    stripePriceId: subscription.items.data[0]?.price?.id ?? null,
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

  const stripe = stripeClient();
  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { firebaseUid: uid },
  });

  await entitlementRef.set({
    stripeCustomerId: customer.id,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return customer.id;
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

  const customerId = await ensureStripeCustomer(auth.uid, typeof auth.token.email === 'string' ? auth.token.email : undefined);
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: auth.uid,
    subscription_data: {
      metadata: { firebaseUid: auth.uid },
    },
    metadata: {
      firebaseUid: auth.uid,
      billingCycle: cycle,
    },
    success_url: `${APP_ORIGIN}/?billing=success`,
    cancel_url: `${APP_ORIGIN}/?billing=cancelled`,
  });

  if (!session.url) throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
  return { url: session.url };
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

  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: APP_ORIGIN,
  });
  return { url: session.url };
});

export const stripeWebhook = onRequest({
  secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
}, async (request, response) => {
  const signature = request.header('stripe-signature');
  if (!signature) {
    response.status(400).send('Missing Stripe signature.');
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(
      request.rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET.value(),
    );
  } catch (error) {
    console.error('Inkbound rejected an invalid Stripe webhook.', error);
    response.status(400).send('Invalid Stripe signature.');
    return;
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.client_reference_id?.trim() || session.metadata?.firebaseUid?.trim();
        const customerId = normalizeCustomerId(session.customer);
        if (uid && customerId) {
          await db.doc(`entitlements/${uid}`).set({
            stripeCustomerId: customerId,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
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
