import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { CallableRequest, HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';

const adminApp = getApps()[0] ?? initializeApp();
const db = getFirestore(adminApp);

const PLAY_PACKAGE_NAME = 'com.inkydameinteractive.inkbound';
const PLAY_PRODUCT_ID = 'inkbound_premium';
const PLAY_RTDN_TOPIC = 'inkbound-play-billing';
const PUBLIC_APP_URL = 'https://inkbound.inkydameinteractive.com';
const PLAY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  monthlyPriceId: string;
  annualPriceId: string;
}

const stripeConfigSecret = defineSecret('INKBOUND_STRIPE_CONFIG');

type SubscriptionStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';
type SubscriptionProvider = 'stripe' | 'google_play';
type JsonRecord = Record<string, unknown>;

interface ProviderState {
  provider: SubscriptionProvider;
  status: SubscriptionStatus;
  expiresAtMillis: number;
}

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

function timestampLikeToMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function subscriptionStatusValue(value: unknown): SubscriptionStatus {
  const status = stringValue(value);
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled') return status;
  return 'none';
}

function stripeConfigValue(): StripeConfig {
  const raw = stripeConfigSecret.value();
  let parsed: JsonRecord;
  try {
    parsed = asRecord(JSON.parse(raw));
  } catch {
    throw new Error('INKBOUND_STRIPE_CONFIG must contain valid JSON.');
  }

  return {
    secretKey: stringValue(parsed.secretKey),
    webhookSecret: stringValue(parsed.webhookSecret),
    monthlyPriceId: stringValue(parsed.monthlyPriceId),
    annualPriceId: stringValue(parsed.annualPriceId),
  };
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

function providerIsActive(state: ProviderState): boolean {
  const now = Date.now();
  if (state.status === 'active' || state.status === 'trialing') {
    return state.expiresAtMillis === 0 || state.expiresAtMillis > now;
  }
  return state.status === 'canceled' && state.expiresAtMillis > now;
}

function providerStateFromEntitlement(entitlement: JsonRecord, provider: SubscriptionProvider): ProviderState {
  const isStripe = provider === 'stripe';
  const statusKey = isStripe ? 'stripeSubscriptionStatus' : 'playSubscriptionStatus';
  const expiryKey = isStripe ? 'stripePaidPremiumUntil' : 'playPaidPremiumUntil';
  let status = subscriptionStatusValue(entitlement[statusKey]);
  let expiresAtMillis = timestampLikeToMillis(entitlement[expiryKey]);

  // Migrate legacy single-provider entitlement fields lazily. This prevents the
  // first event from one billing system from erasing a still-valid purchase made
  // through the other system.
  if (status === 'none' && stringValue(entitlement.subscriptionProvider) === provider) {
    status = subscriptionStatusValue(entitlement.subscriptionStatus);
    expiresAtMillis = timestampLikeToMillis(entitlement.paidPremiumUntil);
  }

  return { provider, status, expiresAtMillis };
}

function canonicalEntitlementFields(
  entitlement: JsonRecord,
  stripeState: ProviderState,
  playState: ProviderState,
  preferredProvider: SubscriptionProvider,
): JsonRecord {
  const activeProviders = [stripeState, playState].filter(providerIsActive);
  activeProviders.sort((left, right) => {
    const leftExpiry = left.expiresAtMillis || Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.expiresAtMillis || Number.MAX_SAFE_INTEGER;
    if (leftExpiry !== rightExpiry) return rightExpiry - leftExpiry;
    return left.provider === preferredProvider ? -1 : 1;
  });

  const selected = activeProviders[0] ?? (preferredProvider === 'stripe' ? stripeState : playState);
  const hasPaidSubscription = activeProviders.length > 0;
  const vipActive = entitlement.vipEnabled === true;
  const courtesyActive = timestampLikeToMillis(entitlement.courtesyPremiumUntil) > Date.now();
  const basePlan = vipActive || hasPaidSubscription || courtesyActive ? 'premium' : 'free';
  const effectiveSource = vipActive ? 'vip' : hasPaidSubscription ? 'subscription' : courtesyActive ? 'courtesy' : 'free';

  return {
    basePlan,
    subscriptionStatus: selected.status,
    subscriptionProvider: selected.provider,
    paidPremiumUntil: selected.expiresAtMillis > 0 ? Timestamp.fromMillis(selected.expiresAtMillis) : FieldValue.delete(),
    effectiveSource,
  };
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
  const customer = typeof subscription.customer === 'string' ? subscription.customer : stringValue(asRecord(subscription.customer).id);
  const subscriptionId = stringValue(subscription.id);
  const entitlementRef = db.doc(`entitlements/${uid}`);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(entitlementRef);
    const entitlement = snapshot.data() ?? {};
    const stripeState: ProviderState = { provider: 'stripe', status, expiresAtMillis: expiryMillis };
    const playState = providerStateFromEntitlement(entitlement, 'google_play');

    transaction.set(entitlementRef, {
      ...canonicalEntitlementFields(entitlement, stripeState, playState, 'stripe'),
      stripeSubscriptionStatus: status,
      stripePaidPremiumUntil: expiryMillis > 0 ? Timestamp.fromMillis(expiryMillis) : FieldValue.delete(),
      stripeCustomerId: customer || FieldValue.delete(),
      stripeSubscriptionId: subscriptionId || FieldValue.delete(),
      billingVerifiedAt: FieldValue.serverTimestamp(),
      stripeBillingVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'stripe',
    }, { merge: true });
  });
}

async function retrieveStripeSubscription(config: StripeConfig, subscriptionId: string): Promise<JsonRecord> {
  return stripeRequest(config, 'GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function resolveStripeUid(subscription: JsonRecord): Promise<string> {
  const metadataUid = stringValue(asRecord(subscription.metadata).firebaseUid);
  if (metadataUid) return metadataUid;

  const subscriptionId = stringValue(subscription.id);
  if (subscriptionId) {
    const match = await db.collection('entitlements').where('stripeSubscriptionId', '==', subscriptionId).limit(1).get();
    if (!match.empty) return match.docs[0].id;
  }

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : stringValue(asRecord(subscription.customer).id);
  if (customerId) {
    const match = await db.collection('entitlements').where('stripeCustomerId', '==', customerId).limit(1).get();
    if (!match.empty) return match.docs[0].id;
  }

  return '';
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
  { invoker: 'public', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', secrets: [stripeConfigSecret] },
  async (request) => {
    const auth = requireAuthenticated(request);
    const data = asRecord(request.data);
    const plan = stringValue(data.plan);
    if (plan !== 'monthly' && plan !== 'annual') throw new HttpsError('invalid-argument', 'Choose a valid Premium plan.');

    const config = stripeConfigValue();
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
  { invoker: 'public', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', secrets: [stripeConfigSecret] },
  async (request) => {
    const auth = requireAuthenticated(request);
    const config = stripeConfigValue();
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
  // The service's unauthenticated Cloud Run access is managed once in Cloud Run.
  // Omitting invoker here prevents every Functions deploy from trying to rewrite
  // the IAM policy on projects where the Firebase CLI identity cannot set it.
  { secrets: [stripeConfigSecret] },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }
    const config = stripeConfigValue();
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
        const uid = await resolveStripeUid(object);
        if (uid) await applyStripeSubscription(uid, object);
        else console.warn('Stripe subscription event could not be matched to an Inkbound account.', { type, subscriptionId: stringValue(object.id) });
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

async function acknowledgePlaySubscription(purchaseToken: string, subscription: JsonRecord): Promise<void> {
  if (stringValue(subscription.acknowledgementState) === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') return;

  const accessToken = await googleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PLAY_PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(PLAY_PRODUCT_ID)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(`Google Play acknowledgement failed (${response.status})${payload ? `: ${payload}` : '.'}`);
  }
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
  const playState: ProviderState = { provider: 'google_play', status, expiresAtMillis: expiryMillis };
  const tokenHash = sha256(purchaseToken);
  const purchaseRef = db.doc(`billingSubscriptions/${tokenHash}`);
  const entitlementRef = db.doc(`entitlements/${uid}`);

  await db.runTransaction(async (transaction) => {
    const [purchaseRecord, entitlementSnapshot] = await Promise.all([
      transaction.get(purchaseRef),
      transaction.get(entitlementRef),
    ]);
    const existingUid = stringValue(purchaseRecord.get('uid'));
    if (existingUid && existingUid !== uid) {
      throw new Error('This Google Play purchase is already linked to a different Inkbound account.');
    }

    const entitlement = entitlementSnapshot.data() ?? {};
    const stripeState = providerStateFromEntitlement(entitlement, 'stripe');

    transaction.set(purchaseRef, {
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
    transaction.set(entitlementRef, {
      ...canonicalEntitlementFields(entitlement, stripeState, playState, 'google_play'),
      playSubscriptionStatus: status,
      playPaidPremiumUntil: expiryMillis > 0 ? Timestamp.fromMillis(expiryMillis) : FieldValue.delete(),
      playPurchaseTokenHash: tokenHash,
      billingVerifiedAt: FieldValue.serverTimestamp(),
      playBillingVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'google_play',
    }, { merge: true });
  });

  const source = providerIsActive(playState) ? 'subscription' : 'free';
  if (source === 'subscription') await acknowledgePlaySubscription(purchaseToken, subscription);
  return { status, expiryMillis, source };
}

export async function refreshGooglePlayEntitlementForUser(uid: string, force = false): Promise<void> {
  const entitlementRef = db.doc(`entitlements/${uid}`);
  const entitlement = await entitlementRef.get();
  const tokenHash = stringValue(entitlement.get('playPurchaseTokenHash'));
  if (!tokenHash) return;

  const verifiedAt = entitlement.get('playBillingVerifiedAt') ?? entitlement.get('billingVerifiedAt');
  const lastVerifiedMillis = verifiedAt instanceof Timestamp ? verifiedAt.toMillis() : 0;
  if (!force && lastVerifiedMillis && Date.now() - lastVerifiedMillis < PLAY_REFRESH_INTERVAL_MS) return;

  const purchaseRecord = await db.doc(`billingSubscriptions/${tokenHash}`).get();
  const purchaseToken = stringValue(purchaseRecord.get('purchaseToken'));
  if (!purchaseToken || purchaseRecord.get('uid') !== uid) return;

  await applyPlaySubscription(uid, purchaseToken, await fetchPlaySubscription(purchaseToken));
}

export const verifyGooglePlaySubscription = onCall(
  { invoker: 'public', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' },
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

export const googlePlayBillingNotification = onMessagePublished(PLAY_RTDN_TOPIC, async (event) => {
  const message = event.data.message;
  let payload = asRecord(message.json);
  if (Object.keys(payload).length === 0 && message.data) {
    try {
      payload = asRecord(JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')));
    } catch (error) {
      console.warn('Ignoring malformed Google Play RTDN payload.', error);
      return;
    }
  }

  if (stringValue(payload.packageName) !== PLAY_PACKAGE_NAME) return;
  const notification = asRecord(payload.subscriptionNotification);
  const purchaseToken = stringValue(notification.purchaseToken);
  if (!purchaseToken) return;

  const tokenHash = sha256(purchaseToken);
  const purchaseRecord = await db.doc(`billingSubscriptions/${tokenHash}`).get();
  const uid = stringValue(purchaseRecord.get('uid'));
  if (!uid) {
    console.warn('Google Play RTDN arrived before the purchase was linked to an Inkbound account.', { tokenHash });
    return;
  }

  try {
    await applyPlaySubscription(uid, purchaseToken, await fetchPlaySubscription(purchaseToken));
  } catch (error) {
    console.error('Google Play RTDN refresh failed.', { uid, tokenHash, error });
    throw error;
  }
});
