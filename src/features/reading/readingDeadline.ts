import type { Edition, ReadingSession, UserBookRecord } from '../../types';
import { getSessionDurationMinutes, getSessionPagesRead } from './sessionAnalytics';
import { getRemainingReadingUnits } from './bookReadingState';

const DAY_MS = 24 * 60 * 60 * 1000;

const localDateAtNoon = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const todayAtNoon = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
};

export type ReadingDeadlineSource = 'library-due-date' | 'finish-by';

export interface ReadingDeadlinePlan {
  deadline: string;
  source: ReadingDeadlineSource;
  daysRemaining: number;
  overdueDays: number;
  isDueToday: boolean;
  isComplete: boolean;
  isAudiobook: boolean;
  totalUnits: number | null;
  completedUnits: number;
  remainingUnits: number | null;
  unitsPerDay: number | null;
  estimatedMinutesPerDay: number | null;
  missingTotal: boolean;
}

export const effectiveReadingDeadline = (book: UserBookRecord): { deadline: string; source: ReadingDeadlineSource } | null => {
  if (book.ownership === 'borrowed-library' && book.libraryLoan?.dueDate) {
    return { deadline: book.libraryLoan.dueDate, source: 'library-due-date' };
  }
  return book.finishByDate ? { deadline: book.finishByDate, source: 'finish-by' } : null;
};

export const buildReadingDeadlinePlan = (
  book: UserBookRecord,
  edition: Edition | undefined,
  sessions: ReadingSession[],
): ReadingDeadlinePlan | null => {
  const deadlineInfo = effectiveReadingDeadline(book);
  if (!deadlineInfo) return null;
  const deadlineDate = localDateAtNoon(deadlineInfo.deadline);
  if (!deadlineDate) return null;

  const today = todayAtNoon();
  const rawDayDifference = Math.round((deadlineDate.getTime() - today.getTime()) / DAY_MS);
  const overdueDays = rawDayDifference < 0 ? Math.abs(rawDayDifference) : 0;
  const daysRemaining = rawDayDifference <= 0 ? (rawDayDifference === 0 ? 1 : 0) : rawDayDifference;
  const readingUnits = getRemainingReadingUnits(book);
  const isAudiobook = readingUnits.isAudiobook;
  const totalUnits = readingUnits.totalUnits ?? null;
  const completedUnits = readingUnits.completedUnits;
  const remainingUnits = readingUnits.remainingUnits ?? null;
  const isComplete = book.status === 'finished' || remainingUnits === 0;
  const unitsPerDay = !isComplete && remainingUnits !== null && daysRemaining > 0
    ? Math.ceil(remainingUnits / daysRemaining)
    : isComplete ? 0 : null;

  let estimatedMinutesPerDay: number | null = null;
  if (!isAudiobook && unitsPerDay && unitsPerDay > 0) {
    let totalPages = 0;
    let totalMinutes = 0;
    sessions.filter((session) => session.bookId === book.id).forEach((session) => {
      const pages = getSessionPagesRead(session);
      const minutes = getSessionDurationMinutes(session);
      if (pages > 0 && minutes > 0) {
        totalPages += pages;
        totalMinutes += minutes;
      }
    });
    if (totalPages > 0 && totalMinutes > 0) {
      const pagesPerMinute = totalPages / totalMinutes;
      estimatedMinutesPerDay = Math.max(1, Math.ceil(unitsPerDay / pagesPerMinute));
    }
  } else if (isAudiobook && unitsPerDay !== null) {
    estimatedMinutesPerDay = unitsPerDay;
  }

  return {
    deadline: deadlineInfo.deadline,
    source: deadlineInfo.source,
    daysRemaining,
    overdueDays,
    isDueToday: rawDayDifference === 0,
    isComplete,
    isAudiobook,
    totalUnits,
    completedUnits,
    remainingUnits,
    unitsPerDay,
    estimatedMinutesPerDay,
    missingTotal: totalUnits === null,
  };
};
