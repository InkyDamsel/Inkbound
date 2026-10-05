import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import { buildNativeLoanReminderPlan } from '../src/features/loans/nativeLoanReminderPlan';

const loan = (
  id: string,
  title: string,
  dueDate: string,
  overrides: Partial<UserBookRecord> = {},
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
    format: 'ebook',
    pageCount: 300,
    coverGradient: '',
  }],
  status: 'want-to-read',
  ownership: 'borrowed-library',
  libraryLoan: { dueDate },
  progressPages: 0,
  progressMinutes: 0,
  progressPercentage: 0,
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-10-01',
  ...overrides,
});

{
  const first = loan('duplicate-a', 'The Silent Patient', '2026-10-05');
  const second = loan('duplicate-b', 'The Silent Patient', '2026-10-05');
  const plan = buildNativeLoanReminderPlan([first, second]);
  assert.equal(plan.schedule.length, 1, 'Duplicate local records for the same title and due date must schedule only one native reminder.');
  assert.deepEqual(plan.cancelBookIds, ['duplicate-b'], 'The duplicate record must have its obsolete native reminder cancelled.');
}

{
  const firstLoan = loan('renewed-a', 'The Silent Patient', '2026-10-05');
  const renewedLoan = loan('renewed-b', 'The Silent Patient', '2026-10-20');
  const plan = buildNativeLoanReminderPlan([firstLoan, renewedLoan]);
  assert.equal(plan.schedule.length, 2, 'Different due dates represent different loan reminders and must not be deduplicated.');
}

{
  const returned = loan('returned', 'Returned Book', '2026-10-05', {
    ownership: 'owned',
  });
  const plan = buildNativeLoanReminderPlan([returned]);
  assert.equal(plan.schedule.length, 0, 'A book that is no longer a library loan must not remain scheduled.');
  assert.deepEqual(plan.cancelBookIds, ['returned'], 'A record retaining old loan metadata must explicitly cancel its native alarm.');
}

console.log('Inkbound library-loan reminder regressions passed.');
