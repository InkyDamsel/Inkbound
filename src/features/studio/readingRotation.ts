import type { ReadingSession, UserBookRecord } from '../../types';
import { getActiveEdition } from '../reading/bookReadingState';
import { buildSeriesLibrary } from '../series/seriesLibrary';
import type { SeriesOverrides } from '../series/seriesOverrides';

export type ReadingRotationFormat = 'ebook' | 'audiobook' | 'physical';
export type ReadingRotationSlot = 'last' | 'current' | 'next';

export interface ReadingRotationSelections {
  ebook?: Partial<Record<ReadingRotationSlot, string>>;
  audiobook?: Partial<Record<ReadingRotationSlot, string>>;
  physical?: Partial<Record<ReadingRotationSlot, string>>;
}

export interface ReadingRotationSlotState {
  book?: UserBookRecord;
  candidates: UserBookRecord[];
  automaticBookId?: string;
  selectionSource: 'automatic' | 'manual' | 'empty';
}

export interface ReadingRotationRow {
  format: ReadingRotationFormat;
  label: string;
  last: ReadingRotationSlotState;
  current: ReadingRotationSlotState;
  next: ReadingRotationSlotState;
  selectableBooks: UserBookRecord[];
}

const FORMAT_LABELS: Record<ReadingRotationFormat, string> = {
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  physical: 'Physical',
};

const PRIORITY_RANK: Record<UserBookRecord['priority'], number> = {
  top: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const dateMillis = (value?: string) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export function readingRotationFormatForBook(book: UserBookRecord): ReadingRotationFormat | null {
  const format = getActiveEdition(book)?.format;
  if (format === 'ebook') return 'ebook';
  if (format === 'audiobook') return 'audiobook';
  if (format === 'hardcover' || format === 'paperback') return 'physical';
  return null;
}

function latestSessionMillis(bookId: string, sessions: ReadingSession[]) {
  let latest = 0;
  sessions.forEach((session) => {
    if (session.bookId !== bookId) return;
    latest = Math.max(latest, dateMillis(session.date));
  });
  return latest;
}

function mostRecentFinished(
  books: UserBookRecord[],
  sessions: ReadingSession[],
) {
  return books
    .filter((book) => book.status === 'finished')
    .slice()
    .sort((a, b) => {
      const aDate = dateMillis(a.dateFinished) || latestSessionMillis(a.id, sessions) || dateMillis(a.lastSessionDate);
      const bDate = dateMillis(b.dateFinished) || latestSessionMillis(b.id, sessions) || dateMillis(b.lastSessionDate);
      return bDate - aDate || a.work.title.localeCompare(b.work.title);
    });
}

function currentCandidates(
  books: UserBookRecord[],
  sessions: ReadingSession[],
) {
  return books
    .filter((book) => book.status === 'currently-reading')
    .slice()
    .sort((a, b) => {
      const aDate = latestSessionMillis(a.id, sessions) || dateMillis(a.lastSessionDate) || dateMillis(a.dateStarted);
      const bDate = latestSessionMillis(b.id, sessions) || dateMillis(b.lastSessionDate) || dateMillis(b.dateStarted);
      return bDate - aDate || a.work.title.localeCompare(b.work.title);
    });
}

function nextSeriesCandidate(
  books: UserBookRecord[],
  anchor: UserBookRecord | undefined,
  format: ReadingRotationFormat,
  overrides: SeriesOverrides,
): UserBookRecord | undefined {
  if (!anchor) return undefined;
  const series = buildSeriesLibrary(books, overrides)
    .find((group) => group.books.some((entry) => entry.book.id === anchor.id));
  if (!series) return undefined;

  const anchorIndex = series.books.findIndex((entry) => entry.book.id === anchor.id);
  if (anchorIndex < 0) return undefined;

  return series.books
    .slice(anchorIndex + 1)
    .map((entry) => entry.book)
    .find((book) =>
      book.status !== 'finished'
      && readingRotationFormatForBook(book) === format,
    );
}

function uniqueBooks(books: UserBookRecord[]) {
  const seen = new Set<string>();
  return books.filter((book) => {
    if (seen.has(book.id)) return false;
    seen.add(book.id);
    return true;
  });
}

function nextCandidates(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  format: ReadingRotationFormat,
  overrides: SeriesOverrides,
) {
  const current = currentCandidates(books, sessions)[0];
  const topPriority = books
    .filter((book) => book.status === 'tbr' && book.priority === 'top')
    .sort((a, b) => dateMillis(a.dateAdded) - dateMillis(b.dateAdded));

  const seriesNext = nextSeriesCandidate(books, current, format, overrides);

  const tbrPriority = books
    .filter((book) => book.status === 'tbr')
    .slice()
    .sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      || dateMillis(a.dateAdded) - dateMillis(b.dateAdded)
      || a.work.title.localeCompare(b.work.title),
    );

  return uniqueBooks([
    ...topPriority,
    ...(seriesNext ? [seriesNext] : []),
    ...tbrPriority,
  ]);
}

function resolveSlot(
  candidates: UserBookRecord[],
  selectableBooks: UserBookRecord[],
  manualBookId?: string,
): ReadingRotationSlotState {
  const automaticBook = candidates[0];
  const manualBook = manualBookId
    ? selectableBooks.find((book) => book.id === manualBookId)
    : undefined;

  if (manualBook) {
    return {
      book: manualBook,
      candidates,
      automaticBookId: automaticBook?.id,
      selectionSource: 'manual',
    };
  }

  if (automaticBook) {
    return {
      book: automaticBook,
      candidates,
      automaticBookId: automaticBook.id,
      selectionSource: 'automatic',
    };
  }

  return { candidates, selectionSource: 'empty' };
}

export function buildReadingRotationRows(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  selections: ReadingRotationSelections = {},
  seriesOverrides: SeriesOverrides = {},
): ReadingRotationRow[] {
  return (['ebook', 'audiobook', 'physical'] as const).flatMap((format) => {
    const formatBooks = books.filter((book) => readingRotationFormatForBook(book) === format);
    const lastCandidates = mostRecentFinished(formatBooks, sessions);
    const current = currentCandidates(formatBooks, sessions);
    const next = nextCandidates(formatBooks, sessions, format, seriesOverrides);
    const rowSelections = selections[format];

    const row: ReadingRotationRow = {
      format,
      label: FORMAT_LABELS[format],
      last: resolveSlot(lastCandidates, formatBooks, rowSelections?.last),
      current: resolveSlot(current, formatBooks, rowSelections?.current),
      next: resolveSlot(next, formatBooks, rowSelections?.next),
      selectableBooks: formatBooks
        .slice()
        .sort((a, b) => a.work.title.localeCompare(b.work.title, undefined, { sensitivity: 'base', numeric: true })),
    };

    return row.last.book || row.current.book || row.next.book ? [row] : [];
  });
}

export function hasReadingRotationContent(rows: ReadingRotationRow[]) {
  return rows.some((row) => row.last.book || row.current.book || row.next.book);
}
