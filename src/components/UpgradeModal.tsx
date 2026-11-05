import React, { useEffect, useState } from 'react';
import { Check, HeartHandshake, RotateCcw, Sparkles, X } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { PRODUCT_POLICY } from '../config/productPolicy';
import { useAccountSync } from '../context/AccountSyncContext';
import { useUserPlan } from '../context/UserPlanContext';
import { functions } from '../lib/firebase';
import {
  PremiumBillingPlan,
  canPurchaseRuntimePremium,
  canRestoreRuntimePremium,
  canShowRuntimePremiumPurchaseOptions,
  purchaseRuntimePremium,
  restoreRuntimePremium,
} from '../platform/runtimePremiumPurchase';

const supportDeveloperUrl = import.meta.env.VITE_SUPPORT_DEVELOPER_URL?.trim();
const OWNER_EMAILS = new Set(['blackdame494@gmail.com', 'inkbound@inkydameinteractive.com']);

export const UpgradeModal: React.FC = () => {
  const { isUpgradeModalOpen, closeUpgradeModal, userPlan, trialAvailable, trialEligibilityKnown, entitlementLoading } = useUserPlan();
  const { user } = useAccountSync();
  const [billingPlan, setBillingPlan] = useState<PremiumBillingPlan | 'restore' | 'trial' | null>(null);
  const [billingError, setBillingError] = useState('');

  useEffect(() => {
    if (userPlan === 'premium' && isUpgradeModalOpen) closeUpgradeModal();
  }, [closeUpgradeModal, isUpgradeModalOpen, userPlan]);

  useEffect(() => {
    if (!isUpgradeModalOpen) {
      setBillingPlan(null);
      setBillingError('');
    }
  }, [isUpgradeModalOpen]);

  if (!isUpgradeModalOpen || userPlan === 'premium') return null;

  const ownerEmail = user?.email?.toLowerCase() ?? '';
  const sandboxBillingRequested = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('billingTest') === '1';
  const sandboxBillingTest = !PRODUCT_POLICY.premium.subscriptionsOpen
    && OWNER_EMAILS.has(ownerEmail)
    && sandboxBillingRequested;
  const showPurchaseOptions = canShowRuntimePremiumPurchaseOptions();
  const subscriptionsAvailable = showPurchaseOptions
    && (PRODUCT_POLICY.premium.subscriptionsOpen || sandboxBillingTest)
    && canPurchaseRuntimePremium();
  const restoreAvailable = PRODUCT_POLICY.premium.subscriptionsOpen && canRestoreRuntimePremium();

  const beginTrial = async () => {
    if (!functions) {
      setBillingError('Premium trials are unavailable right now. Please try again later.');
      return;
    }
    setBillingPlan('trial');
    setBillingError('');
    try {
      const getMyEntitlement = httpsCallable<{ action: 'startTrial' }, unknown>(functions, 'getMyEntitlement');
      await getMyEntitlement({ action: 'startTrial' });
      window.dispatchEvent(new Event('inkbound:entitlement-refresh'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Inkbound could not start the Premium trial.';
      setBillingError(message.includes('already been used') ? 'This Inkbound account has already used its free Premium trial.' : message);
    } finally {
      setBillingPlan(null);
    }
  };

  const beginPurchase = async (plan: PremiumBillingPlan) => {
    setBillingPlan(plan);
    setBillingError('');
    try {
      await purchaseRuntimePremium(plan);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'Inkbound could not start the Premium purchase.');
    } finally {
      setBillingPlan(null);
    }
  };

  const restorePurchase = async () => {
    setBillingPlan('restore');
    setBillingError('');
    try {
      const restored = await restoreRuntimePremium();
      if (restored === 0) setBillingError('No active Inkbound Premium purchase was found for this Google Play account.');
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'Inkbound could not restore your Premium purchase.');
    } finally {
      setBillingPlan(null);
    }
  };

  const comparisonRows = [
    { feature: 'Items in your library', free: 'Unlimited', premium: 'Unlimited' },
    { feature: 'Library imports', free: 'Unlimited', premium: 'Unlimited' },
    { feature: 'Custom lists & collections', free: PRODUCT_POLICY.features.collections === 'free', premium: true },
    { feature: 'Reading progress, notes & quotes', free: PRODUCT_POLICY.features.readingProgress === 'free', premium: true },
    { feature: 'Reading calendar & basic statistics', free: PRODUCT_POLICY.features.readingCalendar === 'free', premium: true },
    { feature: 'Core Series organization', free: PRODUCT_POLICY.features.seriesCore === 'free', premium: true },
    { feature: 'Inkbound Studio cards & exports', free: PRODUCT_POLICY.features.studio === 'free', premium: true },
    { feature: 'Complete data export', free: PRODUCT_POLICY.features.completeExport === 'free', premium: true },
    { feature: 'Batch library editing', free: PRODUCT_POLICY.features.batchEdit === 'free', premium: true },
    { feature: 'Advanced reading insights & filters', free: PRODUCT_POLICY.features.advancedInsights === 'free', premium: true },
    { feature: 'Deeper Series Insights', free: PRODUCT_POLICY.features.seriesInsights === 'free', premium: true },
    { feature: 'Monthly Wrapped', free: PRODUCT_POLICY.features.monthlyWrapped === 'free', premium: true },
    { feature: 'Year in Books', free: PRODUCT_POLICY.features.yearInBooks === 'free', premium: true },
    { feature: 'Bookshelf Through Time', free: PRODUCT_POLICY.features.bookshelfThroughTime === 'free', premium: true },
  ];

  return (
    <div className="fixed inset-0 z-[140] flex items-end overflow-y-auto bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="presentation" onClick={closeUpgradeModal}>
      <section className="inkbound-modal-surface relative flex min-h-0 max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-3xl border border-[var(--ink-border)] bg-[var(--ink-surface)] shadow-2xl sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-3xl" role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="relative shrink-0 overflow-hidden border-b border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-5 py-6 text-center sm:px-8 sm:py-8">
          <button type="button" onClick={closeUpgradeModal} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--ink-surface)] hover:text-[var(--ink-ivory)]" aria-label="Close Premium plans"><X className="h-5 w-5" /></button>
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--ink-mauve)]/30 bg-[var(--ink-mauve)]/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-mauve)]"><Sparkles className="h-3.5 w-3.5" /> Inkbound Premium</span>
          <h2 id="upgrade-modal-title" className="mx-auto max-w-2xl pr-8 font-serif text-2xl font-bold text-[var(--ink-ivory)] sm:pr-0 sm:text-3xl">Preserve more of your reading life</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">Your library stays unlimited on Free. Premium unlocks Inkbound's deeper reflection, historical insights, creative recaps, and advanced library tools.</p>
          {sandboxBillingTest && <div className="mx-auto mt-4 max-w-xl rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-left text-xs font-semibold text-amber-100">Owner-only Stripe Sandbox test mode is active. No real payment will be charged.</div>}
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-8 sm:py-8">
          {user && !entitlementLoading && trialEligibilityKnown && trialAvailable && (
            <div className="rounded-2xl border-2 border-[var(--ink-gold)]/50 bg-[var(--ink-gold)]/5 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-xl">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-gold-bright)]">Try Premium first</span>
                  <h3 className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">7 days of Inkbound Premium, free</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">No card. No payment information. No automatic subscription. When the trial ends, your account simply returns to Free unless you choose a plan.</p>
                </div>
                <button type="button" disabled={billingPlan !== null} onClick={() => void beginTrial()} className="quiet-shelf-primary-action inline-flex min-h-12 w-full shrink-0 items-center justify-center whitespace-nowrap px-5 text-center disabled:opacity-50 sm:w-auto sm:min-w-[190px]">{billingPlan === 'trial' ? 'Starting trial…' : 'Start 7-day free trial'}</button>
              </div>
            </div>
          )}

          {!user ? <p className="text-center text-sm text-[var(--ink-muted)]">Sign in to check your account’s Premium trial eligibility.</p> : !entitlementLoading && trialEligibilityKnown && !trialAvailable ? <p className="text-center text-xs text-[var(--ink-muted)]">This account has already used its one-time Premium trial.</p> : user && !entitlementLoading && !trialEligibilityKnown ? <p className="text-center text-sm text-[var(--ink-muted)]">Premium trial eligibility is unavailable. Please sign in again to refresh your account.</p> : null}

          {!showPurchaseOptions ? (
            <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5 text-sm leading-6 text-[var(--ink-muted)]">
              <strong className="text-[var(--ink-ivory)]">Premium purchasing is not open in the iOS app yet.</strong>{' '}
              You can use Inkbound Free, start the one-time trial if eligible, or keep using Premium already granted to this Inkbound account.
            </div>
          ) : (
            <><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col justify-between rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
              <div><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Monthly</span><div className="mt-1 flex flex-wrap items-baseline gap-1"><span className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">${PRODUCT_POLICY.premium.plannedMonthlyPrice.toFixed(2)}</span><span className="text-xs text-[var(--ink-muted)]">/ month</span></div><p className="mt-2 text-xs text-[var(--ink-muted)]">Flexible monthly billing. Cancel anytime.</p></div>
              {subscriptionsAvailable ? <button type="button" disabled={billingPlan !== null} onClick={() => void beginPurchase('monthly')} className="quiet-shelf-primary-action mt-4 justify-center disabled:opacity-50">{billingPlan === 'monthly' ? 'Opening checkout…' : sandboxBillingTest ? 'Test monthly checkout' : 'Choose monthly'}</button> : <p className="mt-4 text-[11px] font-semibold text-[var(--ink-mauve)]">Planned launch pricing</p>}
            </div>
            <div className="relative flex flex-col justify-between rounded-2xl border-2 border-[var(--ink-mauve)] bg-[var(--ink-surface-soft)] p-5 shadow-xl">
              <span className="absolute -top-3 right-4 rounded-full bg-[var(--ink-mauve)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-surface)]">Best Value</span>
              <div><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-mauve)]">Annual</span><div className="mt-1 flex flex-wrap items-baseline gap-1"><span className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">${PRODUCT_POLICY.premium.plannedAnnualPrice.toFixed(2)}</span><span className="text-xs text-[var(--ink-muted)]">/ year</span></div><p className="mt-2 text-xs text-[var(--ink-muted)]">About $5/month and roughly 28% less than paying monthly.</p></div>
              {subscriptionsAvailable ? <button type="button" disabled={billingPlan !== null} onClick={() => void beginPurchase('annual')} className="quiet-shelf-primary-action mt-4 justify-center disabled:opacity-50">{billingPlan === 'annual' ? 'Opening checkout…' : sandboxBillingTest ? 'Test annual checkout' : 'Choose annual'}</button> : <p className="mt-4 text-[11px] font-semibold text-[var(--ink-mauve)]">Planned launch pricing</p>}
            </div>
          </div></>
          )}
          {restoreAvailable && <div className="flex justify-center"><button type="button" disabled={billingPlan !== null} onClick={() => void restorePurchase()} className="quiet-shelf-secondary-action justify-center disabled:opacity-50"><RotateCcw className="h-4 w-4" /> {billingPlan === 'restore' ? 'Restoring…' : 'Restore Google Play purchase'}</button></div>}
          {billingError && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">{billingError}</div>}

          {!!showPurchaseOptions && (<div className="rounded-2xl border border-[var(--ink-gold)]/30 bg-[var(--ink-gold)]/5 p-5">
            <div className="flex items-start gap-3">
              <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Support the developer</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Want to help Inkbound keep growing without starting a subscription? You can make a one-time contribution instead. Supporting the developer does not change your plan or unlock Premium features.</p>
                {supportDeveloperUrl ? (
                  <a href={supportDeveloperUrl} target="_blank" rel="noreferrer" className="quiet-shelf-secondary-action mt-4 inline-flex justify-center"><HeartHandshake className="h-4 w-4" /> Support Inkbound</a>
                ) : (
                  <button type="button" disabled className="quiet-shelf-secondary-action mt-4 justify-center opacity-50"><HeartHandshake className="h-4 w-4" /> Support link coming soon</button>
                )}
              </div>
            </div>
          </div>)}
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm leading-6 text-[var(--ink-muted)]"><strong className="text-[var(--ink-ivory)]">Free is a complete reading library.</strong>{' '}Premium is for readers who want a richer record of how, when, and what they read.</div>

          <div className="overflow-hidden rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)]">
            <div className="grid grid-cols-[minmax(0,1fr)_52px_64px] border-b border-[var(--ink-border-subtle)] bg-[var(--ink-surface)] px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-ivory)] sm:grid-cols-12 sm:px-4 sm:text-xs sm:tracking-wider"><div className="min-w-0 sm:col-span-6">Feature</div><div className="text-center text-[var(--ink-muted)] sm:col-span-3">Free</div><div className="text-center text-[var(--ink-mauve)] sm:col-span-3">Premium</div></div>
            <div className="divide-y divide-[var(--ink-border-subtle)] text-[11px] sm:text-xs">
              {comparisonRows.map((row) => <div key={row.feature} className="grid grid-cols-[minmax(0,1fr)_52px_64px] items-center px-3 py-3 transition hover:bg-[var(--ink-surface)] sm:grid-cols-12 sm:px-4"><div className="min-w-0 break-words pr-2 font-medium text-[var(--ink-ivory)] sm:col-span-6 sm:pr-3">{row.feature}</div><div className="flex min-w-0 justify-center text-center font-semibold text-[var(--ink-muted)] sm:col-span-3">{typeof row.free === 'boolean' ? row.free ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4" /> : row.free}</div><div className="flex min-w-0 justify-center text-center font-bold text-[var(--ink-mauve)] sm:col-span-3">{typeof row.premium === 'boolean' ? row.premium ? <Check className="h-4 w-4" /> : <X className="h-4 w-4 text-[var(--ink-muted)]" /> : row.premium}</div></div>)}
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-center text-xs text-[var(--ink-muted)] sm:text-left">Current account: <span className="font-bold uppercase text-[var(--ink-mauve)]">{userPlan} Plan</span></div>
            <p className="text-center text-xs text-[var(--ink-muted)] sm:text-right">{sandboxBillingTest ? 'Owner-only Stripe Sandbox testing is active.' : PRODUCT_POLICY.premium.subscriptionsOpen ? 'Premium subscriptions are available.' : 'Premium subscriptions are not open yet. The prices above are planned launch pricing.'}</p>
          </div>
        </div>
      </section>
    </div>
  );
};