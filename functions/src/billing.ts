import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineJsonSecret } from 'firebase-functions/params';
import { CallableRequest, HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);

const PLAY_PACKAGE_NAME = 'com.inkydameinteractive.inkbound';
const PLAY_PRODUCT_ID = 'inkbound_premium';
const PUBLIC_APP_URL = 'https://inkbound.inkydameinteractive.com';
const PLAY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  monthlyPriceId: string;
  annualPriceId: string;
}

const stripeConfig = defineJsonSecret<StripeConfig>('INKBOUND_STRIPE_CONFIG');

type SubscriptionStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';

type JsonRecord = Record<string, unknown>;

function requireAuthenticated(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  return request.auth;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stripeStatus(value: unknown): SubscriptionStatus {
  const status = stringValue(value);
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trialing';
  if (status === 'canceled') return 'canceled';
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete' || status === 'paused') return 'past_due';
  return 'none';
}

function stripeSubscriptionExpirySeconds(subscription: JsonRecord): number {
  const direct = numberValue(subscription.current_period_end);
  if (direct > 0) return direct;
  const items = asRecord(subscription.items);
  const data = Array.isArray(items.data) ? items.data : [];
  return data.reduce((latest, item) => Math.max(latest, numberValue(asRecord(item).current_period_end)), 0);
}

function effectiveSource(status: SubscriptionStatus, expiresAtMillis: number): 'subscription' | 'free' {
  const now = Date.now();
  const active =
    ((status === 'active' || status === 'trialing') && (!expiresAtMillis || expiresAtMillis > now)) ||
    (status === 'canceled' && expiresAtMillis > now);
  return active ? 'subscription' : 'free';
}

async function stripeRequest(
  config: StripeConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: URLSearchParams,
): Promise<JsonRecord> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body?.toString(),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const stripeError = asRecord(payload.error);
    const message = stringValue(stripeError.message) || 'Stripe rejected the billing request.';
    throw new Error(message);
  }
  return payload;
}

async function applyStripeSubscription(uid: string, subscription: JsonRecord) {
  const status = stripeStatus(subscription.status);
  const expirySeconds = stripeSubscriptionExpirySeconds(subscription);
  const expiryMillis = expirySeconds > 0 ? expirySeconds * 1000 : 0;
  const source = effectiveSource(status, expiryMillis);
  const customer = typeof subscription.customer === 'string' ? subscription.customer : stringValue(asRecord(subscription.customer).id);
  const subscriptionId = stringValue(subscription.id);

  await db.doc(`entitlements/${uid}`).set({
    basePlan: source === 'subscription' ? 'premium' : 'free',
    subscriptionStatus: status,
    subscriptionProvider: 'stripe',
    stripeCustomerId: customer || FieldValue.delete(),
    stripeSubscriptionId: subscriptionId || FieldValue.delete(),
    paidPremiumUntil: expiryMillis > 0 ? Timestamp.fromMillis(expiryMillis) : FieldValue.delete(),
    effectiveSource: source,
    billingVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'stripe',
  }, { merge: true });
}

async function retrieveStripeSubscription(config: StripeConfig, subscriptionId: string): Promise<JsonRecord> {
  return stripeRequest(config, 'GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(',').map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  const timestamp = Number(timestampPart?.slice(2));
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'utf8');
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
  });
}

export const createStripeCheckoutSession = onCall(
  { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', secrets: [stripeConfig] },
  async (request) => {
    const auth = requireAuthenticated(request);
    const data = asRecord(request.data);
    const plan = stringValue(data.plan);
    if (plan !== 'monthly' && plan !== 'annual') throw new HttpsError('invalid-argument', 'Choose a valid Premium plan.');

    const config = stripeConfig.value();
    const priceId = plan === 'monthly' ? config.monthlyPriceId : config.annualPriceId;
    if (!config.secretKey || !priceId) throw new HttpsError('failed-precondition', 'Stripe subscriptions are not configured yet.');

    const entitlement = (await db.doc(`entitlements/${auth.uid}`).get()).data() ?? {};
    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('line_items[0][price]', priceId);
    form.set('line_items[0][quantity]', '1');
    form.set('success_url', `${PUBLIC_APP_URL}/?billing=success`);
    form.set('cancel_url', `${PUBLIC_APP_URL}/?billing=canceled`);
    form.set('client_reference_id', auth.uid);
    form.set('metadata[firebaseUid]', auth.uid);
    form.set('subscription_data[metadata][firebaseUid]', auth.uid);
    form.set('allow_promotion_codes', 'true');

    const existingCustomerId = stringValue(entitlement.stripeCustomerId);
    if (existingCustomerId) form.set('customer', existingCustomerId);
    else {
      const email = stringValue(auth.token.email);
      if (email) form.set('customer_email', email);
    }

    try {
      const session = await stripeRequest(config, 'POST', '/v1/checkout/sessions', form);
      const url = stringValue(session.url);
      if (!url) throw new Error('Stripe did not return a checkout URL.');
      return { url };
    } catch (error) {
      console.error('Could not create Stripe Checkout session.', error);
      throw new HttpsError('internal', error instanceof Error ? error.message : 'Could not start Stripe Checkout.');
    }
  },
);

export const createStripeBillingPortalSession = onCall(
  { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', secrets: [stripeConfig] },
  async (request) => {
    const auth = requireAuthenticated(request);
    const config = stripeConfig.value();
    const entitlement = (await db.doc(`entitlements/${auth.uid}`).get()).data() ?? {};
    const customerId = stringValue(entitlement.stripeCustomerId);
    if (!customerId) throw new HttpsError('failed-precondition', 'This account does not have a Stripe subscription to manage.');

    const form = new URLSearchParams();
    form.set('customer', customerId);
    form.set('return_url', PUBLIC_APP_URL);
    try {
      const session = await stripeRequest(config, 'POST', '/v1/billing_portal/sessions', form);
      const url = stringValue(session.url);
      if (!url) throw new Error('Stripe did not return a billing portal URL.');
      return { url };
    } catch (error) {
      console.error('Could not create Stripe billing portal session.', error);
      throw new HttpsError('internal', error instanceof Error ? error.message : 'Could not open subscription management.');
    }
  },
);

export const stripeBillingWebhook = onRequest(
  { secrets: [stripeConfig] },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }
    const config = stripeConfig.value();
    const signature = request.header('stripe-signature') ?? '';
    if (!config.webhookSecret || !verifyStripeSignature(request.rawBody, signature, config.webhookSecret)) {
      response.status(400).send('Invalid signature');
      return;
    }

    const event = asRecord(request.body);
    const type = stringValue(event.type);
    const object = asRecord(asRecord(asRecord(event.data).object));

    try {
      if (type === 'checkout.session.completed') {
        const uid = stringValue(asRecord(object.metadata).firebaseUid) || stringValue(object.client_reference_id);
        const subscriptionId = typeof object.subscription === 'string' ? object.subscription : stringValue(asRecord(object.subscription).id);
        if (uid && subscriptionId) await applyStripeSubscription(uid, await retrieveStripeSubscription(config, subscriptionId));
      } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
        const uid = stringValue(asRecord(object.metadata).firebaseUid);
        if (uid) await applyStripeSubscription(uid, object);
      }
      response.status(200).json({ received: true });
    } catch (error) {
      console.error('Stripe webhook processing failed.', { type, error });
      response.status(500).send('Webhook processing failed');
    }
  },
);

async function googleAccessToken(): Promise<string> {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!response.ok) throw new Error(`Google metadata token request failed (${response.status}).`);
  const payload = asRecord(await response.json());
  const token = stringValue(payload.access_token);
  if (!token) throw new Error('Google metadata service did not return an access token.');
  return token;
}

async function fetchPlaySubscription(purchaseToken: string): Promise<JsonRecord> {
  const accessToken = await googleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    console.error('Google Play subscription verification failed.', { status: response.status, payload });
    throw new Error(`Google Play verification failed (${response.status}).`);
  }
  return payload;
}

function playStatus(state: string): SubscriptionStatus {
  if (state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') return 'active';
  if (state === 'SUBSCRIPTION_STATE_CANCELED') return 'canceled';
  if (state === 'SUBSCRIPTION_STATE_ON_HOLD' || state === 'SUBSCRIPTION_STATE_PAUSED') return 'past_due';
  return 'none';
}

function playExpiryMillis(subscription: JsonRecord): number {
  const lineItems = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  return lineItems.reduce((latest, item) => {
    const expiry = Date.parse(stringValue(asRecord(item).expiryTime));
    return Number.isNaN(expiry) ? latest : Math.max(latest, expiry);
  }, 0);
}

async function applyPlaySubscription(uid: string, purchaseToken: string, subscription: JsonRecord) {
  const lineItems = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  const productIds = lineItems.map((item) => stringValue(asRecord(item).productId)).filter(Boolean);
  if (!productIds.includes(PLAY_PRODUCT_ID)) throw new Error('The Google Play purchase is not an Inkbound Premium subscription.');

  const expectedAccountId = sha256(uid);
  const externalIds = asRecord(subscription.externalAccountIdentifiers);
  const returnedAccountId = stringValue(externalIds.obfuscatedExternalAccountId);
  if (returnedAccountId && returnedAccountId !== expectedAccountId) throw new Error('The Google Play purchase belongs to a different Inkbound account.');

  const status = playStatus(stringValue(subscription.subscriptionState));
  const expiryMillis = playExpiryMillis(subscription);
  const source = effectiveSource(status, expiryMillis);
  const tokenHash = sha256(purchaseToken);

  await db.runTransaction(async (transaction) => {
    transaction.set(db.doc(`billingSubscriptions/${tokenHash}`), {
      uid,
      provider: 'google_play',
      packageName: PLAY_PACKAGE_NAME,
      productId: PLAY_PRODUCT_ID,
      purchaseToken,
      subscriptionStatus: status,
      expiresAt: expiryMillis > 0 ? Timestamp.fromMillis(expiryMillis) : null,
      lastVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(db.doc(`entitlements/${uid}`), {
      basePlan: source === 'subscription' ? 'premium' : 'free',
      subscriptionStatus: status,
      subscriptionProvider: 'google_play',
      paidPremiumUntil: expiryMillis > 0 ? Timestamp.fromMillis(expiryMillis) : FieldValue.delete(),
      effectiveSource: source,
      playPurchaseTokenHash: tokenHash,
      billingVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'google_play',
    }, { merge: true });
  });

  return { status, expiryMillis, source };
}

export async function refreshGooglePlayEntitlementForUser(uid: string, force = false): Promise<void> {
  const entitlementRef = db.doc(`entitlements/${uid}`);
  const entitlement = await entitlementRef.get();
  if (stringValue(entitlement.get('subscriptionProvider')) !== 'google_play') return;
  const verifiedAt = entitlement.get('billingVerifiedAt');
  const lastVerifiedMillis = verifiedAt instanceof Timestamp ? verifiedAt.toMillis() : 0;
  if (!force && lastVerifiedMillis && Date.now() - lastVerifiedMillis < PLAY_REFRESH_INTERVAL_MS) return;

  const tokenHash = stringValue(entitlement.get('playPurchaseTokenHash'));
  if (!tokenHash) return;
  const purchaseRecord = await db.doc(`billingSubscriptions/${tokenHash}`).get();
  const purchaseToken = stringValue(purchaseRecord.get('purchaseToken'));
  if (!purchaseToken || purchaseRecord.get('uid') !== uid) return;

  await applyPlaySubscription(uid, purchaseToken, await fetchPlaySubscription(purchaseToken));
}

export const verifyGooglePlaySubscription = onCall(
  { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' },
  async (request) => {
    const auth = requireAuthenticated(request);
    const data = asRecord(request.data);
    const purchaseToken = stringValue(data.purchaseToken);
    if (!purchaseToken || purchaseToken.length > 4096) throw new HttpsError('invalid-argument', 'A valid Google Play purchase token is required.');

    try {
      const result = await applyPlaySubscription(auth.uid, purchaseToken, await fetchPlaySubscription(purchaseToken));
      return {
        verified: true,
        subscriptionStatus: result.status,
        paidPremiumUntil: result.expiryMillis > 0 ? new Date(result.expiryMillis).toISOString() : null,
      };
    } catch (error) {
      console.error('Could not verify Google Play subscription.', error);
      throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'Google Play could not verify this subscription.');
    }
  },
);
