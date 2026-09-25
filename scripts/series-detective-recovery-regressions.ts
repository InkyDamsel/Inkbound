import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromTitle,
  inferKnownDetectiveSeriesFromDescription,
  inferKnownDetectiveSeriesFromText,
  plausibleDetectiveSeriesSubtitle,
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

// Work identity must include every known edition identifier, not only activeEditionId.
const queries = buildSeriesDetectionQueries(divergent);
assert.equal(queries.workQuery, 'Divergent Veronica Roth');
assert.deepEqual(new Set(queries.identifiers), new Set(['9780062024039', '0062024035', '9780007420421']));

// Common bibliographic series suffixes.
assert.deepEqual(inferDetectiveSeriesFromTitle('Example (Crown Trials, Book 2)'), {
  name: 'Crown Trials',
  position: 2,
});
assert.deepEqual(
  inferKnownDetectiveSeriesFromText('Example Book: Crown Trials #3', 'Crown Trials Series'),
  { name: 'Crown Trials', position: 3 },
);

// Provider naming variations must collapse to one series identity.
assert.equal(detectiveSeriesNamesCompatible('Hades x Persephone Saga', 'Hades & Persephone'), true);
assert.equal(detectiveSeriesNamesCompatible('The Harry Potter Series', 'Harry Potter'), true);
assert.equal(detectiveSeriesNamesCompatible('Hades x Persephone Saga', 'Adrian X Isolde'), false);

// Author normalization must understand "Last, First" without hardcoding an author.
assert.equal(canonicalDetectiveAuthor('Gilmore, Laurie'), 'laurie gilmore');
assert.equal(canonicalDetectiveAuthor('Laurie Gilmore'), 'laurie gilmore');

// Explicit publisher copy is bibliographic evidence, including ordinal words.
assert.deepEqual(
  inferKnownDetectiveSeriesFromDescription(
    'The Elite is the second book in The Selection series.',
    'Selection Series',
  ),
  { name: 'Selection Series', position: 2 },
);
assert.deepEqual(
  inferKnownDetectiveSeriesFromDescription(
    'A Touch of Ruin is the second novel in the Hades x Persephone Saga.',
    'Hades & Persephone',
  ),
  { name: 'Hades & Persephone', position: 2 },
);
assert.equal(
  inferKnownDetectiveSeriesFromDescription(
    'A sweeping story about a difficult selection process.',
    'Selection',
  ),
  null,
);

// Non-generic subtitles may provide context when we already know the series.
assert.equal(plausibleDetectiveSeriesSubtitle('A Twisted Tale'), 'A Twisted Tale');
assert.equal(plausibleDetectiveSeriesSubtitle('A Novel'), null);
assert.equal(plausibleDetectiveSeriesSubtitle('Illustrated Edition'), null);

// Strong structured exact-work evidence can verify one book.
const strong = scoreDetectiveEvidence({
  seriesName: 'Dream Harbor',
  position: 2,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  sourceId: 'isbn-query',
  recordId: 'google-volume-1',
  structured: true,
  exactIdentifier: true,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([strong])?.seriesName, 'Dream Harbor');

// A single title-inferred record is never enough.
const weak = scoreDetectiveEvidence({
  seriesName: 'Dream Harbor',
  position: 2,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  sourceId: 'title-query',
  recordId: 'google-volume-2',
  structured: false,
  exactIdentifier: false,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([weak]), null);

// Repeating the SAME provider record through another query must not fake corroboration.
const duplicateQueryHit = { ...weak, sourceId: 'second-query' };
assert.equal(selectVerifiedDetectiveEvidence([weak, duplicateQueryHit]), null);

// Two genuinely distinct exact-work records can corroborate title-inferred metadata.
const distinctEdition = { ...weak, sourceId: 'isbn-query', recordId: 'google-volume-3' };
assert.equal(selectVerifiedDetectiveEvidence([weak, distinctEdition])?.seriesName, 'Dream Harbor');

// Wrong-author metadata must not verify an inferred relationship.
const wrongAuthor = scoreDetectiveEvidence({
  ...weak,
  recordId: 'google-volume-4',
  authors: ['Someone Else'],
  exactAuthor: false,
});
assert.equal(selectVerifiedDetectiveEvidence([wrongAuthor]), null);

console.log('Inkbound Series Detective recovery regressions passed.');
