import assert from 'node:assert/strict';
import {
  canonicalAuthorIdentity,
  canonicalLanguageCode,
  catalogEditionQualityScore,
  enrichSelectedCatalogEdition,
  hardenCatalogEdition,
  hardenCatalogGroups,
  isValidCatalogIsbn10,
  isValidCatalogIsbn13,
  mergeCatalogEditionData,
  selectExactIsbnEdition,
} from '../src/features/book-search/catalogHardening';
import type { BookSearchEdition, BookSearchWorkGroup } from '../src/features/book-search/model/bookSearch';

const baseEdition: BookSearchEdition = {
  source: 'google-books',
  externalEditionId: 'g-1',
  title: 'DOCTOR SLEEP: STEPHEN KING NEW COVER SERIES',
  authors: [' Stephen King ', 'Stephen   King'],
  genres: ['Horror', ' horror ', 'Fiction'],
  publicationYear: 2013,
  format: 'hardcover',
  isbn10: '0307743659',
  isbn13: '9780307743657',
  pageCount: 0,
  coverUrl: 'http://example.com/cover.jpg',
  specialFeatures: [],
};

assert.equal(isValidCatalogIsbn10('0307743659'), true);
assert.equal(isValidCatalogIsbn10('0307743658'), false);
assert.equal(isValidCatalogIsbn13('9780307743657'), true);
assert.equal(isValidCatalogIsbn13('9780307743658'), false);
assert.equal(canonicalAuthorIdentity('Christopher Pike'), canonicalAuthorIdentity('Pike, Christopher'));
assert.equal(canonicalAuthorIdentity('Agatha Christie'), canonicalAuthorIdentity('Christie, Agatha'));
assert.equal(canonicalAuthorIdentity('Dame Agatha Christie'), canonicalAuthorIdentity('Agatha Christie'));
assert.equal(canonicalLanguageCode('en'), 'en');
assert.equal(canonicalLanguageCode('eng'), 'en');
assert.equal(canonicalLanguageCode('/languages/eng'), 'en');
assert.equal(canonicalLanguageCode('English'), 'en');


const hardenedEdition = hardenCatalogEdition({
  ...baseEdition,
  isbn10: '0307743658',
  isbn13: '9780307743658',
});
assert.equal(hardenedEdition.title, 'Doctor Sleep: Stephen King New Cover Series');
assert.deepEqual(hardenedEdition.authors, ['Stephen King']);
assert.equal(hardenedEdition.isbn10, undefined);
assert.equal(hardenedEdition.isbn13, undefined);
assert.equal(hardenedEdition.pageCount, undefined);
assert.equal(hardenedEdition.coverUrl, 'https://example.com/cover.jpg');
assert.equal(hardenCatalogEdition({ ...baseEdition, format: 'ebook', binding: 'Paperback' }).format, 'paperback');
assert.equal(hardenCatalogEdition({ ...baseEdition, format: 'ebook', binding: 'Hardcover' }).format, 'hardcover');
assert.equal(hardenCatalogEdition({ ...baseEdition, format: 'hardcover', binding: 'Kindle Edition' }).format, 'ebook');
const hardenedAudiobook = hardenCatalogEdition({
  ...baseEdition,
  externalEditionId: 'audiobook-page-count',
  format: 'audiobook',
  binding: 'Audiobook',
  pageCount: 1,
});
assert.equal(hardenedAudiobook.format, 'audiobook');
assert.equal(hardenedAudiobook.pageCount, undefined);
assert.deepEqual(hardenedEdition.genres, ['Horror', 'Fiction']);

const goodEdition = hardenCatalogEdition({
  ...baseEdition,
  externalEditionId: 'g-good',
  pageCount: 531,
  publisher: 'Scribner',
  publicationDate: '2013-09-24',
  language: 'EN',
});
assert.ok(catalogEditionQualityScore(goodEdition) > catalogEditionQualityScore(hardenedEdition));

const mergedEditionMetadata = mergeCatalogEditionData(
  hardenCatalogEdition({ ...baseEdition, externalEditionId: 'merge-a', pageCount: undefined, publisher: undefined }),
  hardenCatalogEdition({ ...baseEdition, source: 'open-library', externalEditionId: 'merge-b', pageCount: 531, publisher: 'Scribner' }),
);
assert.equal(mergedEditionMetadata.pageCount, 531);
assert.equal(mergedEditionMetadata.publisher, 'Scribner');

const monotonicMerge = mergeCatalogEditionData(
  hardenCatalogEdition({
    ...baseEdition,
    externalEditionId: 'monotonic-known',
    pageCount: 444,
    publisher: 'Known Publisher',
    seriesName: 'Known Series',
    seriesOrder: 3,
    coverUrl: 'https://example.com/known-cover.jpg',
    language: 'en',
  }),
  hardenCatalogEdition({
    ...baseEdition,
    source: 'open-library',
    externalEditionId: 'monotonic-missing',
    pageCount: undefined,
    publisher: undefined,
    seriesName: undefined,
    seriesOrder: undefined,
    coverUrl: undefined,
    language: undefined,
  }),
);
assert.equal(monotonicMerge.pageCount, 444);
assert.equal(monotonicMerge.publisher, 'Known Publisher');
assert.equal(monotonicMerge.seriesName, 'Known Series');
assert.equal(monotonicMerge.seriesOrder, 3);
assert.equal(monotonicMerge.coverUrl, 'https://example.com/known-cover.jpg');
assert.equal(monotonicMerge.language, 'en');

const work = (title: string, edition: BookSearchEdition): BookSearchWorkGroup => ({
  key: `work:${title}`,
  title,
  authors: ['Stephen King'],
  genres: ['Horror'],
  editions: [edition],
});

const groups = hardenCatalogGroups([
  work('STEPHEN KING BOX SET', { ...goodEdition, externalEditionId: 'box' }),
  work('DOCTOR SLEEP', goodEdition),
  {
    ...work('Doctor Sleep', { ...goodEdition, source: 'open-library', externalEditionId: 'ol-1' }),
    genres: ['Fiction'],
  },
], { preferredAuthor: 'Stephen King' });

assert.equal(groups[0].title, 'Doctor Sleep');
assert.equal(groups.filter((group) => group.title === 'Doctor Sleep').length, 1);
assert.ok(groups[0].genres.includes('Horror'));
assert.ok(groups[0].genres.includes('Fiction'));
assert.equal(groups.at(-1)?.title, 'Stephen King Box Set');


const concealSearchGroups = hardenCatalogGroups([
  {
    key: 'conceal-correct',
    title: "Conceal, Don't Feel",
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'conceal-correct',
      title: "Conceal, Don't Feel",
      authors: ['Jen Calonita'],
    }],
  },
  {
    key: 'city-of-ashes-noise',
    title: 'City of Ashes (The Mortal Instruments)',
    authors: ['Cassandra Clare'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'city-of-ashes-noise',
      title: 'City of Ashes (The Mortal Instruments)',
      authors: ['Cassandra Clare'],
    }],
  },
  {
    key: 'conceal-partial',
    title: 'Conceal and Don’t Feel as Much?',
    authors: ['Jessica L. Jones'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'conceal-partial',
      title: 'Conceal and Don’t Feel as Much?',
      authors: ['Jessica L. Jones'],
    }],
  },
  {
    key: 'sixty-years-noise',
    title: 'Sixty Years in California',
    authors: ['William Heath Davis'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'sixty-years-noise',
      title: 'Sixty Years in California',
      authors: ['William Heath Davis'],
    }],
  },
], { searchQuery: "conceal don't feel" });

assert.equal(concealSearchGroups[0]?.title, "Conceal, Don't Feel");
assert.ok(concealSearchGroups.some((group) => group.title === 'Conceal and Don’t Feel as Much?'));
assert.ok(!concealSearchGroups.some((group) => group.title === 'City of Ashes (The Mortal Instruments)'));
assert.ok(!concealSearchGroups.some((group) => group.title === 'Sixty Years in California'));


const thinSelectedWork: BookSearchWorkGroup = {
  key: 'conceal-enrichment',
  title: "Conceal, Don't Feel",
  authors: ['Jen Calonita'],
  genres: [],
  editions: [
    {
      ...goodEdition,
      source: 'open-library',
      externalEditionId: 'conceal-thin-hardcover',
      title: "Conceal, Don't Feel",
      authors: ['Jen Calonita'],
      format: 'hardcover',
      pageCount: undefined,
      isbn10: undefined,
      isbn13: undefined,
    },
    {
      ...goodEdition,
      source: 'hardcover',
      externalEditionId: 'conceal-rich-hardcover',
      title: "Conceal, Don't Feel",
      authors: ['Jen Calonita'],
      format: 'hardcover',
      pageCount: 312,
      isbn10: undefined,
      isbn13: undefined,
      seriesName: 'A Twisted Tale',
      seriesOrder: 7,
    },
  ],
};
const enrichedSelected = enrichSelectedCatalogEdition(thinSelectedWork, thinSelectedWork.editions[0]);
assert.equal(enrichedSelected.pageCount, 312);
assert.equal(enrichedSelected.seriesName, 'A Twisted Tale');
assert.equal(enrichedSelected.seriesOrder, 7);

const visibleSameFormatPageCount = hardenCatalogGroups([thinSelectedWork])[0];
const visibleThinHardcover = visibleSameFormatPageCount.editions.find((edition) => edition.externalEditionId === 'conceal-thin-hardcover');
assert.equal(visibleThinHardcover?.pageCount, 312);

const conflictingSameFormatCounts = hardenCatalogGroups([{
  key: 'conflicting-hardcovers',
  title: 'Conflicting Hardcover Test',
  authors: ['Test Author'],
  genres: [],
  editions: [
    {
      ...goodEdition,
      externalEditionId: 'conflict-thin',
      title: 'Conflicting Hardcover Test',
      authors: ['Test Author'],
      format: 'hardcover',
      pageCount: undefined,
      isbn10: undefined,
      isbn13: undefined,
    },
    {
      ...goodEdition,
      source: 'open-library',
      externalEditionId: 'conflict-320',
      title: 'Conflicting Hardcover Test',
      authors: ['Test Author'],
      format: 'hardcover',
      pageCount: 320,
      isbn10: undefined,
      isbn13: undefined,
    },
    {
      ...goodEdition,
      source: 'hardcover',
      externalEditionId: 'conflict-336',
      title: 'Conflicting Hardcover Test',
      authors: ['Test Author'],
      format: 'hardcover',
      pageCount: 336,
      isbn10: undefined,
      isbn13: undefined,
    },
  ],
}])[0];
assert.equal(
  conflictingSameFormatCounts.editions.find((edition) => edition.externalEditionId === 'conflict-thin')?.pageCount,
  undefined,
);

const crossFormatPages = hardenCatalogGroups([{
  key: 'cross-format-pages',
  title: 'Cross Format Test',
  authors: ['Test Author'],
  genres: [],
  editions: [
    {
      ...goodEdition,
      externalEditionId: 'cross-hardcover',
      title: 'Cross Format Test',
      authors: ['Test Author'],
      format: 'hardcover',
      pageCount: undefined,
      isbn10: undefined,
      isbn13: undefined,
    },
    {
      ...goodEdition,
      source: 'open-library',
      externalEditionId: 'cross-paperback',
      title: 'Cross Format Test',
      authors: ['Test Author'],
      format: 'paperback',
      pageCount: 320,
      isbn10: undefined,
      isbn13: undefined,
    },
  ],
}])[0];
assert.equal(
  crossFormatPages.editions.find((edition) => edition.externalEditionId === 'cross-hardcover')?.pageCount,
  undefined,
);

console.log('Inkbound catalog hardening regressions passed.');


const authorIntentGroups = hardenCatalogGroups([
  {
    key: 'unknown-gunslinger',
    title: 'The Gunslinger',
    authors: ['Unknown author'],
    genres: [],
    editions: [{ ...goodEdition, externalEditionId: 'unknown-gunslinger', title: 'The Gunslinger', authors: ['Unknown author'] }],
  },
  {
    key: 'known-gunslinger',
    title: 'The Gunslinger',
    authors: ['Stephen King'],
    genres: ['Fantasy'],
    editions: [{ ...goodEdition, externalEditionId: 'known-gunslinger', title: 'The Gunslinger', authors: ['Stephen King'] }],
  },
  {
    key: 'king-box',
    title: 'Stephen King 2 Box Set (Carrie, Misery And Pet Sematary)',
    authors: ['Stephen King'],
    genres: [],
    editions: [{ ...goodEdition, externalEditionId: 'king-box', title: 'Stephen King 2 Box Set (Carrie, Misery And Pet Sematary)', authors: ['Stephen King'] }],
  },
  {
    key: 'it',
    title: 'It',
    authors: ['Stephen King'],
    genres: ['Horror'],
    editions: [{ ...goodEdition, externalEditionId: 'it', title: 'It', authors: ['Stephen King'] }],
  },
], { searchQuery: 'Stephen King' });

assert.equal(authorIntentGroups.filter((group) => group.title === 'The Gunslinger').length, 1);
assert.deepEqual(authorIntentGroups.find((group) => group.title === 'The Gunslinger')?.authors, ['Stephen King']);
assert.ok(authorIntentGroups.findIndex((group) => group.title === 'It') < authorIntentGroups.findIndex((group) => /Box Set/i.test(group.title)));

const coauthorNoise = hardenCatalogGroups([
  {
    key: 'noise',
    title: 'Stephen King',
    authors: ['Rocky Wood', 'Stephen King'],
    genres: [],
    editions: [{ ...goodEdition, externalEditionId: 'noise', title: 'Stephen King', authors: ['Rocky Wood', 'Stephen King'] }],
  },
  work('Revival', { ...goodEdition, externalEditionId: 'revival', title: 'Revival', authors: ['Stephen King'] }),
], { preferredAuthor: 'Stephen King' });
assert.equal(coauthorNoise[0].title, 'Revival');


const seriesEdition = hardenCatalogEdition({
  ...goodEdition,
  externalEditionId: 'series-edition',
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  seriesName: ' Dream   Harbor ',
  seriesOrder: 2,
});
assert.equal(seriesEdition.seriesName, 'Dream Harbor');
assert.equal(seriesEdition.seriesOrder, 2);
assert.ok(catalogEditionQualityScore(seriesEdition) > catalogEditionQualityScore({ ...seriesEdition, seriesName: undefined, seriesOrder: undefined }));

const propagatedSeriesGroups = hardenCatalogGroups([
  {
    key: 'google-conceal',
    title: "Conceal, Don't Feel",
    subtitle: 'A Twisted Tale',
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'google-books',
      externalEditionId: 'google-conceal-ebook',
      title: "Conceal, Don't Feel",
      subtitle: 'A Twisted Tale',
      authors: ['Jen Calonita'],
      isbn13: '9781368052238',
      seriesName: undefined,
      seriesOrder: undefined,
      pageCount: 320,
      format: 'ebook',
      binding: 'Digital',
    }],
  },
  {
    key: 'hardcover-conceal',
    title: "Conceal, Don't Feel",
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'hardcover',
      externalEditionId: 'hardcover-conceal',
      title: "Conceal, Don't Feel",
      authors: ['Jen Calonita'],
      isbn13: '9781368052238',
      seriesName: 'A Twisted Tale',
      seriesOrder: 7,
      pageCount: 312,
      format: 'hardcover',
      binding: 'Hardcover',
    }],
  },
]);
assert.equal(propagatedSeriesGroups.length, 1);
assert.ok(propagatedSeriesGroups[0].editions.every((edition) => edition.seriesName === 'A Twisted Tale'));
assert.ok(propagatedSeriesGroups[0].editions.every((edition) => edition.seriesOrder === 7));
const propagatedExact = selectExactIsbnEdition(propagatedSeriesGroups, '9781368052238');
assert.ok(propagatedExact);
assert.equal(propagatedExact.edition.pageCount, 320);
assert.equal(propagatedExact.edition.seriesName, 'A Twisted Tale');
assert.equal(propagatedExact.edition.seriesOrder, 7);

const titleVariantGroups = hardenCatalogGroups([
  {
    key: 'conceal-short-title',
    title: "Conceal, Don't Feel",
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'google-books',
      externalEditionId: 'conceal-google',
      title: "Conceal, Don't Feel",
      authors: ['Jen Calonita'],
      isbn13: '9781368052238',
      pageCount: 320,
    }],
  },
  {
    key: 'conceal-series-title',
    title: "Conceal, Don't Feel: A Twisted Tale",
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'hardcover',
      externalEditionId: 'conceal-hardcover',
      title: "Conceal, Don't Feel: A Twisted Tale",
      authors: ['Jen Calonita'],
      isbn13: '9781368052238',
      seriesName: 'A Twisted Tale',
      seriesOrder: 7,
      pageCount: 312,
      binding: 'Hardcover',
    }],
  },
]);
const concealRankedSearch = hardenCatalogGroups([
  {
    key: 'conceal-exact',
    title: "Conceal, Don't Feel",
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'conceal-exact',
      title: "Conceal, Don't Feel",
      authors: ['Jen Calonita'],
    }],
  },
  {
    key: 'conceal-subtitle-variant',
    title: "Conceal, Don't Feel: A Twisted Tale",
    authors: ['Jen Calonita'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'conceal-subtitle-variant',
      title: "Conceal, Don't Feel: A Twisted Tale",
      authors: ['Jen Calonita'],
      seriesName: 'A Twisted Tale',
      seriesOrder: 7,
    }],
  },
  {
    key: 'conceal-research-near-match',
    title: 'Conceal and Don’t Feel as Much? Experiential Effects of Expressive Suppression',
    authors: ['Jessica L. Jones'],
    genres: [],
    editions: [{
      ...goodEdition,
      externalEditionId: 'conceal-research-near-match',
      title: 'Conceal and Don’t Feel as Much? Experiential Effects of Expressive Suppression',
      authors: ['Jessica L. Jones'],
    }],
  },
], { searchQuery: "conceal don't feel" });
assert.equal(concealRankedSearch[0].title, "Conceal, Don't Feel");
assert.ok(concealRankedSearch.some((group) => group.title.includes('Experiential Effects')));
assert.ok(concealRankedSearch[0].editions.some((edition) => edition.seriesName === 'A Twisted Tale'));

assert.equal(titleVariantGroups.length, 1);
assert.ok(titleVariantGroups[0].editions.every((edition) => edition.seriesName === 'A Twisted Tale'));
assert.ok(titleVariantGroups[0].editions.every((edition) => edition.seriesOrder === 7));
assert.equal(selectExactIsbnEdition(titleVariantGroups, '9781368052238')?.edition.pageCount, 320);

const broadParentTitleGroups = hardenCatalogGroups([
  {
    key: 'harry-parent',
    title: 'Harry Potter',
    authors: ['J. K. Rowling'],
    genres: [],
    editions: [{ ...baseEdition, externalEditionId: 'harry-parent', title: 'Harry Potter', authors: ['J. K. Rowling'], isbn13: undefined, isbn10: undefined }],
  },
  {
    key: 'harry-goblet',
    title: 'Harry Potter and the Goblet of Fire',
    authors: ['J. K. Rowling'],
    genres: [],
    editions: [{ ...baseEdition, externalEditionId: 'harry-goblet', title: 'Harry Potter and the Goblet of Fire', authors: ['J. K. Rowling'], isbn13: undefined, isbn10: undefined }],
  },
]);
assert.equal(broadParentTitleGroups.length, 2);


const exactIsbnGroups = hardenCatalogGroups([
  {
    key: 'isbn-google',
    title: 'Exact Edition',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      externalEditionId: 'isbn-google',
      title: 'Exact Edition',
      authors: ['Example Author'],
      isbn13: '9780307743657',
      coverUrl: 'https://example.com/exact.jpg',
      pageCount: undefined,
      publisher: undefined,
    }],
  },
  {
    key: 'isbn-open-library',
    title: 'Exact Edition',
    authors: ['Example Author'],
    genres: ['Fantasy'],
    editions: [{
      ...baseEdition,
      source: 'open-library',
      externalEditionId: 'isbn-open-library',
      title: 'Exact Edition',
      authors: ['Example Author'],
      isbn13: '9780307743657',
      coverUrl: undefined,
      pageCount: 412,
      publisher: 'Exact Publisher',
    }],
  },
  {
    key: 'wrong-edition',
    title: 'Exact Edition',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      externalEditionId: 'wrong-edition',
      title: 'Exact Edition',
      authors: ['Example Author'],
      isbn13: '9781451673319',
      pageCount: 999,
    }],
  },
]);

const exactIsbn = selectExactIsbnEdition(exactIsbnGroups, '9780307743657');
assert.ok(exactIsbn);
assert.equal(exactIsbn.edition.isbn13, '9780307743657');
assert.equal(exactIsbn.edition.pageCount, 412);
assert.equal(exactIsbn.edition.publisher, 'Exact Publisher');
assert.equal(exactIsbn.edition.coverUrl, 'https://example.com/exact.jpg');
assert.notEqual(exactIsbn.edition.pageCount, 999);

const conflictingIsbn13Groups = hardenCatalogGroups([
  {
    key: 'conflict-a',
    title: 'Conflicting Identifier Example',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      externalEditionId: 'conflict-a',
      title: 'Conflicting Identifier Example',
      authors: ['Example Author'],
      isbn10: '0307743659',
      isbn13: '9780307743657',
      pageCount: 412,
    }],
  },
  {
    key: 'conflict-b',
    title: 'Conflicting Identifier Example',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      externalEditionId: 'conflict-b',
      title: 'Conflicting Identifier Example',
      authors: ['Example Author'],
      isbn10: '0307743659',
      isbn13: '9781451673319',
      pageCount: 999,
    }],
  },
]);
assert.equal(conflictingIsbn13Groups[0].editions.length, 2);
assert.equal(
  selectExactIsbnEdition(conflictingIsbn13Groups, '9780307743657')?.edition.pageCount,
  412,
);


const physicalAnchorGroups = hardenCatalogGroups([
  {
    key: 'physical-hardcover',
    title: 'Divergent Example',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'hardcover',
      externalEditionId: 'physical-hardcover',
      title: 'Divergent Example',
      authors: ['Example Author'],
      isbn13: '9780307743657',
      binding: 'Hardcover',
      format: 'hardcover',
      pageCount: 330,
      language: 'en',
      coverUrl: 'https://example.com/english-cover.jpg',
    }],
  },
  {
    key: 'generic-ebook',
    title: 'Divergent Example',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'google-books',
      externalEditionId: 'generic-ebook',
      title: 'Divergent Example',
      authors: ['Example Author'],
      isbn13: '9780307743657',
      binding: undefined,
      format: 'ebook',
      pageCount: 487,
      language: 'en',
      coverUrl: 'https://example.com/generic-cover.jpg',
    }],
  },
]);
const physicalAnchor = selectExactIsbnEdition(physicalAnchorGroups, '9780307743657');
assert.ok(physicalAnchor);
assert.equal(physicalAnchor.edition.format, 'hardcover');
assert.equal(physicalAnchor.edition.pageCount, 487);
assert.equal(physicalAnchor.edition.coverUrl, 'https://example.com/english-cover.jpg');

const languageConflictGroups = hardenCatalogGroups([
  {
    key: 'english-no-cover',
    title: 'Language Example',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'hardcover',
      externalEditionId: 'english-no-cover',
      title: 'Language Example',
      authors: ['Example Author'],
      isbn13: '9780307743657',
      binding: 'Paperback',
      format: 'paperback',
      pageCount: 323,
      language: 'en',
      coverUrl: undefined,
    }],
  },
  {
    key: 'spanish-cover',
    title: 'Language Example',
    authors: ['Example Author'],
    genres: [],
    editions: [{
      ...baseEdition,
      source: 'google-books',
      externalEditionId: 'spanish-cover',
      title: 'Language Example',
      authors: ['Example Author'],
      isbn13: '9780307743657',
      binding: undefined,
      format: 'ebook',
      pageCount: 330,
      language: 'es',
      coverUrl: 'https://example.com/spanish-cover.jpg',
    }],
  },
]);
const languageConflict = selectExactIsbnEdition(languageConflictGroups, '9780307743657');
assert.ok(languageConflict);
assert.equal(languageConflict.edition.language, 'en');
assert.equal(languageConflict.edition.format, 'paperback');
assert.equal(languageConflict.edition.pageCount, 323);
assert.equal(languageConflict.edition.coverUrl, undefined);
