import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, Lock, Search, Sparkles } from 'lucide-react';
import { UserBookRecord } from '../../types';
import { useUserPlan } from '../../context/UserPlanContext';
import { buildSeriesLibrary } from '../../features/series/seriesLibrary';
import { BookCover } from '../BookCover';

interface SeriesLibraryPanelProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
}

const activeEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

export const SeriesLibraryPanel: React.FC<SeriesLibraryPanelProps> = ({ books, onSelectBook }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [search, setSearch] = useState('');
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);
  const series = useMemo(() => buildSeriesLibrary(books), [books]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return series;
    return series.filter((item) =>
      item.name.toLowerCase().includes(query)
      || item.author.toLowerCase().includes(query)
      || item.books.some(({ book }) => book.work.title.toLowerCase().includes(query)),
    );
  }, [search, series]);

  if (series.length === 0) {
    return (
      <section className="inkbound-panel rounded-3xl p-6 text-center sm:p-10">
        <BookOpen className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
        <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No series found yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">
          Books with series information will collect here automatically. Manual series creation and corrections are coming next.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="inkbound-panel rounded-3xl p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inkbound-kicker">Series</p>
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Your reading worlds</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{series.length} series found in your library.</p>
          </div>
          <label className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search series or book"
              className="h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] pl-10 pr-4 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-gold)]/55"
            />
          </label>
        </div>
      </section>

      <div className="grid gap-4">
        {filtered.map((item) => {
          const expanded = expandedSeriesId === item.id;
          const nextUnread = item.books.find(({ book }) => book.status !== 'finished');
          const firstBook = item.books[0]?.book;
          return (
            <article key={item.id} className="inkbound-panel overflow-hidden rounded-3xl">
              <button
                type="button"
                onClick={() => setExpandedSeriesId(expanded ? null : item.id)}
                className="flex w-full flex-col gap-5 p-5 text-left sm:p-6 lg:flex-row lg:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  {firstBook ? (
                    <BookCover
                      work={firstBook.work}
                      edition={activeEdition(firstBook)}
                      size="sm"
                      showFormatBadge={false}
                      className="!h-16 !w-12 rounded-lg"
                    />
                  ) : (
                    <div className="grid h-16 w-12 shrink-0 place-items-center rounded-lg border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]">
                      <BookOpen className="h-5 w-5 text-[var(--ink-gold)]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate font-serif text-2xl text-[var(--ink-ivory)]">{item.name}</h3>
                    <p className="truncate text-sm text-[var(--ink-muted)]">{item.author}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]">
                      <span><strong className="text-[var(--ink-ivory)]">{item.finishedCount}</strong> of {item.books.length} finished</span>
                      {item.currentlyReadingCount > 0 && <span>{item.currentlyReadingCount} reading now</span>}
                      {nextUnread && <span>Next: {nextUnread.book.work.title}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex w-full items-center gap-4 lg:w-auto">
                  <div className="min-w-0 flex-1 lg:w-48 lg:flex-none">
                    <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]"><span>Series progress</span><span>{item.completionPercent}%</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${item.completionPercent}%` }} /></div>
                  </div>
                  <ChevronRight className={`h-5 w-5 shrink-0 text-[var(--ink-gold)] transition ${expanded ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {expanded && (
                <div className="border-t border-[var(--ink-border-subtle)] px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                  <div className="grid gap-3">
                    {item.books.map(({ book, displayPosition }) => (
                      <button
                        key={book.id}
                        type="button"
                        onClick={() => onSelectBook(book)}
                        className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-left transition hover:border-[var(--ink-gold)]/35"
                      >
                        <BookCover
                          work={book.work}
                          edition={activeEdition(book)}
                          size="sm"
                          showFormatBadge={false}
                          className="!h-16 !w-11 rounded-md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-gold)]">{displayPosition}</p>
                          <p className="truncate font-serif text-lg text-[var(--ink-ivory)]">{book.work.title}</p>
                          <p className="mt-1 text-xs capitalize text-[var(--ink-muted)]">{book.status.replaceAll('-', ' ')}{book.rating ? ` · ${book.rating}/5` : ''}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink-faint)]" />
                      </button>
                    ))}
                  </div>

                  <section className="mt-5 rounded-2xl border border-[var(--ink-gold)]/20 bg-[var(--ink-gold)]/5 p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      {userPlan === 'premium' ? <Sparkles className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-gold)]" /> : <Lock className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-serif text-xl text-[var(--ink-ivory)]">Series Insights</h4>
                        {userPlan === 'premium' ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl bg-black/15 p-3"><span className="text-xs text-[var(--ink-muted)]">Average rating</span><strong className="mt-1 block text-[var(--ink-ivory)]">{item.averageRating ? item.averageRating.toFixed(1) : 'Not rated'}</strong></div>
                            <div className="rounded-xl bg-black/15 p-3"><span className="text-xs text-[var(--ink-muted)]">Unread in library</span><strong className="mt-1 block text-[var(--ink-ivory)]">{item.books.length - item.finishedCount}</strong></div>
                            <div className="rounded-xl bg-black/15 p-3"><span className="text-xs text-[var(--ink-muted)]">Completion</span><strong className="mt-1 block text-[var(--ink-ivory)]">{item.completionPercent}%</strong></div>
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">Premium adds deeper series reading time, ratings, pace, timelines, favorite installments, and more.</p>
                            <button type="button" onClick={(event) => { event.stopPropagation(); openUpgradeModal('Premium unlocks in-depth Series Insights.'); }} className="quiet-shelf-secondary-action shrink-0">Unlock Series Insights</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};
