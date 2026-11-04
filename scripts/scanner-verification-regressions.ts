import assert from 'node:assert/strict';
import { coverApproximatelyMatchesWork, coverMatchesWork, isScannerBatchIdentityConsistent, scannerEditionKey } from '../src/features/book-search/scannerVerification';

const circle = ['DARKEST AGE', 'THE CIRCLE OF', 'STONE', 'A. J. LAKE'];
assert.equal(coverMatchesWork(circle, 'The Circle of Stone', ['A. J. Lake']), true);
assert.equal(coverMatchesWork(circle, 'Darkest Age', ['Eric Staggs']), false);
assert.equal(coverMatchesWork(circle, 'The Circle of Stone', ['Eric Staggs']), false);
assert.equal(coverMatchesWork(circle, 'The Circle of Stone', ['A. J. Baker']), false);
const adversary = ['ADVERSARY', 'TO THE', 'VILLAIN', 'HANNAH NICOLE MAEHRER', 'WALMART EXCLUSIVE'];
assert.equal(coverMatchesWork(adversary, 'Adversary to the Villain', ['Hannah Nicole Maehrer']), true);
assert.equal(coverMatchesWork(adversary, 'Darkest Age', ['Eric Staggs']), false);
assert.equal(coverMatchesWork(['STONE', 'A. J. LAKE'], 'The Circle of Stone', ['A. J. Lake']), false);
const edition = { isbn13: '9781599900797', source: 'open-library', externalEditionId: 'circle' };
assert.equal(scannerEditionKey(edition), '9781599900797');
assert.equal(isScannerBatchIdentityConsistent('9781682817254', [{ isbn13: '9781599900797' }]), false,
  'An Adversary ISBN must never identify a Circle of Stone edition.');
assert.equal(isScannerBatchIdentityConsistent('9781599900797', [{ isbn13: '9781599900797' }]), true);
assert.equal(isScannerBatchIdentityConsistent('catalog:open-library:circle', [
  { externalSource: 'open-library', externalEditionId: 'circle' },
]), true);
// Walmart: author-name biography must not be accepted as the photographed novel.
const picassoHeistCover = ['JAMES', 'PATTERSON', 'HOWARD ROUGHAN', 'THE PICASSO HEIST', 'A THRILLER'];
assert.equal(coverApproximatelyMatchesWork(picassoHeistCover, 'James Patterson by James Patterson', ['James Patterson']), false);
assert.equal(coverApproximatelyMatchesWork(picassoHeistCover, 'The Picasso Heist', ['James Patterson', 'Howard Roughan']), true);
// A valid title and independently printed author must remain eligible.
assert.equal(coverApproximatelyMatchesWork(['KING', 'OF', 'GLUTTONY', 'ANA HUANG'], 'King of Gluttony', ['Ana Huang']), true);
// Real-world Walmart: DEV OURED is correctly printed with JORDAN
// STEPHANIE GRAY. A same-title ebook by a different author is NOT this book.
// Reject it in both strict and approximate cover verification lanes.
const devouredCover = ['DEVOURED', 'JORDAN STEPHANIE GRAY', 'A ROMANCE THAT SIZZLES'];
assert.equal(coverMatchesWork(devouredCover, 'Devoured', ['Emily Snow']), false,
  'An unrelated Devoured edition must not pass strict author verification.');
assert.equal(coverApproximatelyMatchesWork(devouredCover, 'Devoured', ['Emily Snow']), false,
  'An unrelated Devoured edition must not pass approximate author verification.');
assert.equal(coverMatchesWork(devouredCover, 'Devoured', ['Jordan Stephanie Gray']), true,
  'The actual printed author must continue to verify.');
assert.equal(coverApproximatelyMatchesWork(devouredCover, 'Devoured', ['Jordan Stephanie Gray']), true,
  'The actual printed author must survive approximate verification.');
// External audit: letters from unrelated OCR lines must never manufacture
// another book's given name. A common short surname alone proves nothing.
const accidentalAuthor = ['DEVOURED', 'SNOW', 'THEM', 'ILY'];
assert.equal(coverMatchesWork(accidentalAuthor, 'Devoured', ['Emily Snow']), false,
  'Strict matching must not join THEM + ILY into EMILY across OCR lines.');
assert.equal(coverApproximatelyMatchesWork(accidentalAuthor, 'Devoured', ['Emily Snow']), false,
  'Approximate matching must not join unrelated lines into an author.');
assert.equal(coverMatchesWork(['DEVOURED', 'SNOW'], 'Devoured', ['Emily Snow']), false,
  'Short surnames without given-name evidence must not verify a book.');
assert.equal(coverMatchesWork(['DEVOURED', 'EMILY SNOW'], 'Devoured', ['Emily Snow']), true,
  'A legitimately printed full author must still verify.');
assert.equal(coverApproximatelyMatchesWork(['REIGN', 'BETH AN', 'CRO OME'], 'Reign', ['Bethan Croome']), true,
  'Fragmented author evidence from one OCR line must still be accepted.');
console.log('Inkbound scanner verification regressions passed.');
