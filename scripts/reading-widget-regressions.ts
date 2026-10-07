import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import { selectReadingWidgetBook } from '../src/features/reading/readingWidgetSelection';

const book = (
  id: string,
  title: string,
  lastSessionDate?: string,
): UserBookRecord => ({
  id,
  work: {
    id: `work-${id}`,
    title,
    author: 'Test Author',
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
  progressPages: 0,
  progressMinutes: 0,
  progressPercentage: 0,
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-09-01',
  lastSessionDate,
});

const session = (
  id: string,
  bookId: string,
  date: string,
  startTime: string,
  endTime: string,
): ReadingSession => ({
  id,
  bookId,
  date,
  startTime,
  endTime,
  durationMinutes: 20,
  startPage: 0,
  endPage: 16,
  pagesRead: 16,
  activitySource: 'timer',
});

// A stale idle timer draft must not pin the widget to an older title.
{
  const tom = book('tom', 'Tom Clancy Target Acquired', '2026-10-01');
  const splintered = book('splintered', 'Splintered', '2026-10-07');
  const sessions = [
    session('splintered-session', 'splintered', '2026-10-07', '15:16', '15:37'),
  ];

  const selected = selectReadingWidgetBook(
    [tom, splintered],
    sessions,
    {
      selectedBookId: 'tom',
      isActive: false,
      isFinished: false,
      timerSeconds: 0,
    },
  );

  assert.equal(
    selected?.id,
    'splintered',
    'Idle stale draft must yield to the most recently read Currently Reading book.',
  );
}

// An active timer still owns the widget even if another book was read more recently.
{
  const tom = book('tom', 'Tom Clancy Target Acquired', '2026-10-01');
  const splintered = book('splintered', 'Splintered', '2026-10-07');
  const selected = selectReadingWidgetBook(
    [tom, splintered],
    [session('splintered-session', 'splintered', '2026-10-07', '15:16', '15:37')],
    {
      selectedBookId: 'tom',
      isActive: true,
      isFinished: false,
      timerSeconds: 120,
    },
  );

  assert.equal(
    selected?.id,
    'tom',
    'Active timer book must remain the widget title while the timer is running.',
  );
}

// With no timer context, widget ordering must match the dashboard's reading recency.
{
  const older = book('older', 'Older', '2026-10-01');
  const newer = book('newer', 'Newer', '2026-10-05');
  const selected = selectReadingWidgetBook([older, newer], [], null);
  assert.equal(selected?.id, 'newer');
}

console.log('Inkbound reading widget selection regressions passed.');
