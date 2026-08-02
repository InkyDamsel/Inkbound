import React, { useMemo } from 'react';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Eye, Sparkles } from 'lucide-react';
import { UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

interface BookshelfThroughTimeScreenProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
}

type ShelfTheme = 'quiet-library' | 'cozy-evening' | 'midnight-study';

interface ShelfPreferences {
  month: string;
  theme: ShelfTheme;
  showRatings: boolean;
  showStats: boolean;
}

const PREFERENCES_KEY = 'inkbound_bookshelf_through_time_preferences';

const themeClasses: Record<ShelfTheme, string> = {
  'quiet-library': 'from-stone-950 via-[#302923] to-[#171411]',
  'cozy-evening': 'from-[#3a241c] via-[#5a3929] to-[#211713]',
  'midnight-study': 'from-[#171825] via-[#26283a] to-[#101119]',
};

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(value: string) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export const BookshelfThroughTimeScreen: React.FC<BookshelfThroughTimeScreenProps> = ({
  books,
  onSelectBook,
}) => {
  const finishedBooks = useMemo(
    () =>
      books
        .filter((book) => book.status === 'finished' && book.dateFinished)
        .sort((a, b) => String(a.dateFinished).localeCompare(String(b.dateFinished))),
    [books],
  );

  const availableMonths = useMemo(() => {
    const months = Array.from(new Set(finishedBooks.map((book) => monthKey(String(book.dateFinished))))).sort();
    const currentMonth = new Date().toISOString().slice(0, 7);
    return months.length > 0 ? months : [currentMonth];
  }, [finishedBooks]);

  const [preferences, setPreferences] = usePersistentState<ShelfPreferences>(PREFERENCES_KEY, {
    month: availableMonths[availableMonths.length - 1],
    theme: 'quiet-library',
    showRatings: true,
    showStats: true,
  });

  const selectedMonth = availableMonths.includes(preferences.month)
    ? preferences.month
    : availableMonths[availableMonths.length - 1];
  const selectedIndex = availableMonths.indexOf(selectedMonth);
  const shelfBooks = finishedBooks.filter((book) => String(book.dateFinished) <= `${selectedMonth}-31`);
  const booksFinishedThisMonth = finishedBooks.filter((book) => monthKey(String(book.dateFinished)) === selectedMonth);
  const totalPages = shelfBooks.reduce((sum, book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    return sum + (edition?.pageCount ?? 0);
  }, 0);

  const updatePreference = <K extends keyof ShelfPreferences>(key: K, value: ShelfPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const moveMonth = (direction: -1 | 1) => {
    const nextIndex = Math.min(availableMonths.length - 1, Math.max(0, selectedIndex + direction));
    updatePreference('month', availableMonths[nextIndex]);
  };

  return (
    <section className="space-y-6 pb-12">
      <header className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="inkbound-eyebrow">A living record of your reading year</span>
            <h2 className="mt-2 font-serif text-3xl text-[var(--ink-ivory)] sm:text-4xl">Bookshelf Through Time</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
              Move through the months and watch every finished book settle onto your shelf in the order it became part of your reading life.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => moveMonth(-1)} disabled={selectedIndex <= 0} className="quiet-shelf-icon-button disabled:opacity-30" aria-label="Previous month"><ChevronLeft /></button>
            <div className="min-w-48 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-2 text-center">
              <span className="block text-xs uppercase tracking-wider text-[var(--ink-muted)]">Shelf snapshot</span>
              <strong className="font-serif text-lg text-[var(--ink-ivory)]">{monthLabel(selectedMonth)}</strong>
            </div>
            <button type="button" onClick={() => moveMonth(1)} disabled={selectedIndex >= availableMonths.length - 1} className="quiet-shelf-icon-button disabled:opacity-30" aria-label="Next month"><ChevronRight /></button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className={`relative min-h-[560px] overflow-hidden rounded-3xl bg-gradient-to-br ${themeClasses[preferences.theme]} p-5 shadow-2xl sm:p-8`}>
          <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,.13), transparent 42%)' }} />
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-[0.24em] text-white/60">{monthLabel(selectedMonth)}</span>
              <h3 className="mt-1 font-serif text-3xl text-white">Your Reading Shelf</h3>
            </div>
            <Sparkles className="h-6 w-6 text-white/60" />
          </div>

          <div className="relative z-10 mt-8 space-y-8">
            {[0, 1, 2].map((shelfIndex) => {
              const shelfSlice = shelfBooks.slice(shelfIndex * 8, shelfIndex * 8 + 8);
              return (
                <div key={shelfIndex}>
                  <div className="flex min-h-32 items-end gap-2 overflow-hidden px-2 sm:gap-3">
                    {shelfSlice.map((book, index) => {
                      const isNewThisMonth = monthKey(String(book.dateFinished)) === selectedMonth;
                      const height = 82 + ((book.work.title.length + index * 11) % 38);
                      return (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => onSelectBook(book)}
                          title={`${book.work.title} by ${book.work.author}`}
                          className={`group relative flex w-9 shrink-0 items-center justify-center rounded-t-sm border border-white/10 px-1 pb-2 text-center shadow-lg transition-transform hover:-translate-y-2 sm:w-11 ${book.editions[0]?.coverGradient ? `bg-gradient-to-b ${book.editions[0].coverGradient}` : 'bg-gradient-to-b from-[#76586d] to-[#30242d]'}`}
                          style={{ height }}
                        >
                          <span className="line-clamp-3 -rotate-90 whitespace-nowrap text-[8px] font-semibold tracking-wide text-white/90 sm:text-[9px]">{book.work.title}</span>
                          {isNewThisMonth && <span className="absolute -top-2 right-0 h-3 w-3 rounded-full border-2 border-white/70 bg-[var(--ink-gold-bright)]" />}
                        </button>
                      );
                    })}
                    {shelfSlice.length === 0 && (
                      <div className="flex h-24 flex-1 items-center justify-center rounded-2xl border border-dashed border-white/15 text-sm text-white/35">Room for future stories</div>
                    )}
                    {shelfIndex === 0 && <div className="ml-auto hidden h-20 w-16 rounded-t-full bg-emerald-950/60 sm:block" aria-hidden="true" />}
                  </div>
                  <div className="h-4 rounded-sm border-t border-white/15 bg-[#6a4430] shadow-[0_10px_18px_rgba(0,0,0,.45)]" />
                </div>
              );
            })}
          </div>

          {preferences.showStats && (
            <div className="relative z-10 mt-8 grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-center backdrop-blur-sm">
              <div><strong className="block font-serif text-2xl text-white">{shelfBooks.length}</strong><span className="text-xs text-white/55">Books on shelf</span></div>
              <div><strong className="block font-serif text-2xl text-white">{booksFinishedThisMonth.length}</strong><span className="text-xs text-white/55">Added this month</span></div>
              <div><strong className="block font-serif text-2xl text-white">{totalPages.toLocaleString()}</strong><span className="text-xs text-white/55">Pages represented</span></div>
            </div>
          )}
        </div>

        <aside className="space-y-5">
          <section className="inkbound-panel rounded-3xl p-5">
            <span className="inkbound-eyebrow">Shelf appearance</span>
            <div className="mt-4 space-y-2">
              {([
                ['quiet-library', 'Quiet Library'],
                ['cozy-evening', 'Cozy Evening'],
                ['midnight-study', 'Midnight Study'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => updatePreference('theme', value)} className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${preferences.theme === value ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>
                  {label}{preferences.theme === value && <Sparkles className="h-4 w-4 text-[var(--ink-gold)]" />}
                </button>
              ))}
            </div>
          </section>

          <section className="inkbound-panel rounded-3xl p-5">
            <span className="inkbound-eyebrow">Display</span>
            <label className="mt-4 flex items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex items-center gap-2"><Eye className="h-4 w-4" />Show ratings later</span><input type="checkbox" checked={preferences.showRatings} onChange={(event) => updatePreference('showRatings', event.target.checked)} /></label>
            <label className="mt-4 flex items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4" />Show shelf statistics</span><input type="checkbox" checked={preferences.showStats} onChange={(event) => updatePreference('showStats', event.target.checked)} /></label>
          </section>

          <section className="inkbound-panel rounded-3xl p-5">
            <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-[var(--ink-gold)]" /><div><strong className="block text-sm text-[var(--ink-ivory)]">Monthly growth</strong><span className="text-xs text-[var(--ink-muted)]">New books are marked on the shelf.</span></div></div>
          </section>
        </aside>
      </div>
    </section>
  );
};
