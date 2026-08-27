import React, { useMemo } from 'react';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Eye, Sparkles } from 'lucide-react';
import { UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { localDateKey } from '../features/reading/sessionAnalytics';

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
const BOOKS_PER_SHELF = 8;
const MINIMUM_SHELF_ROWS = 3;

const themeClasses: Record<ShelfTheme, string> = {
  'quiet-library': 'from-stone-950 via-[#302923] to-[#171411]',
  'cozy-evening': 'from-[#3a241c] via-[#5a3929] to-[#211713]',
  'midnight-study': 'from-[#171825] via-[#26283a] to-[#101119]',
};

function validLocalDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function parseFinishedDate(value?: string): Date | null {
  const raw = value?.trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  if (isoMatch) {
    return validLocalDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|[T\s])/);
  if (slashMatch) {
    return validLocalDate(Number(slashMatch[3]), Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function canonicalDateKey(value?: string): string | null {
  const date = parseFinishedDate(value);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthKey(value?: string): string | null {
  return canonicalDateKey(value)?.slice(0, 7) ?? null;
}

function monthLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'Reading Shelf';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return 'Reading Shelf';
  return new Date(year, month - 1, 1, 12, 0, 0, 0).toLocaleDateString(undefined, {
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
        .filter((book) => book.status === 'finished' && canonicalDateKey(book.dateFinished))
        .sort((a, b) => (canonicalDateKey(a.dateFinished) ?? '').localeCompare(canonicalDateKey(b.dateFinished) ?? '')),
    [books],
  );

  const availableMonths = useMemo(() => {
    const months = Array.from(
      new Set(
        finishedBooks
          .map((book) => monthKey(book.dateFinished))
          .filter((month): month is string => Boolean(month)),
      ),
    ).sort();
    const currentMonth = localDateKey().slice(0, 7);
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
  const selectedIndex = Math.max(0, availableMonths.indexOf(selectedMonth));
  const selectedMonthEnd = `${selectedMonth}-31`;
  const shelfBooks = finishedBooks.filter((book) => {
    const dateKey = canonicalDateKey(book.dateFinished);
    return Boolean(dateKey && dateKey <= selectedMonthEnd);
  });
  const booksFinishedThisMonth = finishedBooks.filter((book) => monthKey(book.dateFinished) === selectedMonth);
  const shelfRowCount = Math.max(MINIMUM_SHELF_ROWS, Math.ceil(shelfBooks.length / BOOKS_PER_SHELF));
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
      <header className="inkbound-panel overflow-hidden rounded-3xl p-5 sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <span className="inkbound-eyebrow">A living record of your reading year</span>
            <h2 className="mt-2 font-serif text-3xl text-[var(--ink-ivory)] sm:text-4xl">Bookshelf Through Time</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
              Move through the months and watch every finished book settle onto your shelf in the order it became part of your reading life.
            </p>
          </div>
          <div className="flex min-w-0 w-full items-center gap-2 xl:w-auto">
            <button type="button" onClick={() => moveMonth(-1)} disabled={selectedIndex <= 0} className="quiet-shelf-icon-button shrink-0 disabled:opacity-30" aria-label="Previous month"><ChevronLeft /></button>
            <div className="min-w-0 flex-1 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 py-2 text-center xl:min-w-48 xl:flex-none xl:px-4">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--ink-muted)] sm:text-xs">Shelf snapshot</span>
              <strong className="block truncate font-serif text-base text-[var(--ink-ivory)] sm:text-lg">{monthLabel(selectedMonth)}</strong>
            </div>
            <button type="button" onClick={() => moveMonth(1)} disabled={selectedIndex >= availableMonths.length - 1} className="quiet-shelf-icon-button shrink-0 disabled:opacity-30" aria-label="Next month"><ChevronRight /></button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className={`relative min-h-[560px] min-w-0 overflow-hidden rounded-3xl bg-gradient-to-br ${themeClasses[preferences.theme]} p-4 shadow-2xl sm:p-8`}>
          <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,.13), transparent 42%)' }} />
          <div className="relative z-10 flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="block truncate text-xs uppercase tracking-[0.24em] text-white/60">{monthLabel(selectedMonth)}</span>
              <h3 className="mt-1 font-serif text-2xl text-white sm:text-3xl">Your Reading Shelf</h3>
            </div>
            <Sparkles className="h-6 w-6 shrink-0 text-white/60" />
          </div>

          <div className="relative z-10 mt-8 space-y-8">
            {Array.from({ length: shelfRowCount }, (_, shelfIndex) => {
              const shelfSlice = shelfBooks.slice(shelfIndex * BOOKS_PER_SHELF, shelfIndex * BOOKS_PER_SHELF + BOOKS_PER_SHELF);
              return (
                <div key={shelfIndex} className="min-w-0">
                  <div className="overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-1 sm:px-2">
                    <div className="flex min-h-32 min-w-max items-end gap-2 sm:gap-3">
                      {shelfSlice.map((book, index) => {
                        const isNewThisMonth = monthKey(book.dateFinished) === selectedMonth;
                        const height = 82 + ((book.work.title.length + index * 11) % 38);
                        const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
                        const coverUrl = edition?.coverUrl;
                        const fallbackGradient = edition?.coverGradient ?? 'from-[#76586d] to-[#30242d]';

                        return (
                          <button
                            key={book.id}
                            type="button"
                            onClick={() => onSelectBook(book)}
                            title={`${book.work.title} by ${book.work.author}`}
                            aria-label={`Open ${book.work.title} by ${book.work.author}`}
                            className="group relative flex shrink-0 items-end transition-transform hover:-translate-y-2"
                            style={{ height, width: 58 }}
                          >
                            <span
                              className={`relative z-20 flex h-full w-4 shrink-0 items-center justify-center overflow-hidden rounded-l-sm border border-white/15 bg-gradient-to-b ${fallbackGradient} shadow-lg`}
                              style={{
                                backgroundImage: coverUrl
                                  ? `linear-gradient(rgba(0,0,0,.28), rgba(0,0,0,.5)), url("${coverUrl}")`
                                  : undefined,
                                backgroundSize: coverUrl ? 'auto 100%' : undefined,
                                backgroundPosition: coverUrl ? 'left center' : undefined,
                              }}
                              aria-hidden="true"
                            >
                              <span className="line-clamp-3 -rotate-90 whitespace-nowrap text-[7px] font-semibold tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.9)]">
                                {book.work.title}
                              </span>
                            </span>

                            <span
                              className={`relative z-10 -ml-px block overflow-hidden rounded-r-sm border border-white/15 bg-gradient-to-b ${fallbackGradient} shadow-[5px_7px_14px_rgba(0,0,0,.42)] transition-transform duration-200 group-hover:translate-x-1 group-hover:-rotate-1`}
                              style={{ height: Math.max(64, height - 4), width: 42 }}
                            >
                              {coverUrl ? (
                                <img
                                  src={coverUrl}
                                  alt={`Cover of ${book.work.title}`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="flex h-full w-full flex-col items-center justify-center px-1 text-center">
                                  <span className="line-clamp-3 font-serif text-[7px] font-semibold leading-tight text-white">{book.work.title}</span>
                                  <span className="mt-1 line-clamp-2 text-[6px] text-white/65">{book.work.author}</span>
                                </span>
                              )}
                              <span className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/20" />
                            </span>

                            {preferences.showRatings && book.rating && (
                              <span className="absolute -bottom-1 right-0 z-30 rounded bg-black/70 px-1 text-[8px] font-bold text-amber-200 shadow">★ {book.rating}</span>
                            )}
                            {isNewThisMonth && <span className="absolute -top-2 right-0 z-30 h-3 w-3 rounded-full border-2 border-white/70 bg-[var(--ink-gold-bright)]" />}
                          </button>
                        );
                      })}
                      {shelfSlice.length === 0 && (
                        <div className="flex h-24 w-[min(72vw,360px)] items-center justify-center rounded-2xl border border-dashed border-white/15 px-4 text-center text-sm text-white/35">Room for future stories</div>
                      )}
                      {shelfIndex === 0 && shelfSlice.length > 0 && <div className="ml-auto hidden h-20 w-16 shrink-0 rounded-t-full bg-emerald-950/60 sm:block" aria-hidden="true" />}
                    </div>
                  </div>
                  <div className="h-4 rounded-sm border-t border-white/15 bg-[#6a4430] shadow-[0_10px_18px_rgba(0,0,0,.45)]" />
                </div>
              );
            })}
          </div>

          {preferences.showStats && (
            <div className="relative z-10 mt-8 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-center backdrop-blur-sm min-[430px]:grid-cols-3">
              <div><strong className="block font-serif text-2xl text-white">{shelfBooks.length}</strong><span className="text-xs text-white/55">Books on shelf</span></div>
              <div><strong className="block font-serif text-2xl text-white">{booksFinishedThisMonth.length}</strong><span className="text-xs text-white/55">Added this month</span></div>
              <div><strong className="block font-serif text-2xl text-white">{totalPages.toLocaleString()}</strong><span className="text-xs text-white/55">Pages represented</span></div>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
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
            <label className="mt-4 flex min-h-11 items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex min-w-0 items-center gap-2"><Eye className="h-4 w-4 shrink-0" />Show ratings on spines</span><input type="checkbox" checked={preferences.showRatings} onChange={(event) => updatePreference('showRatings', event.target.checked)} /></label>
            <label className="mt-4 flex min-h-11 items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex min-w-0 items-center gap-2"><BookOpen className="h-4 w-4 shrink-0" />Show shelf statistics</span><input type="checkbox" checked={preferences.showStats} onChange={(event) => updatePreference('showStats', event.target.checked)} /></label>
          </section>

          <section className="inkbound-panel rounded-3xl p-5">
            <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 shrink-0 text-[var(--ink-gold)]" /><div className="min-w-0"><strong className="block text-sm text-[var(--ink-ivory)]">Monthly growth</strong><span className="text-xs text-[var(--ink-muted)]">New books are marked on the shelf.</span></div></div>
          </section>
        </aside>
      </div>
    </section>
  );
};
