import React, { useEffect, useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { BookDetailsModal as BookDetailsModalCore } from './BookDetailsModalCore';
import { CatalogContributionLauncher } from './catalog/CatalogContributionLauncher';
import { EditionLccnControl } from './edition/EditionLccnControl';
import { LibraryLoanReminderControl } from './library/LibraryLoanReminderControl';
import { FinishOnTimeControl } from './reading/FinishOnTimeControl';
import { openLibrarySeriesForBook } from '../features/library/libraryNavigation';
import { resolveEffectiveSeriesMetadata, seriesPositionLabel } from '../features/series/seriesLibrary';
import { readSeriesOverrides } from '../features/series/seriesOverrides';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { notifyCloudDataUpdated } from '../features/sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../features/sync/storageKeys';
import { getRuntimeStorage, notifyRuntimeStorageChanged } from '../platform/runtimeStorage';
import type { Edition, ReadingSession, UserBookRecord } from '../types';
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

function normalizeOwnershipEdit(book: UserBookRecord): UserBookRecord {
  if (book.ownership === 'wishlist' && book.status === 'finished') {
    return {
      ...book,
      status: 'wishlist',
      dateFinished: undefined,
    };
  }

  if (book.ownership === 'borrowed-person' && book.libraryLoan) {
    return { ...book, libraryLoan: undefined };
  }

  return book;
}

function sessionSortKey(session: ReadingSession): string {
  return `${session.date}T${session.endTime || session.startTime || '00:00'}`;
}

function trackedProgress(session: ReadingSession | undefined, audiobook: boolean): number {
  if (!session) return 0;
  return audiobook ? Math.max(0, Math.floor((session.endTimestampSec ?? 0) / 60)) : Math.max(0, session.endPage ?? 0);
}

type CoreProps = React.ComponentProps<typeof BookDetailsModalCore>;
type BookDetailsModalProps = Omit<CoreProps, 'onUpdateSession' | 'onDeleteSession'> & Partial<Pick<CoreProps, 'onUpdateSession' | 'onDeleteSession'>>;

export const BookDetailsModal: React.FC<BookDetailsModalProps> = (props) => {
  const normalizedBook = useMemo(
    () => props.book ? normalizeBookIdentifiers(props.book) : null,
    [props.book],
  );
  const seriesOverrides = useMemo(() => readSeriesOverrides(), [normalizedBook?.id]);
  const effectiveSeries = useMemo(
    () => normalizedBook ? resolveEffectiveSeriesMetadata(normalizedBook, seriesOverrides) : null,
    [normalizedBook, seriesOverrides],
  );

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
    const before = props.book.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13, edition.lccn]);
    const after = normalizedBook.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13, edition.lccn]);
    if (JSON.stringify(before) !== JSON.stringify(after)) props.onUpdateBook(normalizedBook);
  }, [normalizedBook, props.book, props.onUpdateBook]);

  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    const normalizedUpdate = normalizeOwnershipEdit(updatedBook);

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

  const persistSessions = (nextSessions: ReadingSession[]) => {
    const storage = getRuntimeStorage();
    storage.setItem(SYNC_STORAGE_KEYS.sessions, JSON.stringify(nextSessions));
    notifyRuntimeStorageChanged(SYNC_STORAGE_KEYS.sessions);
    notifyCloudDataUpdated([SYNC_STORAGE_KEYS.sessions]);
  };

  const reconcileBookAfterSessionChange = (previous: ReadingSession | undefined, nextSessions: ReadingSession[]) => {
    if (!normalizedBook) return;
    const edition = getActiveEdition(normalizedBook);
    if (!edition) return;
    const audiobook = edition.format === 'audiobook';
    const related = nextSessions.filter((session) => session.bookId === normalizedBook.id).sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
    const latest = related.at(-1);
    const previousProgress = trackedProgress(previous, audiobook);
    const currentProgress = audiobook ? normalizedBook.progressMinutes : normalizedBook.progressPages;
    const nextTrackedProgress = trackedProgress(latest, audiobook);
    const manualProgressAhead = previous && currentProgress > previousProgress;
    const nextProgress = manualProgressAhead ? Math.max(currentProgress, nextTrackedProgress) : previous && currentProgress === previousProgress ? nextTrackedProgress : Math.max(currentProgress, nextTrackedProgress);
    const total = audiobook ? edition.audiobookDurationMins : edition.pageCount;
    const hasTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
    const progressPercentage = hasTotal ? Math.min(100, Math.round((nextProgress / total!) * 100)) : normalizedBook.progressPercentage;
    const reachedEnd = Boolean(hasTotal && nextProgress >= total!);
    const trackerHadFinishedBook = Boolean(previous && currentProgress === previousProgress && normalizedBook.progressPercentage === 100);
    const shouldUnfinish = trackerHadFinishedBook && hasTotal && !reachedEnd;

    handleUpdateBook({
      ...normalizedBook,
      progressPages: audiobook ? normalizedBook.progressPages : nextProgress,
      progressMinutes: audiobook ? nextProgress : normalizedBook.progressMinutes,
      progressPercentage,
      status: reachedEnd ? 'finished' : shouldUnfinish ? 'currently-reading' : normalizedBook.status,
      dateFinished: reachedEnd ? (normalizedBook.dateFinished ?? latest?.date) : shouldUnfinish ? undefined : normalizedBook.dateFinished,
      lastSessionDate: latest?.date,
    });
  };

  const fallbackUpdateSession = (updatedSession: ReadingSession) => {
    const previous = props.sessions.find((session) => session.id === updatedSession.id);
    const nextSessions = props.sessions.map((session) => session.id === updatedSession.id ? updatedSession : session);
    persistSessions(nextSessions);
    reconcileBookAfterSessionChange(previous, nextSessions);
  };

  const fallbackDeleteSession = (sessionId: string) => {
    const previous = props.sessions.find((session) => session.id === sessionId);
    const nextSessions = props.sessions.filter((session) => session.id !== sessionId);
    persistSessions(nextSessions);
    reconcileBookAfterSessionChange(previous, nextSessions);
  };

  const viewSeries = () => {
    if (!normalizedBook || !effectiveSeries) return;
    openLibrarySeriesForBook(normalizedBook.id);
    props.onClose();
  };

  return (
    <div className="book-details-modal-host">
      <BookDetailsModalCore
        {...props}
        book={displayBook}
        onUpdateBook={handleUpdateBook}
        onUpdateSession={props.onUpdateSession ?? fallbackUpdateSession}
        onDeleteSession={props.onDeleteSession ?? fallbackDeleteSession}
      />
      {displayBook && <CatalogContributionLauncher book={displayBook} onUpdateBook={handleUpdateBook} />}
      {normalizedBook && <EditionLccnControl book={normalizedBook} onUpdateBook={handleUpdateBook} />}
      {normalizedBook && <FinishOnTimeControl book={normalizedBook} sessions={props.sessions} onUpdateBook={handleUpdateBook} />}
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
