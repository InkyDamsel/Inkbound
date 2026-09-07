import React, { useEffect, useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { BookDetailsModal as BookDetailsModalCore } from './BookDetailsModalCore';
import { CatalogContributionLauncher } from './catalog/CatalogContributionLauncher';
import { LibraryLoanReminderControl } from './library/LibraryLoanReminderControl';
import { openLibrarySeriesForBook } from '../features/library/libraryNavigation';
import { resolveEffectiveSeriesMetadata, seriesPositionLabel } from '../features/series/seriesLibrary';
import { readSeriesOverrides } from '../features/series/seriesOverrides';
import type { Edition, UserBookRecord } from '../types';
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
  };
}

function normalizeBookIdentifiers(book: UserBookRecord): UserBookRecord {
  return {
    ...book,
    editions: book.editions.map(normalizeEditionIdentifiers),
  };
}

export const BookDetailsModal: React.FC<React.ComponentProps<typeof BookDetailsModalCore>> = (props) => {
  const normalizedBook = useMemo(
    () => props.book ? normalizeBookIdentifiers(props.book) : null,
    [props.book],
  );
  const seriesOverrides = useMemo(() => readSeriesOverrides(), [normalizedBook?.id]);
  const effectiveSeries = useMemo(
    () => normalizedBook ? resolveEffectiveSeriesMetadata(normalizedBook, seriesOverrides) : null,
    [normalizedBook, seriesOverrides],
  );

  // Book Details should show the same effective series that Series/TBR/export
  // already use, even when an older import only encoded it in the title. These
  // display fallbacks are not written back unless the reader actually changes
  // the Series fields.
  const displayBook = useMemo<UserBookRecord | null>(() => {
    if (!normalizedBook || !effectiveSeries) return normalizedBook;
    if (normalizedBook.work.seriesName?.trim()) return normalizedBook;
    return {
      ...normalizedBook,
      work: {
        ...normalizedBook.work,
        seriesName: effectiveSeries.name,
        seriesOrder: effectiveSeries.position ?? undefined,
      },
    };
  }, [effectiveSeries, normalizedBook]);

  useEffect(() => {
    if (!props.book || !normalizedBook) return;
    const before = props.book.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13]);
    const after = normalizedBook.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13]);
    if (JSON.stringify(before) !== JSON.stringify(after)) props.onUpdateBook(normalizedBook);
  }, [normalizedBook, props.book, props.onUpdateBook]);

  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    if (!normalizedBook || !effectiveSeries || normalizedBook.work.seriesName?.trim()) {
      props.onUpdateBook(updatedBook);
      return;
    }

    const unchangedInferredName = updatedBook.work.seriesName?.trim() === effectiveSeries.name;
    const unchangedInferredPosition = updatedBook.work.seriesOrder === (effectiveSeries.position ?? undefined);
    props.onUpdateBook({
      ...updatedBook,
      work: {
        ...updatedBook.work,
        seriesName: unchangedInferredName ? normalizedBook.work.seriesName : updatedBook.work.seriesName,
        seriesOrder: unchangedInferredPosition ? normalizedBook.work.seriesOrder : updatedBook.work.seriesOrder,
      },
    });
  };

  const viewSeries = () => {
    if (!normalizedBook || !effectiveSeries) return;
    openLibrarySeriesForBook(normalizedBook.id);
    props.onClose();
  };

  return (
    <div className="book-details-modal-host">
      <BookDetailsModalCore {...props} book={displayBook} onUpdateBook={handleUpdateBook} />
      {displayBook && <CatalogContributionLauncher book={displayBook} onUpdateBook={handleUpdateBook} />}
      {normalizedBook && <LibraryLoanReminderControl book={normalizedBook} onUpdateBook={handleUpdateBook} />}
      {normalizedBook && effectiveSeries && (
        <button
          type="button"
          onClick={viewSeries}
          className="fixed left-1/2 top-[max(.75rem,env(safe-area-inset-top))] z-[215] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--ink-gold)]/35 bg-[#17101b]/95 px-4 py-2.5 text-xs font-semibold text-[var(--ink-ivory)] shadow-2xl backdrop-blur-md transition hover:border-[var(--ink-gold)]/60"
          aria-label={`View ${effectiveSeries.name} series`}
        >
          <BookOpen className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" />
          <span className="truncate">{effectiveSeries.name}</span>
          <span className="shrink-0 text-[var(--ink-muted)]">· {seriesPositionLabel(normalizedBook, effectiveSeries.position, effectiveSeries.label)}</span>
          <span className="shrink-0 text-[var(--ink-gold)]">View series →</span>
        </button>
      )}
    </div>
  );
};
