import assert from 'node:assert/strict';
import { collectPrintedIsbnEvidence, combineIsbnProviderGroups, equivalentCatalogIsbns, extractValidPrintedIsbns, selectCatalogIsbnFromBarcodes, selectPreferredPrintedIsbn } from '../src/features/book-search/isbnResolution';
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
    // Real-device scanner regressions: these must remain valid/equivalent lookup
    // identities even when a provider only returns the ISBN-10 form.
    { isbn: '9780345506931', isbn10: '0345506936', title: 'Seven Years to Sin', author: 'Sylvia Day' },
    { isbn: '9781501110368', isbn10: '1501110365', title: 'It Ends with Us', author: 'Colleen Hoover' },
    { isbn: '9780593718056', isbn10: '0593718054', title: 'Tom Clancy Terminal Velocity', author: 'M.P. Woodward' },
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


{
  const walmartPages = [
    {
      lines: ['Copyright © 2023 by S. J. Tilly', 'ISBN 978-1-68281-641-7', 'Walmart Edition ISBN 978-1-68281-818-3', 'First Edition October 2026'],
      standard: '9781682816417',
      walmart: '9781682818183',
    },
    {
      lines: ['Entangled Publishing / Amara', 'ISBN 978-1-64937-982-5', 'Walmart Edition ISBN 978-1-68281-817-6', 'First Edition October 2026'],
      standard: '9781649379825',
      walmart: '9781682818176',
    },
  ];
  for (const fixture of walmartPages) {
    const evidence = collectPrintedIsbnEvidence(fixture.lines);
    assert.ok(evidence.some((item) => item.isbn === fixture.standard && item.priority === 2),
      'Copyright-page scanner must retain the standard ISBN as companion evidence.');
    assert.ok(evidence.some((item) => item.isbn === fixture.walmart && item.priority === 3),
      'Explicit Walmart Edition ISBN must be recognized as retailer-edition evidence.');
    assert.equal(selectPreferredPrintedIsbn(evidence), fixture.walmart,
      'Explicit Walmart Edition ISBN must outrank the generic ISBN on the same copyright page.');
  }

  const splitWalmartEvidence = collectPrintedIsbnEvidence([
    'ISBN',
    '978-1-68281-641-7',
    'Walmart Edition ISBN',
    '978-1-68281-818-3',
  ]);
  assert.equal(selectPreferredPrintedIsbn(splitWalmartEvidence), '9781682818183',
    'Split native OCR lines must carry the Walmart Edition ISBN label onto its adjacent number.');
  assert.ok(splitWalmartEvidence.some((item) => item.isbn === '9781682816417' && item.priority === 2),
    'Split native OCR lines must retain the standard companion ISBN.');

  assert.deepEqual(extractValidPrintedIsbns('ISBN 978L-68281-641-7'), ['9781682816417'],
    'Bounded OCR repair should recover a checksum-valid ISBN from a common 1/L confusion.');
  assert.deepEqual(extractValidPrintedIsbns('ISBN 978-1-68281-641-8'), [],
    'Copyright OCR must reject a plausible-looking ISBN when its checksum is invalid.');
}

console.log('Inkbound ISBN resolution regressions passed.');
