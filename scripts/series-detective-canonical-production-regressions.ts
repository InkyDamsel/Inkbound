import assert from 'node:assert/strict';
import { verifyCanonicalProductionMembership } from '../src/features/series/seriesDetectiveCanonicalAdapter';
import type { DetectiveMergeCandidate } from '../src/features/series/seriesDetectiveMerge';

const make = (title: string, provider: DetectiveMergeCandidate['provider'],
  position: number | null = 1, seriesName = 'Grant County'): DetectiveMergeCandidate => ({
  provider, seriesProvider: provider, seriesStructured: true, seriesName, position,
  work: { key: provider + ':' + title, title, authors: ['Karin Slaughter'], genres: [], editions: [] },
  edition: { source: provider, externalEditionId: provider + ':' + title,
    title, authors: ['Karin Slaughter'], genres: [], publicationYear: 2020,
    format: 'paperback', specialFeatures: [] },
});
const seed = make('Blindsighted', 'open-library');
const seed2 = make('Blindsighted', 'hardcover');
const sibling = make('Kisscut', 'open-library', 2);
const sibling2 = make('Kisscut', 'hardcover', 2);
const owned = [{ title: 'Blindsighted', author: 'Karin Slaughter' }];
const run = (sources: DetectiveMergeCandidate[], target = sibling) =>
  verifyCanonicalProductionMembership(sources, target, owned, 'Grant County');
assert.deepEqual(run([seed, seed2, sibling, sibling2]),
  { verified: false, agreedPosition: null, conflicting: false, providerCount: 2 },
  'Title and author agreement alone cannot establish provider-independent series identity');
assert.equal(run([seed, sibling, sibling2]).verified, false,
  'One-provider seed must never authorize sibling verification');
assert.equal(run([seed, seed2, sibling]).verified, false,
  'One-provider sibling must remain review-only');
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 3)]).verified, false,
  'Disputed position must remain review-only');
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 0)]).verified, false);
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 1.5)]).verified, false);
assert.equal(run([seed, seed2, sibling, make('Triptych', 'hardcover', 2)]).verified, false,
  'Another work cannot manufacture corroboration');
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 2, 'Will Trent')]).verified, false,
  'A related but distinct series cannot authorize membership');
assert.equal(run([seed, seed2, make('Kisscut', 'open-library', null),
  make('Kisscut', 'hardcover', null)]).agreedPosition, null,
  'Unnumbered membership must not invent a reading order');
console.log('Series Detective canonical production adapter regressions passed.');
