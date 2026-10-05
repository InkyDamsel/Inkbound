import type { UserBookRecord } from '../../types';
import { shouldScheduleLibraryLoan } from './libraryLoanReminders';

export interface NativeLoanReminderPlan {
  schedule: UserBookRecord[];
  cancelBookIds: string[];
}

function normalizedReminderIdentity(book: UserBookRecord): string {
  const dueDate = book.libraryLoan?.dueDate?.trim() ?? '';
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId);
  const isbn = activeEdition?.isbn13?.trim()
    || activeEdition?.isbn10?.trim()
    || activeEdition?.isbn?.trim()
    || '';
  const workId = book.work.externalWorkId?.trim() || book.work.id?.trim() || '';
  const title = book.work.title.trim().toLowerCase().replace(/\s+/g, ' ');
  const author = book.work.author.trim().toLowerCase().replace(/\s+/g, ' ');
  const itemIdentity = isbn || workId || `${title}::${author}`;
  return `${itemIdentity}::${dueDate}`;
}

/**
 * Produces one native reminder per real loan identity while explicitly
 * cancelling duplicate local records and loans that no longer qualify.
 *
 * Duplicate library records can legitimately exist in a reader's catalog, but
 * they must never create duplicate Android notifications for the same title/
 * edition due on the same day.
 */
export function buildNativeLoanReminderPlan(books: UserBookRecord[]): NativeLoanReminderPlan {
  const scheduledIdentity = new Set<string>();
  const schedule: UserBookRecord[] = [];
  const cancelBookIds: string[] = [];

  books.forEach((book) => {
    if (!shouldScheduleLibraryLoan(book)) {
      if (book.ownership === 'borrowed-library' || Boolean(book.libraryLoan)) {
        cancelBookIds.push(book.id);
      }
      return;
    }

    const identity = normalizedReminderIdentity(book);
    if (scheduledIdentity.has(identity)) {
      cancelBookIds.push(book.id);
      return;
    }

    scheduledIdentity.add(identity);
    schedule.push(book);
  });

  return { schedule, cancelBookIds };
}
