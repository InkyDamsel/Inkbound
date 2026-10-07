import type { ReadingSession, UserBookRecord } from '../../types';
import { sortCurrentlyReadingByRecency } from './readingRecency';

/**
 * Canonical selector for the reader's primary Currently Reading title.
 *
 * Any surface that needs "the" current book (home, widgets, future shortcuts)
 * must use this selector rather than inventing its own ordering rules.
 */
export function selectPrimaryCurrentlyReadingBook(
  books: UserBookRecord[],
  sessions: ReadingSession[],
): UserBookRecord | undefined {
  return sortCurrentlyReadingByRecency(books, sessions)[0];
}
