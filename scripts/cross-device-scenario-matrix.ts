import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import {
  mergeBooksFromServer,
  mergeServerCollectionById,
} from '../src/features/sync/cloudServerMergePolicy';
import {
  shouldApplyRemoteTombstone,
  shouldRemoteChangeReplacePending,
} from '../src/features/sync/syncConflictPolicy';
import {
  createTrustedDeleteMutation,
  createTrustedUpsertMutation,
  shouldCaptureReaderMutation,
} from '../src/features/sync/syncMutationPolicy';
import { reconcileBooksAfterSessionCollectionChange } from '../src/features/reading/sessionBookReconciliation';

const makeBook = (id = 'book-sync', progressPages = 0): UserBookRecord => ({
  id,
  work: {
    id: `work-${id}`,
    title: 'Cross-device test',
    author: 'Inkbound',
    summary: '',
    genres: [],
    publicationYear: 2026,
  },
  activeEditionId: `edition-${id}`,
  editions: [{
    id: `edition-${id}`,
    format: 'hardcover',
    pageCount: 400,
    coverGradient: '',
  }],
  status: 'currently-reading',
  ownership: 'owned',
  progressPages,
  progressMinutes: 0,
  progressPercentage: Math.round((progressPages / 400) * 100),
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-10-01',
});

const makeSession = (
  id: string,
  endPage: number,
  overrides: Partial<ReadingSession> = {},
): ReadingSession => ({
  id,
  bookId: 'book-sync',
  date: '2026-10-07',
  startTime: '15:16',
  endTime: '15:37',
  durationMinutes: 21,
  startPage: 0,
  endPage,
  pagesRead: endPage,
  activitySource: 'timer',
  ...overrides,
});

function receiveSession(
  book: UserBookRecord,
  currentSessions: ReadingSession[],
  serverSessions: ReadingSession[],
) {
  const nextSessions = mergeServerCollectionById(currentSessions, serverSessions, {});
  const nextBook = reconcileBooksAfterSessionCollectionChange(
    [book],
    currentSessions,
    nextSessions,
  )[0];
  return { nextBook, nextSessions };
}

// MATRIX 1: Device A adds a session -> Devices B/C receive it and book progress follows.
{
  const cloudSession = makeSession('session-added', 16);
  for (const device of ['B', 'C']) {
    const { nextBook, nextSessions } = receiveSession(makeBook(), [], [cloudSession]);
    assert.equal(nextSessions.length, 1, `Device ${device} must receive a newly added session.`);
    assert.equal(nextSessions[0].id, cloudSession.id);
    assert.equal(nextBook.progressPages, 16, `Device ${device} must derive Current Page from the received session.`);
    assert.equal(nextBook.progressPercentage, 4, `Device ${device} must derive Progress % from the received session.`);
  }
}

// MATRIX 2: Device A edits a session -> Devices B/C receive the edit and corrected progress.
{
  const before = makeSession('session-edited', 16);
  const edited = { ...before, endTime: '15:50', durationMinutes: 34, endPage: 40, pagesRead: 40 };
  for (const device of ['B', 'C']) {
    const { nextBook, nextSessions } = receiveSession(makeBook('book-sync', 16), [before], [edited]);
    assert.equal(nextSessions[0].durationMinutes, 34, `Device ${device} must receive session duration edits.`);
    assert.equal(nextSessions[0].endPage, 40, `Device ${device} must receive session page edits.`);
    assert.equal(nextBook.progressPages, 40, `Device ${device} book progress must follow the edited session.`);
  }
}

// MATRIX 3: Device A deletes a session -> Devices B/C remove it via the canonical tombstone rule.
{
  const existing = makeSession('session-deleted', 16);
  assert.equal(
    shouldApplyRemoteTombstone({ tombstoneServerMillis: 2000, latestRecordServerMillis: 1000 }),
    true,
    'A newer session tombstone must beat the older session record.',
  );
  for (const device of ['B', 'C']) {
    const nextSessions = [existing].filter((session) => session.id !== existing.id);
    const nextBook = reconcileBooksAfterSessionCollectionChange(
      [makeBook('book-sync', 16)],
      [existing],
      nextSessions,
    )[0];
    assert.equal(nextSessions.length, 0, `Device ${device} must remove the deleted session.`);
    assert.equal(nextBook.progressPages, 0, `Device ${device} must reconcile session-owned progress after deletion.`);
  }
}

// MATRIX 4: Device A edits a book -> Devices B/C receive the canonical cloud edit.
{
  const stale = makeBook('book-edited', 12);
  const cloud = { ...makeBook('book-edited', 88), lastProgressUpdatedAt: '2026-10-07T20:00:00.000Z' };
  for (const device of ['B', 'C']) {
    const merged = mergeBooksFromServer([stale], [cloud], {});
    assert.equal(merged[0].progressPages, 88, `Device ${device} must receive the cloud book edit.`);
  }
}

// MATRIX 5: stale Device B opens -> stale/pre-reconcile pending data cannot overwrite newer cloud.
{
  const stale = makeBook('stale-open', 10);
  const stalePending = { ...stale, progressPages: 12, progressPercentage: 3 };
  const cloud = { ...makeBook('stale-open', 210), lastProgressUpdatedAt: '2026-10-07T20:00:00.000Z' };
  const merged = mergeBooksFromServer([stale], [cloud], {
    'stale-open': {
      operation: 'upsert',
      data: stalePending,
      clientUpdatedAt: '2026-10-07T21:00:00.000Z',
      // Deliberately no capturedAfterCloudReconcile marker: old/stale intent.
    },
  });
  assert.equal(merged[0].progressPages, 210);
  assert.equal(
    shouldCaptureReaderMutation({ coreReconciled: false, localClearIntent: false }),
    false,
    'Startup/cache churn must not be captured before reconciliation.',
  );
}

// MATRIX 6: Device B edits after reconciliation -> fresh reader intent remains authoritative until upload.
{
  assert.equal(
    shouldCaptureReaderMutation({ coreReconciled: true, localClearIntent: false }),
    true,
  );
  const local = makeBook('fresh-edit', 150);
  const pending = createTrustedUpsertMutation(local, '2026-10-07T21:05:00.000Z');
  const olderCloud = makeBook('fresh-edit', 100);
  const merged = mergeBooksFromServer([local], [olderCloud], { 'fresh-edit': pending });
  assert.equal(merged[0].progressPages, 150);
  assert.equal(pending.capturedAfterCloudReconcile, true);
}

// MATRIX 7: offline edit -> durable trusted pending survives reconnect and later converges after upload.
{
  // Explicit canonical reader intent is captured even when this open cycle has
  // not been able to reconcile yet (for example: the app was opened offline).
  assert.equal(
    shouldCaptureReaderMutation({
      coreReconciled: false,
      localClearIntent: false,
      trustedReaderIntent: true,
    }),
    true,
    'An explicit offline reader edit must enter the durable pending queue before reconnect.',
  );
  assert.equal(
    shouldCaptureReaderMutation({
      coreReconciled: false,
      localClearIntent: false,
      trustedReaderIntent: false,
    }),
    false,
    'Unmarked startup/cache churn must remain blocked before reconciliation.',
  );
  const offlineEdit = makeBook('offline-edit', 73);
  const pending = createTrustedUpsertMutation(offlineEdit, '2026-10-07T21:10:00.000Z');
  const oldCloud = makeBook('offline-edit', 20);
  const beforeUpload = mergeBooksFromServer([offlineEdit], [oldCloud], { 'offline-edit': pending });
  assert.equal(beforeUpload[0].progressPages, 73, 'Offline pending edit must survive the reconnect reconciliation.');

  const afterUploadCloud = { ...offlineEdit };
  const afterAck = mergeBooksFromServer([offlineEdit], [afterUploadCloud], {});
  assert.equal(afterAck[0].progressPages, 73, 'After upload/ack, devices must converge on the offline edit.');
}

// MATRIX 8: old-build pending mutation -> cannot beat newer cloud even if its client clock is later.
{
  assert.equal(
    shouldRemoteChangeReplacePending({
      remoteServerMillis: Date.parse('2026-10-07T20:00:00.000Z'),
      remoteClientUpdatedAt: '2026-10-07T20:00:00.000Z',
      pendingClientUpdatedAt: '2026-10-07T21:00:00.000Z',
    }),
    false,
    'Raw timestamp policy alone would protect a later client timestamp; old-build trust must therefore be rejected before this policy is consulted.',
  );
  const local = makeBook('old-pending', 12);
  const cloud = makeBook('old-pending', 250);
  const merged = mergeBooksFromServer([local], [cloud], {
    'old-pending': {
      operation: 'upsert',
      data: { ...local, progressPages: 15 },
      clientUpdatedAt: '2026-10-07T23:00:00.000Z',
    },
  });
  assert.equal(merged[0].progressPages, 250, 'Untrusted legacy pending data must not beat cloud.');
}

// MATRIX 9: fresh pending mutation -> stays authoritative until uploaded, for books AND sessions.
{
  const pendingBook = createTrustedUpsertMutation(
    makeBook('fresh-pending', 99),
    '2026-10-07T21:20:00.000Z',
  );
  const mergedBook = mergeBooksFromServer(
    [makeBook('fresh-pending', 99)],
    [makeBook('fresh-pending', 30)],
    { 'fresh-pending': pendingBook },
  );
  assert.equal(mergedBook[0].progressPages, 99);

  const localSession = makeSession('fresh-session', 60);
  const cloudSession = makeSession('fresh-session', 30);
  const pendingSession = createTrustedUpsertMutation(localSession, '2026-10-07T21:20:00.000Z');
  const mergedSessions = mergeServerCollectionById(
    [localSession],
    [cloudSession],
    { 'fresh-session': pendingSession },
  );
  assert.equal(mergedSessions[0].endPage, 60);
}

// EXTRA: explicit local clear/delete intent is never accidentally recaptured,
// and trusted deletes retain the same post-reconcile trust marker as upserts.
{
  assert.equal(
    shouldCaptureReaderMutation({ coreReconciled: true, localClearIntent: true }),
    false,
  );
  const deletion = createTrustedDeleteMutation('2026-10-07T21:25:00.000Z');
  assert.equal(deletion.operation, 'delete');
  assert.equal(deletion.capturedAfterCloudReconcile, true);
}

console.log('Inkbound cross-device scenario matrix passed.');
