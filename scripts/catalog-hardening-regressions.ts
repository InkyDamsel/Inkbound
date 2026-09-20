import assert from 'node:assert/strict';
import {
  catalogEditionQualityScore,
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
