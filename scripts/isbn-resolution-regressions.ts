import assert from 'node:assert/strict';
import { combineIsbnProviderGroups, equivalentCatalogIsbns, selectCatalogIsbnFromBarcodes } from '../src/features/book-search/isbnResolution';
import { selectExactIsbnEdition } from '../src/features/book-search/catalogHardening';
import type { BookSearchWorkGroup } from '../src/features/book-search/model/bookSearch';

{
  const blackthornIsbn13 = '9781250379139';
  const equivalents = equivalentCatalogIsbns(blackthornIsbn13);
  assert.ok(
    equivalents.includes('9781250379139'),
    'Blackthorn ISBN-13 must remain a scanner lookup candidate.',
  );
  assert.ok(
    equivalents.includes('125037913X'),
    'Blackthorn ISBN-13 must also resolve through its ISBN-10 equivalent.',
  );
}

{
  const equivalents = equivalentCatalogIsbns('1-250-37913-X');
  assert.ok(equivalents.includes('125037913X'));
  assert.ok(equivalents.includes('9781250379139'));
}

{
  const isbn979 = '9798218403126';
  const equivalents = equivalentCatalogIsbns(isbn979);
  assert.deepEqual(
    equivalents,
    [isbn979],
    '979 ISBNs should not invent an ISBN-10 equivalent.',
  );
}

{
  assert.deepEqual(equivalentCatalogIsbns('9798218403128'), [], 'Invalid 979 check digits must be rejected.');
  assert.deepEqual(equivalentCatalogIsbns('065373007506'), [], 'UPC product barcodes must not be treated as ISBNs.');
}

{
  // Actual physical-book ISBNs that previously failed in scanner lookup.
  const fixtures = [
    { isbn: '9781250379139', isbn10: '125037913X', title: 'Blackthorn', author: 'J.T. Geissinger' },
    { isbn: '9781496758088', isbn10: '1496758080', title: 'Dawn of the Cursed Queen', author: 'Amber V. Nicole' },
  ];
  for (const fixture of fixtures) {
    assert.ok(equivalentCatalogIsbns(fixture.isbn).includes(fixture.isbn10));
    const group: BookSearchWorkGroup = {
      key: fixture.isbn, title: fixture.title, authors: [fixture.author], genres: [],
      editions: [{
        source: 'penguin-random-house', externalEditionId: fixture.isbn,
        title: fixture.title, authors: [fixture.author], genres: [], publicationYear: 2026,
        format: 'hardcover', isbn13: fixture.isbn, isbn10: fixture.isbn10, specialFeatures: [],
      }],
    };
    const unrelated: BookSearchWorkGroup = {
      key: 'unrelated', title: 'Different Book', authors: ['Someone Else'], genres: [],
      editions: [{
        source: 'google-books', externalEditionId: 'unrelated',
        title: 'Different Book', authors: ['Someone Else'], genres: [],
        publicationYear: 2026, format: 'hardcover', specialFeatures: [],
      }],
    };
    const combined = combineIsbnProviderGroups([[unrelated], [group]]);
    assert.equal(selectExactIsbnEdition(combined, fixture.isbn)?.work.title, fixture.title,
      'An unrelated primary provider must not hide the exact ISBN edition from a supplement.');
  }
}


{
  assert.equal(
    selectCatalogIsbnFromBarcodes(['065373007506', '9781250379139']),
    '9781250379139',
    'A nearby UPC must not beat a valid ISBN.',
  );
  assert.equal(
    selectCatalogIsbnFromBarcodes(['125037913X', '9781250379139']),
    '9781250379139',
    'Equivalent ISBN-10/ISBN-13 barcodes should resolve to canonical ISBN-13.',
  );
  assert.equal(
    selectCatalogIsbnFromBarcodes(['9781250379139', '9781496758088']),
    null,
    'Two unrelated valid ISBNs in one frame must be treated as ambiguous instead of guessed.',
  );
}

console.log('Inkbound ISBN resolution regressions passed.');
