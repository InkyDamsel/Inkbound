import React, { useEffect } from 'react';
import { Check, Lock, Sparkles, X } from 'lucide-react';
import { PRODUCT_POLICY } from '../config/productPolicy';
import { useUserPlan } from '../context/UserPlanContext';

export const UpgradeModal: React.FC = () => {
  const { isUpgradeModalOpen, closeUpgradeModal, upgradeReason, userPlan } = useUserPlan();

  useEffect(() => {
    if (userPlan === 'premium' && isUpgradeModalOpen) closeUpgradeModal();
  }, [closeUpgradeModal, isUpgradeModalOpen, userPlan]);

  if (!isUpgradeModalOpen || userPlan === 'premium') return null;

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
      <section className="relative flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-3xl border border-[var(--ink-border)] bg-[var(--ink-surface)] shadow-2xl sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-3xl" role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="relative shrink-0 overflow-hidden border-b border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-5 py-6 text-center sm:px-8 sm:py-8">
          <button type="button" onClick={closeUpgradeModal} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--ink-surface)] hover:text-[var(--ink-ivory)]" aria-label="Close Premium plans"><X className="h-5 w-5" /></button>
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--ink-mauve)]/30 bg-[var(--ink-mauve)]/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-mauve)]"><Sparkles className="h-3.5 w-3.5" /> Inkbound Premium</span>
          <h2 id="upgrade-modal-title" className="mx-auto max-w-2xl pr-8 font-serif text-2xl font-bold text-[var(--ink-ivory)] sm:pr-0 sm:text-3xl">Preserve more of your reading life</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">Your library stays unlimited on Free. Premium unlocks Inkbound's deeper reflection, historical insights, creative recaps, and advanced library tools.</p>
          {upgradeReason && <div className="mx-auto mt-4 flex max-w-xl items-start gap-2 rounded-xl border border-[var(--ink-mauve)]/30 bg-[var(--ink-mauve)]/10 px-4 py-3 text-left text-xs text-[var(--ink-ivory)]"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-mauve)]" /><span>{upgradeReason}</span></div>}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-8 sm:py-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col justify-between rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
              <div><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Monthly</span><div className="mt-1 flex flex-wrap items-baseline gap-1"><span className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">${PRODUCT_POLICY.premium.plannedMonthlyPrice.toFixed(2)}</span><span className="text-xs text-[var(--ink-muted)]">/ month</span></div><p className="mt-2 text-xs text-[var(--ink-muted)]">Flexible monthly billing. Cancel anytime.</p></div>
              <p className="mt-4 text-[11px] font-semibold text-[var(--ink-mauve)]">Planned launch pricing</p>
            </div>
            <div className="relative flex flex-col justify-between rounded-2xl border-2 border-[var(--ink-mauve)] bg-[var(--ink-surface-soft)] p-5 shadow-xl">
              <span className="absolute -top-3 right-4 rounded-full bg-[var(--ink-mauve)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-surface)]">Best Value</span>
              <div><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-mauve)]">Annual</span><div className="mt-1 flex flex-wrap items-baseline gap-1"><span className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">${PRODUCT_POLICY.premium.plannedAnnualPrice.toFixed(2)}</span><span className="text-xs text-[var(--ink-muted)]">/ year</span></div><p className="mt-2 text-xs text-[var(--ink-muted)]">About $5/month and roughly 28% less than paying monthly.</p></div>
              <p className="mt-4 text-[11px] font-semibold text-[var(--ink-mauve)]">Planned launch pricing</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm leading-6 text-[var(--ink-muted)]"><strong className="text-[var(--ink-ivory)]">Free is a complete reading library.</strong>{' '}Premium is for readers who want a richer record of how, when, and what they read.</div>

          <div className="overflow-hidden rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)]">
            <div className="grid grid-cols-[minmax(0,1fr)_52px_64px] border-b border-[var(--ink-border-subtle)] bg-[var(--ink-surface)] px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-ivory)] sm:grid-cols-12 sm:px-4 sm:text-xs sm:tracking-wider"><div className="min-w-0 sm:col-span-6">Feature</div><div className="text-center text-[var(--ink-muted)] sm:col-span-3">Free</div><div className="text-center text-[var(--ink-mauve)] sm:col-span-3">Premium</div></div>
            <div className="divide-y divide-[var(--ink-border-subtle)] text-[11px] sm:text-xs">
              {comparisonRows.map((row) => <div key={row.feature} className="grid grid-cols-[minmax(0,1fr)_52px_64px] items-center px-3 py-3 transition hover:bg-[var(--ink-surface)] sm:grid-cols-12 sm:px-4"><div className="min-w-0 break-words pr-2 font-medium text-[var(--ink-ivory)] sm:col-span-6 sm:pr-3">{row.feature}</div><div className="flex min-w-0 justify-center text-center font-semibold text-[var(--ink-muted)] sm:col-span-3">{typeof row.free === 'boolean' ? row.free ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4" /> : row.free}</div><div className="flex min-w-0 justify-center text-center font-bold text-[var(--ink-mauve)] sm:col-span-3">{typeof row.premium === 'boolean' ? row.premium ? <Check className="h-4 w-4" /> : <X className="h-4 w-4 text-[var(--ink-muted)]" /> : row.premium}</div></div>)}
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-center text-xs text-[var(--ink-muted)] sm:text-left">Current account: <span className="font-bold uppercase text-[var(--ink-mauve)]">{userPlan} Plan</span></div>
            <p className="text-center text-xs text-[var(--ink-muted)] sm:text-right">{PRODUCT_POLICY.premium.subscriptionsOpen ? 'Premium subscriptions are available.' : 'Premium subscriptions are not open yet. The prices above are planned launch pricing.'}</p>
          </div>
        </div>
      </section>
    </div>
  );
};
