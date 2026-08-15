import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import {
  getActiveEdition,
  getBookReadingState,
  reconcileFinishedBookProgress,
  withReadingStatus,
} from '../src/features/reading/bookReadingState';
import {
  getCurrentPace,
  getReadingDates,
  getReadingStreak,
  getSessionListeningMinutes,
  getSessionPagesRead,
  getSevenDayAveragePace,
} from '../src/features/reading/sessionAnalytics';

const baseBook = (): UserBookRecord => ({
  id: 'book-1',
  work: {
    id: 'work-1',
    title: 'Regression Book',
    author: 'Inkbound',
    summary: '',
    genres: ['Fiction'],
    publicationYear: 2026,
  },
  activeEditionId: 'paper-500',
  editions: [
    { id: 'paper-400', format: 'paperback', pageCount: 400, coverGradient: '' },
    { id: 'paper-500', format: 'hardcover', pageCount: 500, coverGradient: '' },
  ],
  status: 'currently-reading',
  ownership: 'owned',
  progressPages: 190,
  progressMinutes: 0,
  progressPercentage: 0,
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-08-01',
});

const session = (overrides: Partial<ReadingSession>): ReadingSession => ({
  id: crypto.randomUUID(),
  bookId: 'book-1',
  date: '2026-08-15',
  startTime: '20:00',
  endTime: '20:30',
  durationMinutes: 30,
  ...overrides,
});

// Active edition is canonical. Never silently use editions[0] when a different
// edition is selected.
{
  const book = baseBook();
  assert.equal(getActiveEdition(book)?.id, 'paper-500');
  const state = getBookReadingState(book);
  assert.equal(state.totalUnits, 500);
  assert.equal(state.progressPercentage, 38);
}

// Legacy/imported Finished records sometimes retained stale partial progress.
// Finished is authoritative when the active edition has a known endpoint, so
// those records must resolve to 100% without leaving a permanent warning.
{
  const staleFinished = {
    ...baseBook(),
    status: 'finished' as const,
    progressPages: 190,
    progressPercentage: 38,
    dateFinished: '2026-08-15',
  };
  const repaired = reconcileFinishedBookProgress(staleFinished);
  assert.equal(repaired.progressPages, 500);
  assert.equal(repaired.progressPercentage, 100);
  const state = getBookReadingState(staleFinished);
  assert.equal(state.completedUnits, 500);
  assert.equal(state.progressPercentage, 100);
  assert.equal(state.progressNeedsCorrection, false);
}

// Correcting a mistaken finished book back to currently-reading must remove the
// finish date without destroying the progress itself.
{
  const book = { ...baseBook(), status: 'finished' as const, dateFinished: '2026-08-15' };
  const corrected = withReadingStatus(book, 'currently-reading');
  assert.equal(corrected.status, 'currently-reading');
  assert.equal(corrected.dateFinished, undefined);
  assert.equal(corrected.progressPages, 190);
}

// Explicitly marking a known-length book Finished must canonicalize its endpoint.
{
  const finished = withReadingStatus(baseBook(), 'finished', '2026-08-15');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.progressPages, 500);
  assert.equal(finished.progressPercentage, 100);
  assert.equal(finished.dateFinished, '2026-08-15');
}

// Session endpoints override legacy aggregate fields so edits cannot leave stale
// pagesRead values driving statistics.
{
  assert.equal(getSessionPagesRead(session({ startPage: 100, endPage: 140, pagesRead: 999 })), 40);
  assert.equal(getSessionPagesRead(session({ pagesRead: 25 })), 25);
}

// Audiobook timestamp endpoints are canonical when present.
{
  assert.equal(
    getSessionListeningMinutes(session({ startTimestampSec: 120, endTimestampSec: 1920, minutesListened: 999 })),
    30,
  );
}

// Zero-duration placeholders never become reading days or streak entries.
{
  const sessions = [
    session({ id: 's1', date: '2026-08-13', durationMinutes: 20 }),
    session({ id: 's2', date: '2026-08-14', durationMinutes: 0 }),
    session({ id: 's3', date: '2026-08-14', durationMinutes: 25 }),
    session({ id: 's4', date: '2026-08-15', durationMinutes: 30 }),
  ];
  assert.deepEqual(getReadingDates(sessions), ['2026-08-13', '2026-08-14', '2026-08-15']);
  assert.equal(getReadingStreak(sessions, '2026-08-15'), 3);
}

// Current pace and remaining-time estimates must use canonical active-edition
// length and canonical endpoint pages.
{
  const book = baseBook();
  const pace = getCurrentPace(session({ startPage: 150, endPage: 190, durationMinutes: 40 }), book);
  assert.equal(pace.pagesPerHour, 60);
  assert.equal(pace.remainingPages, 310);
  assert.equal(Math.round((pace.estimatedRemainingSeconds ?? 0) / 60), 310);
}

// Seven-day pace ignores old sessions and requires enough valid recent activity.
{
  const book = baseBook();
  const sessions = [
    session({ id: 'recent-1', date: '2026-08-14', startPage: 100, endPage: 130, durationMinutes: 30 }),
    session({ id: 'recent-2', date: '2026-08-15', startPage: 130, endPage: 190, durationMinutes: 60 }),
    session({ id: 'old', date: '2026-08-01', startPage: 0, endPage: 100, durationMinutes: 30 }),
  ];
  const pace = getSevenDayAveragePace(sessions, book, '2026-08-15');
  assert.equal(pace.sampleSessions, 2);
  assert.equal(pace.sampleMinutes, 90);
  assert.equal(pace.pagesPerHour, 60);
  assert.equal(pace.remainingPages, 310);
}

console.log('Inkbound critical reading regressions passed.');
