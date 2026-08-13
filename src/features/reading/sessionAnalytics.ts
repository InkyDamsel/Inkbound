import type { ReadingSession, UserBookRecord } from '../../types';

const DAY_MS = 24 * 60 * 60 * 1000;

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
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  let streak = 0;
  while (readingDates.has(localDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
};

export const getDailyReadingMinutes = (sessions: ReadingSession[], date = localDateKey()) =>
  sessions
    .filter((session) => session.date === date)
    .reduce((sum, session) => sum + Math.max(0, session.durationMinutes), 0);

const validPageSessions = (sessions: ReadingSession[]) => sessions.filter((session) => {
  const pages = Math.max(0, session.pagesRead ?? 0);
  const minutes = Math.max(0, session.durationMinutes);
  return pages > 0 && minutes > 0;
});

export const getCurrentPace = (
  session: Pick<ReadingSession, 'pagesRead' | 'durationMinutes'>,
  book?: UserBookRecord,
): ReadingPaceSummary => {
  const pages = Math.max(0, session.pagesRead ?? 0);
  const minutes = Math.max(0, session.durationMinutes);
  const edition = book?.editions.find((item) => item.id === book.activeEditionId) ?? book?.editions[0];
  const remainingPages = edition?.pageCount
    ? Math.max(0, edition.pageCount - Math.max(0, book?.progressPages ?? 0))
    : undefined;

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
  const through = parseLocalDate(throughDate).getTime();
  const start = through - 6 * DAY_MS;
  const eligible = validPageSessions(sessions).filter((session) => {
    if (session.bookId !== book.id) return false;
    const time = parseLocalDate(session.date).getTime();
    return time >= start && time <= through;
  });
  const totalPages = eligible.reduce((sum, session) => sum + Math.max(0, session.pagesRead ?? 0), 0);
  const totalMinutes = eligible.reduce((sum, session) => sum + Math.max(0, session.durationMinutes), 0);
  const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const remainingPages = edition?.pageCount
    ? Math.max(0, edition.pageCount - Math.max(0, book.progressPages))
    : undefined;

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
