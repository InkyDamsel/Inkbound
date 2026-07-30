import React, { useState } from 'react';
import { useUserPlan } from '../context/UserPlanContext';
import { Shield, Sparkles, Sliders, ChevronDown, ChevronUp } from 'lucide-react';

interface DevPlanSwitcherProps {
  currentBookCount: number;
  onSetTestBooksCount?: (count: number) => void;
}

export const DevPlanSwitcher: React.FC<DevPlanSwitcherProps> = ({ currentBookCount, onSetTestBooksCount }) => {
  const { userPlan, setUserPlan, openUpgradeModal } = useUserPlan();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelectFreeUnder = () => {
    setUserPlan('free');
    if (onSetTestBooksCount) {
      onSetTestBooksCount(38); // set 38 books (fewer than 50)
    }
  };

  const handleSelectFreeLimit = () => {
    setUserPlan('free');
    if (onSetTestBooksCount) {
      onSetTestBooksCount(50); // set exactly 50 books
    }
  };

  const handleSelectPremium = () => {
    setUserPlan('premium');
  };

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {isOpen ? (
        <div className="bg-[#1c0f24] text-[#f4efe6] border border-[#c5a059]/40 rounded-2xl p-3 shadow-2xl max-w-xs space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between border-b border-[#3d2448] pb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#e5c158]">
              <Sliders className="w-3.5 h-3.5" />
              <span>Prototype Test Controls</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-stone-400 hover:text-white text-xs p-1"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[11px] text-stone-300">
            Switch account tier to test limits, upgrade prompts, and features:
          </p>

          <div className="space-y-1.5 text-xs">
            <button
              onClick={handleSelectFreeUnder}
              className={`w-full text-left px-3 py-1.5 rounded-lg border transition flex items-center justify-between ${
                userPlan === 'free' && currentBookCount < 50
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold'
                  : 'bg-[#25132f] border-[#3d2448] text-stone-300 hover:bg-[#321a3e]'
              }`}
            >
              <span>1. Free (&lt; 50 Books)</span>
              <span className="text-[10px] opacity-75">38 books</span>
            </button>

            <button
              onClick={handleSelectFreeLimit}
              className={`w-full text-left px-3 py-1.5 rounded-lg border transition flex items-center justify-between ${
                userPlan === 'free' && currentBookCount >= 50
                  ? 'bg-amber-950/60 border-amber-500/50 text-amber-300 font-bold'
                  : 'bg-[#25132f] border-[#3d2448] text-stone-300 hover:bg-[#321a3e]'
              }`}
            >
              <span>2. Free (At 50-Book Limit)</span>
              <span className="text-[10px] opacity-75">50 / 50</span>
            </button>

            <button
              onClick={handleSelectPremium}
              className={`w-full text-left px-3 py-1.5 rounded-lg border transition flex items-center justify-between ${
                userPlan === 'premium'
                  ? 'bg-[#c5a059]/20 border-[#c5a059] text-[#e5c158] font-bold'
                  : 'bg-[#25132f] border-[#3d2448] text-stone-300 hover:bg-[#321a3e]'
              }`}
            >
              <span>3. Premium (Unlimited)</span>
              <Sparkles className="w-3 h-3 text-[#e5c158]" />
            </button>
          </div>

          <div className="pt-1 flex items-center justify-between text-[11px] border-t border-[#3d2448]">
            <button
              onClick={() => openUpgradeModal('Previewing Upgrade Screen')}
              className="text-[#e5c158] hover:underline font-semibold flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" /> Open Upgrade Screen
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-[#1c0f24] hover:bg-[#25132f] text-[#f4efe6] border border-[#c5a059]/40 shadow-xl px-3 py-2 rounded-full flex items-center gap-2 text-xs font-semibold transition group"
        >
          <Sliders className="w-3.5 h-3.5 text-[#e5c158]" />
          <span>Tier:</span>
          <span className="font-bold uppercase text-[#e5c158]">{userPlan}</span>
          <span className="text-[10px] text-stone-300 bg-[#120817] px-1.5 py-0.5 rounded-full border border-[#3d2448]">
            {userPlan === 'premium' ? 'Unlimited' : `${currentBookCount}/50`}
          </span>
          <ChevronUp className="w-3.5 h-3.5 text-stone-400 group-hover:text-white" />
        </button>
      )}
    </div>
  );
};
