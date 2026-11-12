import type { ReadingSession, UserBookRecord } from '../../types';
import { selectPrimaryCurrentlyReadingBook } from './primaryReadingSelection';
import { sortCurrentlyReadingByRecency } from './readingRecency';

export function selectReadingWidgetBook(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  draft?: {
    selectedBookId?: string;
    isActive?: boolean;
    isFinished?: boolean;
    timerSeconds?: number;
  } | null,
): UserBookRecord | undefined {
  const draftHasLiveContext = Boolean(
    draft?.selectedBookId
      && (draft.isActive || draft.isFinished || (draft.timerSeconds ?? 0) > 0),
  );

  if (draftHasLiveContext) {
    const draftBook = books.find((book) => book.id === draft?.selectedBookId);
    if (draftBook) return draftBook;
  }

  return selectPrimaryCurrentlyReadingBook(books, sessions);
}

/** A stable, non-destructive carousel over the canonical Currently Reading set. */
export function readingWidgetCarousel(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  selectedBookId?: string | null,
) {
  const items = sortCurrentlyReadingByRecency(books, sessions);
  const selectedIndex = items.findIndex((book) => book.id === selectedBookId);
  const index = selectedIndex >= 0 ? selectedIndex : 0;
  return { items, index, selected: items[index], count: items.length };
}

export function adjacentReadingWidgetBookId(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  selectedBookId: string | undefined,
  direction: -1 | 1,
): string | undefined {
  const { items, index } = readingWidgetCarousel(books, sessions, selectedBookId);
  if (!items.length) return undefined;
  return items[(index + direction + items.length) % items.length].id;
}
