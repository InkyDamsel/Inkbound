import type { ReadingSession, UserBookRecord } from '../../types';
import { getActiveEdition } from './bookReadingState';
import { localDateKey } from './sessionAnalytics';

export function sessionSortKey(session: ReadingSession): string {
  return `${session.date}T${session.endTime || session.startTime || '00:00'}`;
}

export function getSessionProgressEndpoint(
  session: ReadingSession,
  audiobook: boolean,
  edge: 'start' | 'end',
): number {
  if (audiobook) {
    const seconds = edge === 'start' ? session.startTimestampSec : session.endTimestampSec;
    return Math.max(0, Math.floor((seconds ?? 0) / 60));
  }
  const pages = edge === 'start' ? session.startPage : session.endPage;
  return Math.max(0, pages ?? 0);
}

/**
 * Applies a newly recorded session to the canonical book record.
 *
 * Reaching a known edition endpoint may mark a book Finished. The inverse is not
 * inferred: an existing Finished status is an explicit reading-history fact and
 * must not be erased merely because tracked page/minute progress is incomplete.
 */
export function applySessionProgressToBook(
  book: UserBookRecord,
  session: ReadingSession,
  updatedPages: number,
  updatedMinutes: number,
): UserBookRecord {
  if (book.id !== session.bookId) return book;
  const activeEdition = getActiveEdition(book);
  const isAudiobook = activeEdition?.format === 'audiobook';
  const nextPages = isAudiobook ? book.progressPages : Math.max(book.progressPages, Math.max(0, updatedPages));
  const nextMinutes = isAudiobook ? Math.max(book.progressMinutes, Math.max(0, updatedMinutes)) : book.progressMinutes;
  const total = isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount;
  const completed = isAudiobook ? nextMinutes : nextPages;
  const hasKnownTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
  const progressPercentage = hasKnownTotal
    ? Math.min(100, Math.round((completed / total) * 100))
    : book.progressPercentage;
  const reachedEnd = Boolean(hasKnownTotal && completed >= total!);

  return {
    ...book,
    progressPages: nextPages,
    progressMinutes: nextMinutes,
    progressPercentage,
    status: reachedEnd ? 'finished' : book.status === 'finished' ? 'finished' : 'currently-reading',
    dateStarted: book.dateStarted ?? session.date,
    dateFinished: reachedEnd
      ? book.dateFinished ?? session.date
      : book.status === 'finished'
        ? book.dateFinished
        : undefined,
    lastSessionDate: !book.lastSessionDate || session.date > book.lastSessionDate
      ? session.date
      : book.lastSessionDate,
  };
}

/**
 * Reconciles tracked progress after a session is edited, moved, or deleted.
 * Manual progress ahead of the edited session is preserved. Explicit Finished
 * history is also preserved; session bookkeeping is never allowed to silently
 * rewrite a reader's chosen status back to Currently Reading.
 */
export function reconcileBookAfterSessionMutation(
  book: UserBookRecord,
  nextSessions: ReadingSession[],
  changedSession?: ReadingSession,
): UserBookRecord {
  const activeEdition = getActiveEdition(book);
  const isAudiobook = activeEdition?.format === 'audiobook';
  const related = nextSessions
    .filter((item) => item.bookId === book.id)
    .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
  const latest = related.at(-1);
  const currentProgress = isAudiobook ? book.progressMinutes : book.progressPages;

  const previousRelated = changedSession
    ? [
        ...nextSessions.filter((item) => item.bookId === book.id && item.id !== changedSession.id),
        ...(changedSession.bookId === book.id ? [changedSession] : []),
      ].sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
    : [];
  const previousLatest = previousRelated.at(-1);
  const previousTrackedProgress = previousLatest
    ? getSessionProgressEndpoint(previousLatest, isAudiobook, 'end')
    : changedSession && changedSession.bookId === book.id
      ? getSessionProgressEndpoint(changedSession, isAudiobook, 'start')
      : undefined;
  const trackedProgress = latest
    ? getSessionProgressEndpoint(latest, isAudiobook, 'end')
    : changedSession && changedSession.bookId === book.id
      ? getSessionProgressEndpoint(changedSession, isAudiobook, 'start')
      : currentProgress;
  const hasManualProgressAhead = previousTrackedProgress !== undefined && currentProgress > previousTrackedProgress;
  const nextProgress = changedSession
    ? hasManualProgressAhead ? Math.max(currentProgress, trackedProgress) : trackedProgress
    : Math.max(currentProgress, trackedProgress);

  const total = isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount;
  const hasKnownTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
  const progressPercentage = hasKnownTotal
    ? Math.min(100, Math.round((nextProgress / total) * 100))
    : book.progressPercentage;
  const reachedEnd = Boolean(hasKnownTotal && nextProgress >= total!);

  return {
    ...book,
    progressPages: isAudiobook ? book.progressPages : nextProgress,
    progressMinutes: isAudiobook ? nextProgress : book.progressMinutes,
    progressPercentage,
    status: reachedEnd ? 'finished' : book.status,
    dateFinished: reachedEnd
      ? book.dateFinished ?? latest?.date ?? localDateKey()
      : book.dateFinished,
    lastSessionDate: latest?.date,
  };
}
