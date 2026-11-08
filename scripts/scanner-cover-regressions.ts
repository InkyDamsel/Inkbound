import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverAuthorQueries, coverTitleEvidenceHints, rankAuthorHints, titleAuthorPartQueries, damagedTitleFragments, splitTitleRunQueries, isDemotedCoverTitleLine, prioritizeCoverTitleLines, shortTitleQueries, stripCoverPromoLines, titleSurnameRecoveryQueries } from '../src/features/book-search/coverTextAnalysis';
import { collectPrintedIsbnEvidence, selectPreferredPrintedIsbn } from '../src/features/book-search/isbnResolution';
import { coverApproximatelyMatchesWork, coverMatchesWork } from '../src/features/book-search/scannerVerification';

assert.equal(coverMatchesWork(['IT','A NOVEL','STEPHEN','KING'], 'It', ['Stephen King']), true);
assert.equal(coverMatchesWork(['SHIT HAPPENS','STEPHEN','KING'], 'It', ['Stephen King']), false);
assert.ok(shortTitleQueries(['IT','STEPHEN','KING']).includes('IT STEPHEN KING'));

assert.equal(coverApproximatelyMatchesWork(['MOON', 'THE KNAVE AND THE MOON', 'R ACH EL', 'GI LL I G'], 'Moon', ['Milton Lewis Moon']), false,
  'Do not confuse a title word with a catalog author surname.');
assert.equal(coverMatchesWork(['MOON', 'THE KNAVE AND THE MOON', 'R ACH EL', 'GI LL I G'], 'Moon', ['Milton Lewis Moon']), false,
  'Exact verifier also rejects title/author identity collisions.');
assert.equal(coverApproximatelyMatchesWork(['CARRIE', 'STEPHEN KING'], 'Carrie', ['Stephen King']), true,
  'Single-word titles with independent full author evidence still pass.');
// Nov 7 device trace: marketing banner fragments displaced the damaged
// credited name before the bounded catalog search could use it.
const bannerRankedAuthors = rankAuthorHints(
  ['THH INSTAN', 'EX BESTSEU', 'R ACH E', 'GLLIG', 'MOON', 'KNA KE'],
  ['THH INSTAN', 'EX BESTSEU', 'rache gllig', 'andth rache'],
  ['moon', 'knake'],
);
assert.ok(bannerRankedAuthors.indexOf('rache gllig') >= 0
  && bannerRankedAuthors.indexOf('rache gllig') < bannerRankedAuthors.indexOf('THH INSTAN')
  && bannerRankedAuthors.indexOf('rache gllig') < bannerRankedAuthors.indexOf('EX BESTSEU'),
  'Damaged marketing-banner text must not outrank a non-promotional author-shaped hint.');

// Real physical-cover OCR: catalog retrieval already found this work, but
// decorative letters split the author and damaged both title words.
const knaveMoonCover = [
  'Prepare to', 'meet your next', 'obsession',
  'The Kt end The Moth', 'aND THE', 'MOGN',
  'R ACH EL', 'GI LL I G', 'MOBN', 'KNVE',
];
assert.equal(coverApproximatelyMatchesWork(knaveMoonCover, 'The Knave and the Moon', ['Rachel Gillig']), true,
  'Recover two damaged title words across OCR passes with fully reconstructed author.');
assert.equal(coverApproximatelyMatchesWork(knaveMoonCover, 'The Knave and the Moon', ['Rachel Smith']), false,
  'Never accept a damaged two-word title with an unrelated surname.');
assert.equal(coverApproximatelyMatchesWork([
  'KNVE', 'MOGN', 'R ACH EL', 'GI LL I G',
], 'The Knave and the Moon', ['Rachel Gillig']), false,
  'Require repeated independent title evidence before joining separated damaged fragments.');

// Field capture: full author + THRESHING / DRY on adjacent title lines.
// The actual title is Threshing Day; DRY is one OCR substitution from DAY.
const threshingCover = [
  'THIRTEEN UNFORGETTABLE STORIES ONE LEGENDARY DAY',
  'THE BOND THAT CHANGES EVERYTHING',
  'THRESHING', 'DRY', 'REBECCA YARROS',
];
assert.equal(coverApproximatelyMatchesWork(threshingCover, 'Threshing Day', ['Rebecca Yarros']), true,
  'Recover an adjacent two-line title with one damaged short word and verified author.');
assert.equal(coverApproximatelyMatchesWork(threshingCover, 'Threshing Day', ['Rebecca Smith']), false,
  'Damaged title recovery must still require the correct author.');
assert.equal(coverApproximatelyMatchesWork([
  'THRESHING', 'SOME OTHER TITLE', 'DRY', 'REBECCA YARROS',
], 'Threshing Day', ['Rebecca Yarros']), false,
  'Do not assemble damaged two-word titles from separated OCR lines.');

// Repeated truncated OCR must not hide a less frequent complete title.
const devouredHints = coverTitleEvidenceHints(
  ['DEVOURE', 'DEVOURE', 'DEVOURED', 'DEVOUSED', 'JORDAN STEPHANIE GRAY'],
  ['JORDAN STEPHANIE GRAY'],
);
assert.ok(devouredHints.includes('devoured'),
  'Keep the complete DEV OURED spelling in title retrieval candidates.');
assert.ok(devouredHints.indexOf('devoured') < devouredHints.indexOf('devoure'),
  'Prefer complete title OCR over the repeated truncated variant.');
const googleSource = readFileSync('src/features/book-search/data/googleBooksApi.ts', 'utf8');
assert.ok(!googleSource.includes('Protected Google Books lookup unavailable; retrying public Google Books.'),
  'Never fall back to shared unauthenticated Google quota after protected lookup failure.');
assert.ok(googleSource.includes('searchOpenLibrary(`author:${query.trim()}`'),
  'Open Library author fallback must use its own query dialect.');

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

const witchWithHousemaidPromo = [
  '#1 New York Times Bestselling Author of',
  'THE HOUSEMAID',
  'FREIDA',
  'MCFADDEN',
  'THE',
  'WITCH',
];
assert.equal(
  coverApproximatelyMatchesWork(witchWithHousemaidPromo,'The Housemaid',['Freida McFadden']),
  false,
  'A sibling title printed only inside author-of promo copy must never verify the photographed work.',
);
assert.equal(
  coverApproximatelyMatchesWork(witchWithHousemaidPromo,'The Witch',['Freida McFadden']),
  true,
  'The photographed single-word title must still verify from primary cover text.',
);

const witchClean = stripCoverPromoLines(witchWithHousemaidPromo);
assert.equal(
  witchClean.some((line) => /housemaid/i.test(line)),
  false,
  'Detached sibling title after an author-of line must be removed before scanner retrieval.',
);
assert.equal(
  witchClean.some((line) => /witch/i.test(line)),
  true,
  'Removing detached promo identity must preserve the photographed title.',
);
assert.equal(
  coverApproximatelyMatchesWork(witchClean,'The Housemaid',['Freida McFadden']),
  false,
  'The actual scanner clean-line path must reject the detached sibling work.',
);
assert.equal(
  coverApproximatelyMatchesWork(witchClean,'The Witch',['Freida McFadden']),
  true,
  'The actual scanner clean-line path must retain the photographed work.',
);

const ropedPromo=['USA TODAY BESTSELLING AUTHOR OF BRANDED','SAFFRON A. KENT','ONCE HE HUNTS HER DOWN','HE\'S NEVER LETTING HER GO','ROPED'];
const ropedClean=stripCoverPromoLines(ropedPromo);
assert.equal(coverMatchesWork(ropedPromo,'Branded',['Saffron A. Kent']),false,
  'Defense in depth: even UNSTRIPPED promo copy ("AUTHOR OF BRANDED") is not title-shaped evidence.');
assert.equal(coverMatchesWork(ropedClean,'Branded',['Saffron A. Kent']),false,
  'A previous title named only in author promo copy must not verify as the photographed book.');
assert.equal(coverMatchesWork(ropedClean,'Roped',['Saffron A. Kent']),true,
  'Removing promo text must preserve the actual photographed title and author evidence.');


assert.ok(coverAuthorQueries(['HER MAGIC IS A DEATH SENTENCE','RE1GN','BE THA N','CROME']).includes('bethan crome'),
  'Fragmented given name plus next-line surname must produce a bounded author retrieval hint.');

// Walmart Nov 3: the photographed book is THE PICASSO HEIST.
// "A THRILLER" is a genre subtitle, not James Patterson's unrelated THRILLER.
// Both exact and approximate gates must reject the false positive.
// The scanner-debug build has one persistent diagnostics panel, including
// failures. Never duplicate it inside the error section.
const scannerUiSource = readFileSync('src/components/AddBookModal.tsx', 'utf8');
assert.equal((scannerUiSource.match(/>Scanner diagnostics — test build<\/summary>/g) ?? []).length, 1,
  'Keep exactly one scanner-debug diagnostics panel.');
assert.equal((scannerUiSource.match(/>Scanner details<\/summary>/g) ?? []).length, 0,
  'Do not duplicate scanner diagnostics inside the error section.');
assert.ok(scannerUiSource.includes('early-exact-title:'),
  'Try exact title evidence before exhausting the broad query budget.');

const picassoCover = [
  'JAMES PATTERSON',
  'AND HOWARD ROUGHAN',
  'A THRILLER',
  'THE PICASSO HEIST',
];
assert.equal(coverMatchesWork(picassoCover, 'Thriller', ['James Patterson']), false,
  'A secondary genre subtitle must never establish the book title.');
assert.equal(coverApproximatelyMatchesWork(picassoCover, 'Thriller', ['James Patterson']), false,
  'Approximate recovery must not offer Thriller for The Picasso Heist.');
const picassoSplitCover = [
  'JAMES PATTERSON',
  'AND HOWARD ROUGHAN',
  'A THRILLER',
  'THE',
  'PICASSO',
  'HEIST',
];
assert.equal(coverMatchesWork(picassoSplitCover, 'Thriller', ['James Patterson']), false,
  'Split multi-line cover title still disqualifies unrelated genre-name work.');
assert.equal(coverApproximatelyMatchesWork(picassoSplitCover, 'Thriller', ['James Patterson']), false,
  'Split PICASSO / HEIST must not suggest Thriller.');
assert.equal(coverApproximatelyMatchesWork(picassoCover, 'The Picasso Heist', ['James Patterson', 'Howard Roughan']), true,
  'Rejecting a genre subtitle must not reject the actual photographed work.');

const neroLiveNoisyLines=['THE ALLIANCE SERIES','NERO','ADARK MAFIA ROMA NCE','S.J.TILLY','THEALLIANCE SERIES','NER','A DAR K MAF VA ROMANCE','S.J.TILL','A DARK MAFIA ROM A N CE','S.J.','TILLY','A DARK MAFVA ROMANC E'];
const neroFragmentedSurname=['THE ALLIANCE SERIES','ERO','ADARK M AFIA ROMANCE','S J TIL LY','THEALLIANCE SERIES','S J','LLY','TILLY','NER','NERO'];
const neroFragmentedSurnameAuthors=coverAuthorQueries(neroFragmentedSurname);
assert.ok(neroFragmentedSurnameAuthors.includes('s j tilly'),
  'Initialed author OCR with an internally fragmented surname must reconstruct before noisy cover copy consumes the author-query budget.');
assert.ok(titleSurnameRecoveryQueries(neroFragmentedSurname,neroFragmentedSurnameAuthors).some((query) => query === 'nero tilly'),
  'Fragmented initials-plus-surname recovery must retain the exact short-title surname anchor.');

const neroLiveAuthors=coverAuthorQueries(neroLiveNoisyLines);
assert.ok(neroLiveAuthors.includes('s j tilly'),
  'Strong initials plus surname must survive the bounded author-query budget even after noisy cover lines.');

const neroWalmartLatest=['THE ALLIANCE SERIES','ERO','ADARK MAFTA ROMA NCE','S J','J TILLY','ADARK MAFIA ROMANCE','J T LLY','IHE ALLIANCE SERIES','A D ARK MAFIA ROMANCE','TILLY','NERO','A DARK MAFTA ROMANCE'];
const neroWalmartLatestAuthors=coverAuthorQueries(neroWalmartLatest);
assert.ok(neroWalmartLatestAuthors.some((query) => /(?:^| )tilly$/.test(query)),
  'Latest Walmart Nero OCR must retain Tilly as strong author evidence.');
assert.equal(coverApproximatelyMatchesWork(neroWalmartLatest,'Nero',['S.J. Tilly']),true,
  'Latest Walmart Nero OCR must verify the photographed work from exact title plus independent Tilly evidence.');
assert.ok(titleSurnameRecoveryQueries(neroLiveNoisyLines,neroLiveAuthors).some((query) => query === 'nero tilly'),
  'Live noisy Nero OCR must retain the exact title-surname retrieval connection.');

const neroRecoveryAuthors=coverAuthorQueries(['THE ALLIANCE SERIES','DARK MAFVA ROMANCE','S.J.TILLY','NERO']);
assert.ok(titleSurnameRecoveryQueries(['THE ALLIANCE SERIES','DARK MAFVA ROMANCE','S.J.TILLY','NERO'],neroRecoveryAuthors).some((query) => query === 'nero tilly'),
  'Exact short title plus recovered surname must produce a bounded Nero retrieval anchor.');

const dawnRecoveryLines=['OF','TIIE','DAWN','CURSEID','TUE','QUEEN','GODS & MONSTERS','BOK HREE','A MBERN. NICOLE'];
const dawnRecoveryAuthors=coverAuthorQueries(dawnRecoveryLines);
assert.ok(dawnRecoveryAuthors.some((query) => query.endsWith(' nicole')),
  'A detached first-name glyph must not destroy an otherwise intact author surname retrieval hint.');
assert.ok(titleSurnameRecoveryQueries(dawnRecoveryLines,dawnRecoveryAuthors).some((query) => query.includes('dawn') && query.includes('curseid') && query.includes('queen') && query.includes('nicole')),
  'Complementary Dawn title words plus recovered surname must produce a bounded retrieval anchor.');
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

const hungerGamesWalmart=['THE','HUNGER','GAMES','New York Times Bestselling Author','SUZANNE','COLLINS','HUNGER','GAMES'];
const hungerGamesAuthors=coverAuthorQueries(hungerGamesWalmart);
assert.ok(hungerGamesAuthors.includes('suzanne collins'),
  'Adjacent one-word author lines must survive title-shaped cover text within the bounded author-query budget.');
assert.ok(titleSurnameRecoveryQueries(hungerGamesWalmart,hungerGamesAuthors).some((query) =>
  query.includes('hunger') && query.includes('games') && query.endsWith('collins')),
  'The Hunger Games cover evidence must produce a title plus Collins retrieval anchor.');
assert.equal(coverApproximatelyMatchesWork(hungerGamesWalmart,'The Hunger Games',['Suzanne Collins']),true,
  'The Hunger Games plus independently photographed Suzanne Collins evidence must verify.');

const girlInPiecesWalmart=['G RL','PHEEES','ATALEEN','GLAS GOW','GIKL','KATHLE EN','GLAS GOW','GR','KATALE N','GEASGOW','GLAS GOW','KATALE EN','GLAS GOW','PIECES','GLASGOW'];
const girlInPiecesAuthors=coverAuthorQueries(girlInPiecesWalmart);
assert.ok(girlInPiecesAuthors.includes('kathleen glasgow'),
  'Complementary fragmented Kathleen Glasgow OCR passes must reconstruct a bounded author hint.');
assert.ok(titleSurnameRecoveryQueries(girlInPiecesWalmart,girlInPiecesAuthors).some((query) =>
  query.includes('pieces') && query.endsWith('glasgow')),
  'Girl in Pieces OCR must retain a Pieces plus Glasgow retrieval anchor.');

const devouredWalmart=['JORDAN STEPHANIE GRAY','DEYOURED','Luminous and','exhilarating','Bitten is a romance','that sizzles','REBECCA ROSS','of Divine Rivals'];
assert.ok(coverAuthorQueries(devouredWalmart).includes('jordan stephanie gray'),
  'A complete three-word author line must survive noisy Walmart cover copy as a retrieval hint.');
assert.equal(coverApproximatelyMatchesWork(devouredWalmart,'Devoured',['Jordan Stephanie Gray']),true,
  'Damaged one-word title plus independently captured full author must verify approximately.');
assert.equal(coverApproximatelyMatchesWork(devouredWalmart,'Bitten',['Jordan Stephanie Gray']),false,
  'A title mentioned only in promotional cover copy must not replace the photographed title.');

const reignWrongGromCandidates = ['REIGN', 'BETH AN', 'GR O ME', 'BET HAN', 'CRO ME', 'BETHAN'];
assert.equal(coverApproximatelyMatchesWork(reignWrongGromCandidates, 'Grom', ['Federico Grom']), false,
  'A damaged Reign author fragment must not verify an unrelated Grom author.');
assert.equal(coverApproximatelyMatchesWork(reignWrongGromCandidates, 'Grom', ['A. V. Selivanov']), false,
  'A short-title candidate must have independently photographed author evidence.');
assert.equal(coverApproximatelyMatchesWork(reignWrongGromCandidates, 'Reign', ['Bethan Croome']), true,
  'Rejecting Grom must not prevent the actual Reign cover from verifying.');

const reignCompleteGivenFragmentedSurname=['RETGN','BETHAN R','CRO ME','BETHAN','REIGN','BETHAN','BET HAN','BETH AN','GRO ME','R OM E'];
const reignCompleteGivenAuthors=coverAuthorQueries(reignCompleteGivenFragmentedSurname);
assert.ok(reignCompleteGivenAuthors.includes('bethan crome'),
  'A complete recovered given name plus a nearby fragmented surname must reconstruct into a strong author hint.');
assert.ok(coverApproximatelyMatchesWork(reignCompleteGivenFragmentedSurname,'Reign',['Bethan Croome']),
  'A complete given name plus one-character-damaged fragmented surname must verify the real catalog author after title proof.');

const reignLiveFragmented=['REIGN','BETH AN','CRO ME','REIGN!','BETHAN','CRO ME','t:i','BETH AN t','L1','OM','BETH AN'];
assert.ok(coverAuthorQueries(reignLiveFragmented).includes('bethan crome'),
  'Two adjacent internally fragmented author words must reconstruct into a bounded author retrieval hint.');

const reignWalmartLatest=['REIGN','BETH AN','GR O ME','BET H AN','CR O ME','BET HAN','GRO ME','BETHAN'];
const reignWalmartLatestAuthors=coverAuthorQueries(reignWalmartLatest);
assert.ok(reignWalmartLatestAuthors.includes('bethan crome') || reignWalmartLatestAuthors.includes('bethan grome'),
  'Latest Walmart Reign OCR must reconstruct a bounded Bethan surname retrieval hint.');
assert.equal(coverApproximatelyMatchesWork(reignWalmartLatest,'Reign',['Bethan Croome']),true,
  'Latest Walmart Reign OCR must verify the real catalog identity despite one damaged surname glyph.');
assert.ok(coverApproximatelyMatchesWork(reignLiveFragmented,'Reign',['Bethan Croome']),
  'Live fragmented Reign OCR must verify the real Croome surname with one missing OCR glyph.');

const reignPhotoSpacedAuthor=['REIGN','BETH AN','GR O ME','REIEN','BET HAN','CRO ME','BETH A','GRO ME','GR O ME','BETH AT K','CRO ME'];
const reignPhotoSpacedAuthors=coverAuthorQueries(reignPhotoSpacedAuthor);
assert.ok(reignPhotoSpacedAuthors.includes('bethan crome'),
  'Repeated OCR passes must prefer BETH AN + CRO ME -> bethan crome over damaged GROME variants.');
assert.ok(titleSurnameRecoveryQueries(reignPhotoSpacedAuthor,reignPhotoSpacedAuthors).some((query) => query === 'reign crome'),
  'Reign photo OCR must preserve the exact title-surname retrieval anchor after author reconstruction.');

const reignDamaged=['HER MAGIC IS A DEATH SENTENCE','RE1GN','BE THA N','CROME'];
assert.equal(coverApproximatelyMatchesWork(reignDamaged,'Reign',['Bethan Croome']),true,
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

const dawnShreddedGlue=['OF','TUE','DAWN','CURSED','TIIE','QUEEN','GODS & MONSTERS','BOK TIHREE','A MB RN. NICOLE'];
assert.equal(coverApproximatelyMatchesWork(dawnShreddedGlue,'Dawn of the Cursed Queen',['Amber V. Nicole']),true,
  'Three distinctive photographed title words plus independent surname must survive shredded glue-word OCR.');
assert.equal(coverApproximatelyMatchesWork(dawnShreddedGlue,'Gods and Monsters',['Amber V. Nicole']),false,
  'A two-word sibling title must not use distinctive-word fallback even when the same author is visible.');
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

// Systemic retrieval-budget regression: three OCR title variants and two
// plausible author hints must not starve surname/given-name fallback.
const boundedRecovery = titleAuthorPartQueries(
  ['damaged one', 'damaged two', 'correct title'],
  ['correct given surname', 'noisy given surname'],
  6,
);
assert.equal(boundedRecovery.length, 6);
assert.ok(boundedRecovery.includes('correct title correct given surname'),
  'All three title observations must receive a full-identity lookup.');
assert.ok(boundedRecovery.some((query) => query === 'damaged one surname' || query === 'damaged one correct'),
  'A six-request scanner budget must reserve room for partial-name recovery.');

// Live on-device OCR (Oct 30 2026). The scanner's request budget is tiny, so the
// REAL printed author and title must be ranked first or they are never queried.
const liveClean = (raw: string[]) => raw
  .map((line) => line.replace(/[^a-zA-Z\s'-]/g, ' ').replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .filter((line) => !/(?:new york times|bestsell|walmart exclusive|exclusive edition|isbn(?:-1[03])?\s*[:#]|book club edition|^a novel$)/i.test(line));
const liveRank = (raw: string[]) => {
  const lines = liveClean(raw);
  const authors = rankAuthorHints(lines, [...lines.filter((line) => { const words = line.trim().split(/\s+/); return words.length >= 2 && words.length <= 4 && !isDemotedCoverTitleLine(line); }), ...coverAuthorQueries(lines, 24)]).map((hint) => hint.toLowerCase()).slice(0, 12);
  return { lines, authors, titles: coverTitleEvidenceHints(lines, authors) };
};

const liveDevoured = liveRank(['JORDAN STEPHANIE GRAY','DEVOURO','"Luminous and','exhilarating...','[Bitten is] a romance','that sizzles."','EBECCA ROSS,','1 New York Tim','bastselling suthor','of Divin Rivals','DEKORE','exhilarating....','[Bitten is) a romance','#1 New York TimeE','bestsoling suthor','of Divina Rivals','DEVOURED','"LuminoUS and','that sizzles,"','-REBECCA']);
assert.equal(liveDevoured.authors[0], 'jordan stephanie gray',
  'Devoured: the printed all-caps author must outrank blurb lines such as "new york tim".');
assert.ok(liveDevoured.titles.includes('devoured'), 'Devoured: OCR variants DEVOURO/DEVOURED must collapse to a title hint.');
assert.ok(titleAuthorPartQueries(liveDevoured.titles, liveDevoured.authors).includes('devoured jordan stephanie gray'));

// Nov 2 device trace: the full printed author was recognized, but was crowded
// out by a fixed cap of heuristic blurb identities before ranking.
const devouredCrowded = liveRank(['DEVOURED', 'JORDAN STEPHANIE GRAY', 'REBECCA ROSS', 'BITTEN ROMANCE',
  'LUMINOUS AND', 'EXHILARATING THAT SIZZLES', 'BESTSELLING AUTHOR',
  ...Array.from({ length: 30 }, (_, index) => `BLURB PERSON${index} NAME`)]);
assert.ok(devouredCrowded.authors.slice(0, 3).includes('jordan stephanie gray'),
  'Complete printed author names must survive capped heuristic candidate generation.');
assert.ok(devouredCrowded.titles.includes('devoured'),
  'Prioritizing printed author names must preserve the visible title.');

// A later, clean OCR title must receive a full-author request before
// damaged earlier variants spend the bounded query budget.
const noisyTitleQueries = titleAuthorPartQueries(
  ['denoured', 'deyoue', 'devoured'],
  ['jordan stephanie gray', 'jordan stephanie jra'],
  8,
);
assert.ok(noisyTitleQueries.includes('devoured jordan stephanie gray'),
  'A correctly recognized third title must not be starved by earlier OCR variants.');
assert.ok(noisyTitleQueries.indexOf('devoured jordan stephanie gray') < 8,
  'Correct title and full author must be retrieved inside the existing query cap.');

const liveReign = liveRank(['REIGN',"AB ETH A'N",'CR O ME','BETH AN','GR O ME','BETH A"N','CRO ME','E.','BET H AN','ruti:','1:','3CR OD ME']);
assert.ok(liveReign.authors.slice(0, 3).includes('bethan crome'),
  'Reign: reconstructed Bethan + surname must be inside the first three author hints.');
assert.deepEqual(liveReign.titles, ['reign'], 'Reign: fragmented given-name lines must not become title evidence.');
assert.ok(titleAuthorPartQueries(liveReign.titles, liveReign.authors).includes('reign bethan'),
  'Reign: a title + given-name query must survive a misspelled surname.');

const liveNero = liveRank(['THE ALLIANCE SERIEs','ERO','A DARK MAFVA ROMA NCE','S.J. TILLY','THE ALLIANCE S ERIES','ADARK MAFVA ROMA NCE','THE ALLIA NCE SERIES','S.J.','TILLY','THE ALLIANCESERIES','NERO','ADARK MAF VA ROMANCE','S ERIES','ADARK MAFIAI ROM ANCE','ADARK MAFIA RoMANCE']);
assert.equal(liveNero.authors[0], 's j tilly', 'Nero: initials + surname must outrank genre/series lines.');
assert.deepEqual(liveNero.titles, ['nero'], 'Nero: the printed title must not be excluded by a title-word author hint.');
assert.ok(titleAuthorPartQueries(liveNero.titles, liveNero.authors).includes('nero s j tilly'));

// Live false positive (Oct 30 2026): "Devour" by Lucia Jordan was accepted for the
// DEVOURED / JORDAN STEPHANIE GRAY cover because "Jordan" is that author's FIRST name.
const devouredCover = liveClean(['JORDAN STEPHANIE GRAY','DEVOURO','"Luminous and','exhilarating...','DEVOURED','REBECCA ROSS']);
assert.equal(coverMatchesWork(devouredCover, 'Devour', ['Lucia Jordan']), false,
  'A surname that is really another author\'s printed first name must not verify a work.');
assert.equal(coverApproximatelyMatchesWork(devouredCover, 'Devour', ['Lucia Jordan']), false);
assert.equal(coverApproximatelyMatchesWork(devouredCover, 'Devoured', ['Jordan Stephanie Gray']), true,
  'The real Devoured by Jordan Stephanie Gray must still verify.');
assert.equal(coverMatchesWork(['DEVOURED','JORDAN STEPHANIE GRAY'], 'Devour', ['Jordan Stephanie Gray']), false,
  'A catalog title that is only the start of the longer printed word is a different book.');

const liveReign2 = liveRank(['HER MAGIC S A DEATH SENT','REIGN','BET H AN','CRO ME','HER MAGIC IS A DEATH','R REIGN','BETH AN','GRO) ME','HER','BETH A N','CR O ME','BETHAN','CROME']);
assert.deepEqual(liveReign2.titles, ['reign'], 'Reign: "R REIGN" must collapse to the printed title.');
assert.equal(coverApproximatelyMatchesWork(liveReign2.lines, 'Reign', ['Bethan Croome']), true);


// Audit 2026-11: title evidence must be title-shaped. Review blurbs, series lines and
// taglines that merely CONTAIN a catalog title must not verify that sibling work.
const devouredAudit = stripCoverPromoLines([
  'NEW YORK TIMES BESTSELLING AUTHOR OF BITTEN', 'JORDAN STEPHANIE GRAY', 'DEVOURED',
  '"Luminous and', 'exhilarating....', '[Bitten is] a romance', 'that sizzles."',
  '\u2014REBECCA ROSS,', '#1 New York Times', 'bestselling author', 'of Divine Rivals',
]).map((line) => line.replace(/[^a-zA-Z\s\'-]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
assert.equal(coverMatchesWork(devouredAudit, 'Bitten', ['Jordan Stephanie Gray']), false,
  'A sibling named only inside a review blurb must not verify as the photographed book.');
assert.equal(coverMatchesWork(devouredAudit, 'Devoured', ['Jordan Stephanie Gray']), true,
  'The photographed Devoured must still verify.');
const neroAudit = ['THE ALLIANCE SERIES', 'A DARK MAFIA ROMANCE', 'S J TILLY', 'NERO'];
assert.equal(coverMatchesWork(neroAudit, 'The Alliance', ['S.J. Tilly']), false,
  'A series banner is not the photographed title.');
assert.equal(coverMatchesWork(neroAudit, 'Nero', ['S.J. Tilly']), true);
assert.equal(coverMatchesWork(['FOURTH WING', 'REBECCA YARROS', 'THE EMPYREAN SERIES'], 'The Empyrean', ['Rebecca Yarros']), false,
  'Series copy must not verify a work titled after the series.');


// Nov 7 physical-cover trace: correct catalog work was retrieved but rejected
// because COOKBOOK was read as BOOK and MATT as MAT.
const dungeonAnarchistCover = [
  'DUNGEON', 'NARCHISTS', 'BOOK', 'MAIL', 'DINNIMAN',
  'ANARCHIST\'S', 'MAT',
];
assert.equal(coverApproximatelyMatchesWork(
  dungeonAnarchistCover, "The Dungeon Anarchist's Cookbook", ['Matt Dinniman'],
), true, 'Recover a truncated third title word with two strong title anchors and printed author.');
assert.equal(coverApproximatelyMatchesWork(
  ['DUNGEON', 'NARCHISTS', 'BOOK', 'DINNIMAN'],
  "The Dungeon Anarchist's Cookbook", ['Matt Dinniman'],
), false, 'Surname without independent given-name evidence cannot authorize truncated-title recovery.');
assert.equal(coverApproximatelyMatchesWork(
  ['DUNGEON', 'NARCHISTS', 'BOOK', 'MAT', 'OTHERSON'],
  "The Dungeon Anarchist's Cookbook", ['Matt Dinniman'],
), false, 'Truncated title recovery must reject a conflicting surname.');


// Nov 7 Android trace: OCR retained SHIELD OF, SPARROWS and the complete
// DEVNEY PERRY credit, but merged passes separated the title lines.
const shieldAndroidCover = [
  'Feat th monsters', 'we tiake', 'NEW', 'BONUS', 'CONTENH',
  'INCUDEDI', 'SHIE D OF', 'SP RROWS', 'EVNEY PERRY',
  'CONTENT', 'INCUDEDY', 'SPARROWS', 'DEVNEY PERRY',
  'SHIELD OF',
];
assert.equal(coverApproximatelyMatchesWork(shieldAndroidCover,
  'Shield of Sparrows', ['Devney Perry']), true,
  'A connector-bearing title split across OCR passes must verify with the complete printed author.');
assert.equal(coverApproximatelyMatchesWork(
  ['BONUS', 'CONTENT', 'SPARROWS', 'DEVNEY PERRY'],
  'Shield of Sparrows', ['Devney Perry']), false,
  'An author and a single title word must not manufacture the photographed title.');
assert.equal(coverApproximatelyMatchesWork(
  ['SHIELD OF', 'SPARROWS', 'OTHER AUTHOR'],
  'Shield of Sparrows', ['Devney Perry']), false,
  'Title fragments without independent author evidence must not verify.');

console.log('Inkbound scanner cover regressions passed.');