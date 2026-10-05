import type { ReadingSession, UserBookRecord } from '../../types';

const parseClock = (value?: string) => {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
};

export const getReadingSessionTimestamp = (session: ReadingSession): number => {
  const dateMatch = session.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return Number.NEGATIVE_INFINITY;

  const [, yearText, monthText, dayText] = dateMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const start = parseClock(session.startTime);
  const end = parseClock(session.endTime);
  const chosen = end ?? start ?? { hour: 12, minute: 0 };
  const timestamp = new Date(year, month - 1, day, chosen.hour, chosen.minute, 0, 0);

  if (start && end && (end.hour < start.hour || (end.hour === start.hour && end.minute < start.minute))) {
    timestamp.setDate(timestamp.getDate() + 1);
  }

  const value = timestamp.getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

const parseStoredTimestamp = (value?: string): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const parseDateOnly = (value?: string): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return parseStoredTimestamp(value);
  const [, yearText, monthText, dayText] = match;
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText), 12, 0, 0, 0).getTime();
};

/**
 * Recency for choosing which Currently Reading title should lead the dashboard.
 *
 * Current progress can be updated without creating reading activity, so the
 * exact progress-update timestamp is considered independently from sessions.
 * Session activity remains canonical reading evidence; this helper only decides
 * presentation order.
 */
export function getBookReadingRecency(
  book: UserBookRecord,
  sessions: ReadingSession[],
): number {
  const latestSession = sessions
    .filter((session) => session.bookId === book.id)
    .reduce((latest, session) => Math.max(latest, getReadingSessionTimestamp(session)), Number.NEGATIVE_INFINITY);

  return Math.max(
    parseStoredTimestamp(book.lastProgressUpdatedAt),
    latestSession,
    parseDateOnly(book.lastSessionDate),
    parseDateOnly(book.dateStarted),
    parseDateOnly(book.dateAdded),
  );
}

export function sortCurrentlyReadingByRecency(
  books: UserBookRecord[],
  sessions: ReadingSession[],
): UserBookRecord[] {
  return books
    .filter((book) => book.status === 'currently-reading')
    .slice()
    .sort((a, b) => {
      const difference = getBookReadingRecency(b, sessions) - getBookReadingRecency(a, sessions);
      return difference || a.work.title.localeCompare(b.work.title, undefined, { sensitivity: 'base', numeric: true });
    });
}
