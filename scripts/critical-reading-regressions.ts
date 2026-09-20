import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { ReadingSession, UserBookRecord } from '../src/types';
import {
  getActiveEdition,
  getAverageBookProgress,
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

// Active-edition progress uses the selected edition total.
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

// Derived groupings must use the canonical reading-state resolver too. This is
// the exact regression that previously let a 16-book Finished collection show 0%.
{
  const importedFinishedBooks = Array.from({ length: 16 }, (_, index) => ({
    ...baseBook(),
    id: `finished-${index + 1}`,
    work: { ...baseBook().work, id: `work-${index + 1}`, title: `Finished ${index + 1}` },
    status: 'finished' as const,
    progressPages: 0,
    progressPercentage: 0,
    dateFinished: '2026-08-15',
  }));
  assert.equal(getAverageBookProgress(importedFinishedBooks), 100);
}

// Leaving Finished clears the finish date but does not invent or erase page progress.
{
  const book = { ...baseBook(), status: 'finished' as const, progressPercentage: 100, dateFinished: '2026-08-15' };
  const corrected = withReadingStatus(book, 'currently-reading');
  assert.equal(corrected.status, 'currently-reading');
  assert.equal(corrected.dateFinished, undefined);
  assert.equal(corrected.progressPages, 190);
}

// Explicitly marking Finished records the date and canonical 100% without inventing
// an exact final page endpoint.
{
  const finished = withReadingStatus(baseBook(), 'finished', '2026-08-15');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.progressPages, 190);
  assert.equal(finished.progressPercentage, 100);
  assert.equal(finished.dateFinished, '2026-08-15');
  assert.equal(hasTrustworthyFinishedHistory(finished), true);
}

{
  const missingDate = { ...baseBook(), status: 'finished' as const, progressPercentage: 100, dateFinished: undefined };
  assert.equal(hasTrustworthyFinishedHistory(missingDate), false);
}

// A new tracked session that actually reaches a known endpoint finishes the book.
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

// Logging or reconciling partial session progress against an already-Finished book
// must never downgrade its canonical completion state.
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
  assert.equal(reconciled.progressPercentage, 100);
  assert.equal(reconciled.dateFinished, '2026-08-15');

  const partialSession = applySessionProgressToBook(
    { ...finished, progressPages: 190 },
    session({ id: 'partial-after-finish', startPage: 190, endPage: 220, pagesRead: 30 }),
    220,
    0,
  );
  assert.equal(partialSession.status, 'finished');
  assert.equal(partialSession.progressPercentage, 100);
  assert.equal(partialSession.dateFinished, '2026-08-15');
}

// Reading analytics use real session values and deterministic date anchors.
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
  assert.equal(currentPace.sampleMinutes, 60);
  assert.equal(currentPace.sampleSessions, 1);

  const sevenDayPace = getSevenDayAveragePace(sessions, baseBook(), '2026-08-11');
  assert.equal(sevenDayPace.sampleSessions, 2);
  assert.equal(sevenDayPace.sampleMinutes, 90);
  assert.ok(Math.abs((sevenDayPace.pagesPerHour ?? 0) - (80 / 1.5)) < 0.0001);
}

// Malformed/reversed page endpoints never become negative reading-session totals.
{
  assert.equal(getSessionPagesRead(session({ startPage: 357, endPage: 52, pagesRead: -305 })), 0);
}

// Structural integrity should consider legitimate Finished history healthy even when
// its exact final page was never recorded.
{
  const historical = { ...baseBook(), status: 'finished' as const, progressPages: 190, progressPercentage: 100, dateFinished: '2026-08-15' };
  const report = analyzeLibraryIntegrity([historical], []);
  assert.equal(report.bookCount, 1);
  assert.equal(report.sessionCount, 0);
  assert.equal(report.missingActiveEditionCount, 0);
  assert.equal(report.duplicateBookIdCount, 0);
  assert.equal(report.duplicateSessionIdCount, 0);
  assert.equal(report.orphanSessionCount, 0);
  assert.equal(report.healthy, true);
}

// Sync conflict rules protect newer/pending local work from stale cloud data.
{
  assert.equal(shouldRemoteChangeReplacePending({ remoteClientUpdatedAt: '2026-09-09T11:59:00.000Z', pendingClientUpdatedAt: '2026-09-09T12:00:00.000Z' }), false);
  assert.equal(shouldRemoteChangeReplacePending({ remoteClientUpdatedAt: '2026-09-09T12:01:00.000Z', pendingClientUpdatedAt: '2026-09-09T12:00:00.000Z' }), true);
  assert.equal(shouldRemoteChangeReplacePending({ remoteServerMillis: Date.parse('2026-09-09T12:02:00.000Z'), remoteClientUpdatedAt: '2026-09-09T11:00:00.000Z', pendingClientUpdatedAt: '2026-09-09T12:00:00.000Z' }), true);

  // Bookly-style stale-device scenario: the device with old 52/617 data must
  // yield when the cloud has a newer server-confirmed 357/617 update.
  assert.equal(shouldRemoteChangeReplacePending({
    remoteServerMillis: Date.parse('2026-09-11T11:05:00.000Z'),
    remoteClientUpdatedAt: '2026-09-11T11:04:59.000Z',
    pendingClientUpdatedAt: '2026-09-11T11:00:00.000Z',
  }), true);

  assert.equal(shouldApplyRemoteTombstone({ tombstoneServerMillis: 1000, latestRecordServerMillis: 2000 }), false);
  assert.equal(shouldApplyRemoteTombstone({ tombstoneServerMillis: 2000, latestRecordServerMillis: 1000 }), true);

  assert.equal(shouldPromoteLocalRecordMissingFromCloud({ hasCloudRecord: false, baselineFingerprint: undefined, hasPendingMutation: false }), true);
  assert.equal(shouldPromoteLocalRecordMissingFromCloud({ hasCloudRecord: true, baselineFingerprint: undefined, hasPendingMutation: false }), false);
  assert.equal(shouldPromoteLocalRecordMissingFromCloud({ hasCloudRecord: false, baselineFingerprint: 'previous-cloud-version', hasPendingMutation: false }), false);
  assert.equal(shouldPromoteLocalRecordMissingFromCloud({ hasCloudRecord: false, baselineFingerprint: undefined, hasPendingMutation: true }), false);
}

// Account ownership cleanup only runs when switching between different authenticated
// readers, and it must include every canonical core/auxiliary account-owned key.
{
  const previousUid = 'reader-a';
  const nextUid = 'reader-b';
  const coreAndAuxiliary = getAccountOwnedKeysToClearForOwnerChange(previousUid, nextUid);
  const auxiliaryOnly = getAuxiliaryKeysToClearForOwnerChange(previousUid, nextUid);

  CORE_ACCOUNT_RUNTIME_KEYS.forEach((key) => assert.equal(coreAndAuxiliary.includes(key), true));
  Object.values(AUXILIARY_ACCOUNT_KEYS).forEach((key) => {
    assert.equal(coreAndAuxiliary.includes(key), true);
    assert.equal(auxiliaryOnly.includes(key), true);
  });
  assert.equal(coreAndAuxiliary.includes(READING_MEMORIES_ACCOUNT_KEY), true);
  assert.equal(auxiliaryOnly.includes(READING_MEMORIES_ACCOUNT_KEY), true);

  assert.deepEqual(getAccountOwnedKeysToClearForOwnerChange(previousUid, previousUid), []);
  assert.deepEqual(getAuxiliaryKeysToClearForOwnerChange(null, nextUid), []);
}

// Persistence-law guardrails: stale core pending writes must wait for a successful
// cloud reconciliation, and Collection icons must not be truncated before saving.
{
  const costSafeSource = fs.readFileSync(new URL('../src/features/sync/CostSafeCloudPersistenceBridge.tsx', import.meta.url), 'utf8');
  const deltaSource = fs.readFileSync(new URL('../src/features/sync/CrossDeviceDeltaSyncBridge.tsx', import.meta.url), 'utf8');
  const auxiliarySource = fs.readFileSync(new URL('../src/features/sync/AuxiliaryAccountSyncBridge.tsx', import.meta.url), 'utf8');
  const collectionsSource = fs.readFileSync(new URL('../src/components/CollectionsScreen.tsx', import.meta.url), 'utf8');
  const cloudRefreshBoundarySource = fs.readFileSync(new URL('../src/features/sync/CloudDataRefreshBoundary.tsx', import.meta.url), 'utf8');

  assert.match(costSafeSource, /INKBOUND_CORE_RECONCILED_EVENT/);
  assert.match(costSafeSource, /let coreReconciled = false/);
  assert.match(costSafeSource, /if \(!coreReconciled\) return Promise\.resolve\(\)/);
  assert.match(deltaSource, /notifyCoreCloudReconciled\(uid\)/);
  assert.match(auxiliarySource, /remoteServerMillis: remote\.updatedAt\?\.toMillis\(\) \?\? 0/);
  assert.match(deltaSource, /if \(baselineMatchesRemote\) return false/);
  assert.match(deltaSource, /baseline\.profile === stable\(profileRecord\.data\)/);
  assert.match(auxiliarySource, /baseline\[name\] === remoteFingerprint/);
  assert.doesNotMatch(auxiliarySource, /pending\[name\] = \{ data: localValue, clientUpdatedAt: now \};[\s\S]{0,120}localChangedAgainstKnownCloud/);
  assert.doesNotMatch(collectionsSource, /setEmoji\([^\n]*slice\(0,\s*4\)/);
  assert.match(collectionsSource, /updatedAt: now/);
  assert.doesNotMatch(cloudRefreshBoundarySource, /recoverIncompleteLatestImport/);
}

console.log('Inkbound critical reading regressions passed.');
