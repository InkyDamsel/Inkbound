import React, { useState } from 'react';
import {
  BookOpen,
  Check,
  Crown,
  Download,
  FileSpreadsheet,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useUserPlan } from '../context/UserPlanContext';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';
import type { ReadingSession, UserBookRecord } from '../types';

interface SettingsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  isDarkMode: boolean;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  onResetData: () => void;
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  books,
  sessions,
  isDarkMode,
  setIsDarkMode,
  onResetData,
}) => {
  const { userPlan, freeBookLimit, openUpgradeModal } = useUserPlan();
  const [annualGoal, setAnnualGoal] = usePersistentState('inkbound_annual_goal', '25');
  const [dailyGoalMins, setDailyGoalMins] = usePersistentState('inkbound_daily_goal_minutes', '30');
  const [exported, setExported] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');

  const markExported = () => {
    setExported(true);
    window.setTimeout(() => setExported(false), 3000);
  };

  const handleExportJSON = () => {
    const data = {
      schemaVersion: 1,
      app: 'Inkbound',
      exportDate: new Date().toISOString(),
      preferences: {
        annualGoal,
        dailyGoalMins,
        theme: isDarkMode ? 'dark' : 'light',
      },
      books,
      sessions,
    };

    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
      `inkbound-library-backup-${new Date().toISOString().split('T')[0]}.json`,
    );
    markExported();
  };

  const handleExportCSV = () => {
    const headers = [
      'Title',
      'Subtitle',
      'Author',
      'Series',
      'Series Number',
      'Status',
      'Ownership',
      'Rating',
      'Format',
      'ISBN',
      'Page Count',
      'Pages Read',
      'Date Added',
      'Date Started',
      'Date Finished',
      'Tags',
      'Collections',
    ];

    const rows = books.map((book) => {
      const activeEdition =
        book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

      return [
        book.work.title,
        book.work.subtitle,
        book.work.author,
        book.work.seriesName,
        book.work.seriesOrder,
        book.status,
        book.ownership,
        book.rating,
        activeEdition?.format,
        activeEdition?.isbn13 ?? activeEdition?.isbn10 ?? activeEdition?.isbn,
        activeEdition?.pageCount,
        book.progressPages,
        book.dateAdded,
        book.dateStarted,
        book.dateFinished,
        book.privateTags.join(' | '),
        book.collections.join(' | '),
      ].map(csvCell);
    });

    const csvContent = `\uFEFF${[headers.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\n')}`;
    downloadBlob(
      new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
      `inkbound-library-${new Date().toISOString().split('T')[0]}.csv`,
    );
    markExported();
  };

  const confirmReset = () => {
    if (resetConfirmation.trim().toUpperCase() !== 'CLEAR') return;
    onResetData();
    setResetConfirmation('');
    setResetDialogOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <header>
        <p className="inkbound-kicker">Preferences & data</p>
        <h1 className="mt-2 font-serif text-4xl text-[var(--ink-ivory)]">Settings</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          Shape your reading experience, protect your records, and keep a portable copy of your library.
        </p>
      </header>

      <section className="inkbound-panel space-y-5 rounded-3xl p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--ink-border-subtle)] pb-5 sm:flex-row sm:items-center">
          <div>
            <p className="inkbound-eyebrow">Account access</p>
            <h2 className="mt-2 flex items-center gap-2 font-serif text-2xl text-[var(--ink-ivory)]">
              {userPlan === 'premium' ? (
                <><Crown className="h-5 w-5 text-[var(--ink-gold)]" /> Inkbound Premium</>
              ) : (
                <><BookOpen className="h-5 w-5 text-[var(--ink-muted)]" /> Inkbound Free</>
              )}
            </h2>
          </div>
          {userPlan === 'free' ? (
            <button
              type="button"
              onClick={() => openUpgradeModal('Upgrade to Premium for unlimited books, imports, batch editing, and detailed insights.')}
              className="quiet-shelf-primary-action justify-center"
            >
              <Sparkles className="h-4 w-4" /> View Premium
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/10 px-4 py-2 text-xs font-bold text-[var(--ink-gold)]">
              <Check className="h-4 w-4" /> Active access
            </span>
          )}
        </div>

        <ResponsiveGrid minItemWidth={240} maxColumns={2} gap={16}>
          <article className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Library capacity</span>
            <p className="mt-2 font-semibold text-[var(--ink-ivory)]">
              {userPlan === 'premium'
                ? 'Unlimited books and imports'
                : `${books.length} of ${freeBookLimit} books used`}
            </p>
            {userPlan === 'free' && (
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {Math.max(0, freeBookLimit - books.length)} spaces remaining
              </p>
            )}
          </article>
          <article className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Data ownership</span>
            <p className="mt-2 font-semibold text-[var(--ink-ivory)]">Export at any time</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Your books, notes, sessions, and memories remain yours.</p>
          </article>
        </ResponsiveGrid>
      </section>

      <section className="inkbound-panel rounded-3xl p-6">
        <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Appearance</h2>
        <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold text-[var(--ink-ivory)]">Color theme</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Your choice is saved automatically on this device.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsDarkMode((current) => !current)}
            className="quiet-shelf-secondary-action justify-center"
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {isDarkMode ? 'Use light mode' : 'Use dark mode'}
          </button>
        </div>
      </section>

      <section className="inkbound-panel rounded-3xl p-6">
        <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Reading goals</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">Changes save automatically.</p>
        <ResponsiveGrid minItemWidth={240} maxColumns={2} gap={16} className="mt-5">
          <label className="text-sm font-semibold text-[var(--ink-ivory)]">
            Annual book goal
            <input
              type="number"
              min="1"
              max="10000"
              value={annualGoal}
              onChange={(event) => setAnnualGoal(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none"
            />
          </label>
          <label className="text-sm font-semibold text-[var(--ink-ivory)]">
            Daily reading target in minutes
            <input
              type="number"
              min="1"
              max="1440"
              value={dailyGoalMins}
              onChange={(event) => setDailyGoalMins(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none"
            />
          </label>
        </ResponsiveGrid>
      </section>

      <section className="inkbound-panel rounded-3xl p-6">
        <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Export your data</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          JSON preserves the complete Inkbound record. CSV creates a spreadsheet-friendly library using each book’s active edition.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={handleExportJSON} className="quiet-shelf-primary-action justify-center">
            <Download className="h-4 w-4" /> Complete JSON backup
          </button>
          <button type="button" onClick={handleExportCSV} className="quiet-shelf-secondary-action justify-center">
            <FileSpreadsheet className="h-4 w-4" /> Library CSV
          </button>
          {exported && (
            <span className="inline-flex items-center gap-2 px-2 text-sm font-semibold text-emerald-400">
              <Check className="h-4 w-4" /> Export ready
            </span>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-[#c97b7b]/30 bg-[#c97b7b]/5 p-6">
        <h2 className="font-serif text-2xl text-[#e9b2b2]">Clear local library data</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          This removes books and reading sessions stored on this device. Cloud records are not changed unless you later sync the empty device library.
        </p>
        <button
          type="button"
          onClick={() => setResetDialogOpen(true)}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c97b7b]/40 px-4 text-sm font-bold text-[#e9b2b2] hover:bg-[#c97b7b]/10"
        >
          <RotateCcw className="h-4 w-4" /> Clear local data
        </button>
      </section>

      {resetDialogOpen && (
        <div className="fixed inset-0 z-[250] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setResetDialogOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-data-title"
            className="relative w-full max-w-lg rounded-3xl border border-[#c97b7b]/35 bg-[#17101b] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => setResetDialogOpen(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-[var(--ink-muted)]" aria-label="Close confirmation">
              <X className="h-5 w-5" />
            </button>
            <h3 id="clear-data-title" className="pr-12 font-serif text-3xl text-[var(--ink-ivory)]">Clear this device?</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
              Export a backup first. To confirm permanent removal from this device, type <strong className="text-[var(--ink-ivory)]">CLEAR</strong> below.
            </p>
            <input
              value={resetConfirmation}
              onChange={(event) => setResetConfirmation(event.target.value)}
              autoFocus
              placeholder="Type CLEAR"
              className="mt-5 min-h-12 w-full rounded-xl border border-[#c97b7b]/35 bg-[#0d0910] px-4 text-[var(--ink-ivory)] outline-none"
            />
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setResetDialogOpen(false)} className="quiet-shelf-secondary-action justify-center">Cancel</button>
              <button
                type="button"
                onClick={confirmReset}
                disabled={resetConfirmation.trim().toUpperCase() !== 'CLEAR'}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a65050] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear this device
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
