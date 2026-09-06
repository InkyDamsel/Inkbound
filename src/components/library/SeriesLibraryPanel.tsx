import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Lock, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { UserBookRecord } from '../../types';
import { useUserPlan } from '../../context/UserPlanContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { buildSeriesLibrary } from '../../features/series/seriesLibrary';
import {
  makeSeriesOverrideId,
  SERIES_OVERRIDES_STORAGE_KEY,
  type SeriesOverride,
  type SeriesOverrides,
} from '../../features/series/seriesOverrides';
import { BookCover } from '../BookCover';

interface SeriesLibraryPanelProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
}

type DraftBook = { bookId: string; position: string; label: string };
type Draft = { id?: string; name: string; author: string; books: DraftBook[] };

const SERIES_PER_PAGE = 20;
const emptyDraft = (): Draft => ({ name: '', author: '', books: [] });
const activeEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

const ownershipLabel = (book: UserBookRecord) => {
  if (book.ownership === 'owned') return 'Owned';
  if (book.ownership === 'borrowed-library') return 'Library loan';
  if (book.ownership === 'borrowed-person') return 'Borrowed';
  if (book.ownership === 'subscription') return book.subscriptionService
    ? book.subscriptionService.replaceAll('-', ' ')
    : 'Subscription';
  if (book.ownership === 'wishlist') return 'Wishlist';
  return 'Not owned';
};

const pageWindow = (current: number, total: number): number[] => {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
};

export const SeriesLibraryPanel: React.FC<SeriesLibraryPanelProps> = ({ books, onSelectBook }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [overrides, setOverrides] = usePersistentState<SeriesOverrides>(SERIES_OVERRIDES_STORAGE_KEY, {});
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const series = useMemo(() => buildSeriesLibrary(books, overrides), [books, overrides]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return series;
    return series.filter((item) =>
      item.name.toLowerCase().includes(query)
      || item.author.toLowerCase().includes(query)
      || item.books.some(({ book }) => book.work.title.toLowerCase().includes(query)),
    );
  }, [search, series]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / SERIES_PER_PAGE));
  const pagedSeries = useMemo(() => {
    const start = (currentPage - 1) * SERIES_PER_PAGE;
    return filtered.slice(start, start + SERIES_PER_PAGE);
  }, [currentPage, filtered]);
  const visibleStart = filtered.length === 0 ? 0 : (currentPage - 1) * SERIES_PER_PAGE + 1;
  const visibleEnd = Math.min(currentPage * SERIES_PER_PAGE, filtered.length);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const goToPage = (page: number) => {
    const next = Math.max(1, Math.min(page, totalPages));
    if (next === currentPage) return;
    setCurrentPage(next);
    setExpandedSeriesId(null);
    window.requestAnimationFrame(() => {
      document.querySelector('[data-series-library-start]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openCreate = () => {
    setError('');
    setDraft(emptyDraft());
  };

  const openEdit = (item: (typeof series)[number]) => {
    setError('');
    setDraft({
      id: item.id,
      name: item.name,
      author: item.author,
      books: item.books.map(({ book, position, displayPosition }) => ({
        bookId: book.id,
        position: position?.toString() ?? '',
        label: displayPosition.startsWith('Book ') || displayPosition === 'Series book' ? '' : displayPosition,
      })),
    });
  };

  const toggleDraftBook = (bookId: string) => setDraft((current) => {
    if (!current) return current;
    const exists = current.books.some((entry) => entry.bookId === bookId);
    return {
      ...current,
      books: exists
        ? current.books.filter((entry) => entry.bookId !== bookId)
        : [...current.books, { bookId, position: '', label: '' }],
    };
  });

  const updateDraftBook = (bookId: string, patch: Partial<DraftBook>) => setDraft((current) => current ? {
    ...current,
    books: current.books.map((entry) => entry.bookId === bookId ? { ...entry, ...patch } : entry),
  } : current);

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    const author = draft.author.trim();
    if (!name) {
      setError('Give the series a name.');
      return;
    }
    if (draft.books.length === 0) {
      setError('Add at least one book to the series.');
      return;
    }

    const invalidPosition = draft.books.find((entry) => entry.position.trim() !== '' && !Number.isFinite(Number(entry.position)));
    if (invalidPosition) {
      setError('Series positions must be numbers such as 1, 1.5, or 2.');
      return;
    }

    const id = draft.id ?? makeSeriesOverrideId(name, author || 'Unknown author');
    const now = new Date().toISOString();
    const existing = overrides[id];
    const next: SeriesOverride = {
      id,
      name,
      author: author || 'Unknown author',
      books: draft.books.map((entry) => ({
        bookId: entry.bookId,
        position: entry.position.trim() === '' ? null : Number(entry.position),
        label: entry.label.trim() || undefined,
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    setOverrides((current) => ({ ...current, [id]: next }));
    setExpandedSeriesId(id);
    setDraft(null);
  };

  const deleteManualSeries = (id: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (expandedSeriesId === id) setExpandedSeriesId(null);
  };

  const pagination = filtered.length > SERIES_PER_PAGE && (
    <nav className="inkbound-panel flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Series pages">
      <p className="text-xs text-[var(--ink-muted)]">
        Showing <strong className="text-[var(--ink-ivory)]">{visibleStart}-{visibleEnd}</strong> of <strong className="text-[var(--ink-ivory)]">{filtered.length}</strong> series
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-end">
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
          className="quiet-shelf-secondary-action !h-10 !px-3 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Previous series page"
        >
          <ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline">Previous</span>
        </button>
        {pageWindow(currentPage, totalPages).map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => goToPage(page)}
            aria-current={page === currentPage ? 'page' : undefined}
            className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${page === currentPage
              ? 'border-[var(--ink-gold)] bg-[var(--ink-gold)] text-[#171015]'
              : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-muted)] hover:border-[var(--ink-gold)]/40 hover:text-[var(--ink-ivory)]'}`}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="quiet-shelf-secondary-action !h-10 !px-3 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Next series page"
        >
          <span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="space-y-5" data-series-library-start>
      <section className="inkbound-panel rounded-3xl p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inkbound-kicker">Series</p>
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Your reading worlds</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{series.length} series found in your library.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:max-w-lg sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setCurrentPage(1);
                  setExpandedSeriesId(null);
                }}
                placeholder="Search series or book"
                className="h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] pl-10 pr-4 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-gold)]/55"
              />
            </label>
            <button type="button" onClick={openCreate} className="quiet-shelf-primary-action shrink-0">
              <Plus className="h-4 w-4" />Create Series
            </button>
          </div>
        </div>
      </section>

      {series.length === 0 ? (
        <section className="inkbound-panel rounded-3xl p-6 text-center sm:p-10">
          <BookOpen className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No series found yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">
            Series metadata groups books automatically, or create one yourself when metadata is missing or wrong.
          </p>
          <button type="button" onClick={openCreate} className="quiet-shelf-primary-action mx-auto mt-5">
            <Plus className="h-4 w-4" />Create your first series
          </button>
        </section>
      ) : filtered.length === 0 ? (
        <section className="inkbound-panel rounded-3xl p-8 text-center text-sm text-[var(--ink-muted)]">
          No series match that search.
        </section>
      ) : (
        <>
          {pagination}
          <div className="grid gap-4">
            {pagedSeries.map((item) => {
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
                      {firstBook && (
                        <BookCover
                          work={firstBook.work}
                          edition={activeEdition(firstBook)}
                          size="sm"
                          showFormatBadge={false}
                          className="!h-16 !w-12 rounded-lg"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-serif text-2xl text-[var(--ink-ivory)]">{item.name}</h3>
                          {item.isManual && (
                            <span className="rounded-full border border-[var(--ink-gold)]/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-gold)]">Custom</span>
                          )}
                        </div>
                        <p className="truncate text-sm text-[var(--ink-muted)]">{item.author}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]">
                          <span><strong className="text-[var(--ink-ivory)]">{item.finishedCount}</strong> of {item.books.length} finished</span>
                          <span><strong className="text-[var(--ink-ivory)]">{item.ownedCount}</strong> owned</span>
                          <span><strong className="text-[var(--ink-ivory)]">{item.unreadCount}</strong> unread</span>
                          {item.notOwnedCount > 0 && <span><strong className="text-[var(--ink-ivory)]">{item.notOwnedCount}</strong> not owned</span>}
                          {nextUnread && <span>Next: {nextUnread.book.work.title}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex w-full items-center gap-4 lg:w-auto">
                      <div className="min-w-0 flex-1 lg:w-48 lg:flex-none">
                        <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                          <span>Series progress</span><span>{item.completionPercent}%</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${item.completionPercent}%` }} />
                        </div>
                      </div>
                      <ChevronRight className={`h-5 w-5 shrink-0 text-[var(--ink-gold)] transition ${expanded ? 'rotate-90' : ''}`} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-[var(--ink-border-subtle)] px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                      <div className="mb-4 flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => openEdit(item)} className="quiet-shelf-secondary-action">
                          <Pencil className="h-4 w-4" />{item.isManual ? 'Edit series' : 'Correct series'}
                        </button>
                        {item.isManual && (
                          <button type="button" onClick={() => deleteManualSeries(item.id)} className="quiet-shelf-secondary-action text-rose-300">
                            <Trash2 className="h-4 w-4" />Remove custom grouping
                          </button>
                        )}
                      </div>

                      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Owned</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.ownedCount}</strong></div>
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Unread</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.unreadCount}</strong></div>
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Borrowed</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.borrowedCount}</strong></div>
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Not owned</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.notOwnedCount}</strong></div>
                      </section>

                      {item.subscriptionCount > 0 && <p className="mb-4 text-xs text-[var(--ink-muted)]">{item.subscriptionCount} book{item.subscriptionCount === 1 ? '' : 's'} available through a subscription service.</p>}

                      <div className="grid gap-3">
                        {item.books.map(({ book, displayPosition }) => (
                          <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-left transition hover:border-[var(--ink-gold)]/35">
                            <BookCover work={book.work} edition={activeEdition(book)} size="sm" showFormatBadge={false} className="!h-16 !w-11 rounded-md" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-gold)]">{displayPosition}</p>
                              <p className="truncate font-serif text-lg text-[var(--ink-ivory)]">{book.work.title}</p>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]"><span className="capitalize">{book.status.replaceAll('-', ' ')}</span><span>·</span><span className="capitalize">{ownershipLabel(book)}</span>{book.rating ? <><span>·</span><span>{book.rating}/5</span></> : null}</div>
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
                                <div className="rounded-xl bg-black/15 p-3"><span className="text-xs text-[var(--ink-muted)]">Unread in library</span><strong className="mt-1 block text-[var(--ink-ivory)]">{item.unreadCount}</strong></div>
                                <div className="rounded-xl bg-black/15 p-3"><span className="text-xs text-[var(--ink-muted)]">Completion</span><strong className="mt-1 block text-[var(--ink-ivory)]">{item.completionPercent}%</strong></div>
                              </div>
                            ) : (
                              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <p className="max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">Premium adds deeper series reading time, ratings, pace, timelines, favorite installments, and more.</p>
                                <button type="button" onClick={() => openUpgradeModal('Premium unlocks in-depth Series Insights.')} className="quiet-shelf-secondary-action shrink-0">Unlock Series Insights</button>
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
          {pagination}
        </>
      )}

      {draft && (
        <div className="fixed inset-0 z-[220] overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
          <section className="mx-auto my-4 w-full max-w-3xl rounded-3xl border border-[var(--ink-gold)]/30 bg-[#17101b] p-5 shadow-2xl sm:my-8 sm:p-6" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-4">
              <div><p className="inkbound-kicker">Series organization</p><h2 className="mt-1 font-serif text-3xl text-[var(--ink-ivory)]">{draft.id ? 'Edit Series' : 'Create Series'}</h2></div>
              <button type="button" onClick={() => setDraft(null)} className="rounded-full p-2 text-[var(--ink-muted)] hover:bg-white/5" aria-label="Close series editor"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Series name<input autoFocus value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setError(''); }} className="mt-2 h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none focus:border-[var(--ink-gold)]" /></label>
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Author<input value={draft.author} onChange={(event) => { setDraft({ ...draft, author: event.target.value }); setError(''); }} className="mt-2 h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none focus:border-[var(--ink-gold)]" /></label>
            </div>

            <p className="mt-5 text-sm font-semibold text-[var(--ink-ivory)]">Books in this series</p>
            <div className="mt-2 max-h-[48dvh] space-y-2 overflow-y-auto pr-1">
              {books.map((book) => {
                const entry = draft.books.find((item) => item.bookId === book.id);
                return (
                  <div key={book.id} className={`rounded-2xl border p-3 ${entry ? 'border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/5' : 'border-[var(--ink-border-subtle)]'}`}>
                    <div className="flex items-center gap-3"><input type="checkbox" checked={Boolean(entry)} onChange={() => { toggleDraftBook(book.id); setError(''); }} className="h-5 w-5 accent-[#c5a059]" /><div className="min-w-0 flex-1"><p className="truncate font-semibold text-[var(--ink-ivory)]">{book.work.title}</p><p className="truncate text-xs text-[var(--ink-muted)]">{book.work.author} · {ownershipLabel(book)}</p></div></div>
                    {entry && <div className="mt-3 grid gap-2 pl-8 sm:grid-cols-2"><input type="number" step="0.1" value={entry.position} onChange={(event) => { updateDraftBook(book.id, { position: event.target.value }); setError(''); }} placeholder="Position (1, 1.5, 2...)" className="h-10 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none" /><input value={entry.label} onChange={(event) => updateDraftBook(book.id, { label: event.target.value })} placeholder="Optional label (Prequel, Novella...)" className="h-10 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none" /></div>}
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setDraft(null)} className="quiet-shelf-secondary-action">Cancel</button><button type="button" onClick={saveDraft} className="quiet-shelf-primary-action">Save Series</button></div>
          </section>
        </div>
      )}
    </div>
  );
};