import assert from 'node:assert/strict';
import { detectiveWorkTitlesCompatible, normalizeDetectiveText } from '../src/features/series/seriesDetectiveEvidence';
import { detectiveCandidatesAreSameWork, mergeDetectiveCandidates, type DetectiveMergeCandidate } from '../src/features/series/seriesDetectiveMerge';

const candidate = (title: string, provider: DetectiveMergeCandidate['provider']): DetectiveMergeCandidate => ({
  work: { key: provider + ':' + title, title, authors: ['Example Author'], genres: [], editions: [] },
  edition: { source: provider, externalEditionId: provider + ':' + title, title, authors: ['Example Author'], genres: [], publicationYear: 2020, isbn13: '9781234567897', format: 'paperback', specialFeatures: [] },
  seriesName: 'Example Series', position: null, provider, seriesStructured: true,
});
const first = candidate('First Installment', 'open-library');
const second = candidate('Second Installment', 'hardcover');
assert.equal(detectiveCandidatesAreSameWork(first, second), false,
  'Shared ISBN and series must not collapse different titles');
assert.equal(mergeDetectiveCandidates([first, second]).length, 2,
  'Distinct installments must remain separate in the roster');
const matching = candidate('First Installment', 'hardcover');
assert.equal(detectiveCandidatesAreSameWork(first, matching), true,
  'Identical title and author may still corroborate across providers');
const withIdentifier = (base: DetectiveMergeCandidate, isbn: string, field: 'isbn10' | 'isbn13'): DetectiveMergeCandidate => ({
  ...base,
  edition: { ...base.edition, isbn10: undefined, isbn13: undefined, [field]: isbn },
  work: { ...base.work, editions: [] },
});
const isbn10Edition = withIdentifier(first, '0743273567', 'isbn10');
const isbn13Edition = withIdentifier(matching, '9780743273565', 'isbn13');
const combined = mergeDetectiveCandidates([
  { ...isbn10Edition, work: { ...isbn10Edition.work, editions: [isbn10Edition.edition] } },
  isbn13Edition,
]);
assert.equal(combined.length, 1, 'ISBN-10 and its ISBN-13 equivalent must resolve to one work');
assert.equal(combined[0].work.editions.length, 1,
  'Equivalent ISBN-10 and ISBN-13 must not create duplicate editions');
const differentEdition = withIdentifier(matching, '9780306406157', 'isbn13');
const separate = mergeDetectiveCandidates([
  { ...isbn10Edition, work: { ...isbn10Edition.work, editions: [isbn10Edition.edition] } },
  differentEdition,
]);
assert.equal(separate.length, 1, 'Different editions of the same titled work remain one work');
assert.equal(separate[0].work.editions.length, 2,
  'Different valid ISBNs must remain distinct editions');
const conflictingEdition = {
  ...isbn13Edition,
  edition: { ...isbn13Edition.edition, isbn10: '0306406152' },
};
assert.equal(mergeDetectiveCandidates([
  { ...isbn10Edition, work: { ...isbn10Edition.work, editions: [isbn10Edition.edition] } },
  conflictingEdition,
])[0].work.editions.length, 2, 'Contradictory identifiers must not be synthesized into one edition');
const recycledWorkKey = {
  ...second,
  provider: first.provider,
  work: { ...second.work, key: first.work.key },
};
assert.equal(detectiveCandidatesAreSameWork(first, recycledWorkKey), false,
  'Reused native work keys must not override conflicting titles');
const contradictorySameKey = {
  ...isbn13Edition,
  provider: isbn10Edition.provider,
  work: { ...isbn13Edition.work, key: isbn10Edition.work.key },
  edition: { ...isbn13Edition.edition, isbn10: '0306406152' },
};
assert.equal(detectiveCandidatesAreSameWork(isbn10Edition, contradictorySameKey), true,
  'Compatible titles may group at work level despite conflicting editions');
assert.equal(mergeDetectiveCandidates([
  { ...isbn10Edition, work: { ...isbn10Edition.work, editions: [isbn10Edition.edition] } },
  contradictorySameKey,
])[0].work.editions.length, 2,
  'Conflicting editions remain separate even when a provider reuses its work key');
assert.equal(normalizeDetectiveText('Мапл Хиллз'), 'мапл хиллз', 'Non-Latin identities must remain nonempty');
assert.equal(normalizeDetectiveText('吹雪'), '吹雪', 'CJK identities must remain nonempty');
assert.equal(detectiveWorkTitlesCompatible('Icebreaker: A Novel', 'Icebreaker'), true,
  'Generic marketing subtitles may be omitted');
assert.equal(detectiveWorkTitlesCompatible('Dune: Messiah', 'Dune'), false,
  'Distinct installment titles must never merge by colon prefix');
assert.equal(detectiveWorkTitlesCompatible('As Old as Time: A Twisted Tale Manga, Volume 1', 'As Old as Time', 'A Twisted Tale'), false,
  'Adaptations must not corroborate original novels');
assert.equal(detectiveWorkTitlesCompatible('Daydream: Deluxe Edition Hardcover', 'Daydream'), false,
  'Deluxe editions must not automatically count as the same verified identity');
console.log('Series Detective merge identity regressions passed.');
