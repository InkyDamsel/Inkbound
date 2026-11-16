import assert from 'node:assert/strict';
import { corroborateDetectiveMembership, hasCorroboratedOwnedSeed } from '../src/features/series/seriesDetectiveCorroboration';
import type { DetectiveMergeCandidate } from '../src/features/series/seriesDetectiveMerge';

const candidate = (title: string, provider: DetectiveMergeCandidate['provider'], position: number | null = 1, seriesName = 'Example Series'): DetectiveMergeCandidate => ({
  work: { key: provider + ':' + title, title, authors: ['Example Author'], genres: [], editions: [] },
  edition: { source: provider, externalEditionId: provider + ':' + title, title, authors: ['Example Author'], genres: [], publicationYear: 2020, format: 'paperback', specialFeatures: [] },
  seriesName, position, provider, seriesStructured: true,
});
const first = candidate('First', 'open-library');
const firstOther = candidate('First', 'hardcover');
const second = candidate('Second', 'hardcover', 2);
const owned = [{ title: 'First', author: 'Example Author' }, { title: 'Second', author: 'Example Author' }];
assert.equal(hasCorroboratedOwnedSeed([first, second], owned, 'Example Series'), false,
  'Independent votes for different owned works cannot establish a seed');
assert.equal(hasCorroboratedOwnedSeed([first, firstOther], owned, 'Example Series'), true);
assert.equal(hasCorroboratedOwnedSeed([first, firstOther], [{ title: 'Unrelated', author: 'Example Author' }], 'Example Series'), false);
assert.equal(hasCorroboratedOwnedSeed([first, candidate('First', 'hardcover', 1, 'Other Series')], owned, 'Example Series'), false);
assert.deepEqual(corroborateDetectiveMembership([first, firstOther], first, 'Example Series'),
  { providers: 2, conflictingOrder: false, agreedPosition: 1 });
assert.equal(corroborateDetectiveMembership([first], first, 'Example Series').agreedPosition, null);
assert.equal(corroborateDetectiveMembership([first, candidate('First', 'hardcover', 2)], first, 'Example Series').conflictingOrder, true);
for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const result = corroborateDetectiveMembership([first, candidate('First', 'hardcover', invalid)], first, 'Example Series');
  assert.equal(result.conflictingOrder, true);
  assert.equal(result.agreedPosition, null);
}
const ambiguousAlias = candidate('First: A Different Book', 'hardcover', 1);
assert.equal(corroborateDetectiveMembership([first, ambiguousAlias], first, 'Example Series').providers, 1,
  'A loosely matched title must not manufacture independent verification');
assert.equal(corroborateDetectiveMembership([first, second], first, 'Example Series').providers, 1,
  'Evidence from another installment cannot vote for this work');
console.log('Series Detective production corroboration regressions passed.');
