package com.inkydameinteractive.inkbound;

import android.content.Intent;
import android.net.Uri;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

@CapacitorPlugin(name = "InkboundPlayBilling")
public class PlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String PRODUCT_ID = "inkbound_premium";
    private static final String PACKAGE_NAME = "com.inkydameinteractive.inkbound";

    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build();
    }

    private interface ReadyAction {
        void run();
    }

    private void whenReady(PluginCall call, ReadyAction action) {
        if (billingClient != null && billingClient.isReady()) {
            action.run();
            return;
        }
        if (billingClient == null) {
            call.reject("Google Play Billing is unavailable on this device.");
            return;
        }
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    action.run();
                } else {
                    call.reject("Google Play Billing could not connect: " + billingResult.getDebugMessage());
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // The next billing action reconnects. Do not fail an already-launched Play UI.
            }
        });
    }

    private void queryPremiumProduct(PluginCall call, ReadyActionWithProduct action) {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PRODUCT_ID)
            .setProductType(BillingClient.ProductType.SUBS)
            .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(product))
            .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, queryResult) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Google Play could not load Inkbound Premium: " + billingResult.getDebugMessage());
                return;
            }
            List<ProductDetails> details = queryResult.getProductDetailsList();
            if (details == null || details.isEmpty()) {
                call.reject("Inkbound Premium is not available for this Google Play account yet.");
                return;
            }
            action.run(details.get(0));
        });
    }

    private interface ReadyActionWithProduct {
        void run(ProductDetails productDetails);
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String basePlanId = call.getString("basePlanId", "");
        String obfuscatedAccountId = call.getString("obfuscatedAccountId", "");
        if (!"monthly".equals(basePlanId) && !"annual".equals(basePlanId)) {
            call.reject("Choose a valid Inkbound Premium plan.");
            return;
        }
        if (obfuscatedAccountId.isEmpty() || obfuscatedAccountId.length() > 64) {
            call.reject("Inkbound could not identify the signed-in account for Google Play Billing.");
            return;
        }
        if (pendingPurchaseCall != null) {
            call.reject("Another Google Play purchase is already in progress.");
            return;
        }

        whenReady(call, () -> queryPremiumProduct(call, productDetails -> {
            List<ProductDetails.SubscriptionOfferDetails> offers = productDetails.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                call.reject("Google Play did not return any eligible Inkbound Premium plans.");
                return;
            }

            List<ProductDetails.SubscriptionOfferDetails> matches = new ArrayList<>();
            for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                if (basePlanId.equals(offer.getBasePlanId())) matches.add(offer);
            }
            if (matches.isEmpty()) {
                call.reject("The selected Inkbound Premium plan is not available for this Google Play account.");
                return;
            }
            matches.sort(Comparator.comparing(offer -> offer.getOfferId() == null ? 0 : 1));
            ProductDetails.SubscriptionOfferDetails selectedOffer = matches.get(0);

            BillingFlowParams.ProductDetailsParams productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(productDetails)
                .setOfferToken(selectedOffer.getOfferToken())
                .build();
            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(productParams))
                .setObfuscatedAccountId(obfuscatedAccountId)
                .build();

            pendingPurchaseCall = call;
            BillingResult launchResult = billingClient.launchBillingFlow(getActivity(), flowParams);
            if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                pendingPurchaseCall = null;
                call.reject("Google Play could not start the purchase: " + launchResult.getDebugMessage());
            }
        }));
    }

    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call = pendingPurchaseCall;
        if (call == null) return;

        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            pendingPurchaseCall = null;
            JSObject result = new JSObject();
            result.put("canceled", true);
            call.resolve(result);
            return;
        }
        if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            pendingPurchaseCall = null;
            call.reject("Google Play did not complete the purchase: " + billingResult.getDebugMessage());
            return;
        }

        Purchase selected = null;
        for (Purchase purchase : purchases) {
            if (purchase.getProducts().contains(PRODUCT_ID)) {
                selected = purchase;
                break;
            }
        }
        if (selected == null) {
            pendingPurchaseCall = null;
            call.reject("Google Play returned a purchase that was not Inkbound Premium.");
            return;
        }

        pendingPurchaseCall = null;
        call.resolve(purchaseToJs(selected));
    }

    @PluginMethod
    public void restore(PluginCall call) {
        whenReady(call, () -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
            billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("Google Play could not restore purchases: " + billingResult.getDebugMessage());
                    return;
                }
                JSArray restored = new JSArray();
                if (purchases != null) {
                    for (Purchase purchase : purchases) {
                        if (purchase.getProducts().contains(PRODUCT_ID)) restored.put(purchaseToJs(purchase));
                    }
                }
                JSObject result = new JSObject();
                result.put("purchases", restored);
                call.resolve(result);
            });
        });
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        String purchaseToken = call.getString("purchaseToken", "");
        if (purchaseToken.isEmpty()) {
            call.reject("A Google Play purchase token is required.");
            return;
        }
        whenReady(call, () -> {
            AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchaseToken)
                .build();
            billingClient.acknowledgePurchase(params, billingResult -> {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    call.resolve();
                } else {
                    call.reject("Google Play could not acknowledge the purchase: " + billingResult.getDebugMessage());
                }
            });
        });
    }

    @PluginMethod
    public void manage(PluginCall call) {
        try {
            Uri uri = Uri.parse(
                "https://play.google.com/store/account/subscriptions?sku=" + PRODUCT_ID + "&package=" + PACKAGE_NAME
            );
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Google Play subscription management could not be opened.", error);
        }
    }

    private JSObject purchaseToJs(Purchase purchase) {
        JSObject result = new JSObject();
        result.put("purchaseToken", purchase.getPurchaseToken());
        result.put("purchaseState", purchase.getPurchaseState());
        result.put("acknowledged", purchase.isAcknowledged());
        result.put("pending", purchase.getPurchaseState() == Purchase.PurchaseState.PENDING);
        result.put("purchased", purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED);
        result.put("canceled", false);
        return result;
    }
}
