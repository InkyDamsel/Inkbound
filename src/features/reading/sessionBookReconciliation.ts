import type { ReadingSession, UserBookRecord } from '../../types';
import { appendReadingCompletion, getActiveEdition } from './bookReadingState';
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
 * Finished and 100% are one canonical reader-facing state, so session bookkeeping
 * must never lower the stored percentage of an explicitly Finished title.
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
  const nextPages = isAudiobook ? book.progressPages : Math.max(book.progressPages, Math.max(0, updatedPages), Math.max(0, session.endPage ?? 0));
  const nextMinutes = isAudiobook ? Math.max(book.progressMinutes, Math.max(0, updatedMinutes)) : book.progressMinutes;
  const total = isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount;
  const completed = isAudiobook ? nextMinutes : nextPages;
  const hasKnownTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
  const reachedEnd = Boolean(hasKnownTotal && completed >= total!);
  const staysFinished = reachedEnd || book.status === 'finished';
  const progressPercentage = staysFinished
    ? 100
    : hasKnownTotal
      ? Math.min(100, Math.round((completed / total!) * 100))
      : book.progressPercentage;

  const updated: UserBookRecord = {
    ...book,
    progressPages: nextPages,
    progressMinutes: nextMinutes,
    progressPercentage,
    status: staysFinished ? 'finished' : 'currently-reading',
    dateStarted: book.dateStarted ?? session.date,
    dateFinished: reachedEnd ? session.date : book.status === 'finished' ? book.dateFinished : undefined,
    lastSessionDate: !book.lastSessionDate || session.date > book.lastSessionDate ? session.date : book.lastSessionDate,
  };
  return reachedEnd && book.status !== 'finished' ? appendReadingCompletion(updated, session.date, 'tracked') : updated;
}

/**
 * Reconciles tracked progress after a session is edited, moved, or deleted.
 * Manual progress ahead of the edited session is preserved. Explicit Finished
 * history is also preserved; session bookkeeping is never allowed to silently
 * rewrite a reader's chosen status back to Currently Reading or lower its stored
 * completion percentage below 100%.
 */
export function reconcileBookAfterSessionMutation(
  book: UserBookRecord,
  nextSessions: ReadingSession[],
  changedSession?: ReadingSession,
): UserBookRecord {
  const activeEdition = getActiveEdition(book);
  const isAudiobook = activeEdition?.format === 'audiobook';
  const activityRelated = nextSessions
    .filter((item) => item.bookId === book.id)
    .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
  // A confirmed manual progress delta is canonical activity evidence, not the
  // owner of the book's current progress. Book progress was already saved by the
  // explicit progress edit, so later editing/deleting that activity must not roll
  // the current page backward.
  const related = activityRelated.filter((item) => item.activitySource !== 'progress-confirmation');
  const latest = related.at(-1);
  const currentProgress = isAudiobook ? book.progressMinutes : book.progressPages;

  const previousRelated = changedSession
    ? [
        ...nextSessions.filter((item) => item.bookId === book.id && item.id !== changedSession.id && item.activitySource !== 'progress-confirmation'),
        ...(changedSession.bookId === book.id && changedSession.activitySource !== 'progress-confirmation' ? [changedSession] : []),
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
  const reachedEnd = Boolean(hasKnownTotal && nextProgress >= total!);
  const staysFinished = reachedEnd || book.status === 'finished';
  const progressPercentage = staysFinished
    ? 100
    : hasKnownTotal
      ? Math.min(100, Math.round((nextProgress / total!) * 100))
      : book.progressPercentage;

  return {
    ...book,
    progressPages: isAudiobook ? book.progressPages : nextProgress,
    progressMinutes: isAudiobook ? nextProgress : book.progressMinutes,
    progressPercentage,
    status: staysFinished ? 'finished' : book.status,
    dateFinished: reachedEnd
      ? book.dateFinished ?? latest?.date ?? localDateKey()
      : book.dateFinished,
    lastSessionDate: activityRelated.at(-1)?.date ?? book.lastSessionDate,
  };
}


function sessionCollectionsDiffer(left?: ReadingSession, right?: ReadingSession): boolean {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
}

/**
 * Reconciles canonical book progress when an entire session collection changes,
 * including cross-device additions/edits/deletions.
 *
 * The previous collection is used to distinguish session-owned progress from
 * manual progress that was already ahead. This lets a remote session edit or
 * delete move tracked progress backward when appropriate without erasing a
 * reader's independent manual correction.
 */
export function reconcileBooksAfterSessionCollectionChange(
  books: UserBookRecord[],
  previousSessions: ReadingSession[],
  nextSessions: ReadingSession[],
): UserBookRecord[] {
  const previousById = new Map(previousSessions.map((session) => [session.id, session]));
  const nextById = new Map(nextSessions.map((session) => [session.id, session]));
  const affectedBookIds = new Set<string>();

  new Set([...previousById.keys(), ...nextById.keys()]).forEach((id) => {
    const previous = previousById.get(id);
    const next = nextById.get(id);
    if (!sessionCollectionsDiffer(previous, next)) return;
    if (previous?.bookId) affectedBookIds.add(previous.bookId);
    if (next?.bookId) affectedBookIds.add(next.bookId);
  });

  if (!affectedBookIds.size) return books;

  return books.map((book) => {
    if (!affectedBookIds.has(book.id)) return book;

    const activeEdition = getActiveEdition(book);
    const isAudiobook = activeEdition?.format === 'audiobook';
    const previousRelated = previousSessions
      .filter((session) => session.bookId === book.id && session.activitySource !== 'progress-confirmation')
      .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
    const nextRelated = nextSessions
      .filter((session) => session.bookId === book.id && session.activitySource !== 'progress-confirmation')
      .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));

    const previousLatest = previousRelated.at(-1);
    const nextLatest = nextRelated.at(-1);
    const currentProgress = isAudiobook ? book.progressMinutes : book.progressPages;
    const previousTrackedProgress = previousLatest
      ? getSessionProgressEndpoint(previousLatest, isAudiobook, 'end')
      : 0;
    const nextTrackedProgress = nextLatest
      ? getSessionProgressEndpoint(nextLatest, isAudiobook, 'end')
      : previousLatest
        ? getSessionProgressEndpoint(previousLatest, isAudiobook, 'start')
        : currentProgress;

    const manualProgressAhead = currentProgress > previousTrackedProgress;
    const nextProgress = manualProgressAhead
      ? Math.max(currentProgress, nextTrackedProgress)
      : nextTrackedProgress;

    const total = isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount;
    const hasKnownTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
    const reachedEnd = Boolean(hasKnownTotal && nextProgress >= total!);
    const staysFinished = reachedEnd || book.status === 'finished';
    const progressPercentage = staysFinished
      ? 100
      : hasKnownTotal
        ? Math.min(100, Math.round((nextProgress / total!) * 100))
        : book.progressPercentage;

    return {
      ...book,
      progressPages: isAudiobook ? book.progressPages : nextProgress,
      progressMinutes: isAudiobook ? nextProgress : book.progressMinutes,
      progressPercentage,
      status: staysFinished
        ? 'finished'
        : nextRelated.length > 0
          ? 'currently-reading'
          : book.status,
      dateStarted: book.dateStarted ?? nextRelated[0]?.date,
      dateFinished: reachedEnd
        ? book.dateFinished ?? nextLatest?.date ?? localDateKey()
        : book.dateFinished,
      lastSessionDate: nextLatest?.date ?? book.lastSessionDate,
    };
  });
}


/**
 * Repairs a book/session mismatch when the session already existed before this
 * app process started (for example, after an upgrade). This is intentionally
 * monotonic: existing session evidence may advance current progress, but this
 * repair path never moves a reader backward. Session edit/delete paths use
 * reconcileBooksAfterSessionCollectionChange, which has the previous collection
 * needed to safely lower session-owned progress.
 */
export function reconcileBooksFromExistingSessionEvidence(
  books: UserBookRecord[],
  sessions: ReadingSession[],
): UserBookRecord[] {
  const sessionBookIds = new Set(
    sessions
      .filter((session) => session.activitySource !== 'progress-confirmation')
      .map((session) => session.bookId),
  );
  if (!sessionBookIds.size) return books;

  let changed = false;
  const nextBooks = books.map((book) => {
    if (!sessionBookIds.has(book.id)) return book;
    const reconciled = reconcileBookAfterSessionMutation(book, sessions);
    const related = sessions
      .filter((session) => session.bookId === book.id && session.activitySource !== 'progress-confirmation')
      .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
    const first = related[0];
    const next = first && !reconciled.dateStarted
      ? { ...reconciled, dateStarted: first.date }
      : reconciled;

    if (JSON.stringify(next) !== JSON.stringify(book)) changed = true;
    return next;
  });

  return changed ? nextBooks : books;
}
