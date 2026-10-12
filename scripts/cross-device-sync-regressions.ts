import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import { mergeBooksFromServer, mergeServerCollectionById } from '../src/features/sync/cloudServerMergePolicy';
import { shouldCreateDeleteMutation } from '../src/features/sync/syncMutationPolicy';
import { compareRecentlyAddedBooks } from '../src/features/library/libraryRecentSort';

{
  const older = { ...book(`book-${new Date('2026-10-12T12:00:00').getTime()}-abc123`, 0), dateAdded: '2026-10-12' };
  const newest = { ...book(`book-${new Date('2026-10-12T13:00:00').getTime()}-abc123`, 0), dateAdded: '2026-10-12' };
  const explicit = { ...book('imported-1', 0), dateAdded: '2026-10-12', dateAddedAt: '2026-10-12T23:59:00.000Z' };
  const ordered = [older, newest, explicit].sort(compareRecentlyAddedBooks);
  assert.equal(ordered[0].id, explicit.id, 'Exact addition timestamps must win over array order after sync.');
  assert.equal(ordered[1].id, newest.id, 'Legacy timestamped book IDs must restore recent order.');
  assert.equal(ordered[2].id, older.id, 'Older same-day additions must not jump ahead.');
  assert.equal(compareRecentlyAddedBooks(book('legacy-a', 0), book('legacy-b', 0)), 0,
    'Historical date-only books must retain stable existing order.');
}

const book = (id: string, progressPages: number, title = 'Sync Test'): UserBookRecord => ({
  id,
  work: {
    id: `work-${id}`,
    title,
    author: 'Inkbound',
    summary: '',
    genres: [],
    publicationYear: 2026,
  },
  activeEditionId: `edition-${id}`,
  editions: [{
    id: `edition-${id}`,
    format: 'ebook',
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

{
  const local = book('same-book', 25);
  const cloud = { ...book('same-book', 97), lastProgressUpdatedAt: '2026-10-05T18:00:00.000Z' };
  const merged = mergeBooksFromServer([local], [cloud], {});
  assert.equal(merged[0].progressPages, 97, 'Manual refresh must replace stale existing book progress with the saved account copy when no local mutation is pending.');
  assert.equal(merged[0].lastProgressUpdatedAt, cloud.lastProgressUpdatedAt);
}

{
  const local = book('pending-book', 25);
  const pendingBook = { ...local, progressPages: 81, progressPercentage: 20, lastProgressUpdatedAt: '2026-10-05T19:00:00.000Z' };
  const cloud = { ...book('pending-book', 40), lastProgressUpdatedAt: '2026-10-05T18:00:00.000Z' };
  const merged = mergeBooksFromServer([local], [cloud], {
    'pending-book': {
      operation: 'upsert',
      data: pendingBook,
      clientUpdatedAt: '2026-10-05T19:00:00.000Z',
      capturedAfterCloudReconcile: true,
    },
  });
  assert.equal(merged[0].progressPages, 81, 'A durable pending local edit must not be overwritten by manual cloud refresh.');
}

{
  const localSession: ReadingSession = {
    id: 'session-1',
    bookId: 'same-book',
    date: '2026-10-05',
    startTime: '18:00',
    endTime: '18:15',
    durationMinutes: 15,
    startPage: 25,
    endPage: 40,
    pagesRead: 15,
  };
  const cloudSession: ReadingSession = {
    ...localSession,
    endTime: '18:30',
    durationMinutes: 30,
    endPage: 55,
    pagesRead: 30,
  };
  const merged = mergeServerCollectionById([localSession], [cloudSession], {});
  assert.equal(merged[0].durationMinutes, 30, 'Manual refresh must reconcile edits to an existing canonical session.');
  assert.equal(merged[0].endPage, 55);
}

{
  const localSession: ReadingSession = {
    id: 'session-pending',
    bookId: 'same-book',
    date: '2026-10-05',
    startTime: '18:00',
    endTime: '18:20',
    durationMinutes: 20,
  };
  const cloudSession = { ...localSession, durationMinutes: 10, endTime: '18:10' };
  const pendingSession = { ...localSession, durationMinutes: 45, endTime: '18:45' };
  const merged = mergeServerCollectionById([localSession], [cloudSession], {
    'session-pending': {
      operation: 'upsert',
      data: pendingSession,
      clientUpdatedAt: '2026-10-05T19:00:00.000Z',
      capturedAfterCloudReconcile: true,
    },
  });
  assert.equal(merged[0].durationMinutes, 45, 'A pending local session edit captured after reconciliation must remain authoritative until uploaded.');
}

{
  const staleLocal = book('legacy-stale-book', 10);
  const stalePending = { ...staleLocal, progressPages: 12, progressPercentage: 3 };
  const cloud = { ...book('legacy-stale-book', 210), lastProgressUpdatedAt: '2026-10-07T14:00:00.000Z' };
  const merged = mergeBooksFromServer([staleLocal], [cloud], {
    'legacy-stale-book': {
      operation: 'upsert',
      data: stalePending,
      clientUpdatedAt: '2026-10-07T15:00:00.000Z',
    },
  });
  assert.equal(
    merged[0].progressPages,
    210,
    'Legacy/pre-reconcile pending state must never let a stale device overwrite the newer saved account copy.',
  );
}


{
  assert.equal(
    shouldCreateDeleteMutation({ hasCloudBaseline: true, explicitlyAuthorized: false }),
    false,
    'A cloud-backed book missing from a local working array must never become a delete without explicit reader authorization.',
  );
  assert.equal(
    shouldCreateDeleteMutation({ hasCloudBaseline: true, explicitlyAuthorized: true }),
    true,
    'An explicit reader deletion may create a delete mutation for a cloud-backed record.',
  );
  assert.equal(
    shouldCreateDeleteMutation({ hasCloudBaseline: false, explicitlyAuthorized: true }),
    false,
    'A record that never existed in the cloud baseline must not manufacture a cloud tombstone.',
  );
}

{
  const localOnly = book('locally-saved-not-in-snapshot', 12, 'Preserve My Book');
  const cloudOnly = book('cloud-only', 60);
  const merged = mergeBooksFromServer([localOnly], [cloudOnly], {});
  assert.deepEqual(
    merged.map((item) => item.id).sort(),
    ['cloud-only', 'locally-saved-not-in-snapshot'],
    'A partial cloud snapshot must not erase a locally saved book absent from the response.',
  );
}

{
  const localSession: ReadingSession = {
    id: 'local-session-not-in-snapshot',
    bookId: 'locally-saved-not-in-snapshot',
    date: '2026-10-09',
    startTime: '10:00',
    endTime: '10:20',
    durationMinutes: 20,
  };
  const merged = mergeServerCollectionById([localSession], [], {});
  assert.equal(merged.length, 1, 'A partial cloud snapshot must not erase a locally saved reading session.');
  assert.equal(merged[0].id, localSession.id);
}

{
  const local = book('manual-metadata', 33, 'Reader Corrected Title');
  const pending = {
    ...local,
    work: { ...local.work, author: 'Reader Corrected Author' },
  };
  const server = book('manual-metadata', 21, 'Stale Provider Title');
  const merged = mergeBooksFromServer([local], [server], {
    'manual-metadata': {
      operation: 'upsert',
      data: pending,
      clientUpdatedAt: '2026-10-10T20:00:00.000Z',
      capturedAfterCloudReconcile: true,
    },
  });
  assert.equal(merged[0].work.title, 'Reader Corrected Title', 'Pending reader title corrections must survive server refresh.');
  assert.equal(merged[0].work.author, 'Reader Corrected Author', 'Pending reader author corrections must survive server refresh.');
}

console.log('Inkbound cross-device sync regressions passed.');
