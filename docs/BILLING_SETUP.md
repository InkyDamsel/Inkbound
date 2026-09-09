# Inkbound Premium billing setup

Inkbound has one entitlement source of truth: `entitlements/{firebaseUid}` in Firestore. Clients may read their own entitlement, but only Firebase Functions can write it.

## Product contract

- Web checkout provider: Stripe Checkout
- Android checkout provider: Google Play Billing
- Canonical Premium entitlement: Firebase `entitlements/{uid}`
- Monthly price shown in Inkbound: $6.99 USD
- Annual price shown in Inkbound: $59.99 USD
- Google Play subscription product ID: `inkbound_premium`
- Google Play base plan IDs: `monthly` and `annual`

Do not change the Play IDs in Console without changing the native/server constants in Inkbound first.

## 1. Stripe

Create one Premium product in Stripe with two recurring prices:

- Monthly: $6.99 USD / month
- Annual: $59.99 USD / year

Copy both `price_...` IDs.

Deploy the billing functions once so Firebase prints the URL for `stripeBillingWebhook`. In Stripe Workbench / Webhooks, add that HTTPS endpoint and subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the webhook signing secret (`whsec_...`).

Configure the single Firebase JSON secret:

```powershell
npm run firebase:secret:stripe
```

Enter one line of valid JSON when prompted:

```json
{"secretKey":"sk_live_...","webhookSecret":"whsec_...","monthlyPriceId":"price_...","annualPriceId":"price_..."}
```

Then redeploy Functions:

```powershell
npm run firebase:deploy:functions
```

Stripe Checkout and the Stripe Customer Portal are created on the server. No Stripe secret key or customer-specific portal URL belongs in the web/Android bundle.

## 2. Google Play Console

Under Monetize > Products > Subscriptions, create:

- Product ID: `inkbound_premium`

Create two auto-renewing base plans:

- Base plan ID: `monthly` — monthly billing period, launch price matching $6.99 USD
- Base plan ID: `annual` — yearly billing period, launch price matching $59.99 USD

Activate the subscription/base plans in the closed-test-compatible configuration before testing purchases.

Inkbound uses Google Play Billing Library 9.1.0. Android never redirects Premium purchases to Stripe.

## 3. Let Firebase verify Play purchases

The deployed Firebase Functions service account must be allowed to use the Google Play Android Publisher API for this developer account/app. Grant the Firebase Functions runtime service account the required Play Console API access for subscriptions/orders.

The verification function calls `purchases.subscriptionsv2.get` for package:

`com.inkydameinteractive.inkbound`

The client sends a SHA-256 hash of the Firebase UID as Play's `obfuscatedAccountId`. The server compares the returned account identifier before granting Premium.

Verified purchase tokens are stored only in the server-only `billingSubscriptions` collection. Firestore rules do not expose that collection to clients.

## 4. Open subscriptions only after both providers work

Keep this in the production env while wiring/testing:

```text
VITE_PREMIUM_SUBSCRIPTIONS_OPEN=false
```

When Stripe live checkout/webhook and Google Play monthly/annual purchase + restore are both verified, set:

```text
VITE_PREMIUM_SUBSCRIPTIONS_OPEN=true
```

Then rebuild/redeploy web and rebuild Android. This is a compile-time release switch, so changing the env alone does not alter an already-built Android bundle.

## Required release tests

1. Web monthly checkout -> entitlement becomes Premium -> Android sees Premium.
2. Web annual checkout -> entitlement becomes Premium.
3. Stripe Customer Portal opens for a Stripe subscriber.
4. Android monthly purchase -> server verifies -> purchase acknowledged -> web sees Premium.
5. Android annual purchase -> same flow.
6. Android Restore Google Play purchase works after reinstall/sign-in.
7. Google Play Manage Subscription opens Play, not Stripe.
8. Canceled subscription retains access only through its paid-through date.
9. Expired/stale paid-through date cannot leave Premium enabled forever.
10. VIP/courtesy Premium still works independently of paid subscriptions.

Do not use a client-side plan flag as payment proof. Stripe/Google Play state must be verified by the backend before the canonical entitlement changes.
