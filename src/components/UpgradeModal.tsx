import React from 'react';
import { useUserPlan } from '../context/UserPlanContext';
import { Sparkles, Check, X, Shield, Zap, BookOpen, Layers, BarChart3, Filter, Lock } from 'lucide-react';

export const UpgradeModal: React.FC = () => {
  const { isUpgradeModalOpen, closeUpgradeModal, upgradeReason, userPlan, setUserPlan } = useUserPlan();

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-[#1c0f24] border border-[#c5a059]/40 rounded-3xl shadow-2xl overflow-hidden my-8">
        {/* Header Header Banner */}
        <div className="bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] p-6 sm:p-8 text-white text-center relative overflow-hidden border-b border-[#3d2448]">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#c5a059]/10 rounded-full blur-3xl pointer-events-none" />
          <button
            onClick={closeUpgradeModal}
            className="absolute top-4 right-4 p-2 rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#e5c158] bg-[#c5a059]/20 border border-[#c5a059]/30 px-3 py-1 rounded-full mb-3">
            <Sparkles className="w-3.5 h-3.5 text-[#e5c158]" /> Premium Journal Tier
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#f4efe6]">
            Unlock Unlimited Library & Advanced Insights
          </h2>
          <p className="text-sm text-stone-300 max-w-xl mx-auto mt-2">
            Take your reading journey further with unlimited books, powerful batch management, large imports, and deep reading habits analysis.
          </p>

          {upgradeReason && (
            <div className="mt-4 inline-flex items-center gap-2 bg-[#c5a059]/20 border border-[#c5a059]/40 text-[#f4efe6] text-xs px-4 py-2 rounded-xl">
              <Lock className="w-3.5 h-3.5 text-[#e5c158]" />
              <span>{upgradeReason}</span>
            </div>
          )}
        </div>

        <div className="p-6 sm:p-8 space-y-8">
          {/* Pricing Options Cards (Placeholder) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl border border-[#3d2448] bg-[#25132f] flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-stone-400">Monthly Tier</span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-serif font-bold text-[#f4efe6]">$4.99</span>
                  <span className="text-xs text-stone-400">/ month</span>
                </div>
                <p className="text-xs text-stone-400 mt-2">Flexible monthly billing, cancel anytime.</p>
              </div>
              <p className="text-[11px] italic text-[#e5c158] mt-4 font-semibold">Pricing subject to change (Prototype)</p>
            </div>

            <div className="p-5 rounded-2xl border-2 border-[#c5a059] bg-[#281c2c] relative flex flex-col justify-between shadow-xl">
              <span className="absolute -top-3 right-4 bg-[#c5a059] text-[#120817] text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                Best Value
              </span>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#e5c158]">Annual Tier</span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-serif font-bold text-[#f4efe6]">$39.99</span>
                  <span className="text-xs text-stone-400">/ year</span>
                </div>
                <p className="text-xs text-stone-400 mt-2">Save over 30% compared to monthly plan.</p>
              </div>
              <p className="text-[11px] italic text-[#e5c158] mt-4 font-semibold">Pricing subject to change (Prototype)</p>
            </div>
          </div>

          {/* Plan Comparison Table */}
          <div className="border border-[#3d2448] rounded-2xl overflow-hidden bg-[#25132f]">
            <div className="bg-[#1c0f24] px-4 py-3 border-b border-[#3d2448] grid grid-cols-12 text-xs font-bold uppercase tracking-wider text-[#f4efe6]">
              <div className="col-span-6 sm:col-span-6">Feature</div>
              <div className="col-span-3 sm:col-span-3 text-center text-stone-600 dark:text-stone-400">Free</div>
              <div className="col-span-3 sm:col-span-3 text-center text-[#c5a059]">Premium</div>
            </div>

            <div className="divide-y divide-[#3d2448] text-xs">
              {comparisonRows.map((row, idx) => (
                <div key={idx} className="px-4 py-3 grid grid-cols-12 items-center hover:bg-white/5 transition">
                  <div className="col-span-6 sm:col-span-6 font-medium text-stone-200">
                    {row.feature}
                  </div>
                  <div className="col-span-3 sm:col-span-3 flex justify-center text-stone-400 font-semibold">
                    {typeof row.free === 'boolean' ? (
                      row.free ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <X className="w-4 h-4 text-stone-500" />
                      )
                    ) : (
                      row.free
                    )}
                  </div>
                  <div className="col-span-3 sm:col-span-3 flex justify-center text-[#e5c158] font-bold">
                    {typeof row.premium === 'boolean' ? (
                      row.premium ? (
                        <Check className="w-4 h-4 text-[#e5c158]" />
                      ) : (
                        <X className="w-4 h-4 text-stone-500" />
                      )
                    ) : (
                      row.premium
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="text-xs text-stone-400 text-center sm:text-left">
              Current Active Account: <span className="font-bold uppercase text-[#e5c158]">{userPlan} Plan</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {userPlan === 'premium' ? (
                <button
                  onClick={handleDowngrade}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-[#3d2448] text-stone-300 hover:bg-[#25132f] text-xs font-semibold transition"
                >
                  Switch to Free Plan
                </button>
              ) : (
                <button
                  onClick={handleUpgrade}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-sm shadow-md hover:opacity-95 transition flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-[#120817]" /> Switch to Premium Now
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
