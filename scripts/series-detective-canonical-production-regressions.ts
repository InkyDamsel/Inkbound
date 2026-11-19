import assert from 'node:assert/strict';
import { decideDetectiveMembership } from '../src/features/series/seriesDetectiveDecision';
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
  'Without independent edition evidence, a disputed position cannot grant membership');
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 0)]).verified, false);
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 1.5)]).verified, false);
assert.equal(run([seed, seed2, sibling, make('Triptych', 'hardcover', 2)]).verified, false,
  'Another work cannot manufacture corroboration');
assert.equal(run([seed, seed2, sibling, make('Kisscut', 'hardcover', 2, 'Will Trent')]).verified, false,
  'A related but distinct series cannot authorize membership');
assert.equal(run([seed, seed2, make('Kisscut', 'open-library', null),
  make('Kisscut', 'hardcover', null)]).agreedPosition, null,
  'Unnumbered membership must not invent a reading order');
// Real ISBN-10/ISBN-13 representations of the same edition must corroborate.
const withIsbn = (candidate: DetectiveMergeCandidate, field: 'isbn10' | 'isbn13', isbn: string): DetectiveMergeCandidate => ({
  ...candidate, edition: { ...candidate.edition, [field]: isbn },
});
// These ISBNs are test fixtures for identity mechanics, not catalog claims.
const seedIsbn10 = '0743273567';
const seedIsbn13 = '9780743273565';
const siblingIsbn10 = '0306406152';
const siblingIsbn13 = '9780306406157';
const sameEditionSources = [
  withIsbn(seed, 'isbn10', seedIsbn10),
  withIsbn(seed2, 'isbn13', seedIsbn13),
  withIsbn(sibling, 'isbn10', siblingIsbn10),
  withIsbn(sibling2, 'isbn13', siblingIsbn13),
];
assert.equal(run(sameEditionSources).verified, true,
  'Equivalent checksum-valid ISBN-10/13 values should count as one edition identifier');
assert.equal(run([
  withIsbn(seed, 'isbn10', '0743273560'),
  ...sameEditionSources.slice(1),
]).verified, false, 'An invalid ISBN checksum cannot corroborate the owned seed');
assert.equal(run([
  ...sameEditionSources.slice(0, 3),
  withIsbn(sibling2, 'isbn13', '9780062024039'),
]).verified, false, 'Different edition identifiers cannot establish exact-edition corroboration');
const subtitleSeed = withIsbn(make('Blindsighted: A Novel', 'hardcover'), 'isbn13', seedIsbn13);
const subtitleSibling = withIsbn(make('Kisscut: A Novel', 'hardcover', 2), 'isbn13', siblingIsbn13);
assert.equal(run([sameEditionSources[0], subtitleSeed, sameEditionSources[2], subtitleSibling]).verified, true,
  'A generic publisher subtitle must not erase an independent vote');
const unrelatedSubtitle = withIsbn(make('Kisscut: A Different Book', 'hardcover', 2), 'isbn13', siblingIsbn13);
assert.equal(run([sameEditionSources[0], subtitleSeed, sameEditionSources[2], unrelatedSubtitle]).verified, false,
  'A generic colon prefix must not make unrelated subtitle text a verification vote');
// Cross-edition work evidence is allowed only when two independent providers
// supply native series identifiers. A text label or one provider is insufficient.
const native = (source: DetectiveMergeCandidate, id: string): DetectiveMergeCandidate => ({
  ...source, nativeSeriesId: id,
});
const crossEdition = [
  native(withIsbn(seed, 'isbn13', seedIsbn13), 'ol-grant-county'),
  native(withIsbn(seed2, 'isbn13', siblingIsbn13), 'hc-grant-county'),
  native(withIsbn(sibling, 'isbn13', siblingIsbn13), 'ol-grant-county'),
  native(withIsbn(sibling2, 'isbn13', seedIsbn13), 'hc-grant-county'),
];
assert.equal(run(crossEdition).verified, true,
  'Independent native series memberships may corroborate a work across different editions');
assert.equal(run(crossEdition.map(({ nativeSeriesId: _id, ...source }) => source)).verified, false,
  'Matching title and series text without native identifiers cannot prove cross-edition identity');
assert.equal(run([crossEdition[0], crossEdition[1], crossEdition[2]]).verified, false,
  'One native provider for the target cannot prove cross-edition membership');
assert.equal(run([crossEdition[0], crossEdition[1], crossEdition[2],
  { ...crossEdition[3], seriesName: 'Will Trent' }]).verified, false,
  'Native memberships in different series cannot corroborate');
assert.equal(run([...crossEdition, {
  ...crossEdition[2], nativeSeriesId: 'ol-different-series',
}]).verified, false, 'A provider contradicting its own native series ID must not grant verification');
assert.equal(run([...crossEdition.slice(0, 3), {
  ...crossEdition[3], position: 0,
}]).conflicting, true, 'Invalid positions must remain visible as conflicts');
assert.equal(run([...crossEdition.slice(0, 3), {
  ...crossEdition[3], position: 3,
}]).verified, true, 'Disputed native series order must preserve verified membership');
const disputedEditionSources = [
  ...sameEditionSources.slice(0, 3),
  { ...sameEditionSources[3], position: 3 },
];
assert.equal(run(disputedEditionSources).verified, true,
  'Verified membership must survive conflicting independent ordinals');
assert.equal(run(disputedEditionSources).conflicting, true);
assert.equal(run(disputedEditionSources).agreedPosition, null);
assert.deepEqual(decideDetectiveMembership(
  disputedEditionSources, disputedEditionSources[2], owned, 'Grant County',
), { verification: 'verified', position: null, conflictingOrder: true },
'The production decision must separate membership from disputed order');
const reviewOrder = decideDetectiveMembership(
  [seed, seed2, sibling, sibling2], sibling, owned, 'Grant County',
);
assert.deepEqual(reviewOrder, {
  verification: 'review', position: null, conflictingOrder: false,
}, 'A review-only candidate must not leak an apparently verified ordinal');
const verifiedOrder = decideDetectiveMembership(
  sameEditionSources, sameEditionSources[2], owned, 'Grant County',
);
assert.equal(verifiedOrder.verification, 'verified');
assert.equal(verifiedOrder.position, 2,
  'Independently verified ordering should remain available');
const placeholderAuthorSources = sameEditionSources.map(source => ({
  ...source,
  work: { ...source.work, authors: ['Unknown Author'] },
}));
assert.equal(run(placeholderAuthorSources).verified, false,
  'Catalog placeholder authors must not corroborate a work');
const blankAndValidAuthorSources = sameEditionSources.map(source => ({
  ...source,
  work: { ...source.work, authors: ['', 'Karin Slaughter'] },
}));
assert.equal(run(blankAndValidAuthorSources).verified, true,
  'A blank author preceding a credible author must not invalidate corroboration');
console.log('Series Detective canonical production adapter regressions passed.');
