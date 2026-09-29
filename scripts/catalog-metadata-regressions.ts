import assert from 'node:assert/strict';
import type { BookSearchEdition, BookSearchWorkGroup } from '../src/features/book-search/model/bookSearch';
import {
  catalogTitlesAreCompatible,
  enrichSelectedCatalogEdition,
  hardenCatalogGroups,
} from '../src/features/book-search/catalogHardening';
import { createBookFromSearchEdition } from '../src/features/book-search/mapping/bookSearchMapper';
import { normalizeLibraryRecord } from '../src/features/library/libraryNormalization';
import { seriesNamesAreCompatible } from '../src/features/series/seriesLibrary';

const edition = (
  source: BookSearchEdition['source'],
  id: string,
  title: string,
  author: string,
  overrides: Partial<BookSearchEdition> = {},
): BookSearchEdition => ({
  source,
  externalEditionId: id,
  title,
  authors: [author],
  genres: [],
  publicationYear: 2020,
  format: 'paperback',
  specialFeatures: [],
  ...overrides,
});

const group = (
  key: string,
  title: string,
  author: string,
  editions: BookSearchEdition[],
): BookSearchWorkGroup => ({
  key,
  title,
  authors: [author],
  genres: [],
  editions,
});

// Bibliographic series suffixes are the same work, even for short titles.
assert.equal(
  catalogTitlesAreCompatible('The Selection', 'The Selection (The Selection #1)'),
  true,
);
assert.equal(
  catalogTitlesAreCompatible(
    'Conceal, Don\'t Feel',
    'Conceal, Don\'t Feel (A Twisted Tale, Book 7)',
  ),
  true,
);
assert.equal(
  catalogTitlesAreCompatible(
    'Harry Potter',
    'Harry Potter and the Chamber of Secrets',
  ),
  false,
);

// A Touch of Darkness: one provider owns the selected edition, another owns
// the missing work-level series relationship. The selected edition must keep
// its own identity while inheriting the valid series metadata.
const darknessGoogleEdition = edition(
  'google-books',
  'google-darkness',
  'A Touch of Darkness',
  'Scarlett St. Clair',
  {
    isbn13: '9781728261706',
    pageCount: 400,
    coverUrl: 'https://example.test/darkness-google.jpg',
  },
);
const darknessOpenLibraryEdition = edition(
  'open-library',
  'ol-darkness',
  'A Touch of Darkness (Hades x Persephone Saga, Book 1)',
  'Scarlett St. Clair',
  {
    isbn13: '9781728261713',
    seriesName: 'Hades x Persephone Saga',
    seriesOrder: 1,
  },
);
const darknessGroups = hardenCatalogGroups([
  group('google:darkness', 'A Touch of Darkness', 'Scarlett St. Clair', [darknessGoogleEdition]),
  group(
    'ol:darkness',
    'A Touch of Darkness (Hades x Persephone Saga, Book 1)',
    'Scarlett St. Clair',
    [darknessOpenLibraryEdition],
  ),
]);
assert.equal(darknessGroups.length, 1);
assert.equal(darknessGroups[0].editions.length, 2);
assert.equal(
  darknessGroups[0].editions.find((item) => item.externalEditionId === 'google-darkness')?.seriesName,
  'Hades x Persephone Saga',
);
assert.equal(
  darknessGroups[0].editions.find((item) => item.externalEditionId === 'google-darkness')?.seriesOrder,
  1,
);

const enrichedDarkness = enrichSelectedCatalogEdition(darknessGroups[0], darknessGoogleEdition);
assert.equal(enrichedDarkness.seriesName, 'Hades x Persephone Saga');
assert.equal(enrichedDarkness.seriesOrder, 1);
assert.equal(enrichedDarkness.pageCount, 400);

const savedDarkness = createBookFromSearchEdition({
  work: darknessGroups[0],
  edition: darknessGoogleEdition,
});
assert.equal(savedDarkness.work.seriesName, 'Hades x Persephone Saga');
assert.equal(savedDarkness.work.seriesOrder, 1);
assert.equal(normalizeLibraryRecord(savedDarkness).work.seriesName, 'Hades x Persephone Saga');
assert.equal(normalizeLibraryRecord(savedDarkness).work.seriesOrder, 1);

// Compatible series-name variants collapse to one canonical relationship.
const hadesVariantGroups = hardenCatalogGroups([
  group(
    'hades-a',
    'A Touch of Darkness',
    'Scarlett St. Clair',
    [edition('google-books', 'hades-a-ed', 'A Touch of Darkness', 'Scarlett St. Clair', {
      seriesName: 'Hades x Persephone Saga',
      seriesOrder: 1,
    })],
  ),
  group(
    'hades-b',
    'A Touch of Darkness (Hades & Persephone, Book 1)',
    'Scarlett St. Clair',
    [edition('hardcover', 'hades-b-ed', 'A Touch of Darkness', 'Scarlett St. Clair', {
      seriesName: 'Hades & Persephone',
      seriesOrder: 1,
    })],
  ),
]);
assert.equal(hadesVariantGroups.length, 1);
assert.equal(
  new Set(hadesVariantGroups[0].editions.map((item) => item.seriesName)).size,
  2,
);
assert.ok(hadesVariantGroups[0].editions.every((item) => item.seriesOrder === 1));

// Selection: short primary title must merge with a provider that embeds the
// series suffix, then persist that relationship.
const selectionPrimary = edition(
  'google-books',
  'selection-google',
  'The Selection',
  'Kiera Cass',
  { isbn13: '9780062059932' },
);
const selectionSeries = edition(
  'open-library',
  'selection-ol',
  'The Selection (The Selection #1)',
  'Kiera Cass',
  {
    isbn13: '9780062059949',
    seriesName: 'The Selection',
    seriesOrder: 1,
  },
);
const selectionGroups = hardenCatalogGroups([
  group('selection-google', 'The Selection', 'Kiera Cass', [selectionPrimary]),
  group('selection-ol', 'The Selection (The Selection #1)', 'Kiera Cass', [selectionSeries]),
]);
assert.equal(selectionGroups.length, 1);
const savedSelection = createBookFromSearchEdition({
  work: selectionGroups[0],
  edition: selectionPrimary,
});
assert.equal(savedSelection.work.seriesName, 'The Selection');
assert.equal(savedSelection.work.seriesOrder, 1);

// Twisted Tale: shared-series metadata is work-level. The selected edition may
// omit it while a compatible provider exposes the relationship.
const concealPrimary = edition(
  'google-books',
  'conceal-google',
  'Conceal, Don\'t Feel',
  'Jen Calonita',
  { isbn13: '9781368052238' },
);
const concealSeries = edition(
  'open-library',
  'conceal-ol',
  'Conceal, Don\'t Feel (A Twisted Tale, Book 7)',
  'Jen Calonita',
  {
    seriesName: 'A Twisted Tale',
    seriesOrder: 7,
  },
);
const concealGroups = hardenCatalogGroups([
  group('conceal-google', 'Conceal, Don\'t Feel', 'Jen Calonita', [concealPrimary]),
  group(
    'conceal-ol',
    'Conceal, Don\'t Feel (A Twisted Tale, Book 7)',
    'Jen Calonita',
    [concealSeries],
  ),
]);
assert.equal(concealGroups.length, 1);
const savedConceal = createBookFromSearchEdition({
  work: concealGroups[0],
  edition: concealPrimary,
});
assert.equal(savedConceal.work.seriesName, 'A Twisted Tale');
assert.equal(savedConceal.work.seriesOrder, 7);

// Conflicting installment numbers must not be guessed onto an otherwise thin
// sibling edition.
const conflictThin = edition(
  'google-books',
  'conflict-thin',
  'Example Story',
  'Example Author',
);
const conflictGroups = hardenCatalogGroups([
  group('conflict-google', 'Example Story', 'Example Author', [conflictThin]),
  group('conflict-ol', 'Example Story', 'Example Author', [
    edition('open-library', 'conflict-ol-ed', 'Example Story', 'Example Author', {
      seriesName: 'Example Saga',
      seriesOrder: 1,
    }),
  ]),
  group('conflict-hc', 'Example Story', 'Example Author', [
    edition('hardcover', 'conflict-hc-ed', 'Example Story', 'Example Author', {
      seriesName: 'Example Saga Series',
      seriesOrder: 2,
    }),
  ]),
]);
assert.equal(conflictGroups.length, 1);
const thinAfterConflict = conflictGroups[0].editions.find(
  (item) => item.externalEditionId === 'conflict-thin',
);
assert.ok(thinAfterConflict?.seriesName);
assert.equal(seriesNamesAreCompatible(thinAfterConflict?.seriesName, 'Example Saga'), true);
assert.equal(thinAfterConflict?.seriesOrder, undefined);

// A lone Open Library edition/translation series label must not become the
// canonical work series merely because the provider exposes it as structured
// metadata. Edition-scoped labels may still remain available to Detective.
const translatedEditionSeries = edition(
  'open-library',
  'translated-series-edition',
  'Example Punishment',
  'Example Author',
  {
    isbn13: '9780000000002',
    seriesName: 'Les aventures de la Belle -- tome 2',
    seriesOrder: 2,
  },
);
const translatedSeriesGroup = hardenCatalogGroups([
  group(
    'translated-series-work',
    'Example Punishment',
    'Example Author',
    [translatedEditionSeries],
  ),
]);
const savedTranslatedSeries = createBookFromSearchEdition({
  work: translatedSeriesGroup[0],
  edition: translatedEditionSeries,
});
assert.equal(savedTranslatedSeries.work.seriesName, undefined);
assert.equal(savedTranslatedSeries.work.seriesOrder, undefined);

// Book 0 is legitimate metadata and must survive mapper + library normalization.
const prequelEdition = edition(
  'google-books',
  'prequel',
  'Before the Beginning',
  'Example Author',
  {
    seriesName: 'Example Saga',
    seriesOrder: 0,
  },
);
const prequelBook = createBookFromSearchEdition({
  work: group('prequel-work', 'Before the Beginning', 'Example Author', [prequelEdition]),
  edition: prequelEdition,
});
assert.equal(prequelBook.work.seriesOrder, 0);
assert.equal(normalizeLibraryRecord(prequelBook).work.seriesOrder, 0);

// PRH is a publisher-owned source. When it identifies the exact same ISBN,
 // its edition metadata may fill/override publisher-controlled fields such as
 // page count without creating a second persisted work.
const prhGoogleEdition = edition(
  'google-books',
  'google-prh-authority',
  'Publisher Metadata Example',
  'Example Author',
  {
    isbn13: '9780062059932',
    pageCount: 320,
  },
);
const prhPublisherEdition = edition(
  'penguin-random-house',
  'prh-publisher-authority',
  'Publisher Metadata Example',
  'Example Author',
  {
    isbn13: '9780062059932',
    pageCount: 336,
    publisher: 'Penguin Random House',
    binding: 'Paperback',
    seriesName: 'Example Series',
    seriesOrder: 2,
  },
);
const prhAuthorityGroups = hardenCatalogGroups([
  group('google-prh-authority', 'Publisher Metadata Example', 'Example Author', [prhGoogleEdition]),
  group('prh-publisher-authority', 'Publisher Metadata Example', 'Example Author', [prhPublisherEdition]),
]);
assert.equal(prhAuthorityGroups.length, 1);
assert.equal(prhAuthorityGroups[0].editions.length, 1);
const prhEnriched = enrichSelectedCatalogEdition(prhAuthorityGroups[0], prhPublisherEdition);
assert.equal(prhEnriched.pageCount, 336);
assert.equal(prhEnriched.publisher, 'Penguin Random House');
assert.equal(prhEnriched.seriesName, 'Example Series');
assert.equal(prhEnriched.seriesOrder, 2);
const savedPrhBook = createBookFromSearchEdition({
  work: prhAuthorityGroups[0],
  edition: prhPublisherEdition,
});
assert.equal(savedPrhBook.editions[0].externalSource, 'penguin-random-house');
assert.equal(savedPrhBook.sourceOfImport, 'Penguin Random House');

console.log('Inkbound canonical catalog metadata regressions passed.');
