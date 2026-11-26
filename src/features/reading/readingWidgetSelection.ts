import type { ReadingSession, UserBookRecord } from '../../types';
import { selectPrimaryCurrentlyReadingBook } from './primaryReadingSelection';

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
