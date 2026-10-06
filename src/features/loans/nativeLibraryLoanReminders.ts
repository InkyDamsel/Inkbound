import { registerPlugin } from '@capacitor/core';
import type { UserBookRecord } from '../../types';
import { isNativeRuntime } from '../../platform/runtimePlatform';
import { shouldScheduleLibraryLoan } from './libraryLoanReminders';
import { buildNativeLoanReminderPlan } from './nativeLoanReminderPlan';
import { readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';

interface LoanReminderPlugin {
  schedule(options: { bookId: string; title: string; dueDate: string }): Promise<void>;
  cancel(options: { bookId: string }): Promise<void>;
}

const LoanReminder = registerPlugin<LoanReminderPlugin>('LoanReminder');
const NATIVE_LOAN_REMINDER_BOOK_IDS_KEY = 'inkbound_native_loan_reminder_book_ids_v2';

export async function syncNativeLibraryLoanReminder(book: UserBookRecord): Promise<void> {
  if (!isNativeRuntime()) return;
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
  if (!isNativeRuntime()) return;

  const previousBookIds = new Set(readRuntimeJson<string[]>(NATIVE_LOAN_REMINDER_BOOK_IDS_KEY, []));
  const plan = buildNativeLoanReminderPlan(books);
  const scheduledBookIds = new Set(plan.schedule.map((book) => book.id));

  // Cancel anything that used to be scheduled but no longer represents an
  // active canonical loan, plus duplicate/ineligible records identified by the
  // current plan. This closes deletion, ownership-change, and duplicate-record
  // holes instead of waiting for obsolete alarms to fire.
  const cancelIds = new Set<string>([
    ...plan.cancelBookIds,
    ...[...previousBookIds].filter((bookId) => !scheduledBookIds.has(bookId)),
  ]);

  await Promise.all([
    ...[...cancelIds].map((bookId) => LoanReminder.cancel({ bookId }).catch((error) => {
      console.warn('Inkbound could not cancel an obsolete library reminder.', error);
    })),
    ...plan.schedule.map(syncNativeLibraryLoanReminder),
  ]);

  writeRuntimeJson(NATIVE_LOAN_REMINDER_BOOK_IDS_KEY, [...scheduledBookIds]);
}
