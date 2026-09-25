import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromTitle,
  scoreDetectiveEvidence,
  selectVerifiedDetectiveEvidence,
} from '../src/features/series/seriesDetectiveEvidence';

const divergent = {
  work: { title: 'Divergent', author: 'Veronica Roth' },
  editions: [
    { id: 'a', isbn13: '9780062024039', isbn10: '0062024035' },
    { id: 'b', isbn13: '9780007420421' },
  ],
} as unknown as UserBookRecord;

const queries = buildSeriesDetectionQueries(divergent);
assert.equal(queries.workQuery, 'Divergent Veronica Roth');
assert.deepEqual(new Set(queries.identifiers), new Set(['9780062024039', '0062024035', '9780007420421']));

assert.deepEqual(inferDetectiveSeriesFromTitle('Example (Crown Trials, Book 2)'), {
  name: 'Crown Trials',
  position: 2,
});
assert.equal(detectiveSeriesNamesCompatible('Hades x Persephone Saga', 'Hades & Persephone'), true);
assert.equal(canonicalDetectiveAuthor('Gilmore, Laurie'), 'laurie gilmore');

const strong = scoreDetectiveEvidence({
  seriesName: 'Dream Harbor',
  position: 2,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  sourceId: 'isbn-query',
  structured: true,
  exactIdentifier: true,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([strong])?.seriesName, 'Dream Harbor');

const weak = scoreDetectiveEvidence({
  seriesName: 'Dream Harbor',
  position: 2,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  sourceId: 'title-query',
  structured: false,
  exactIdentifier: false,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([weak]), null);

const corroborated = { ...weak, sourceId: 'second-query' };
assert.equal(selectVerifiedDetectiveEvidence([weak, corroborated])?.seriesName, 'Dream Harbor');

console.log('Inkbound Series Detective recovery regressions passed.');
