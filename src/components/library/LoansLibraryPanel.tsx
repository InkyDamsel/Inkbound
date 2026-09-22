import React, { useMemo } from 'react';
import { AlertTriangle, CalendarClock, Clock3, Library, TimerReset } from 'lucide-react';
import type { UserBookRecord } from '../../types';
import { getRemainingReadingUnits } from '../../features/reading/bookReadingState';
import { LIBRARY_SECTION_SORT_OPTIONS, compareLibraryDates, compareLibraryLabels, type LibrarySectionSortMode } from '../../features/library/librarySectionSort';
import { usePersistentState } from '../../hooks/usePersistentState';
import { BookCover } from '../BookCover';

interface LoansLibraryPanelProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const localDateAtNoon = (value?: string): Date | null => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const todayAtNoon = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
};

const formatDueDate = (value?: string) => {
  const date = localDateAtNoon(value);
  return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date';
};

export const LoansLibraryPanel: React.FC<LoansLibraryPanelProps> = ({ books, onSelectBook }) => {
  const [sortMode, setSortMode] = usePersistentState<LibrarySectionSortMode>('inkbound_loans_sort', 'az');
  const loans = useMemo(() => books
    .filter((book) => book.ownership === 'borrowed-library')
    .map((book) => {
      const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
      const dueDate = localDateAtNoon(book.libraryLoan?.dueDate);
      const rawDays = dueDate ? Math.round((dueDate.getTime() - todayAtNoon().getTime()) / DAY_MS) : null;
      const readingUnits = getRemainingReadingUnits(book);
      const isAudiobook = readingUnits.isAudiobook;
      const remainingUnits = readingUnits.remainingUnits ?? null;
      const daysForPace = rawDays !== null && rawDays >= 0 ? Math.max(1, rawDays) : 0;
      const unitsPerDay = remainingUnits !== null && daysForPace > 0 && book.status !== 'finished'
        ? Math.ceil(remainingUnits / daysForPace)
        : book.status === 'finished' || remainingUnits === 0 ? 0 : null;

      return { book, edition, rawDays, isAudiobook, remainingUnits, unitsPerDay };
    })
    .sort((a, b) => {
      if (sortMode === 'za') return compareLibraryLabels(b.book.work.title, a.book.work.title);
      if (sortMode === 'newest') {
        return compareLibraryDates(b.book.dateAdded, a.book.dateAdded) || compareLibraryLabels(a.book.work.title, b.book.work.title);
      }
      if (sortMode === 'oldest') {
        return compareLibraryDates(a.book.dateAdded, b.book.dateAdded) || compareLibraryLabels(a.book.work.title, b.book.work.title);
      }
      return compareLibraryLabels(a.book.work.title, b.book.work.title);
    }), [books, sortMode]);

  const overdueCount = loans.filter((loan) => loan.rawDays !== null && loan.rawDays < 0).length;
  const dueSoonCount = loans.filter((loan) => loan.rawDays !== null && loan.rawDays >= 0 && loan.rawDays <= 7).length;
  const missingDueDateCount = loans.filter((loan) => loan.rawDays === null).length;

  if (loans.length === 0) {
    return (
      <div className="inkbound-panel p-10 text-center sm:p-14">
        <Library className="mx-auto h-10 w-10 text-[#c5a059]/70" />
        <h2 className="mt-4 font-serif text-2xl text-[#f4efe6]">No library loans yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-[#ad9fac]">Books marked as borrowed from a library will appear here with their due dates and finish-on-time pace.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="inkbound-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#c5a059]">Library loans</span>
            <h2 className="mt-1 font-serif text-2xl text-[#f4efe6]">Finish before they go back</h2>
            <p className="mt-1 text-sm text-[#ad9fac]">Due dates and daily reading pace update from your current progress.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-sm text-[#ad9fac]">
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as LibrarySectionSortMode)} className="inkbound-select min-w-[140px]" aria-label="Sort library loans">
                {LIBRARY_SECTION_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-[#c5a059]/20 bg-[#0d0910] px-3 py-2 text-[#d8ccd7]"><b className="text-[#f4efe6]">{loans.length}</b> borrowed</span>
            {dueSoonCount > 0 && <span className="rounded-full border border-[#c5a059]/30 bg-[#c5a059]/10 px-3 py-2 text-[#e2bd66]">{dueSoonCount} due within 7 days</span>}
            {overdueCount > 0 && <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-rose-200">{overdueCount} overdue</span>}
            {missingDueDateCount > 0 && <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[#ad9fac]">{missingDueDateCount} need a due date</span>}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {loans.map(({ book, edition, rawDays, isAudiobook, remainingUnits, unitsPerDay }) => {
          const overdue = rawDays !== null && rawDays < 0;
          const dueToday = rawDays === 0;
          const dayLabel = rawDays === null
            ? 'Add a due date'
            : overdue
              ? `${Math.abs(rawDays)} day${Math.abs(rawDays) === 1 ? '' : 's'} overdue`
              : dueToday
                ? 'Due today'
                : `${rawDays} day${rawDays === 1 ? '' : 's'} left`;
          const unitLabel = isAudiobook ? 'min' : 'pages';

          return (
            <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="inkbound-panel group flex w-full gap-4 p-4 text-left transition hover:border-[#c5a059]/35 sm:p-5">
              <BookCover work={book.work} edition={edition} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-serif text-lg text-[#f4efe6] group-hover:text-white">{book.work.title}</h3>
                    <p className="truncate text-xs text-[#ad9fac]">{book.work.author}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${overdue ? 'bg-rose-400/10 text-rose-200' : dueToday ? 'bg-[#c5a059]/15 text-[#e2bd66]' : 'bg-white/5 text-[#cdbfcb]'}`}>{dayLabel}</span>
                </div>

                <div className="mt-4 grid gap-2 text-xs text-[#ad9fac] sm:grid-cols-2">
                  <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-[#c5a059]" /><span>Due {formatDueDate(book.libraryLoan?.dueDate)}</span></div>
                  {remainingUnits !== null && <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-[#c5a059]" /><span>{remainingUnits} {unitLabel} remaining</span></div>}
                </div>

                <div className="mt-4 rounded-2xl border border-[#c5a059]/16 bg-[#0d0910]/75 p-3">
                  {overdue ? (
                    <div className="flex items-center gap-2 text-sm text-rose-200"><AlertTriangle className="h-4 w-4" />This loan is past its due date.</div>
                  ) : unitsPerDay !== null ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm text-[#d8ccd7]"><TimerReset className="h-4 w-4 text-[#c5a059]" />Finish on time</span>
                      <strong className="text-base text-[#e2bd66]">{unitsPerDay === 0 ? 'Finished' : `${unitsPerDay} ${unitLabel}/day`}</strong>
                    </div>
                  ) : (
                    <div className="text-sm text-[#ad9fac]">{rawDays === null ? 'Open this book to add a library due date.' : `Add a ${isAudiobook ? 'duration' : 'page count'} to calculate your daily pace.`}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
