import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import {
  getActiveEdition,
  getBookReadingState,
  reconcileFinishedBookProgress,
  withReadingStatus,
} from '../src/features/reading/bookReadingState';
import { hasTrustworthyFinishedHistory } from '../src/features/reading/inkboundActivity';
import {
  applySessionProgressToBook,
  reconcileBookAfterSessionMutation,
} from '../src/features/reading/sessionBookReconciliation';
import { analyzeLibraryIntegrity } from '../src/features/recovery/libraryIntegrity';
import {
  getCurrentPace,
  getReadingDates,
  getReadingStreak,
  getSessionListeningMinutes,
  getSessionPagesRead,
  getSevenDayAveragePace,
} from '../src/features/reading/sessionAnalytics';
import {
  AUXILIARY_ACCOUNT_KEYS,
  CORE_ACCOUNT_RUNTIME_KEYS,
  READING_MEMORIES_ACCOUNT_KEY,
  getAccountOwnedKeysToClearForOwnerChange,
  getAuxiliaryKeysToClearForOwnerChange,
} from '../src/features/sync/auxiliaryAccountSyncConfig';
import {
  shouldApplyRemoteTombstone,
  shouldPromoteLocalRecordMissingFromCloud,
  shouldRemoteChangeReplacePending,
} from '../src/features/sync/syncConflictPolicy';

const baseBook = (): UserBookRecord => ({
  id: 'book-1',
  work: { id: 'work-1', title: 'Regression Book', author: 'Inkbound', summary: '', genres: ['Fiction'], publicationYear: 2026 },
  activeEditionId: 'paper-500',
  editions: [
    { id: 'paper-400', format: 'paperback', pageCount: 400, coverGradient: '' },
    { id: 'paper-500', format: 'hardcover', pageCount: 500, coverGradient: '' },
  ],
  status: 'currently-reading', ownership: 'owned', progressPages: 190, progressMinutes: 0,
  progressPercentage: 0, privateTags: [], priority: 'medium', moods: [], collections: [], dateAdded: '2026-08-01',
});

const session = (overrides: Partial<ReadingSession>): ReadingSession => ({
  id: crypto.randomUUID(), bookId: 'book-1', date: '2026-08-15', startTime: '20:00', endTime: '20:30', durationMinutes: 30, ...overrides,
});

{
  const book = baseBook();
  assert.equal(getActiveEdition(book)?.id, 'paper-500');
  const state = getBookReadingState(book);
  assert.equal(state.totalUnits, 500);
  assert.equal(state.progressPercentage, 38);
}

// Finished and 100% are one reader-facing state. Imported history may not know
// the exact final page, so preserve the tracked endpoint while normalizing the
// completion percentage to 100.
{
  const finishedHistory = { ...baseBook(), status: 'finished' as const, progressPages: 190, progressPercentage: 38, dateFinished: '2026-08-15' };
  const reconciled = reconcileFinishedBookProgress(finishedHistory);
  assert.equal(reconciled.progressPages, 190);
  assert.equal(reconciled.progressPercentage, 100);
  const state = getBookReadingState(finishedHistory);
  assert.equal(state.completedUnits, 190);
  assert.equal(state.progressPercentage, 100);
  assert.equal(state.isFinished, true);
  assert.equal(state.progressNeedsCorrection, false);
  assert.equal(hasTrustworthyFinishedHistory(finishedHistory), true);
}

{
  const book = { ...baseBook(), status: 'finished' as const, dateFinished: '2026-08-15' };
  const corrected = withReadingStatus(book, 'currently-reading');
  assert.equal(corrected.status, 'currently-reading');
  assert.equal(corrected.dateFinished, undefined);
  assert.equal(corrected.progressPages, 190);
}

{
  const finished = withReadingStatus(baseBook(), 'finished', '2026-08-15');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.progressPages, 190);
  assert.equal(finished.progressPercentage, 100);
  assert.equal(finished.dateFinished, '2026-08-15');
  assert.equal(hasTrustworthyFinishedHistory(finished), true);
}

{
  const missingDate = { ...baseBook(), status: 'finished' as const, dateFinished: undefined };
  assert.equal(hasTrustworthyFinishedHistory(missingDate), false);
}

// A new tracked session that actually reaches a known endpoint can finish the book.
{
  const book = { ...baseBook(), progressPages: 450, progressPercentage: 90 };
  const completed = applySessionProgressToBook(
    book,
    session({ id: 'finish-session', startPage: 450, endPage: 500, pagesRead: 50 }),
    500,
    0,
  );
  assert.equal(completed.status, 'finished');
  assert.equal(completed.progressPages, 500);
  assert.equal(completed.progressPercentage, 100);
  assert.equal(completed.dateFinished, '2026-08-15');
}

// Editing/deleting a session may lower tracked progress, but it must never silently
// erase an explicit Finished reading-history fact or its date.
{
  const finished = {
    ...baseBook(),
    status: 'finished' as const,
    progressPages: 500,
    progressPercentage: 100,
    dateFinished: '2026-08-15',
    lastSessionDate: '2026-08-15',
  };
  const remaining = [session({ id: 'older', date: '2026-08-14', startPage: 100, endPage: 200, pagesRead: 100 })];
  const reconciled = reconcileBookAfterSessionMutation(finished, remaining);
  assert.equal(reconciled.status, 'finished');
  assert.equal(reconciled.dateFinished, '2026-08-15');
}

// Reading analytics must use real session values rather than inferred/imported history.
{
  const sessions = [
    session({ id: 's1', date: '2026-08-10', startPage: 10, endPage: 40, pagesRead: 30, durationMinutes: 30 }),
    session({ id: 's2', date: '2026-08-11', startPage: 40, endPage: 90, pagesRead: 50, durationMinutes: 60 }),
  ];
  assert.equal(getSessionPagesRead(sessions[0]), 30);
  assert.equal(getSessionListeningMinutes(sessions[0]), 0);
  assert.deepEqual(getReadingDates(sessions), ['2026-08-10', '2026-08-11']);
  assert.equal(getReadingStreak(sessions, '2026-08-11'), 2);

  const currentPace = getCurrentPace(sessions[1], baseBook());
  assert.equal(currentPace.pagesPerHour, 50);
  assert.equal(currentPace.remainingPages, 310);

  const sevenDayPace = getSevenDayAveragePace(sessions, baseBook(), '2026-08-11');
  assert.equal(sevenDayPace.sampleSessions, 2);
  assert.equal(sevenDayPace.sampleMinutes, 90);
  assert.ok(Math.abs((sevenDayPace.pagesPerHour ?? 0) - (80 / 1.5)) < 0.0001);
}

// Integrity analysis should still consider legitimate Finished history structurally healthy
// even when its exact final page was never recorded.
{
  const historical = { ...baseBook(), status: 'finished' as const, progressPages: 190, progressPercentage: 100, dateFinished: '2026-08-15' };
  const report = analyzeLibraryIntegrity([historical], []);
  assert.equal(report.bookCount, 1);
  assert.equal(report.missingActiveEditionCount, 0);
  assert.equal(report.orphanSessionCount, 0);
  assert.equal(report.healthy, true);
}

// Sync conflict rules protect newer/pending local work from stale cloud data.
{
  assert.equal(shouldRemoteChangeReplacePending({ remoteClientUpdatedAt: '2026-09-09T11:59:00.000Z', pendingClientUpdatedAt: '2026-09-09T12:00:00.000Z' }), false);
  assert.equal(shouldRemoteChangeReplacePending({ remoteClientUpdatedAt: '2026-09-09T12:01:00.000Z', pendingClientUpdatedAt: '2026-09-09T12:00:00.000Z' }), true);
  assert.equal(shouldApplyRemoteTombstone({ tombstoneServerMillis: 1000, latestRecordServerMillis: 2000 }), false);
  assert.equal(shouldApplyRemoteTombstone({ tombstoneServerMillis: 2000, latestRecordServerMillis: 1000 }), true);
  assert.equal(shouldPromoteLocalRecordMissingFromCloud({ hasCloudRecord: false, baselineFingerprint: undefined, hasPendingMutation: false }), true);
  assert.equal(shouldPromoteLocalRecordMissingFromCloud({ hasCloudRecord: true, baselineFingerprint: undefined, hasPendingMutation: false }), false);
}

// Account ownership cleanup must include all canonical core and auxiliary data.
{
  const core = getAccountOwnedKeysToClearForOwnerChange();
  const auxiliary = getAuxiliaryKeysToClearForOwnerChange();
  CORE_ACCOUNT_RUNTIME_KEYS.forEach((key) => assert.equal(core.includes(key), true));
  AUXILIARY_ACCOUNT_KEYS.forEach((key) => assert.equal(auxiliary.includes(key), true));
  assert.equal(auxiliary.includes(READING_MEMORIES_ACCOUNT_KEY), true);
}

console.log('Inkbound critical reading regressions passed.');
