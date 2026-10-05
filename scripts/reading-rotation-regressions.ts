import assert from 'node:assert/strict';
import type { Format, Priority, ReadingSession, ReadingStatus, UserBookRecord } from '../src/types';
import { buildReadingRotationRows } from '../src/features/studio/readingRotation';

function book(options: {
  id: string;
  title: string;
  format: Format;
  status: ReadingStatus;
  priority?: Priority;
  dateFinished?: string;
  dateStarted?: string;
  dateAdded?: string;
  seriesName?: string;
  seriesOrder?: number;
}): UserBookRecord {
  return {
    id: options.id,
    work: {
      id: `work-${options.id}`,
      title: options.title,
      author: 'Test Author',
      summary: '',
      genres: [],
      publicationYear: 2026,
      seriesName: options.seriesName,
      seriesOrder: options.seriesOrder,
    },
    activeEditionId: `edition-${options.id}`,
    editions: [{
      id: `edition-${options.id}`,
      format: options.format,
      coverGradient: 'from-black to-black',
      coverUrl: `https://example.com/${options.id}.jpg`,
    }],
    status: options.status,
    ownership: 'owned',
    progressPages: 0,
    progressMinutes: 0,
    progressPercentage: options.status === 'finished' ? 100 : 0,
    privateTags: [],
    priority: options.priority ?? 'medium',
    moods: [],
    collections: [],
    dateAdded: options.dateAdded ?? '2026-01-01',
    dateStarted: options.dateStarted,
    dateFinished: options.dateFinished,
  };
}

const sessions: ReadingSession[] = [
  {
    id: 'session-current',
    bookId: 'ebook-current',
    date: '2026-10-04',
    startTime: '20:00',
    endTime: '20:30',
    durationMinutes: 30,
  },
];

{
  const books = [
    book({ id: 'ebook-finished-old', title: 'Old Finish', format: 'ebook', status: 'finished', dateFinished: '2026-09-01' }),
    book({ id: 'ebook-finished-new', title: 'Newest Finish', format: 'ebook', status: 'finished', dateFinished: '2026-10-01' }),
    book({ id: 'ebook-current', title: 'Current Ebook', format: 'ebook', status: 'currently-reading', dateStarted: '2026-09-30' }),
    book({ id: 'ebook-read-next', title: 'Explicit Read Next', format: 'ebook', status: 'tbr', priority: 'top' }),
    book({ id: 'ebook-high', title: 'High Priority', format: 'ebook', status: 'tbr', priority: 'high' }),
    book({ id: 'audio-current', title: 'Current Audio', format: 'audiobook', status: 'currently-reading' }),
    book({ id: 'physical-finished', title: 'Finished Hardcover', format: 'hardcover', status: 'finished', dateFinished: '2026-09-20' }),
    book({ id: 'physical-next', title: 'Paperback Next', format: 'paperback', status: 'tbr', priority: 'high' }),
  ];

  const rows = buildReadingRotationRows(books, sessions);
  assert.deepEqual(rows.map((row) => row.format), ['ebook', 'audiobook', 'physical']);

  const ebook = rows.find((row) => row.format === 'ebook')!;
  assert.equal(ebook.last.book?.id, 'ebook-finished-new', 'Last should use the most recently finished title in that format.');
  assert.equal(ebook.current.book?.id, 'ebook-current', 'Current should use currently-reading canonical status.');
  assert.equal(ebook.next.book?.id, 'ebook-read-next', 'Read Next/top priority should win the Next slot.');

  const physical = rows.find((row) => row.format === 'physical')!;
  assert.equal(physical.last.book?.id, 'physical-finished', 'Hardcover should resolve into the Physical row.');
  assert.equal(physical.next.book?.id, 'physical-next', 'Paperback should resolve into the same Physical row.');
}

{
  const books = [
    book({ id: 'series-current', title: 'Series Book 1', format: 'ebook', status: 'currently-reading', seriesName: 'Example Saga', seriesOrder: 1 }),
    book({ id: 'series-next', title: 'Series Book 2', format: 'ebook', status: 'tbr', priority: 'low', seriesName: 'Example Saga', seriesOrder: 2 }),
    book({ id: 'standalone-high', title: 'Standalone High', format: 'ebook', status: 'tbr', priority: 'high' }),
  ];
  const rows = buildReadingRotationRows(books, []);
  const ebook = rows.find((row) => row.format === 'ebook')!;
  assert.equal(ebook.next.book?.id, 'series-next', 'Next unread book in the active series should beat ordinary TBR priority.');
}

{
  const books = [
    book({ id: 'current-a', title: 'Current A', format: 'ebook', status: 'currently-reading', seriesName: 'Saga A', seriesOrder: 1 }),
    book({ id: 'current-b', title: 'Current B', format: 'ebook', status: 'currently-reading', seriesName: 'Saga B', seriesOrder: 1 }),
    book({ id: 'next-a', title: 'Next A', format: 'ebook', status: 'tbr', priority: 'low', seriesName: 'Saga A', seriesOrder: 2 }),
    book({ id: 'next-b', title: 'Next B', format: 'ebook', status: 'tbr', priority: 'low', seriesName: 'Saga B', seriesOrder: 2 }),
  ];

  const rows = buildReadingRotationRows(books, [], {
    ebook: { current: 'current-b' },
  });
  const ebook = rows.find((row) => row.format === 'ebook')!;
  assert.equal(ebook.current.book?.id, 'current-b', 'Manual Current selection should persist as the displayed current book.');
  assert.equal(ebook.current.selectionSource, 'manual');
  assert.equal(ebook.next.book?.id, 'next-b', 'Series-next resolution should follow the displayed Current selection.');
}

{
  const books = [
    book({ id: 'manual-only', title: 'Paused Ebook', format: 'ebook', status: 'paused' }),
  ];
  const automaticRows = buildReadingRotationRows(books, []);
  assert.equal(automaticRows.length, 1, 'A format already present in the library must remain available for manual slot selection.');
  assert.equal(automaticRows[0].last.book, undefined);
  assert.equal(automaticRows[0].current.book, undefined);
  assert.equal(automaticRows[0].next.book, undefined);

  const manualRows = buildReadingRotationRows(books, [], {
    ebook: { next: 'manual-only' },
  });
  assert.equal(manualRows[0].next.book?.id, 'manual-only', 'Manual fallback should fill a slot when no automatic rule matches.');
}

{
  const books = [
    book({ id: 'ebook-current', title: 'Only Ebook', format: 'ebook', status: 'currently-reading' }),
  ];
  const rows = buildReadingRotationRows(books, []);
  assert.deepEqual(rows.map((row) => row.format), ['ebook'], 'Unused reading formats should not render empty rows.');
}

console.log('Inkbound Reading Rotation regressions passed.');
