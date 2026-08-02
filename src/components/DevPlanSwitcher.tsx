import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sliders, Sparkles } from 'lucide-react';
import { useUserPlan } from '../context/UserPlanContext';

interface DevPlanSwitcherProps {
  currentBookCount: number;
  onSetTestBooksCount?: (count: number) => void;
}

export const DevPlanSwitcher: React.FC<DevPlanSwitcherProps> = ({
  currentBookCount,
  onSetTestBooksCount,
}) => {
  const { userPlan, setUserPlan, openUpgradeModal } = useUserPlan();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelectFreeUnder = () => {
    setUserPlan('free');
    onSetTestBooksCount?.(38);
  };

  const handleSelectFreeLimit = () => {
    setUserPlan('free');
    onSetTestBooksCount?.(50);
  };

  const handleSelectPremium = () => {
    setUserPlan('premium');
  };

  return (
    <div className="w-full">
      {isOpen ? (
        <section className="w-full space-y-3 rounded-2xl border border-[#c5a059]/40 bg-[#120817] p-3 text-[#f4efe6] shadow-inner sm:p-4">
          <div className="flex items-center justify-between border-b border-[#3d2448] pb-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[#e5c158]">
              <Sliders className="h-4 w-4" />
              <span>Prototype Test Controls</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="grid min-h-11 min-w-11 place-items-center rounded-full text-stone-400 transition hover:bg-[#25132f] hover:text-white"
              aria-label="Collapse prototype controls"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-stone-300">
            Switch account tiers to test limits, upgrade prompts, and Premium-only features.
          </p>

          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <button
              type="button"
              onClick={handleSelectFreeUnder}
              aria-pressed={userPlan === 'free' && currentBookCount < 50}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                userPlan === 'free' && currentBookCount < 50
                  ? 'border-emerald-500/50 bg-emerald-950/60 font-bold text-emerald-300'
                  : 'border-[#3d2448] bg-[#25132f] text-stone-300 hover:bg-[#321a3e]'
              }`}
            >
              <span>Free under limit</span>
              <span className="shrink-0 text-[10px] opacity-75">38 books</span>
            </button>

            <button
              type="button"
              onClick={handleSelectFreeLimit}
              aria-pressed={userPlan === 'free' && currentBookCount >= 50}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                userPlan === 'free' && currentBookCount >= 50
                  ? 'border-amber-500/50 bg-amber-950/60 font-bold text-amber-300'
                  : 'border-[#3d2448] bg-[#25132f] text-stone-300 hover:bg-[#321a3e]'
              }`}
            >
              <span>Free at limit</span>
              <span className="shrink-0 text-[10px] opacity-75">50 / 50</span>
            </button>

            <button
              type="button"
              onClick={handleSelectPremium}
              aria-pressed={userPlan === 'premium'}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                userPlan === 'premium'
                  ? 'border-[#c5a059] bg-[#c5a059]/20 font-bold text-[#e5c158]'
                  : 'border-[#3d2448] bg-[#25132f] text-stone-300 hover:bg-[#321a3e]'
              }`}
            >
              <span>Premium unlimited</span>
              <Sparkles className="h-4 w-4 shrink-0 text-[#e5c158]" />
            </button>
          </div>

          <div className="border-t border-[#3d2448] pt-3">
            <button
              type="button"
              onClick={() => openUpgradeModal('Previewing the Inkbound Premium upgrade screen')}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#c5a059]/30 bg-[#25132f] px-4 text-xs font-bold text-[#e5c158] transition hover:bg-[#321a3e] sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              Preview Upgrade Screen
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[#c5a059]/40 bg-[#120817] px-4 text-xs font-semibold text-[#f4efe6] shadow-inner transition hover:bg-[#25132f]"
          aria-expanded={isOpen}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Sliders className="h-4 w-4 shrink-0 text-[#e5c158]" />
            <span>Test account tier</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-bold uppercase text-[#e5c158]">{userPlan}</span>
            <span className="rounded-full border border-[#3d2448] bg-[#1c0f24] px-2 py-0.5 text-[10px] text-stone-300">
              {userPlan === 'premium' ? 'Unlimited' : `${currentBookCount}/50`}
            </span>
            <ChevronUp className="h-4 w-4 text-stone-400" />
          </span>
        </button>
      )}
    </div>
  );
};
