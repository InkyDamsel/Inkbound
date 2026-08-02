import React, { useState } from 'react';
import { UserBookRecord, ReadingSession } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { DevPlanSwitcher } from './DevPlanSwitcher';
import { ResponsiveGrid } from '../layout/responsive';
import {
  Sun,
  Download,
  RotateCcw,
  BookOpen,
  Check,
  FileSpreadsheet,
  Sparkles,
  Crown,
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
  const [exported, setExported] = useState(false);

  const handleExportJSON = () => {
    const data = {
      app: 'Inkbound',
      exportDate: new Date().toISOString(),
      books,
      sessions,
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inkbound_library_backup_${new Date().toISOString().split('T')[0]}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 3000);
  };

  const handleExportCSV = () => {
    const headers = ['Title', 'Author', 'Status', 'Rating', 'Format', 'PagesRead', 'DateAdded'];
    const rows = books.map((book) => [
      `"${book.work.title.replace(/"/g, '""')}"`,
      `"${book.work.author.replace(/"/g, '""')}"`,
      book.status,
      book.rating || '',
      book.editions[0]?.format || 'hardcover',
      book.progressPages,
      book.dateAdded,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inkbound_library_${new Date().toISOString().split('T')[0]}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <div>
        <span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
          Preferences & Controls
        </span>
        <h1 className="mt-1 font-serif text-3xl font-bold text-[#f4efe6]">
          Settings & Data Backup
        </h1>
        <p className="text-sm text-stone-400">
          Customize your Inkbound reading journal and export your complete library records.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-[#c5a059]/40 bg-[#1c0f24] p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-3 border-b border-[#3d2448] pb-4 sm:flex-row sm:items-center">
          <div>
            <span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
              Account Subscription Tier
            </span>
            <h2 className="mt-1 flex items-center gap-2 font-serif text-xl font-bold text-[#f4efe6]">
              {userPlan === 'premium' ? (
                <>
                  <Crown className="h-5 w-5 text-[#e5c158]" />
                  <span>Premium Tier — Unlimited Library</span>
                </>
              ) : (
                <>
                  <BookOpen className="h-5 w-5 text-stone-400" />
                  <span>Free Tier</span>
                </>
              )}
            </h2>
          </div>

          {userPlan === 'free' ? (
            <button
              type="button"
              onClick={() =>
                openUpgradeModal(
                  'Upgrade to Premium for unlimited library books, batch editing, and detailed reading analytics.',
                )
              }
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-5 py-2.5 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"
            >
              <Sparkles className="h-4 w-4" /> Upgrade to Premium
            </button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-xl border border-[#c5a059]/40 bg-[#c5a059]/20 px-3 py-1.5 text-xs font-bold text-[#e5c158]">
              <Check className="h-4 w-4" /> Active Subscription
            </span>
          )}
        </div>

        <ResponsiveGrid minItemWidth={240} maxColumns={2} gap={16}>
          <div className="space-y-1 rounded-xl border border-[#3d2448] bg-[#25132f] p-3 text-xs">
            <span className="block font-bold text-stone-400">Library Book Count Limit</span>
            <p className="font-semibold text-[#f4efe6]">
              {userPlan === 'free' ? (
                <span>
                  {books.length} of {freeBookLimit} books used ({Math.max(0, freeBookLimit - books.length)} slots left)
                </span>
              ) : (
                <span className="font-bold text-emerald-400">Unlimited Books Allowed</span>
              )}
            </p>
          </div>

          <div className="space-y-1 rounded-xl border border-[#3d2448] bg-[#25132f] p-3 text-xs">
            <span className="block font-bold text-stone-400">Feature Access Level</span>
            <p className="font-semibold text-[#f4efe6]">
              {userPlan === 'free'
                ? 'Standard Library + Basic Analytics'
                : 'Batch Edits + Unlimited Import + Deep Habit Reports'}
            </p>
          </div>
        </ResponsiveGrid>

        <div className="border-t border-[#3d2448] pt-2">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#e5c158]">
            Prototype Testing Bar: Toggle Account Tiers & Simulate Limits
          </p>
          <DevPlanSwitcher currentBookCount={books.length} />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#c5a059]/20 bg-[#1c0f24] p-6 shadow-xl">
        <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Appearance & Themes</h2>
        <div className="flex flex-col justify-between gap-4 pt-2 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold text-[#f4efe6]">Color Palette Theme</p>
            <p className="text-[11px] text-stone-400">Quiet library evening palette</p>
          </div>
          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-4 py-2 text-xs font-bold text-[#120817] shadow-sm transition"
          >
            <Sun className="h-4 w-4" />
            <span>{isDarkMode ? 'Dark Mode Active' : 'Enable Dark Mode'}</span>
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#c5a059]/20 bg-[#1c0f24] p-6 shadow-xl">
        <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Reading Targets & Goals</h2>
        <ResponsiveGrid minItemWidth={240} maxColumns={2} gap={16}>
          <label className="text-xs font-bold text-[#f4efe6]">
            Annual Reading Goal (Books)
            <input
              type="number"
              min="1"
              value={annualGoal}
              onChange={(event) => setAnnualGoal(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
            />
          </label>

          <label className="text-xs font-bold text-[#f4efe6]">
            Daily Focus Target (Minutes)
            <input
              type="number"
              min="1"
              value={dailyGoalMins}
              onChange={(event) => setDailyGoalMins(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
            />
          </label>
        </ResponsiveGrid>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#c5a059]/20 bg-[#1c0f24] p-6 shadow-xl">
        <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Full Data Export & Ownership</h2>
        <p className="text-xs text-stone-400">
          Your reading catalog belongs to you. Export your library, ratings, notes, quotes, and session logs at any time.
        </p>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={handleExportJSON}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-5 py-2.5 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"
          >
            <Download className="h-4 w-4" />
            <span>Export Complete JSON Backup</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center justify-center gap-2 rounded-xl border border-[#c5a059]/30 bg-[#25132f] px-5 py-2.5 text-xs font-bold text-[#f4efe6] shadow-md transition hover:bg-[#321a3e]"
          >
            <FileSpreadsheet className="h-4 w-4 text-[#e5c158]" />
            <span>Export Library CSV Spreadsheet</span>
          </button>

          {exported && (
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
              <Check className="h-4 w-4" /> Exported successfully!
            </span>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-rose-900/40 bg-[#1c0f24] p-6 shadow-xl">
        <h2 className="font-serif text-xl font-bold text-rose-300">Reset Prototype Sample Data</h2>
        <p className="text-xs text-stone-400">
          Revert catalog changes and restore the original sample books and reading sessions.
        </p>
        <button
          type="button"
          onClick={onResetData}
          className="flex items-center justify-center gap-2 rounded-xl border border-rose-700/50 bg-rose-900/80 px-4 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-900 sm:w-fit"
        >
          <RotateCcw className="h-4 w-4" />
          <span>Reset Sample Books & Sessions</span>
        </button>
      </section>
    </div>
  );
};
