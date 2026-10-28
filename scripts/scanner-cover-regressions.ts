import assert from 'node:assert/strict';
import { coverAuthorQueries, damagedTitleFragments, splitTitleRunQueries, isDemotedCoverTitleLine, prioritizeCoverTitleLines, shortTitleQueries, stripCoverPromoLines } from '../src/features/book-search/coverTextAnalysis';
import { collectPrintedIsbnEvidence, selectPreferredPrintedIsbn } from '../src/features/book-search/isbnResolution';
import { coverApproximatelyMatchesWork, coverMatchesWork } from '../src/features/book-search/scannerVerification';

assert.equal(coverMatchesWork(['IT','A NOVEL','STEPHEN','KING'], 'It', ['Stephen King']), true);
assert.equal(coverMatchesWork(['SHIT HAPPENS','STEPHEN','KING'], 'It', ['Stephen King']), false);
assert.ok(shortTitleQueries(['IT','STEPHEN','KING']).includes('IT STEPHEN KING'));

const winterveilFragments=damagedTitleFragments('TMINTERVEI');
assert.ok(winterveilFragments.some((fragment) => fragment.includes('interve')),
  'Damaged long title OCR must expose a stable interior retrieval fragment.');
assert.deepEqual(damagedTitleFragments('ROPED'),[],
  'Short titles must not be broadened into fragment retrieval.');
assert.deepEqual(damagedTitleFragments('DAWN OF THE CURSED QUEEN'),[],
  'Multi-word titles must stay on the stronger normal title paths.');
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


assert.ok(coverAuthorQueries(['HER MAGIC IS A DEATH SENTENCE','RE1GN','BE THA N','CROME']).includes('bethan crome'),
  'Fragmented given name plus next-line surname must produce a bounded author retrieval hint.');

const neroAllianceCover=['THE ALLIANCE SERIES','ER','ADARK MAFVA ROMANCE','S.J. TIL','TILLY','NERO'];
assert.equal(coverApproximatelyMatchesWork(neroAllianceCover,'Nero',['S.J. Tilly']),true,
  'Nero plus independently captured S.J. Tilly cover evidence must verify when normal search retrieves the work.');
assert.equal(coverApproximatelyMatchesWork(
  ['THE ALLIANCE SERIES','S.J. TILLY','NER0'],
  'Nero',
  ['S.J. Tilly'],
),false,'Four-character titles must require an exact OCR title match; fuzzy recovery is not allowed.');
assert.equal(coverApproximatelyMatchesWork(
  ['THE ALLIANCE SERIES','A DARK MAFIA ROMANCE','S.J. TILLY'],
  'Nero',
  ['S.J. Tilly'],
),false,'Alliance series and author evidence without the photographed Nero title must not verify Nero.');

const devouredWalmart=['JORDAN STEPHANIE GRAY','DEYOURED','Luminous and','exhilarating','Bitten is a romance','that sizzles','REBECCA ROSS','of Divine Rivals'];
assert.ok(coverAuthorQueries(devouredWalmart).includes('jordan stephanie gray'),
  'A complete three-word author line must survive noisy Walmart cover copy as a retrieval hint.');
assert.equal(coverApproximatelyMatchesWork(devouredWalmart,'Devoured',['Jordan Stephanie Gray']),true,
  'Damaged one-word title plus independently captured full author must verify approximately.');
assert.equal(coverApproximatelyMatchesWork(devouredWalmart,'Bitten',['Jordan Stephanie Gray']),false,
  'A title mentioned only in promotional cover copy must not replace the photographed title.');

const reignDamaged=['HER MAGIC IS A DEATH SENTENCE','RE1GN','BE THA N','CROME'];
assert.equal(coverApproximatelyMatchesWork(reignDamaged,'Reign',['Bethan Crome']),true,
  'Scanner must recover a one-glyph title substitution plus a fragmented author name.');

assert.equal(isDemotedCoverTitleLine('A DARK MAFIA ROMANCE'),true);
assert.equal(isDemotedCoverTitleLine('THE ALLIANCE SERIES'),true);
assert.equal(isDemotedCoverTitleLine('NEW YORK TIMES BESTSELLING AUTHOR'),true);
assert.equal(isDemotedCoverTitleLine('HER MAGIC IS A DEATH SENTENCE'),true);
assert.equal(isDemotedCoverTitleLine('NEVER LIE'),false);
assert.equal(isDemotedCoverTitleLine('ROPED'),false);
assert.equal(isDemotedCoverTitleLine('DAWN OF THE CURSED QUEEN'),false);
assert.deepEqual(
  prioritizeCoverTitleLines(['A DARK MAFIA ROMANCE','THE ALLIANCE SERIES','HANS','S.J. TILLY']).slice(0,2),
  ['HANS','S.J. TILLY'],
  'Title-like and author-shaped OCR must stay ahead of genre and series labels.',
);

const tillyPromoOnly=['A DARK MAFIA ROMANCE','THE ALLIANCE SERIES','NEW YORK TIMES BESTSELLING AUTHOR','S.J. TILLY'];
const tillyClean=stripCoverPromoLines(tillyPromoOnly).filter((line) => !/(?:new york times|bestsell)/i.test(line));
assert.equal(coverMatchesWork(tillyClean,'Hans',['S.J. Tilly']),false,
  'Author, series, and genre promo text without photographed title evidence must not verify a work.');

assert.equal(coverMatchesWork(['THE CIRCLE OF','STONE','A. J. LAKE'],'The Circle of Stone',['A. J. Lake']),true,
  'A legitimate title split across adjacent decorative lines must still verify.');
assert.equal(coverMatchesWork(['ADVERSARY','TO THE','VILLAIN','HANNAH NICOLE MAEHRER'],'Adversary to the Villain',['Hannah Nicole Maehrer']),true,
  'A legitimate three-line decorative title must still verify.');

const siblingTitleWordsScattered=[
  'GODS',
  'DAWN OF THE CURSED QUEEN',
  'AND MONSTERS',
  'AMBER V. NICOLE',
];
assert.equal(coverMatchesWork(siblingTitleWordsScattered,'Gods and Monsters',['Amber V. Nicole']),false,
  'A sibling title must not be manufactured from words scattered across unrelated cover lines.');
assert.equal(coverApproximatelyMatchesWork(['DAWN OF THE CURSED QUEEN','AMBER V. NICOLE'],'Gods and Monsters',['Amber V. Nicole']),false,
  'Author identity alone must never make an unrelated sibling title pass approximate verification.');

const dawnWalmartSplit=['DAWN','CURSED','OF','THE','QUEEN','GODS MONSTERS BOK THREE','A MBER V','NICOLE'];
assert.ok(splitTitleRunQueries(dawnWalmartSplit).includes('dawn cursed of the queen'),
  'Walmart OCR split across one-word decorative lines must reconstruct the full Dawn title for retrieval.');

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
