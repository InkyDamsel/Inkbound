import assert from 'node:assert/strict';
import { shortTitleQueries, stripCoverPromoLines } from '../src/features/book-search/coverTextAnalysis';
import { collectPrintedIsbnEvidence, selectPreferredPrintedIsbn } from '../src/features/book-search/isbnResolution';
import { coverApproximatelyMatchesWork, coverMatchesWork } from '../src/features/book-search/scannerVerification';

assert.equal(coverMatchesWork(['IT','A NOVEL','STEPHEN','KING'], 'It', ['Stephen King']), true);
assert.equal(coverMatchesWork(['SHIT HAPPENS','STEPHEN','KING'], 'It', ['Stephen King']), false);
assert.ok(shortTitleQueries(['IT','STEPHEN','KING']).includes('IT STEPHEN KING'));

assert.equal(coverApproximatelyMatchesWork(['AVA REID','TMINTERVEI'], 'Winterveil', ['Ava Reid']), true);
assert.equal(coverApproximatelyMatchesWork(['AVA REED','TMINTERVEI'], 'Winterveil', ['Ava Reid']), false);
assert.equal(coverMatchesWork(['BLACK','THORN','J.T.','GEISSINGER'], 'Blackthorn', ['J.T. Geissinger']), true);

const neverLie=['#1 NEW YORK TIMES BESTSELLING AUTHOR OF','THE HOUSEMAID AND THE TEACHER','NEVER','LIE','FREIDA','McFADDEN'];
const stripped=stripCoverPromoLines(neverLie);
assert.equal(coverMatchesWork(stripped,'The Housemaid',['Freida McFadden']),false);
assert.equal(coverMatchesWork(stripped,'Never Lie',['Freida McFadden']),true);

const ropedPromo=['USA TODAY BESTSELLING AUTHOR OF BRANDED','SAFFRON A. KENT','ONCE HE HUNTS HER DOWN','HE\'S NEVER LETTING HER GO','ROPED'];
const ropedClean=stripCoverPromoLines(ropedPromo);
assert.equal(coverMatchesWork(ropedPromo,'Branded',['Saffron A. Kent']),true,
  'Raw OCR demonstrates why promo text must never be used as identity proof.');
assert.equal(coverMatchesWork(ropedClean,'Branded',['Saffron A. Kent']),false,
  'A previous title named only in author promo copy must not verify as the photographed book.');
assert.equal(coverMatchesWork(ropedClean,'Roped',['Saffron A. Kent']),true,
  'Removing promo text must preserve the actual photographed title and author evidence.');


const reignDamaged=['HER MAGIC IS A DEATH SENTENCE','RE1GN','BE THA N','CROME'];
assert.equal(coverApproximatelyMatchesWork(reignDamaged,'Reign',['Bethan Crome']),true,
  'Scanner must recover a one-glyph title substitution plus a fragmented author name.');

const dawnWrongBook=['DAWN OF THE CURSED QUEEN','AMBER V. NICOLE'];
assert.equal(coverMatchesWork(dawnWrongBook,'Gods and Monsters',['Amber V. Nicole']),false,
  'Matching author evidence must never verify a different title.');
assert.equal(coverMatchesWork(dawnWrongBook,'Dawn of the Cursed Queen',['Amber V. Nicole']),true,
  'The complete photographed title plus author must verify the intended work.');

const pages=[
  ['ISBN 978-0-06-346227-4','9 780063 462274'],
  ['ISBN 978-1-4967-5808-8','9 781496 758088'],
  ['ISBN 978-1-250-34675-9','9 781250 346759'],
  ['ISBN 978-1-6682-2748-0','9 781668 227480'],
  ['ISBN 978-1-682-81817-6','9 781682 818176'],
  ['ISBN-13: 978-1-7282-9616-6','9 781728 296166'],
  ['ISBN 978-0-593-71805-6','9 780593 718056'],
];
for(const lines of pages){
  const labeled=collectPrintedIsbnEvidence(lines);
  const expected=labeled[0]?.isbn;
  assert.ok(expected);
  const unlabeled=collectPrintedIsbnEvidence(lines.filter(line=>!/isbn/i.test(line)));
  assert.equal(selectPreferredPrintedIsbn(unlabeled),expected);
}
assert.deepEqual(collectPrintedIsbnEvidence(['51999','PRINTED IN CHINA']),[]);
assert.deepEqual(collectPrintedIsbnEvidence(['9 781250 346758']),[]);

console.log('Inkbound scanner cover regressions passed.');
