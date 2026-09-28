import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Star } from 'lucide-react';
import { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { ResponsiveGrid } from '../../layout/responsive';
import { getBookReadingState } from '../../features/reading/bookReadingState';
import { readingStatusLabelForBook } from '../../features/reading/customReadingStatuses';
import { SYNC_STORAGE_KEYS } from '../../features/sync/storageKeys';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  getCloudDataRevision,
  INKBOUND_CLOUD_DATA_EVENT,
  type CloudDataUpdatedDetail,
} from '../../features/sync/cloudSyncEvents';
import { BookCover } from '../BookCover';

interface LibraryBookGridProps {
  books: UserBookRecord[];
  selectedBookIds: string[];
  onSelectBook: (book: UserBookRecord) => void;
  onToggleSelectBook: (id: string) => void;
}

const HYDRATION_FALLBACK_MS = 4000;
const INITIAL_RENDER_COUNT = 120;
const RENDER_STEP = 120;

export function LibraryBookGrid({ books, selectedBookIds, onSelectBook, onToggleSelectBook }: LibraryBookGridProps) {
  const { user, isAuthReady } = useAccountSync();
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [cloudLibraryReady, setCloudLibraryReady] = useState(() => {
    if (!user) return true;
    return getCloudDataRevision() > 0 && getRuntimeStorage().getItem(SYNC_STORAGE_KEYS.localOwnerUid) === user.uid;
  });
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);

  useEffect(() => {
    setHydrationTimedOut(false);
    const handleCloudUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (detail?.keys.includes(SYNC_STORAGE_KEYS.books)) {
        setCloudLibraryReady(true);
        setHydrationTimedOut(false);
      }
    };
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
    if (!isAuthReady) setCloudLibraryReady(false);
    else if (!user) setCloudLibraryReady(true);
    else setCloudLibraryReady(getCloudDataRevision() > 0 && getRuntimeStorage().getItem(SYNC_STORAGE_KEYS.localOwnerUid) === user.uid);
    const fallbackTimer = user ? window.setTimeout(() => setHydrationTimedOut(true), HYDRATION_FALLBACK_MS) : null;
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, [isAuthReady, user?.uid]);

  // A library already present on this device is immediately usable. Network
  // reconciliation must never hide a reader's books behind a loading screen.
  const hasLocalBooks = books.length > 0;
  const isHydratingCloudLibrary = !hasLocalBooks && !hydrationTimedOut && (!isAuthReady || Boolean(user && !cloudLibraryReady));
  const visibleBooks = useMemo(() => books.slice(0, Math.min(visibleCount, books.length)), [books, visibleCount]);
  const hasMoreBooks = visibleBooks.length < books.length;

  if (isHydratingCloudLibrary) {
    return (
      <section className="space-y-4" aria-live="polite" aria-busy="true">
        <div className="inkbound-panel flex items-center gap-3 rounded-2xl px-5 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-muted)]" />
          <div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Opening your library…</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Inkbound is restoring the books saved to your account.</p></div>
        </div>
        <ResponsiveGrid minItemWidth={150} maxColumns={6} gap={16} alignItems="stretch">
          {Array.from({ length: 12 }, (_, index) => <div key={`library-sync-placeholder-${index}`} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3" aria-hidden="true"><div className="mx-auto aspect-[2/3] w-28 animate-pulse rounded-md bg-[var(--ink-surface)]" /><div className="mt-4 h-4 w-4/5 animate-pulse rounded-full bg-[var(--ink-surface)]" /><div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-[var(--ink-surface)]" /><div className="mt-4 h-6 w-16 animate-pulse rounded-full bg-[var(--ink-surface)]" /></div>)}
        </ResponsiveGrid>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {hydrationTimedOut && user && !cloudLibraryReady && !hasLocalBooks ? <div className="inkbound-panel flex items-start gap-3 rounded-2xl px-5 py-4" role="status"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-gold)]" /><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Your saved library is taking a little longer to arrive.</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">You can keep using Inkbound. We’ll continue trying as your connection allows.</p></div></div> : null}
      <ResponsiveGrid minItemWidth={150} maxColumns={6} gap={16} alignItems="stretch">
        {visibleBooks.map((book) => {
          const isSelected = selectedBookIds.includes(book.id);
          const readingState = getBookReadingState(book);
          return (
            <article
              key={book.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectBook(book)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectBook(book);
                }
              }}
              className={`group cursor-pointer rounded-2xl border p-3 transition duration-200 ${isSelected ? 'border-[#c5a059] bg-[#c5a059]/12 shadow-[0_16px_34px_rgba(0,0,0,.4)]' : 'border-white/5 bg-[#17101b] hover:-translate-y-1 hover:border-[#c5a059]/35 hover:bg-[#1d1422]'}`}
            >
              <div className="flex justify-center"><BookCover work={book.work} edition={readingState.activeEdition} size="md" progressPercentage={readingState.progressPercentage} isFinished={readingState.isFinished} rating={book.rating} isSelected={isSelected} onSelectToggle={() => onToggleSelectBook(book.id)} /></div>
              <div className="mt-4 min-w-0"><h3 className="line-clamp-2 font-serif text-base font-bold leading-tight text-[#f4efe6] transition group-hover:text-[#e2bd66]">{book.work.title}</h3><p className="mt-1 truncate text-xs text-[#ad9fac]">{book.work.author}</p><div className="mt-3 flex items-center justify-between gap-2 text-[11px]"><span className="rounded-full bg-[#24172a] px-2.5 py-1 capitalize text-[#cfc2cf]">{readingStatusLabelForBook(book)}</span>{book.rating ? <span className="flex items-center gap-1 font-bold text-[#e2bd66]"><Star className="h-3 w-3 fill-current" />{book.rating.toFixed(1)}</span> : null}</div>{readingState.progressNeedsCorrection ? <p className="mt-2 text-[10px] text-[#e2bd66]">Progress needs correction</p> : null}</div>
            </article>
          );
        })}
      </ResponsiveGrid>

      {books.length > INITIAL_RENDER_COUNT ? (
        <div className="inkbound-panel flex flex-col items-center justify-between gap-3 rounded-2xl px-5 py-4 sm:flex-row">
          <p className="text-sm text-[var(--ink-muted)]">
            Showing <strong className="text-[var(--ink-ivory)]">{visibleBooks.length.toLocaleString()}</strong> of <strong className="text-[var(--ink-ivory)]">{books.length.toLocaleString()}</strong> books. Inkbound loads your shelf in sections so even very large libraries stay smooth.
          </p>
          {hasMoreBooks ? (
            <button
              type="button"
              onClick={() => setVisibleCount((current) => Math.min(current + RENDER_STEP, books.length))}
              className="quiet-shelf-secondary-action w-full justify-center sm:w-auto"
            >
              Show {Math.min(RENDER_STEP, books.length - visibleBooks.length).toLocaleString()} more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
