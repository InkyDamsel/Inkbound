import { createPortal } from 'react-dom';
import { useBookDetailsDialogFocus } from '../bookDetailsDialogFocus';
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Save, X } from 'lucide-react';
import type { ReadingSession, UserBookRecord } from '../../types';
import { buildReadingDeadlinePlan } from '../../features/reading/readingDeadline';
import { useEmbeddedBookDetailsToolbar } from '../../platform/bookDetailsLayoutCapability';

interface FinishOnTimeControlProps {
  book: UserBookRecord;
  sessions: ReadingSession[];
  onUpdateBook: (book: UserBookRecord) => void;
}

const formatDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
};

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes} min/day`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min/day` : `${hours} hr/day`;
};

export const FinishOnTimeControl: React.FC<FinishOnTimeControlProps> = ({ book, sessions, onUpdateBook }) => {
  const [open, setOpen] = useState(false);
  const dialogRef = useBookDetailsDialogFocus(open, () => setOpen(false));
  const nativeDialogLayout = useEmbeddedBookDetailsToolbar();
  const [finishByDate, setFinishByDate] = useState(book.finishByDate ?? '');
  const [blockedByChildDialog, setBlockedByChildDialog] = useState(false);
  const activeEdition = useMemo(
    () => book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0],
    [book],
  );
  const plan = useMemo(() => buildReadingDeadlinePlan(book, activeEdition, sessions), [activeEdition, book, sessions]);
  const usesLibraryDueDate = book.ownership === 'borrowed-library' && Boolean(book.libraryLoan?.dueDate);

  useEffect(() => {
    setFinishByDate(book.finishByDate ?? '');
  }, [book.id, book.finishByDate]);

  useEffect(() => {
    const host = document.querySelector('.book-details-modal-host');
    if (!host) return;

    const updateBlockedState = () => {
      const blockingDialog = Array.from(host.querySelectorAll<HTMLElement>('section[role="dialog"]')).some((dialog) => {
        const label = dialog.getAttribute('aria-label');
        return label === 'Manage book cover'
          || label === 'Delete book confirmation'
          || (label !== null && label !== 'Finish on time' && dialog.closest('.book-details-modal-host') === host);
      });
      setBlockedByChildDialog(blockingDialog);
    };

    updateBlockedState();
    const observer = new MutationObserver(updateBlockedState);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [book.id]);

  const save = () => {
    onUpdateBook({ ...book, finishByDate: finishByDate || undefined });
    setOpen(false);
  };

  const primaryText = (() => {
    if (!plan) return usesLibraryDueDate ? 'Add a due date to calculate your pace' : 'Set a finish-by date';
    if (plan.isComplete) return 'Finished on time';
    if (plan.overdueDays > 0) return `Deadline passed ${plan.overdueDays} day${plan.overdueDays === 1 ? '' : 's'} ago`;
    if (plan.missingTotal) return `Finish by ${formatDate(plan.deadline)} · add ${plan.isAudiobook ? 'duration' : 'page count'} to calculate pace`;
    if (plan.unitsPerDay === null) return `Finish by ${formatDate(plan.deadline)}`;
    return plan.isAudiobook
      ? `${formatMinutes(plan.unitsPerDay)} to finish on time`
      : `${plan.unitsPerDay} pages/day to finish on time`;
  })();

  const secondaryText = plan && !plan.isComplete && plan.overdueDays === 0
    ? `${plan.isDueToday ? 'Due today' : `${plan.daysRemaining} day${plan.daysRemaining === 1 ? '' : 's'} left`}${plan.remainingUnits !== null ? ` · ${plan.remainingUnits} ${plan.isAudiobook ? 'minutes' : 'pages'} remaining` : ''}`
    : undefined;

  return (
    <>
      {!blockedByChildDialog && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`fixed left-1/2 z-[214] flex w-[min(calc(100vw-2rem),42rem)] -translate-x-1/2 items-center justify-center gap-3 rounded-2xl border border-[var(--ink-border)] bg-[#17101b]/96 px-5 py-3.5 text-sm font-semibold text-[var(--ink-ivory)] shadow-2xl backdrop-blur-md transition hover:border-[var(--ink-gold)]/55 ${book.ownership === 'borrowed-library' ? 'bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.4rem)] sm:bottom-[5.5rem]' : 'bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6 sm:w-auto sm:min-w-[22rem] sm:rounded-full'}`}
          aria-label={primaryText}
        >
          <Clock3 className="h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
          <span className="min-w-0 text-center">
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-gold)]">Finish on time</span>
            <span className="block truncate">{primaryText}</span>
            {secondaryText && <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--ink-muted)]">{secondaryText}</span>}
          </span>
        </button>
      )}

      {open && createPortal(
        <div ref={dialogRef} tabIndex={-1} className={`fixed inset-0 z-[270] flex justify-center bg-black/80 ${nativeDialogLayout ? "items-center overflow-y-auto p-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "items-end sm:items-center sm:p-4"}`} onClick={() => setOpen(false)}>
          <section className={`w-full max-w-lg border border-[var(--ink-gold)]/30 bg-[#17101b] p-5 shadow-2xl sm:p-6 ${nativeDialogLayout ? "my-auto min-h-0 max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain rounded-3xl" : "rounded-t-3xl pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl"}`} role="dialog" aria-modal="true" aria-label="Finish on time" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-kicker">Reading plan</p>
                <h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">Finish on time</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Inkbound recalculates from what you still have left, so your daily target gets easier when you read ahead.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="quiet-shelf-icon-button shrink-0" aria-label="Close finish-on-time planner"><X className="h-4 w-4" /></button>
            </div>

            {usesLibraryDueDate ? (
              <div className="mt-5 rounded-2xl border border-[var(--ink-gold)]/25 bg-[var(--ink-surface-soft)] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-gold)]">Library due date</p>
                <p className="mt-1 font-serif text-xl text-[var(--ink-ivory)]">{formatDate(book.libraryLoan!.dueDate!)}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">The library return date is your finish deadline automatically. Edit it from Library Loan if the due date changes.</p>
              </div>
            ) : (
              <label className="mt-5 block text-xs font-bold text-[var(--ink-ivory)]">Finish by
                <input type="date" value={finishByDate} onChange={(event) => setFinishByDate(event.target.value)} className="inkbound-select mt-2 w-full" />
              </label>
            )}

            <div className="mt-5 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              {!plan ? (
                <p className="text-sm text-[var(--ink-muted)]">Choose a deadline to see your daily reading target.</p>
              ) : plan.isComplete ? (
                <p className="text-sm font-semibold text-[var(--ink-ivory)]">You already finished this one.</p>
              ) : plan.overdueDays > 0 ? (
                <p className="text-sm font-semibold text-rose-300">This deadline has already passed by {plan.overdueDays} day{plan.overdueDays === 1 ? '' : 's'}.</p>
              ) : plan.missingTotal ? (
                <p className="text-sm text-[var(--ink-muted)]">Inkbound needs the {plan.isAudiobook ? 'audiobook duration' : 'page count'} for this edition before it can calculate a daily pace.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Remaining</span><strong className="mt-1 block text-lg text-[var(--ink-ivory)]">{plan.remainingUnits} {plan.isAudiobook ? 'min' : 'pages'}</strong></div>
                  <div><span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Time left</span><strong className="mt-1 block text-lg text-[var(--ink-ivory)]">{plan.isDueToday ? 'Today' : `${plan.daysRemaining} days`}</strong></div>
                  <div><span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Daily target</span><strong className="mt-1 block text-lg text-[var(--ink-gold)]">{plan.isAudiobook ? formatMinutes(plan.unitsPerDay ?? 0) : `${plan.unitsPerDay} pages`}</strong></div>
                </div>
              )}
              {plan?.estimatedMinutesPerDay && !plan.isAudiobook && !plan.isComplete && plan.overdueDays === 0 && !plan.missingTotal && (
                <p className="mt-4 flex items-center gap-2 border-t border-[var(--ink-border-subtle)] pt-3 text-xs text-[var(--ink-muted)]"><CalendarDays className="h-4 w-4 text-[var(--ink-gold)]" />Based on your sessions with this book, that is about {formatMinutes(plan.estimatedMinutesPerDay)}.</p>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setOpen(false)} className="quiet-shelf-secondary-action justify-center">Close</button>
              {!usesLibraryDueDate && <button type="button" onClick={save} className="quiet-shelf-primary-action justify-center"><Save className="h-4 w-4" />Save finish date</button>}
            </div>
          </section>
        </div>
      , document.body)}
    </>
  );
};