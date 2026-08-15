import type { ReadingSession, UserBookRecord } from '../../types';

export interface ReadingPaceSummary {
  pagesPerHour?: number;
  remainingPages?: number;
  estimatedRemainingSeconds?: number;
  sampleMinutes: number;
  sampleSessions: number;
}

const parseLocalDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
  return parsed;
};

// Calendar-day math must use local date fields rather than fixed 24-hour
// millisecond jumps. Around DST transitions, a local day can be 23 or 25 hours.
const addLocalDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const finiteNonnegative = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

const positiveFiniteTotal = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const remainingPagesForBook = (book?: UserBookRecord) => {
  if (!book) return undefined;
  const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const totalPages = positiveFiniteTotal(edition?.pageCount);
  if (totalPages === undefined) return undefined;
  return Math.max(0, totalPages - finiteNonnegative(book.progressPages));
};

// Session endpoints are the canonical page-progress record when both exist.
// Fall back to pagesRead only for legacy sessions that do not have endpoints.
export const getSessionPagesRead = (
  session: Pick<ReadingSession, 'startPage' | 'endPage' | 'pagesRead'>,
) => {
  if (
    typeof session.startPage === 'number'
    && Number.isFinite(session.startPage)
    && typeof session.endPage === 'number'
    && Number.isFinite(session.endPage)
  ) {
    return Math.max(0, session.endPage - session.startPage);
  }

  return finiteNonnegative(session.pagesRead);
};

export const getSessionDurationMinutes = (
  session: Pick<ReadingSession, 'durationMinutes'>,
) => finiteNonnegative(session.durationMinutes);

// Audiobook timestamp endpoints are canonical when present. Fall back to the
// stored minutesListened value for legacy sessions without timestamp progress.
export const getSessionListeningMinutes = (
  session: Pick<ReadingSession, 'startTimestampSec' | 'endTimestampSec' | 'minutesListened'>,
) => {
  if (
    typeof session.startTimestampSec === 'number'
    && Number.isFinite(session.startTimestampSec)
    && typeof session.endTimestampSec === 'number'
    && Number.isFinite(session.endTimestampSec)
  ) {
    return Math.max(0, (session.endTimestampSec - session.startTimestampSec) / 60);
  }

  return finiteNonnegative(session.minutesListened);
};

export const localDateKey = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatDurationEstimate = (totalSeconds?: number) => {
  if (!totalSeconds || totalSeconds <= 0 || !Number.isFinite(totalSeconds)) return null;
  const rounded = Math.max(1, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
};

export const getReadingStreak = (sessions: ReadingSession[], throughDate = localDateKey()) => {
  const readingDates = new Set(
    sessions
      .filter((session) => getSessionDurationMinutes(session) > 0 && parseLocalDate(session.date) !== null)
      .map((session) => session.date),
  );

  let cursor = parseLocalDate(throughDate) ?? parseLocalDate(localDateKey())!;
  const todayKey = localDateKey(cursor);
  if (!readingDates.has(todayKey)) {
    cursor = addLocalDays(cursor, -1);
  }

  let streak = 0;
  while (readingDates.has(localDateKey(cursor))) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }
  return streak;
};

export const getDailyReadingMinutes = (sessions: ReadingSession[], date = localDateKey()) => {
  if (parseLocalDate(date) === null) return 0;
  return sessions
    .filter((session) => session.date === date && parseLocalDate(session.date) !== null)
    .reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
};

const validPageSessions = (sessions: ReadingSession[]) => sessions.filter((session) => {
  const pages = getSessionPagesRead(session);
  const minutes = getSessionDurationMinutes(session);
  return pages > 0 && minutes > 0 && parseLocalDate(session.date) !== null;
});

export const getCurrentPace = (
  session: Pick<ReadingSession, 'startPage' | 'endPage' | 'pagesRead' | 'durationMinutes'>,
  book?: UserBookRecord,
): ReadingPaceSummary => {
  const pages = getSessionPagesRead(session);
  const minutes = getSessionDurationMinutes(session);
  const remainingPages = remainingPagesForBook(book);

  if (pages <= 0 || minutes < 2) {
    return { remainingPages, sampleMinutes: minutes, sampleSessions: pages > 0 ? 1 : 0 };
  }

  const pagesPerHour = pages / (minutes / 60);
  const estimatedRemainingSeconds = remainingPages !== undefined && pagesPerHour > 0
    ? (remainingPages / pagesPerHour) * 3600
    : undefined;

  return {
    pagesPerHour,
    remainingPages,
    estimatedRemainingSeconds,
    sampleMinutes: minutes,
    sampleSessions: 1,
  };
};

export const getSevenDayAveragePace = (
  sessions: ReadingSession[],
  book: UserBookRecord,
  throughDate = localDateKey(),
): ReadingPaceSummary => {
  const through = parseLocalDate(throughDate) ?? parseLocalDate(localDateKey())!;
  const start = addLocalDays(through, -6);
  const eligible = validPageSessions(sessions).filter((session) => {
    if (session.bookId !== book.id) return false;
    const sessionDate = parseLocalDate(session.date);
    return sessionDate !== null && sessionDate >= start && sessionDate <= through;
  });
  const totalPages = eligible.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
  const totalMinutes = eligible.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
  const remainingPages = remainingPagesForBook(book);

  if (eligible.length < 2 || totalMinutes < 20 || totalPages <= 0) {
    return { remainingPages, sampleMinutes: totalMinutes, sampleSessions: eligible.length };
  }

  const pagesPerHour = totalPages / (totalMinutes / 60);
  const estimatedRemainingSeconds = remainingPages !== undefined && pagesPerHour > 0
    ? (remainingPages / pagesPerHour) * 3600
    : undefined;

  return {
    pagesPerHour,
    remainingPages,
    estimatedRemainingSeconds,
    sampleMinutes: totalMinutes,
    sampleSessions: eligible.length,
  };
};
