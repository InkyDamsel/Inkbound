import type { Edition, ReadingSession, UserBookRecord } from '../../types';
import { getActiveEdition } from './bookReadingState';
import { localDateKey } from './sessionAnalytics';

export type ProgressActivityKind = 'pages' | 'audiobook-minutes';

export interface ProgressActivityPrompt {
  bookId: string;
  editionId: string;
  kind: ProgressActivityKind;
  previousValue: number;
  nextValue: number;
  delta: number;
  date: string;
  activityKey: string;
}

const finiteNonnegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

const localTimeKey = (value = new Date()) =>
  `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

export function buildProgressActivityPrompt(
  book: UserBookRecord,
  nextPages: number | undefined,
  nextMinutes: number | undefined,
  now = new Date(),
  activityKey = `progress-confirmation-${crypto.randomUUID()}`,
): ProgressActivityPrompt | null {
  const edition = getActiveEdition(book);
  if (!edition) return null;

  if (edition.format === 'audiobook') {
    if (nextMinutes === undefined) return null;
    const previousValue = finiteNonnegative(book.progressMinutes);
    const nextValue = finiteNonnegative(nextMinutes);
    if (nextValue <= previousValue) return null;
    return {
      bookId: book.id,
      editionId: edition.id,
      kind: 'audiobook-minutes',
      previousValue,
      nextValue,
      delta: nextValue - previousValue,
      date: localDateKey(now),
      activityKey,
    };
  }

  if (nextPages === undefined) return null;
  const previousValue = finiteNonnegative(book.progressPages);
  const nextValue = finiteNonnegative(nextPages);
  if (nextValue <= previousValue) return null;
  return {
    bookId: book.id,
    editionId: edition.id,
    kind: 'pages',
    previousValue,
    nextValue,
    delta: nextValue - previousValue,
    date: localDateKey(now),
    activityKey,
  };
}

export function createConfirmedProgressSession(
  prompt: ProgressActivityPrompt,
  now = new Date(),
): ReadingSession {
  const time = localTimeKey(now);
  return {
    id: `sess-progress-${prompt.activityKey}`,
    bookId: prompt.bookId,
    editionId: prompt.editionId,
    activitySource: 'progress-confirmation',
    activityKey: prompt.activityKey,
    date: prompt.date,
    startTime: time,
    endTime: time,
    durationMinutes: 0,
    startPage: prompt.kind === 'pages' ? prompt.previousValue : undefined,
    endPage: prompt.kind === 'pages' ? prompt.nextValue : undefined,
    pagesRead: prompt.kind === 'pages' ? prompt.delta : undefined,
    startTimestampSec: prompt.kind === 'audiobook-minutes' ? prompt.previousValue * 60 : undefined,
    endTimestampSec: prompt.kind === 'audiobook-minutes' ? prompt.nextValue * 60 : undefined,
    minutesListened: prompt.kind === 'audiobook-minutes' ? prompt.delta : undefined,
    notes: 'Progress update confirmed as reading activity.',
  };
}

export function addConfirmedProgressActivity(
  sessions: ReadingSession[],
  prompt: ProgressActivityPrompt,
  now = new Date(),
): { sessions: ReadingSession[]; session: ReadingSession; added: boolean } {
  const existing = sessions.find((session) => session.activityKey === prompt.activityKey);
  if (existing) return { sessions, session: existing, added: false };
  const session = createConfirmedProgressSession(prompt, now);
  return { sessions: [session, ...sessions], session, added: true };
}

export function deriveProgressFromPercentage(
  edition: Edition,
  percentage: number,
): { progressPages?: number; progressMinutes?: number } {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0));
  if (edition.format === 'audiobook' && edition.audiobookDurationMins) {
    return { progressMinutes: Math.round((safe / 100) * edition.audiobookDurationMins) };
  }
  if (edition.pageCount) {
    return { progressPages: Math.round((safe / 100) * edition.pageCount) };
  }
  return {};
}
