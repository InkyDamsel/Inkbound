import { registerPlugin } from '@capacitor/core';
import type { UserBookRecord } from '../../types';
import { isAndroidRuntime } from '../../platform/runtimePlatform';
import { shouldScheduleLibraryLoan } from './libraryLoanReminders';

interface LoanReminderPlugin {
  schedule(options: { bookId: string; title: string; dueDate: string }): Promise<void>;
  cancel(options: { bookId: string }): Promise<void>;
}

const LoanReminder = registerPlugin<LoanReminderPlugin>('LoanReminder');

export async function syncNativeLibraryLoanReminder(book: UserBookRecord): Promise<void> {
  if (!isAndroidRuntime()) return;
  try {
    if (!shouldScheduleLibraryLoan(book)) {
      await LoanReminder.cancel({ bookId: book.id });
      return;
    }
    await LoanReminder.schedule({
      bookId: book.id,
      title: book.work.title,
      dueDate: book.libraryLoan!.dueDate!,
    });
  } catch (error) {
    console.warn('Inkbound could not schedule the library return reminder.', error);
  }
}

export async function syncNativeLibraryLoanReminders(books: UserBookRecord[]): Promise<void> {
  if (!isAndroidRuntime()) return;
  // A large Inkbound library can contain tens of thousands of records. Only
  // records that are library loans (or retain loan metadata that may need an old
  // alarm cancelled) should ever cross the native bridge.
  const relevant = books.filter((book) => book.ownership === 'borrowed-library' || Boolean(book.libraryLoan));
  await Promise.all(relevant.map(syncNativeLibraryLoanReminder));
}
