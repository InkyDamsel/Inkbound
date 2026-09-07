import type { UserBookRecord } from '../../types';

export type LibraryLoanReminderKind = 'three-days' | 'due-today' | 'overdue';

export interface LibraryLoanReminder {
  id: string;
  bookId: string;
  title: string;
  dueDate: string;
  daysUntilDue: number;
  kind: LibraryLoanReminderKind;
  headline: string;
  detail: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateStart(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function daysUntilDate(dateValue: string, now = new Date()): number | null {
  const due = localDateStart(dateValue);
  if (due === null) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / DAY_MS);
}

export function buildLibraryLoanReminders(books: UserBookRecord[], now = new Date()): LibraryLoanReminder[] {
  return books.flatMap((book) => {
    if (book.ownership !== 'borrowed-library' || !book.libraryLoan?.dueDate) return [];
    const daysUntilDue = daysUntilDate(book.libraryLoan.dueDate, now);
    if (daysUntilDue === null || daysUntilDue > 3) return [];

    const kind: LibraryLoanReminderKind = daysUntilDue < 0
      ? 'overdue'
      : daysUntilDue === 0
        ? 'due-today'
        : 'three-days';

    const headline = kind === 'overdue'
      ? `${book.work.title} is overdue`
      : kind === 'due-today'
        ? `${book.work.title} is due today`
        : `${book.work.title} is due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;

    const detail = kind === 'overdue'
      ? `Library return date was ${book.libraryLoan.dueDate}.`
      : `Library return date: ${book.libraryLoan.dueDate}.`;

    return [{
      id: `library-loan:${book.id}:${book.libraryLoan.dueDate}:${kind}`,
      bookId: book.id,
      title: book.work.title,
      dueDate: book.libraryLoan.dueDate,
      daysUntilDue,
      kind,
      headline,
      detail,
    }];
  }).sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.title.localeCompare(b.title));
}

export function shouldScheduleLibraryLoan(book: UserBookRecord): boolean {
  return book.ownership === 'borrowed-library' && Boolean(book.libraryLoan?.dueDate);
}
