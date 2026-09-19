import assert from 'node:assert/strict';
import {
  catalogEditionQualityScore,
  hardenCatalogEdition,
  hardenCatalogGroups,
  isValidCatalogIsbn10,
  isValidCatalogIsbn13,
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
