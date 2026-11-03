import assert from 'node:assert/strict';
import { sameCatalogIsbn, collectPrintedIsbnEvidence, combineIsbnProviderGroups, equivalentCatalogIsbns, extractValidPrintedIsbns, selectCatalogIsbnFromBarcodes, selectPreferredPrintedIsbn } from '../src/features/book-search/isbnResolution';
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
  // Nov 3 physical Walmart scans. These passed native barcode decoding
  // but did not all receive catalog results. Never misclassify them as UPCs.
  for (const isbn of ['9781538758458', '9780316608312', '9781649379825']) {
    assert.deepEqual(equivalentCatalogIsbns(isbn).includes(isbn), true,
      `Walmart ISBN ${isbn} must be retained unchanged as a valid physical identifier.`);
  }
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
    assert.ok(evidence.some((item) => item.isbn === fixture.standard && item.priority === 3),
      'Copyright-page scanner must recognize the standard publisher ISBN as primary evidence.');
    assert.ok(evidence.some((item) => item.isbn === fixture.walmart && item.priority === 1),
      'Explicit Walmart Edition ISBN must be retained as retailer fallback evidence.');
    assert.equal(selectPreferredPrintedIsbn(evidence), fixture.standard,
      'Standard publisher ISBN must outrank the Walmart Edition ISBN on the same copyright page.');
    assert.equal(selectPreferredPrintedIsbn(evidence, fixture.walmart), fixture.standard,
      'A previously scanned Walmart barcode must not override the standard publisher ISBN printed on the copyright page.');
  }

  const splitWalmartEvidence = collectPrintedIsbnEvidence([
    'ISBN',
    '978-1-68281-641-7',
    'Walmart Edition ISBN',
    '978-1-68281-818-3',
  ]);
  assert.equal(selectPreferredPrintedIsbn(splitWalmartEvidence), '9781682816417',
    'Split native OCR lines must prefer the standard publisher ISBN over the Walmart Edition ISBN.');
  assert.ok(splitWalmartEvidence.some((item) => item.isbn === '9781682816417' && item.priority === 3),
    'Split native OCR lines must retain the standard publisher ISBN as primary evidence.');
  assert.ok(splitWalmartEvidence.some((item) => item.isbn === '9781682818183' && item.priority === 1),
    'Split native OCR lines must retain the Walmart Edition ISBN only as fallback evidence.');

  const walmartOnlyEvidence = collectPrintedIsbnEvidence(['Walmart Edition ISBN 978-1-68281-818-3']);
  assert.equal(selectPreferredPrintedIsbn(walmartOnlyEvidence), '9781682818183',
    'A retailer ISBN must remain usable when it is the only valid printed ISBN available.');

  assert.deepEqual(extractValidPrintedIsbns('ISBN 978L-68281-641-7'), ['9781682816417'],
    'Bounded OCR repair should recover a checksum-valid ISBN from a common 1/L confusion.');
  assert.deepEqual(extractValidPrintedIsbns('Walmart Edition ISBN 978-1-68281-818-3'), ['9781682818183'],
    'A Walmart ISBN-13 must remain the full printed ISBN and never collapse to an inner ISBN-10.');
  assert.ok(!extractValidPrintedIsbns('Walmart Edition ISBN 978-1-68281-818-3').includes('8682818183'),
    'Scanner must never manufacture checksum-valid ISBN-10 8682818183 from inside 9781682818183.');
  assert.deepEqual(extractValidPrintedIsbns('ISBN 978-1-68281-641-8'), [],
    'Copyright OCR must reject a plausible-looking ISBN when its checksum is invalid.');
}


// Audit 2026-11: a scan batch must treat ISBN-10 and its ISBN-13 as ONE edition identity.
assert.equal(sameCatalogIsbn('0306406152', '9780306406157'), true, 'ISBN-10 and ISBN-13 of one edition are the same identity');
assert.equal(sameCatalogIsbn('9780306406157', '0306406152'), true);
assert.equal(sameCatalogIsbn('9780306406157', '9780306406157'), true);
assert.equal(sameCatalogIsbn('0306406152', '9781682818183'), false, 'unrelated editions stay distinct');
assert.equal(sameCatalogIsbn('catalog:google-books:abc', 'catalog:google-books:abc'), true);
assert.equal(sameCatalogIsbn('catalog:google-books:abc', 'catalog:google-books:abd'), false);
assert.equal(sameCatalogIsbn('9791234567896', '9791234567896'), true, '979 values compare exactly');

console.log('Inkbound ISBN resolution regressions passed.');
