import type { ReadingSession, UserBookRecord } from '../../types';

export interface ReadingPaceSummary {
  pagesPerHour?: number;
  remainingPages?: number;
  estimatedRemainingSeconds?: number;
  sampleMinutes: number;
  sampleSessions: number;
}

const parseLocalDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, Math.max(0, (month || 1) - 1), day || 1);
};

// Calendar-day math must use local date fields rather than fixed 24-hour
// millisecond jumps. Around DST transitions, a local day can be 23 or 25 hours.
const addLocalDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const positiveFiniteTotal = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const remainingPagesForBook = (book?: UserBookRecord) => {
  if (!book) return undefined;
  const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const totalPages = positiveFiniteTotal(edition?.pageCount);
  if (totalPages === undefined) return undefined;
  return Math.max(0, totalPages - Math.max(0, book.progressPages));
};

// Session endpoints are the canonical page-progress record when both exist.
// Fall back to pagesRead only for legacy sessions that do not have endpoints.
const pagesReadForSession = (
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

  return typeof session.pagesRead === 'number' && Number.isFinite(session.pagesRead)
    ? Math.max(0, session.pagesRead)
    : 0;
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
      .filter((session) => Math.max(0, session.durationMinutes) > 0)
      .map((session) => session.date),
  );

  let cursor = parseLocalDate(throughDate);
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

export const getDailyReadingMinutes = (sessions: ReadingSession[], date = localDateKey()) =>
  sessions
    .filter((session) => session.date === date)
    .reduce((sum, session) => sum + Math.max(0, session.durationMinutes), 0);

const validPageSessions = (sessions: ReadingSession[]) => sessions.filter((session) => {
  const pages = pagesReadForSession(session);
  const minutes = Math.max(0, session.durationMinutes);
  return pages > 0 && minutes > 0;
});

export const getCurrentPace = (
  session: Pick<ReadingSession, 'startPage' | 'endPage' | 'pagesRead' | 'durationMinutes'>,
  book?: UserBookRecord,
): ReadingPaceSummary => {
  const pages = pagesReadForSession(session);
  const minutes = Math.max(0, session.durationMinutes);
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
  const through = parseLocalDate(throughDate);
  const start = addLocalDays(through, -6);
  const eligible = validPageSessions(sessions).filter((session) => {
    if (session.bookId !== book.id) return false;
    const sessionDate = parseLocalDate(session.date);
    return sessionDate >= start && sessionDate <= through;
  });
  const totalPages = eligible.reduce((sum, session) => sum + pagesReadForSession(session), 0);
  const totalMinutes = eligible.reduce((sum, session) => sum + Math.max(0, session.durationMinutes), 0);
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
