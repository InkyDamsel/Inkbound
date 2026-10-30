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
console.log('Inkbound scanner verification regressions passed.');
