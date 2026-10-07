import assert from 'node:assert/strict';
import { equivalentCatalogIsbns } from '../src/features/book-search/isbnResolution';

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
  const isbn979 = '9798218403128';
  const equivalents = equivalentCatalogIsbns(isbn979);
  assert.deepEqual(
    equivalents,
    [isbn979],
    '979 ISBNs should not invent an ISBN-10 equivalent.',
  );
}

console.log('Inkbound ISBN resolution regressions passed.');
