import { tagIdentity, uniquePrivateTags } from '../features/library/privateTags';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen } from 'lucide-react';
import { BookDetailsModal as BookDetailsModalCore } from './BookDetailsModalCore';
import { CatalogContributionLauncher } from './catalog/CatalogContributionLauncher';
import { EditionLccnControl } from './edition/EditionLccnControl';
import { LibraryLoanReminderControl } from './library/LibraryLoanReminderControl';
import { FinishOnTimeControl } from './reading/FinishOnTimeControl';
import { normalizeLibraryRecord } from '../features/library/libraryNormalization';
import { openLibrarySeriesForBook } from '../features/library/libraryNavigation';
import { getEffectiveBookProgressPages } from '../features/reading/readingPageTotals';
import { resolveEffectiveSeriesMetadata, seriesPositionLabel } from '../features/series/seriesLibrary';
import { readSeriesOverrides } from '../features/series/seriesOverrides';
import { SYNC_STORAGE_KEYS } from '../features/sync/storageKeys';
import { readRuntimeJson } from '../platform/runtimeStorage';
import type { Edition, UserBookRecord } from '../types';
import { usesEmbeddedBookDetailsToolbar } from '../platform/bookDetailsLayoutCapability';
import './bookDetailsResponsive.css';

function normalizeStoredIsbn(value?: string): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  const spreadsheetWrapped = trimmed.match(/^=\s*["']([^"']+)["']$/);
  const candidate = spreadsheetWrapped?.[1] ?? trimmed;
  const normalized = candidate.replace(/[^0-9X]/gi, '').toUpperCase();
  return normalized || undefined;
}

function normalizeEditionIdentifiers(edition: Edition): Edition {
  const isbn = normalizeStoredIsbn(edition.isbn);
  const isbn10 = normalizeStoredIsbn(edition.isbn10);
  const isbn13 = normalizeStoredIsbn(edition.isbn13);
  return {
    ...edition,
    isbn,
    isbn10,
    isbn13,
    lccn: edition.lccn?.trim() || undefined,
  };
}

function normalizeBookIdentifiers(book: UserBookRecord): UserBookRecord {
  return {
    ...book,
    editions: book.editions.map(normalizeEditionIdentifiers),
  };
}

type BookDetailsModalProps = React.ComponentProps<typeof BookDetailsModalCore> & {
  onViewSeries?: (book: UserBookRecord) => void;
};

export const BookDetailsModal: React.FC<BookDetailsModalProps> = (props) => {
  const [seriesHeaderTarget, setSeriesHeaderTarget] = useState<HTMLElement | null>(null);
  const [tagPickerTarget, setTagPickerTarget] = useState<HTMLElement | null>(null);
  const [bottomToolbarTarget, setBottomToolbarTarget] = useState<HTMLElement | null>(null);
  const normalizedBook = useMemo(
    () => props.book ? normalizeBookIdentifiers(props.book) : null,
    [props.book],
  );
  const seriesOverrides = useMemo(() => readSeriesOverrides(), [normalizedBook?.id]);
  const effectiveSeries = useMemo(
    () => normalizedBook ? resolveEffectiveSeriesMetadata(normalizedBook, seriesOverrides) : null,
    [normalizedBook, seriesOverrides],
  );
  const availableTags = useMemo(() => {
    const books = readRuntimeJson<UserBookRecord[]>(SYNC_STORAGE_KEYS.books, []);
    return uniquePrivateTags(books.flatMap((item) => item.privateTags ?? []))
      .sort((a, b) => a.localeCompare(b));
  }, [normalizedBook?.id, normalizedBook?.privateTags?.join('|')]);

  const displayBook = useMemo<UserBookRecord | null>(() => {
    if (!normalizedBook) return null;

    // Book Details is a view over canonical reading state. Historical finished
    // books may legitimately have no persisted progressPages because Inkbound did
    // not observe the original sessions. Show the canonical effective page value
    // without rewriting the stored reading history.
    const effectiveProgressPages = getEffectiveBookProgressPages(normalizedBook);
    const baseDisplayBook: UserBookRecord = {
      ...normalizedBook,
      progressPages: effectiveProgressPages,
    };

    if (!effectiveSeries || normalizedBook.work.seriesName?.trim()) return baseDisplayBook;
    return {
      ...baseDisplayBook,
      work: {
        ...baseDisplayBook.work,
        seriesName: effectiveSeries.name,
        seriesOrder: effectiveSeries.position ?? undefined,
      },
    };
  }, [effectiveSeries, normalizedBook]);

  useEffect(() => {
    if (!props.book || !normalizedBook) return;
    const before = props.book.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13, edition.lccn]);
    const after = normalizedBook.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13, edition.lccn]);
    if (JSON.stringify(before) !== JSON.stringify(after)) props.onUpdateBook(normalizedBook);
  }, [normalizedBook, props.book, props.onUpdateBook]);

  useEffect(() => {
    if (!displayBook) {
      setSeriesHeaderTarget(null);
      setTagPickerTarget(null);
      setBottomToolbarTarget(null);
      return;
    }
    const host = document.querySelector('.book-details-modal-host');
    const header = host?.querySelector("[data-series-shortcut-slot]");
    setSeriesHeaderTarget(header instanceof HTMLElement ? header : null);
    const footer = host?.querySelector('.book-details-bottom-toolbar');
    setBottomToolbarTarget(footer instanceof HTMLElement ? footer : null);

    const labels = Array.from(host?.querySelectorAll("section[role='dialog'] label") ?? []);
    const tagsLabel = labels.find((label) => label.textContent?.trim().startsWith('Tags'));
    setTagPickerTarget(tagsLabel instanceof HTMLElement ? tagsLabel : null);
  }, [displayBook?.id, displayBook?.privateTags?.join('|')]);

  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    // progressPages on displayBook may be an effective historical display value.
    // Explicit progress edits travel through onCorrectProgress, so never let a
    // display-only fallback leak back into persisted book state during unrelated
    // Book Details edits.
    const persistenceSafeUpdate = normalizedBook
      ? { ...updatedBook, progressPages: normalizedBook.progressPages }
      : updatedBook;

    // Reuse the canonical library normalizer so Book Details cannot invent a
    // second ownership/status coupling. Wishlist ownership must never erase a
    // legitimate Finished status or finish date.
    const normalizedUpdate = normalizeLibraryRecord(persistenceSafeUpdate);

    if (!normalizedBook || !effectiveSeries || normalizedBook.work.seriesName?.trim()) {
      props.onUpdateBook(normalizedUpdate);
      return;
    }

    const unchangedInferredName = normalizedUpdate.work.seriesName?.trim() === effectiveSeries.name;
    const unchangedInferredPosition = normalizedUpdate.work.seriesOrder === (effectiveSeries.position ?? undefined);
    props.onUpdateBook({
      ...normalizedUpdate,
      work: {
        ...normalizedUpdate.work,
        seriesName: unchangedInferredName ? normalizedBook.work.seriesName : normalizedUpdate.work.seriesName,
        seriesOrder: unchangedInferredPosition ? normalizedBook.work.seriesOrder : normalizedUpdate.work.seriesOrder,
      },
    });
  };

  const addExistingTag = (tag: string) => {
    if (!normalizedBook || !tag) return;
    const nextTags = uniquePrivateTags([...(normalizedBook.privateTags ?? []), tag]);
    handleUpdateBook({ ...normalizedBook, privateTags: nextTags });
  };

  const viewSeries = () => {
    if (!normalizedBook || !effectiveSeries) return;
    if (props.onViewSeries) {
      props.onViewSeries(normalizedBook);
      return;
    }
    openLibrarySeriesForBook(normalizedBook.id);
    props.onClose();
  };

  const seriesShortcut = normalizedBook && effectiveSeries && seriesHeaderTarget
    ? createPortal(
        <div className="book-details-series-row flex min-w-0">
          <button
            type="button"
            onClick={viewSeries}
            className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-full border border-[var(--ink-gold)]/35 bg-[#17101b]/85 px-4 py-2.5 text-xs font-semibold text-[var(--ink-ivory)] shadow-lg transition hover:border-[var(--ink-gold)]/60"
            aria-label={`View ${effectiveSeries.name} series`}
          >
            <BookOpen className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" />
            <span className="min-w-0 truncate">{effectiveSeries.name}</span>
            <span className="hidden shrink-0 text-[var(--ink-muted)] sm:inline">· {seriesPositionLabel(normalizedBook, effectiveSeries.position, effectiveSeries.label)}</span>
            <span className="shrink-0 text-[var(--ink-gold)]">View series →</span>
          </button>
        </div>,
        seriesHeaderTarget,
      )
    : null;

  const tagPicker = normalizedBook && tagPickerTarget && availableTags.length > 0
    ? createPortal(
        <select
          defaultValue=""
          onChange={(event) => {
            addExistingTag(event.target.value);
            event.currentTarget.value = '';
          }}
          className="inkbound-select mt-2 w-full"
          aria-label="Add an existing tag"
        >
          <option value="">Add an existing tag…</option>
          {availableTags
            .filter((tag) => !(normalizedBook.privateTags ?? []).some((existing) => tagIdentity(existing) === tagIdentity(tag)))
            .map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>,
        tagPickerTarget,
      )
    : null;

  // Compact web and native must use the same in-dialog action dock.
  // Desktop retains its established floating controls unchanged.
  const [compactViewport, setCompactViewport] = useState(() => typeof window !== 'undefined'
    && window.matchMedia('(max-width: 639px), (orientation: landscape) and (max-height: 600px) and (max-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px), (orientation: landscape) and (max-height: 600px) and (max-width: 1024px)');
    const update = () => setCompactViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const nativeBookToolbar = usesEmbeddedBookDetailsToolbar() || compactViewport;

  return (
    <div className={`book-details-modal-host${nativeBookToolbar ? " book-details-native" : ""}`}>
      <BookDetailsModalCore
        key={`${displayBook?.id ?? 'none'}:${displayBook?.privateTags?.join('|') ?? ''}`}
        {...props}
        book={displayBook}
        onUpdateBook={handleUpdateBook}
      />
      {nativeBookToolbar ? (bottomToolbarTarget ? createPortal(<>
        {displayBook && <CatalogContributionLauncher book={displayBook} onUpdateBook={handleUpdateBook} />}
        {normalizedBook && <EditionLccnControl book={normalizedBook} onUpdateBook={handleUpdateBook} />}
        {normalizedBook && <FinishOnTimeControl book={normalizedBook} sessions={props.sessions} onUpdateBook={handleUpdateBook} />}
        {normalizedBook && <LibraryLoanReminderControl book={normalizedBook} onUpdateBook={handleUpdateBook} />}
      </>, bottomToolbarTarget) : null) : <>
        {displayBook && <CatalogContributionLauncher book={displayBook} onUpdateBook={handleUpdateBook} />}
        {normalizedBook && <EditionLccnControl book={normalizedBook} onUpdateBook={handleUpdateBook} />}
        {normalizedBook && <FinishOnTimeControl book={normalizedBook} sessions={props.sessions} onUpdateBook={handleUpdateBook} />}
        {normalizedBook && <LibraryLoanReminderControl book={normalizedBook} onUpdateBook={handleUpdateBook} />}
      </>}
      {seriesShortcut}
      {tagPicker}
    </div>
  );
};
