import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import {
  getDailyActivityCount,
  getDailyGoalMinutes,
  getDailyPagesRead,
  getReadingDates,
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionPagesRead,
  localDateKey,
} from '../src/features/reading/sessionAnalytics';
import {
  addConfirmedProgressActivity,
  buildProgressActivityPrompt,
  deriveProgressFromPercentage,
} from '../src/features/reading/progressActivity';
import { getEffectivePagesReadForPeriod } from '../src/features/reading/readingPageTotals';
import { reconcileBookAfterSessionMutation } from '../src/features/reading/sessionBookReconciliation';

const printBook = (overrides: Partial<UserBookRecord> = {}): UserBookRecord => ({
  id: 'book-print',
  work: {
    id: 'work-print',
    title: 'Daily Goal Regression',
    author: 'Inkbound',
    summary: '',
    genres: ['Fiction'],
    publicationYear: 2026,
  },
  activeEditionId: 'edition-print',
  editions: [{
    id: 'edition-print',
    format: 'ebook',
    pageCount: 400,
    coverGradient: '',
  }],
  status: 'currently-reading',
  ownership: 'owned',
  progressPages: 81,
  progressMinutes: 0,
  progressPercentage: 20,
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-10-01',
  ...overrides,
});

const audioBook = (): UserBookRecord => ({
  ...printBook(),
  id: 'book-audio',
  work: { ...printBook().work, id: 'work-audio', title: 'Audio Goal Regression' },
  activeEditionId: 'edition-audio',
  editions: [{
    id: 'edition-audio',
    format: 'audiobook',
    audiobookDurationMins: 600,
    coverGradient: '',
  }],
  progressPages: 0,
  progressMinutes: 81,
  progressPercentage: 14,
});

const session = (overrides: Partial<ReadingSession>): ReadingSession => ({
  id: 'session-base',
  bookId: 'book-print',
  date: '2026-10-05',
  startTime: '19:00',
  endTime: '19:30',
  durationMinutes: 30,
  ...overrides,
});

// Timer-based page credit comes from canonical session endpoints.
{
  const timer = session({
    id: 'timer',
    activitySource: 'timer',
    startPage: 81,
    endPage: 97,
    pagesRead: 16,
    durationMinutes: 30,
  });
  assert.equal(getSessionPagesRead(timer), 16);
  assert.equal(getDailyPagesRead([timer], '2026-10-05'), 16);
  assert.equal(getDailyActivityCount([timer], '2026-10-05'), 1);
}

// Manually added reading sessions count exactly the same way.
{
  const manual = session({
    id: 'manual',
    activitySource: 'manual-session',
    startPage: 10,
    endPage: 26,
    pagesRead: 16,
    durationMinutes: 20,
  });
  assert.equal(getDailyPagesRead([manual], '2026-10-05'), 16);
  assert.equal(getReadingStreak([manual], '2026-10-05'), 1);
}

// Confirmed manual progress delta creates canonical activity without inventing time.
{
  const prompt = buildProgressActivityPrompt(
    printBook(),
    97,
    undefined,
    new Date(2026, 9, 5, 21, 0, 0),
    'confirm-pages-81-97',
  );
  assert.ok(prompt);
  assert.equal(prompt.delta, 16);
  const result = addConfirmedProgressActivity([], prompt);
  assert.equal(result.added, true);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.session.activitySource, 'progress-confirmation');
  assert.equal(getSessionDurationMinutes(result.session), 0);
  assert.equal(getSessionPagesRead(result.session), 16);
  assert.equal(getDailyPagesRead(result.sessions, '2026-10-05'), 16);
  assert.deepEqual(getReadingDates(result.sessions), ['2026-10-05']);
  assert.equal(getReadingStreak(result.sessions, '2026-10-05'), 1);
}

// Declining the prompt means no canonical session was added, so page-goal credit is zero.
{
  const prompt = buildProgressActivityPrompt(printBook(), 97, undefined, new Date(2026, 9, 5), 'declined');
  assert.ok(prompt);
  const unchangedSessions: ReadingSession[] = [];
  assert.equal(getDailyPagesRead(unchangedSessions, prompt.date), 0);
  assert.equal(getDailyActivityCount(unchangedSessions, prompt.date), 0);
}

// Repeating the same confirmation is idempotent.
{
  const prompt = buildProgressActivityPrompt(printBook(), 97, undefined, new Date(2026, 9, 5), 'same-confirmation');
  assert.ok(prompt);
  const first = addConfirmedProgressActivity([], prompt);
  const second = addConfirmedProgressActivity(first.sessions, prompt);
  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal(second.sessions.length, 1);
  assert.equal(getDailyPagesRead(second.sessions, '2026-10-05'), 16);
}

// Moving backward/correcting current progress never invents pages.
{
  const backward = buildProgressActivityPrompt(printBook(), 60, undefined, new Date(2026, 9, 5), 'backward');
  assert.equal(backward, null);

  const same = buildProgressActivityPrompt(printBook(), 81, undefined, new Date(2026, 9, 5), 'same');
  assert.equal(same, null);
}

// Multiple legitimate updates on the same day add their separate confirmed deltas.
{
  const firstBook = printBook();
  const firstPrompt = buildProgressActivityPrompt(firstBook, 97, undefined, new Date(2026, 9, 5, 10), 'multi-1');
  assert.ok(firstPrompt);
  const first = addConfirmedProgressActivity([], firstPrompt);

  const secondBook = { ...firstBook, progressPages: 97 };
  const secondPrompt = buildProgressActivityPrompt(secondBook, 112, undefined, new Date(2026, 9, 5, 20), 'multi-2');
  assert.ok(secondPrompt);
  const second = addConfirmedProgressActivity(first.sessions, secondPrompt);
  assert.equal(getDailyPagesRead(second.sessions, '2026-10-05'), 31);
  assert.equal(getDailyActivityCount(second.sessions, '2026-10-05'), 2);
}

// Local calendar dates are the reset boundary, not a rolling 24-hour window.
{
  const late = session({
    id: 'late',
    date: '2026-10-05',
    startPage: 0,
    endPage: 8,
    pagesRead: 8,
  });
  const nextDay = session({
    id: 'next-day',
    date: '2026-10-06',
    startPage: 8,
    endPage: 24,
    pagesRead: 16,
  });
  assert.equal(getDailyPagesRead([late, nextDay], '2026-10-05'), 8);
  assert.equal(getDailyPagesRead([late, nextDay], '2026-10-06'), 16);
  assert.equal(localDateKey(new Date(2026, 9, 6, 0, 1)), '2026-10-06');
}

// Page reports consume the same confirmed activity session as the daily goal.
{
  const book = printBook({ progressPages: 97 });
  const prompt = buildProgressActivityPrompt(printBook(), 97, undefined, new Date(2026, 9, 5), 'report-shared-activity');
  assert.ok(prompt);
  const confirmed = addConfirmedProgressActivity([], prompt);
  assert.equal(getDailyPagesRead(confirmed.sessions, '2026-10-05'), 16);
  assert.equal(
    getEffectivePagesReadForPeriod([book], confirmed.sessions, '2026-10-05', '2026-10-05'),
    16,
  );
}

// Deleting/editing a progress-confirmation activity must not roll current book progress backward.
{
  const book = printBook({ progressPages: 97, progressPercentage: 24 });
  const prompt = buildProgressActivityPrompt(printBook(), 97, undefined, new Date(2026, 9, 5), 'reconcile-separation');
  assert.ok(prompt);
  const confirmed = addConfirmedProgressActivity([], prompt);
  const reconciled = reconcileBookAfterSessionMutation(book, [], confirmed.session);
  assert.equal(reconciled.progressPages, 97);
}

// Percentage changes only create page/minute activity when the active edition has a known total.
{
  const pageDerived = deriveProgressFromPercentage(printBook().editions[0], 25);
  assert.equal(pageDerived.progressPages, 100);

  const unknownTotalEdition = { ...printBook().editions[0], pageCount: undefined };
  assert.deepEqual(deriveProgressFromPercentage(unknownTotalEdition, 25), {});

  const audioDerived = deriveProgressFromPercentage(audioBook().editions[0], 20);
  assert.equal(audioDerived.progressMinutes, 120);
}

// Audiobook progress confirmation can satisfy time-based daily goals without a timer.
{
  const prompt = buildProgressActivityPrompt(
    audioBook(),
    undefined,
    97,
    new Date(2026, 9, 5, 21),
    'confirm-audio-81-97',
  );
  assert.ok(prompt);
  const confirmed = addConfirmedProgressActivity([], prompt);
  assert.equal(getDailyGoalMinutes(confirmed.sessions, '2026-10-05'), 16);
  assert.equal(getDailyPagesRead(confirmed.sessions, '2026-10-05'), 0);
}

console.log('Inkbound daily page goal regressions passed.');
