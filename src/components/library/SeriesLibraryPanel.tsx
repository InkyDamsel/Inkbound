import { isSeriesDetectiveAvailable } from '../../features/series/seriesDetectiveAvailability';
import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Lock, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { UserBookRecord } from '../../types';
import { useUserPlan } from '../../context/UserPlanContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import {
  clearLibrarySeriesFocusBookId,
  readLibrarySeriesFocusBookId,
  SERIES_FOCUS_BOOK_STORAGE_KEY,
} from '../../features/library/libraryNavigation';
import { LIBRARY_SECTION_SORT_OPTIONS, compareLibraryDates, compareLibraryLabels, type LibrarySectionSortMode } from '../../features/library/librarySectionSort';
import { DEVICE_STORAGE_KEYS } from '../../features/sync/storageKeys';
import { INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT } from '../../platform/runtimeStorage';
import {
  buildSeriesLibrary,
  seriesBookDisplayTitle,
  seriesPositionLabel,
} from '../../features/series/seriesLibrary';
import {
  makeSeriesOverrideId,
  SERIES_OVERRIDES_STORAGE_KEY,
  type SeriesOverride,
  type SeriesOverrides,
} from '../../features/series/seriesOverrides';
import {
  ownershipLabel,
  subscriptionServiceLabel,
} from '../../domain/libraryTaxonomy';
import { readingStatusLabelForBook } from '../../features/reading/customReadingStatuses';
import { BookCover } from '../BookCover';
import { SeriesDetectivePreview } from './SeriesDetectivePreview';

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

const displayOwnership = (book: UserBookRecord) => book.ownership === 'subscription' && book.subscriptionService
  ? subscriptionServiceLabel(book.subscriptionService)
  : ownershipLabel(book.ownership);

const pageWindow = (current: number, total: number): number[] => {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
};

export const SeriesLibraryPanel: React.FC<SeriesLibraryPanelProps> = ({ books, onSelectBook }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [overrides, setOverrides] = usePersistentState<SeriesOverrides>(SERIES_OVERRIDES_STORAGE_KEY, {});
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = usePersistentState<LibrarySectionSortMode>(DEVICE_STORAGE_KEYS.seriesSort, 'az');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftBookSearch, setDraftBookSearch] = useState('');
  const [draftBookSort, setDraftBookSort] = useState<'selected' | 'title' | 'author' | 'recent'>('selected');
  const [error, setError] = useState('');
  const [pendingFocusBookId, setPendingFocusBookId] = useState<string | null>(() => readLibrarySeriesFocusBookId());

  const series = useMemo(() => buildSeriesLibrary(books, overrides), [books, overrides]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = query
      ? series.filter((item) =>
          item.name.toLowerCase().includes(query)
          || item.author.toLowerCase().includes(query)
          || item.books.some(({ book }) => book.work.title.toLowerCase().includes(query)),
        )
      : [...series];

    const seriesDate = (item: (typeof series)[number], newest: boolean) => {
      const dates = item.books.map(({ book }) => book.dateAdded).filter(Boolean);
      if (!dates.length) return '';
      const ordered = [...dates].sort(compareLibraryDates);
      return ordered[newest ? ordered.length - 1 : 0];
    };

    return source.sort((a, b) => {
      if (sortMode === 'za') return compareLibraryLabels(b.name, a.name);
      if (sortMode === 'newest') {
        return compareLibraryDates(seriesDate(b, true), seriesDate(a, true)) || compareLibraryLabels(a.name, b.name);
      }
      if (sortMode === 'oldest') {
        return compareLibraryDates(seriesDate(a, false), seriesDate(b, false)) || compareLibraryLabels(a.name, b.name);
      }
      return compareLibraryLabels(a.name, b.name);
    });
  }, [search, series, sortMode]);

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

  useEffect(() => {
    setCurrentPage(1);
    setExpandedSeriesId(null);
  }, [sortMode]);

  useEffect(() => {
    const refreshPendingFocus = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key !== SERIES_FOCUS_BOOK_STORAGE_KEY) return;
      setPendingFocusBookId(readLibrarySeriesFocusBookId());
    };

    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, refreshPendingFocus);
    return () => window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, refreshPendingFocus);
  }, []);

  useEffect(() => {
    const targetBookId = pendingFocusBookId ?? readLibrarySeriesFocusBookId();
    if (!targetBookId) return;

    if (search) {
      setSearch('');
      return;
    }

    const targetIndex = filtered.findIndex((item) => item.books.some(({ book }) => book.id === targetBookId));
    if (targetIndex < 0) return;

    const targetSeries = filtered[targetIndex];
    setCurrentPage(Math.floor(targetIndex / SERIES_PER_PAGE) + 1);
    setExpandedSeriesId(targetSeries.id);
    clearLibrarySeriesFocusBookId(targetBookId);
    setPendingFocusBookId(null);

    window.setTimeout(() => {
      document.querySelector(`[data-series-id="${CSS.escape(targetSeries.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }, [filtered, pendingFocusBookId, search]);

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
    setDraftBookSearch('');
    setDraftBookSort('selected');
    setDraft(emptyDraft());
  };

  const openEdit = (item: (typeof series)[number]) => {
    setError('');
    setDraftBookSearch('');
    setDraftBookSort('selected');
    setDraft({
      id: item.id,
      name: item.name,
      author: item.author,
      books: item.books.map(({ book, position, displayPosition }) => ({
        bookId: book.id,
        position: position?.toString() ?? '',
        label: displayPosition === seriesPositionLabel(book, position) ? '' : displayPosition,
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
      setError('Add at least one item to the series.');
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

  const draftVisibleBooks = useMemo(() => {
    if (!draft) return [];

    const query = draftBookSearch.trim().toLowerCase();
    const selectedIds = new Set(draft.books.map((entry) => entry.bookId));
    const source = query
      ? books.filter((book) =>
          book.work.title.toLowerCase().includes(query)
          || book.work.author.toLowerCase().includes(query),
        )
      : [...books];

    return source.sort((a, b) => {
      if (draftBookSort === 'selected') {
        const aSelected = selectedIds.has(a.id);
        const bSelected = selectedIds.has(b.id);
        const selectedDifference = Number(bSelected) - Number(aSelected);
        if (selectedDifference !== 0) return selectedDifference;

        if (aSelected && bSelected) {
          const aEntry = draft.books.find((entry) => entry.bookId === a.id);
          const bEntry = draft.books.find((entry) => entry.bookId === b.id);
          const aPosition = aEntry?.position.trim() === '' ? Number.POSITIVE_INFINITY : Number(aEntry?.position);
          const bPosition = bEntry?.position.trim() === '' ? Number.POSITIVE_INFINITY : Number(bEntry?.position);
          if (Number.isFinite(aPosition) || Number.isFinite(bPosition)) {
            const positionDifference = aPosition - bPosition;
            if (positionDifference !== 0) return positionDifference;
          }
        }

        return compareLibraryLabels(a.work.title, b.work.title);
      }
      if (draftBookSort === 'author') {
        return compareLibraryLabels(a.work.author, b.work.author)
          || compareLibraryLabels(a.work.title, b.work.title);
      }
      if (draftBookSort === 'recent') {
        return compareLibraryDates(b.dateAdded, a.dateAdded)
          || compareLibraryLabels(a.work.title, b.work.title);
      }
      return compareLibraryLabels(a.work.title, b.work.title);
    });
  }, [books, draft, draftBookSearch, draftBookSort]);

  const pagination = filtered.length > SERIES_PER_PAGE && (
    <nav className="inkbound-panel flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Series pages">
      <p className="text-xs text-[var(--ink-muted)]">
        Showing <strong className="text-[var(--ink-ivory)]">{visibleStart}-{visibleEnd}</strong> of <strong className="text-[var(--ink-ivory)]">{filtered.length}</strong> series
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-end">
        <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="quiet-shelf-secondary-action !h-10 !px-3 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Previous series page">
          <ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline">Previous</span>
        </button>
        {pageWindow(currentPage, totalPages).map((page) => (
          <button key={page} type="button" onClick={() => goToPage(page)} aria-current={page === currentPage ? 'page' : undefined} className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${page === currentPage ? 'border-[var(--ink-gold)] bg-[var(--ink-gold)] text-[#171015]' : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-muted)] hover:border-[var(--ink-gold)]/40 hover:text-[var(--ink-ivory)]'}`}>
            {page}
          </button>
        ))}
        <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="quiet-shelf-secondary-action !h-10 !px-3 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Next series page">
          <span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="space-y-5" data-series-library-start>
      <details className="inkbound-panel rounded-3xl p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-gold)]">Series tools — search, sort & create</summary>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inkbound-kicker">Series</p>
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Your reading worlds</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{series.length} series found in your library.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label className="relative min-w-0 sm:w-[280px] lg:w-[340px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); setExpandedSeriesId(null); }} placeholder="Search series or title" className="h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] pl-10 pr-4 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-gold)]/55" />
            </label>
            <label className="flex items-center gap-3 text-sm font-medium text-[var(--ink-muted)]">
              Sort
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as LibrarySectionSortMode)}
                className="inkbound-select min-h-11 min-w-[150px]"
                aria-label="Sort series"
              >
                {LIBRARY_SECTION_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={openCreate} className="quiet-shelf-primary-action shrink-0"><Plus className="h-4 w-4" />Create Series</button>
          </div>
        </div>
      </details>

      {series.length === 0 ? (
        <section className="inkbound-panel rounded-3xl p-6 text-center sm:p-10">
          <BookOpen className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No series found yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">Series metadata groups reading material automatically, or create one yourself when metadata is missing or wrong.</p>
          <button type="button" onClick={openCreate} className="quiet-shelf-primary-action mx-auto mt-5"><Plus className="h-4 w-4" />Create your first series</button>
        </section>
      ) : filtered.length === 0 ? (
        <section className="inkbound-panel rounded-3xl p-8 text-center text-sm text-[var(--ink-muted)]">No series match that search.</section>
      ) : (
        <>
          <div className="grid gap-4">
            {pagedSeries.map((item) => {
              const expanded = expandedSeriesId === item.id;
              const nextUnread = item.books.find(({ book }) => book.status !== 'finished');
              const firstBook = item.books[0]?.book;

              return (
                <article key={item.id} data-series-id={item.id} className="inkbound-panel overflow-hidden rounded-3xl">
                  <button type="button" onClick={() => setExpandedSeriesId(expanded ? null : item.id)} className="flex w-full flex-col gap-5 p-5 text-left sm:p-6 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      {firstBook && <BookCover work={firstBook.work} edition={activeEdition(firstBook)} size="sm" showFormatBadge={false} className="!h-16 !w-12 rounded-lg" />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-serif text-2xl text-[var(--ink-ivory)]">{item.name}</h3>
                          {item.isManual && <span className="rounded-full border border-[var(--ink-gold)]/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-gold)]">Custom</span>}
                        </div>
                        <p className="truncate text-sm text-[var(--ink-muted)]">{item.author}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]">
                          <span><strong className="text-[var(--ink-ivory)]">{item.finishedCount}</strong> of {item.books.length} finished</span>
                          <span><strong className="text-[var(--ink-ivory)]">{item.ownedCount}</strong> owned</span>
                          <span><strong className="text-[var(--ink-ivory)]">{item.unreadCount}</strong> unread</span>
                          {item.notOwnedCount > 0 && <span><strong className="text-[var(--ink-ivory)]">{item.notOwnedCount}</strong> not owned</span>}
                          {nextUnread && <span>Next: {seriesBookDisplayTitle(nextUnread.book, item.name)}</span>}
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
                      <div className="mb-4 flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => openEdit(item)} className="quiet-shelf-secondary-action"><Pencil className="h-4 w-4" />{item.isManual ? 'Edit series' : 'Correct series'}</button>
                        {item.isManual && <button type="button" onClick={() => deleteManualSeries(item.id)} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" />Remove custom grouping</button>}
                      </div>

                      {isSeriesDetectiveAvailable() && <SeriesDetectivePreview key={item.id} seriesName={item.name} author={item.author} books={books} seriesBookIds={item.books.map(({ book }) => book.id)} overrides={overrides} onSelectBook={onSelectBook} />}

                      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Owned</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.ownedCount}</strong></div>
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Unread</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.unreadCount}</strong></div>
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Borrowed</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.borrowedCount}</strong></div>
                        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Not owned</span><strong className="mt-1 block font-serif text-2xl text-[var(--ink-ivory)]">{item.notOwnedCount}</strong></div>
                      </section>

                      {item.subscriptionCount > 0 && <p className="mb-4 text-xs text-[var(--ink-muted)]">{item.subscriptionCount} item{item.subscriptionCount === 1 ? '' : 's'} available through a subscription service.</p>}

                      <div className="grid gap-3">
                        {item.books.map(({ book, displayPosition }) => (
                          <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-left transition hover:border-[var(--ink-gold)]/35">
                            <BookCover work={book.work} edition={activeEdition(book)} size="sm" showFormatBadge={false} className="!h-16 !w-11 rounded-md" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-gold)]">{displayPosition}</p>
                              <p className="truncate font-serif text-lg text-[var(--ink-ivory)]">{seriesBookDisplayTitle(book, item.name)}</p>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]"><span>{readingStatusLabelForBook(book)}</span><span>·</span><span>{displayOwnership(book)}</span>{book.rating ? <><span>·</span><span>{book.rating}/5</span></> : null}</div>
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
        <div className="fixed inset-x-0 bottom-0 top-14 z-[220] flex items-start justify-center overflow-hidden bg-black/75 p-3 pt-4 backdrop-blur-sm sm:top-16 sm:p-5 sm:pt-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
          <section className="flex max-h-[calc(100dvh-5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--ink-gold)]/30 bg-[#17101b] shadow-2xl sm:max-h-[calc(100dvh-6rem)]" role="dialog" aria-modal="true">
            <div className="shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="inkbound-kicker">Series organization</p><h2 className="mt-1 font-serif text-3xl text-[var(--ink-ivory)]">{draft.id ? 'Edit Series' : 'Create Series'}</h2></div>
              <button type="button" onClick={() => setDraft(null)} className="rounded-full p-2 text-[var(--ink-muted)] hover:bg-white/5" aria-label="Close series editor"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Series name<input autoFocus value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setError(''); }} className="mt-2 h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none focus:border-[var(--ink-gold)]" /></label>
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Author<input value={draft.author} onChange={(event) => { setDraft({ ...draft, author: event.target.value }); setError(''); }} className="mt-2 h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none focus:border-[var(--ink-gold)]" /></label>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-[var(--ink-border-subtle)] pt-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--ink-ivory)]">Reading material in this series</p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">{draft.books.length} selected</p>
              </div>
              <div className="grid w-full flex-1 gap-2 sm:max-w-2xl sm:grid-cols-[minmax(220px,1fr)_180px]">
                <label className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--ink-faint)]" />
                  <input
                    type="search"
                    value={draftBookSearch}
                    onChange={(event) => setDraftBookSearch(event.target.value)}
                    placeholder="Search title or author"
                    className="h-10 w-full min-w-0 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] pl-9 pr-3 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-gold)]/55"
                    aria-label="Search books in series editor"
                  />
                </label>
                <select
                  value={draftBookSort}
                  onChange={(event) => setDraftBookSort(event.target.value as 'selected' | 'title' | 'author' | 'recent')}
                  className="inkbound-select h-10 w-full min-w-0"
                  aria-label="Sort books in series editor"
                >
                  <option value="selected">Selected first</option>
                  <option value="title">Title A-Z</option>
                  <option value="author">Author A-Z</option>
                  <option value="recent">Recently added</option>
                </select>
              </div>
            </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-3 sm:px-6">
              <div className="space-y-2">
              {draftVisibleBooks.map((book) => {
                const entry = draft.books.find((item) => item.bookId === book.id);
                return (
                  <div key={book.id} className={`rounded-2xl border p-3 ${entry ? 'border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/5' : 'border-[var(--ink-border-subtle)]'}`}>
                    <div className="flex items-center gap-3"><input type="checkbox" checked={Boolean(entry)} onChange={() => { toggleDraftBook(book.id); setError(''); }} className="h-5 w-5 accent-[#c5a059]" /><div className="min-w-0 flex-1"><p className="truncate font-semibold text-[var(--ink-ivory)]">{book.work.title}</p><p className="truncate text-xs text-[var(--ink-muted)]">{book.work.author} · {displayOwnership(book)}</p></div></div>
                    {entry && <div className="mt-3 grid gap-2 pl-8 sm:grid-cols-2"><input type="number" step="0.1" value={entry.position} onChange={(event) => { updateDraftBook(book.id, { position: event.target.value }); setError(''); }} placeholder="Position (1, 1.5, 2...)" className="h-10 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none" /><input value={entry.label} onChange={(event) => updateDraftBook(book.id, { label: event.target.value })} placeholder="Optional label (Prequel, Novella...)" className="h-10 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] px-3 text-sm outline-none" /></div>}
                  </div>
                );
              })}
              {draftVisibleBooks.length === 0 && (
                <p className="rounded-2xl border border-[var(--ink-border-subtle)] p-5 text-center text-sm text-[var(--ink-muted)]">No books match that search.</p>
              )}
              </div>
            </div>

            <div className="shrink-0 border-t border-[var(--ink-border-subtle)] bg-[#17101b] px-5 py-4 sm:px-6">
              {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setDraft(null)} className="quiet-shelf-secondary-action">Cancel</button><button type="button" onClick={saveDraft} className="quiet-shelf-primary-action">Save Series</button></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
