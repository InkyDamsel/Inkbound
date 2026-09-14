import assert from 'node:assert/strict';
import type { ReadingSession, UserBookRecord } from '../src/types';
import { getEffectivePagesReadForPeriod } from '../src/features/reading/readingPageTotals';
import { hasTrustworthyFinishedHistory } from '../src/features/reading/inkboundActivity';

const book = (overrides: Partial<UserBookRecord> = {}): UserBookRecord => ({
  id: 'book-1',
  work: {
    id: 'work-1',
    title: 'Reporting Regression Book',
    author: 'Inkbound',
    summary: '',
    genres: ['Fiction'],
    publicationYear: 2026,
  },
  activeEditionId: 'edition-1',
  editions: [{
    id: 'edition-1',
    format: 'paperback',
    pageCount: 500,
    coverGradient: '',
  }],
  status: 'finished',
  ownership: 'owned',
  progressPages: 0,
  progressMinutes: 0,
  progressPercentage: 100,
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-01-01',
  dateFinished: '2026-08-20',
  ...overrides,
});

const pageSession = (
  id: string,
  date: string,
  startPage: number,
  endPage: number,
): ReadingSession => ({
  id,
  bookId: 'book-1',
  date,
  startTime: '20:00',
  endTime: '20:30',
  durationMinutes: 30,
  startPage,
  endPage,
  pagesRead: Math.max(0, endPage - startPage),
});

// Imported/manual historical finishes with a real end date and known page count
// must contribute to historical page reports even when Inkbound never observed
// the original reading sessions.
{
  const imported = book({
    id: 'book-import-1',
    sourceOfImport: 'Library import',
    privateTags: ['imported'],
    importFinishedDateProvided: true,
    editions: [{
      id: 'edition-1',
      format: 'paperback',
      pageCount: 500,
      coverGradient: '',
      externalSource: 'import',
    }],
  });

  assert.equal(hasTrustworthyFinishedHistory(imported), true);
  assert.equal(
    getEffectivePagesReadForPeriod([imported], [], '2026-08-01', '2026-08-31'),
    500,
  );
  assert.equal(
    getEffectivePagesReadForPeriod([imported], [], '2026-07-01', '2026-07-31'),
    0,
  );
}

// A Finished flag without a valid historical end date is not enough to invent
// monthly/yearly reading history.
{
  const missingEndDate = book({ dateFinished: undefined });
  assert.equal(hasTrustworthyFinishedHistory(missingEndDate), false);
  assert.equal(
    getEffectivePagesReadForPeriod([missingEndDate], [], '2026-08-01', '2026-08-31'),
    0,
  );
}

// Tracked page sessions are authoritative period evidence. A 500-page book read
// 300 pages in July and 200 in August must be 300 + 200, not 300 + 500.
{
  const tracked = book({ progressPages: 500 });
  const sessions = [
    pageSession('july-pages', '2026-07-31', 0, 300),
    pageSession('august-pages', '2026-08-20', 300, 500),
  ];

  assert.equal(
    getEffectivePagesReadForPeriod([tracked], sessions, '2026-07-01', '2026-07-31'),
    300,
  );
  assert.equal(
    getEffectivePagesReadForPeriod([tracked], sessions, '2026-08-01', '2026-08-31'),
    200,
  );
  assert.equal(
    getEffectivePagesReadForPeriod([tracked], sessions, '2026-01-01', '2026-12-31'),
    500,
  );
}

// A later reread/session must not erase valid imported history from its original
// finish month. Only page evidence through the historical finish date suppresses
// the historical page-count fallback.
{
  const imported = book({
    id: 'book-1',
    sourceOfImport: 'Library import',
    privateTags: ['imported'],
    importFinishedDateProvided: true,
  });
  const reread = [pageSession('later-reread', '2026-09-05', 0, 40)];

  assert.equal(
    getEffectivePagesReadForPeriod([imported], reread, '2026-08-01', '2026-08-31'),
    500,
  );
  assert.equal(
    getEffectivePagesReadForPeriod([imported], reread, '2026-09-01', '2026-09-30'),
    40,
  );
}

console.log('Inkbound reporting math regressions passed.');
