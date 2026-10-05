import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import { mergeBooksFromServer, mergeServerCollectionById } from '../src/features/sync/CloudServerRefreshBridge';

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
    },
  });
  assert.equal(merged[0].durationMinutes, 45, 'A pending local session edit must remain authoritative until uploaded.');
}

console.log('Inkbound cross-device sync regressions passed.');
