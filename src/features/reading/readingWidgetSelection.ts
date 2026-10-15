import type { ReadingSession, UserBookRecord } from '../../types';
import { selectPrimaryCurrentlyReadingBook } from './primaryReadingSelection';
import { getReadingSessionTimestamp } from './readingRecency';

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
    if (draftBook && draftBook.status === 'currently-reading') {
      const newestRecordedSession = sessions.reduce(
        (latest, session) => Math.max(latest, getReadingSessionTimestamp(session)),
        Number.NEGATIVE_INFINITY,
      );
      const draftBookLatestSession = sessions
        .filter((session) => session.bookId === draftBook.id)
        .reduce((latest, session) => Math.max(latest, getReadingSessionTimestamp(session)), Number.NEGATIVE_INFINITY);
      // A stale timer draft must not override a more recently completed session.
      if (draft?.isActive || draftBookLatestSession >= newestRecordedSession) return draftBook;
    }
  }

  return selectPrimaryCurrentlyReadingBook(books, sessions);
}
