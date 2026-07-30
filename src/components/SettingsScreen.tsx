import React, { useState } from 'react';
import { UserBookRecord, ReadingSession } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { DevPlanSwitcher } from './DevPlanSwitcher';
import {
  Settings,
  Moon,
  Sun,
  Download,
  RotateCcw,
  BookOpen,
  Award,
  Lock,
  Check,
  FileSpreadsheet,
  Sparkles,
  CreditCard,
  Crown
} from 'lucide-react';

interface SettingsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  isDarkMode: boolean;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  onResetData: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  books,
  sessions,
  isDarkMode,
  setIsDarkMode,
  onResetData,
}) => {
  const { userPlan, freeBookLimit, openUpgradeModal } = useUserPlan();
  const [annualGoal, setAnnualGoal] = useState('25');
  const [dailyGoalMins, setDailyGoalMins] = useState('30');
  const [defaultFormat, setDefaultFormat] = useState('hardcover');
  const [exported, setExported] = useState(false);


  // Export JSON function
  const handleExportJSON = () => {
    const data = {
      app: 'Reading App',
      exportDate: new Date().toISOString(),
      books,
      sessions,
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reading_app_library_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  // Export CSV function
  const handleExportCSV = () => {
    const headers = ['Title', 'Author', 'Status', 'Rating', 'Format', 'PagesRead', 'DateAdded'];
    const rows = books.map((b) => [
      `"${b.work.title.replace(/"/g, '""')}"`,
      `"${b.work.author.replace(/"/g, '""')}"`,
      b.status,
      b.rating || '',
      b.editions[0]?.format || 'hardcover',
      b.progressPages,
      b.dateAdded,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reading_app_library_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="space-y-6 pb-20 max-w-4xl mx-auto">
      {/* Title */}
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-[#e5c158] bg-[#c5a059]/15 border border-[#c5a059]/30 px-2.5 py-1 rounded">
          Preferences & Controls
        </span>
        <h1 className="text-3xl font-serif font-bold text-[#f4efe6] mt-1">
          Settings & Data Backup
        </h1>
        <p className="text-sm text-stone-400">
          Customize your reading journal environment and export complete library records
        </p>
      </div>

      {/* Section 0: Subscription Tier & Plan */}
      <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#3d2448] pb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#e5c158] bg-[#c5a059]/15 border border-[#c5a059]/30 px-2.5 py-1 rounded">
              Account Subscription Tier
            </span>
            <h2 className="text-xl font-serif font-bold text-[#f4efe6] mt-1 flex items-center gap-2">
              {userPlan === 'premium' ? (
                <>
                  <Crown className="w-5 h-5 text-[#e5c158]" />
                  <span>Premium Tier (Unlimited Library)</span>
                </>
              ) : (
                <>
                  <BookOpen className="w-5 h-5 text-stone-400" />
                  <span>Free Tier</span>
                </>
              )}
            </h2>
          </div>

          <div>
            {userPlan === 'free' ? (
              <button
                onClick={() => openUpgradeModal('Upgrade to Premium for unlimited library books, batch editing, and detailed reading habit analytics.')}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] hover:opacity-95 font-bold text-xs shadow-md transition flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-[#120817]" /> Upgrade to Premium
              </button>
            ) : (
              <span className="text-xs font-bold text-[#e5c158] bg-[#c5a059]/20 border border-[#c5a059]/40 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                <Check className="w-4 h-4 text-[#e5c158]" /> Active Subscription — Pricing subject to change
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 bg-[#25132f] rounded-xl border border-[#3d2448] space-y-1">
            <span className="text-stone-400 font-bold block">Library Book Count Limit</span>
            <p className="font-semibold text-[#f4efe6]">
              {userPlan === 'free' ? (
                <span>
                  {books.length} of {freeBookLimit} books used ({Math.max(0, freeBookLimit - books.length)} slots left)
                </span>
              ) : (
                <span className="text-emerald-400 font-bold">Unlimited Books Allowed</span>
              )}
            </p>
          </div>

          <div className="p-3 bg-[#25132f] rounded-xl border border-[#3d2448] space-y-1">
            <span className="text-stone-400 font-bold block">Feature Access Level</span>
            <p className="font-semibold text-[#f4efe6]">
              {userPlan === 'free' ? 'Standard Library + Basic Analytics' : 'Batch Edits + Unlimited Import + Deep Habit Reports'}
            </p>
          </div>
        </div>

        {/* Prototype Switcher Tool */}
        <div className="pt-2 border-t border-[#3d2448]">
          <p className="text-[11px] font-bold text-[#e5c158] uppercase tracking-wider mb-2">
            Prototype Testing Bar: Toggle Account Tiers & Simulate Limits
          </p>
          <DevPlanSwitcher currentBookCount={books.length} />
        </div>
      </div>

      {/* Section 1: Appearance */}
      <div className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
          Appearance & Themes
        </h2>

        <div className="flex items-center justify-between pt-2">
          <div>
            <p className="text-xs font-bold text-[#f4efe6]">Color Palette Theme</p>
            <p className="text-[11px] text-stone-400">Deep Plum & Aubergine Journal Theme</p>
          </div>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold transition shadow-sm"
          >
            <Sun className="w-4 h-4 text-[#120817]" />
            <span>Dark Mode Active</span>
          </button>
        </div>
      </div>

      {/* Section 2: Reading Targets */}
      <div className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
          Reading Targets & Goals
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-bold text-[#f4efe6] block mb-1">
              Annual Reading Goal (Books)
            </label>
            <input
              type="number"
              value={annualGoal}
              onChange={(e) => setAnnualGoal(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
            />
          </div>

          <div>
            <label className="font-bold text-[#f4efe6] block mb-1">
              Daily Focus Target (Minutes)
            </label>
            <input
              type="number"
              value={dailyGoalMins}
              onChange={(e) => setDailyGoalMins(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
            />
          </div>
        </div>
      </div>

      {/* Section 3: Data Export */}
      <div className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
          Full Data Export & Ownership
        </h2>
        <p className="text-xs text-stone-400">
          Your reading catalog belongs exclusively to you. Export your entire library, ratings, notes, quotes, and session logs at any time.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportJSON}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold shadow-md hover:opacity-95 transition"
          >
            <Download className="w-4 h-4 text-[#120817]" />
            <span>Export Complete JSON Backup</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#25132f] border border-[#c5a059]/30 text-[#f4efe6] text-xs font-bold shadow-md hover:bg-[#321a3e] transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#e5c158]" />
            <span>Export Library CSV Spreadsheet</span>
          </button>

          {exported && (
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
              <Check className="w-4 h-4" /> Exported successfully!
            </span>
          )}
        </div>
      </div>

      {/* Section 4: Sample Data Reset */}
      <div className="bg-[#1c0f24] border border-rose-900/40 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-xl font-serif font-bold text-rose-300">
          Reset Prototype Sample Data
        </h2>
        <p className="text-xs text-stone-400">
          Revert catalog changes and reset the prototype to initial sample books and reading sessions.
        </p>

        <button
          onClick={onResetData}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-900/80 hover:bg-rose-900 text-rose-100 text-xs font-bold transition border border-rose-700/50"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset Sample Books & Sessions</span>
        </button>
      </div>
    </div>
  );
};
