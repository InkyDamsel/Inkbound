import React from 'react';
import { Check, Lock, Sparkles, X } from 'lucide-react';
import { useUserPlan } from '../context/UserPlanContext';

export const UpgradeModal: React.FC = () => {
  const { isUpgradeModalOpen, closeUpgradeModal, upgradeReason, userPlan, setUserPlan } =
    useUserPlan();

  if (!isUpgradeModalOpen) return null;

  const comparisonRows = [
    { feature: 'Books in Library', free: 'Up to 50', premium: 'Unlimited' },
    { feature: 'Add books individually', free: true, premium: true },
    { feature: 'Add multiple books at once', free: false, premium: true },
    { feature: 'Book summaries & editions', free: true, premium: true },
    { feature: 'Reading progress & sessions', free: true, premium: true },
    { feature: 'Basic statistics', free: true, premium: true },
    { feature: 'Batch-select & batch-editing', free: false, premium: true },
    { feature: 'Large CSV / JSON imports', free: false, premium: true },
    { feature: 'Detailed reading history reports', free: false, premium: true },
    { feature: 'Advanced report filters & date ranges', free: false, premium: true },
    { feature: 'Personalized reading pattern insights', free: false, premium: true },
  ];

  const handleUpgrade = () => {
    setUserPlan('premium');
    closeUpgradeModal();
  };

  const handleDowngrade = () => {
    setUserPlan('free');
    closeUpgradeModal();
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-end overflow-y-auto bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
      role="presentation"
      onClick={closeUpgradeModal}
    >
      <section
        className="relative flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative shrink-0 overflow-hidden border-b border-[#3d2448] bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] px-5 py-6 text-center text-white sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-[#c5a059]/10 blur-3xl" />
          <button
            type="button"
            onClick={closeUpgradeModal}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-stone-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close Premium plans"
          >
            <X className="h-5 w-5" />
          </button>

          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#c5a059]/30 bg-[#c5a059]/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
            <Sparkles className="h-3.5 w-3.5" /> Inkbound Premium
          </span>
          <h2
            id="upgrade-modal-title"
            className="mx-auto max-w-2xl pr-8 font-serif text-2xl font-bold text-[#f4efe6] sm:pr-0 sm:text-3xl"
          >
            Unlock Unlimited Library & Advanced Insights
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-stone-300">
            Grow your reading journal with unlimited books, batch management, large imports,
            and deeper reading analytics.
          </p>

          {upgradeReason && (
            <div className="mx-auto mt-4 flex max-w-xl items-start gap-2 rounded-xl border border-[#c5a059]/40 bg-[#c5a059]/20 px-4 py-3 text-left text-xs text-[#f4efe6]">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e5c158]" />
              <span>{upgradeReason}</span>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:px-8 sm:py-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col justify-between rounded-2xl border border-[#3d2448] bg-[#25132f] p-5">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  Monthly Tier
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-serif text-3xl font-bold text-[#f4efe6]">$4.99</span>
                  <span className="text-xs text-stone-400">/ month</span>
                </div>
                <p className="mt-2 text-xs text-stone-400">
                  Flexible monthly billing, cancel anytime.
                </p>
              </div>
              <p className="mt-4 text-[11px] font-semibold italic text-[#e5c158]">
                Prototype pricing — subject to change
              </p>
            </div>

            <div className="relative flex flex-col justify-between rounded-2xl border-2 border-[#c5a059] bg-[#281c2c] p-5 shadow-xl">
              <span className="absolute -top-3 right-4 rounded-full bg-[#c5a059] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#120817]">
                Best Value
              </span>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#e5c158]">
                  Annual Tier
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-serif text-3xl font-bold text-[#f4efe6]">$39.99</span>
                  <span className="text-xs text-stone-400">/ year</span>
                </div>
                <p className="mt-2 text-xs text-stone-400">
                  Save over 30% compared with monthly billing.
                </p>
              </div>
              <p className="mt-4 text-[11px] font-semibold italic text-[#e5c158]">
                Prototype pricing — subject to change
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#3d2448] bg-[#25132f]">
            <div className="grid grid-cols-[minmax(150px,1fr)_70px_84px] border-b border-[#3d2448] bg-[#1c0f24] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#f4efe6] sm:grid-cols-12">
              <div className="sm:col-span-6">Feature</div>
              <div className="text-center text-stone-400 sm:col-span-3">Free</div>
              <div className="text-center text-[#c5a059] sm:col-span-3">Premium</div>
            </div>

            <div className="divide-y divide-[#3d2448] text-xs">
              {comparisonRows.map((row) => (
                <div
                  key={row.feature}
                  className="grid grid-cols-[minmax(150px,1fr)_70px_84px] items-center px-4 py-3 transition hover:bg-white/5 sm:grid-cols-12"
                >
                  <div className="pr-3 font-medium text-stone-200 sm:col-span-6">
                    {row.feature}
                  </div>
                  <div className="flex justify-center font-semibold text-stone-400 sm:col-span-3">
                    {typeof row.free === 'boolean' ? (
                      row.free ? (
                        <Check className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <X className="h-4 w-4 text-stone-500" />
                      )
                    ) : (
                      row.free
                    )}
                  </div>
                  <div className="flex justify-center font-bold text-[#e5c158] sm:col-span-3">
                    {typeof row.premium === 'boolean' ? (
                      row.premium ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <X className="h-4 w-4 text-stone-500" />
                      )
                    ) : (
                      row.premium
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-center text-xs text-stone-400 sm:text-left">
              Current account:{' '}
              <span className="font-bold uppercase text-[#e5c158]">{userPlan} Plan</span>
            </div>

            {userPlan === 'premium' ? (
              <button
                type="button"
                onClick={handleDowngrade}
                className="min-h-12 w-full rounded-xl border border-[#3d2448] px-5 py-2.5 text-xs font-semibold text-stone-300 transition hover:bg-[#25132f] sm:w-auto"
              >
                Switch to Free Plan
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUpgrade}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-6 py-3 text-sm font-bold text-[#120817] shadow-md transition hover:opacity-95 sm:w-auto"
              >
                <Sparkles className="h-4 w-4" /> Switch to Premium
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
