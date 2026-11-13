import { createPortal } from 'react-dom';
import { useBookDetailsDialogFocus } from '../bookDetailsDialogFocus';
import React, { useEffect, useState } from 'react';
import { CalendarClock, Save, X } from 'lucide-react';
import type { UserBookRecord } from '../../types';

interface LibraryLoanReminderControlProps {
  book: UserBookRecord;
  onUpdateBook: (book: UserBookRecord) => void;
}

export const LibraryLoanReminderControl: React.FC<LibraryLoanReminderControlProps> = ({ book, onUpdateBook }) => {
  const [open, setOpen] = useState(false);
  const dialogRef = useBookDetailsDialogFocus(open, () => setOpen(false));
  const [borrowedDate, setBorrowedDate] = useState(book.libraryLoan?.borrowedDate ?? '');
  const [dueDate, setDueDate] = useState(book.libraryLoan?.dueDate ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setBorrowedDate(book.libraryLoan?.borrowedDate ?? '');
    setDueDate(book.libraryLoan?.dueDate ?? '');
    setError('');
  }, [book.id, book.libraryLoan?.borrowedDate, book.libraryLoan?.dueDate]);

  if (book.ownership !== 'borrowed-library') return null;

  const save = () => {
    if (!dueDate) {
      setError('Library books need a due-back date.');
      return;
    }
    if (borrowedDate && dueDate < borrowedDate) {
      setError('Return date cannot be before the borrowed date.');
      return;
    }
    const updated: UserBookRecord = {
      ...book,
      libraryLoan: {
        borrowedDate: borrowedDate || undefined,
        dueDate,
      },
    };
    onUpdateBook(updated);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[215] flex w-[min(calc(100vw-2rem),42rem)] -translate-x-1/2 items-center justify-center gap-3 rounded-2xl border border-[var(--ink-gold)]/45 bg-[#211526]/98 px-5 py-4 text-sm font-semibold text-[var(--ink-ivory)] shadow-2xl backdrop-blur-md transition hover:border-[var(--ink-gold)]/70 hover:bg-[#281a2e] sm:bottom-6 sm:w-auto sm:min-w-[22rem] sm:rounded-full sm:px-6 sm:py-3.5"
        aria-label={dueDate ? `Edit library return date. Due ${dueDate}` : 'Add required library return date'}
      >
        <CalendarClock className="h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
        <span className="min-w-0 text-center">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-gold)]">Library loan</span>
          <span className="block truncate">{dueDate ? `Due back ${dueDate} · Edit dates` : 'Add required due-back date'}</span>
        </span>
      </button>

      {open && createPortal(
        <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[260] flex items-end justify-center bg-black/80 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <section className="w-full max-w-lg rounded-t-3xl border border-[var(--ink-gold)]/30 bg-[#17101b] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-6" role="dialog" aria-modal="true" aria-label="Library loan dates" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-kicker">Library loan</p>
                <h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">Return reminders</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Library loans require a due-back date. Inkbound will remind you three days before the due date and again on the due date.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="quiet-shelf-icon-button shrink-0" aria-label="Close library loan editor"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-[var(--ink-ivory)]">Borrowed on<input type="date" value={borrowedDate} onChange={(event) => { setBorrowedDate(event.target.value); setError(''); }} className="inkbound-select mt-2 w-full" /></label>
              <label className="text-xs font-bold text-[var(--ink-ivory)]">Due back <span className="text-[var(--ink-gold)]">Required</span><input required type="date" value={dueDate} min={borrowedDate || undefined} onChange={(event) => { setDueDate(event.target.value); setError(''); }} className="inkbound-select mt-2 w-full" /></label>
            </div>

            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
            <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-xs leading-5 text-[var(--ink-muted)]">Borrowed from a person is tracked separately and does not require a return date. On Android, library due reminders are device notifications. On the web, they appear under the notification bell.</p>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setOpen(false)} className="quiet-shelf-secondary-action justify-center">Cancel</button>
              <button type="button" onClick={save} className="quiet-shelf-primary-action justify-center"><Save className="h-4 w-4" />Save loan dates</button>
            </div>
          </section>
        </div>
      , document.body)}
    </>
  );
};
