import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverAuthorQueries, coverTitleEvidenceHints, rankAuthorHints, titleAuthorPartQueries, damagedTitleFragments, splitTitleRunQueries, isDemotedCoverTitleLine, isUsableScannerCoverQuery, prioritizeCoverTitleLines, shortTitleQueries, stripCoverEndorsementLines, stripCoverPromoLines, titleSurnameRecoveryQueries } from '../src/features/book-search/coverTextAnalysis';
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
assert.equal(coverMatchesWork(['BLACK', 'UNRELATED TAGLINE', 'THORN', 'J.T.', 'GEISSINGER'],
  'Blackthorn', ['J.T. Geissinger']), false,
  'A split single-word title requires adjacent OCR fragments, not words across unrelated lines.');
assert.equal(coverMatchesWork(['BLACK', 'THORN', 'J.T.', 'GEISSINGER'],
  'Blackthorn', ['Someone Else']), false,
  'Recovering a split title must not weaken independent author verification.');

const devouredQuotedCover = [
  'JORDAN STEPHANIE GRAY', 'DEVOURED', '"Luminous and',
  'exhilarating...', '[Bitten is] a romance', 'that sizzles."',
  '-REBECCA ROSS,', 'New York Times bestselling author', 'of Divine Rivals',
  'DEVOURED',
];
const devouredFiltered = stripCoverEndorsementLines(devouredQuotedCover);
assert.ok(devouredFiltered.includes('JORDAN STEPHANIE GRAY') && devouredFiltered.includes('DEVOURED'),
  'Quarantining review copy must preserve independent title and author OCR lines.');
assert.ok(!devouredFiltered.some((line) => /luminous|exhilarating|sizzles|rebecca|divine rivals|bitten is/i.test(line)),
  'Review quote, credited reviewer, and sibling titles cannot feed scanner retrieval.');
assert.equal(coverMatchesWork(devouredFiltered, 'Devoured', ['Jordan Stephanie Gray']), true,
  'After removing endorsements, the correct photographed work must still verify.');
assert.equal(coverMatchesWork(devouredFiltered, 'Divine Rivals', ['Rebecca Ross']), false,
  'An endorsement cannot verify the review author\'s separate book.');
const damagedReviewerCover = [
  'JORDAN STEPHANIE GRAY', 'DEVOURED', '"Luminous and',
  'that sizzles."', 'EEECCA OSS', 'bestselling author of Divine Rivals',
];
const damagedReviewerFiltered = stripCoverEndorsementLines(damagedReviewerCover);
assert.ok(damagedReviewerFiltered.includes('JORDAN STEPHANIE GRAY')
  && damagedReviewerFiltered.includes('DEVOURED'),
  'An OCR-damaged endorsement must not erase a printed full author or main title.');
assert.ok(!damagedReviewerFiltered.some((line) => /EEECCA|sizzles|divine rivals/i.test(line)),
  'An OCR-damaged review byline cannot become a competing author identity.');

// Nov 3, 21:47 field test: OCR entirely missed the jacket QUOTE on one
// pass but still read reviewer credits. This must not poison identities.
const devouredNoQuote = [
  'JORDAN STEPHANIE GRAY',
  'REBECCA ROSS,', '1 New York TimHS', 'bestselling author', 'of Divine Rvas',
  'DEVOVE)', 'DEVOURED', 'bestseling author', '{Bten romance',
  'RESECCA ROSS,', '1Nw York Tim', 'bostselling suthor', 'of Divin Rivas',
  'DEYOUED', 'btsiling suthor',
];
const devouredWithoutReviewers = stripCoverPromoLines(stripCoverEndorsementLines(devouredNoQuote));
assert.ok(devouredWithoutReviewers.includes('JORDAN STEPHANIE GRAY')
  && devouredWithoutReviewers.includes('DEVOURED'),
  'Actual printed author and title must survive endorsement quarantine even without quotation marks.');
assert.ok(!devouredWithoutReviewers.some((line) => /REBECCA|RESECCA|YORK|DIVIN|suthor|bestsel/i.test(line)),
  'Review attributions and their credentials must not become catalog identities when quote OCR is missing.');
assert.equal(coverMatchesWork(devouredWithoutReviewers, 'Devoured', ['Jordan Stephanie Gray']), true);
assert.equal(coverMatchesWork(devouredWithoutReviewers, 'Devoured', ['Emily Snow']), false);
assert.deepEqual(stripCoverEndorsementLines(['JORDAN STEPHANIE GRAY', 'DEVOURED']),
  ['JORDAN STEPHANIE GRAY', 'DEVOURED'],
  'Clean titles and author names must remain untouched.');

// Nov 4 field scan: the main author survived, while an OCR-damaged review
// credit "RERECCA ROS" and "REBECCA RGSS" polluted author hints. The
// cover's actual title is partially read as DEVOURE.
const partialDevouredCover = [
  'JORDAN STEPHANIE GRAY', 'Luminous', 'and', 'exnlaratihg',
  'Biten is a romance', 'thhat sizzer', 'DEVOURE)',
  'RERECCA ROS5', 'bsteing atho', 'vine vals',
  'REBECCA RGSS', 'bsteing ho', 'DEVORE)',
];
const partialDevouredFiltered = stripCoverEndorsementLines(partialDevouredCover);
assert.ok(partialDevouredFiltered.includes('JORDAN STEPHANIE GRAY'),
  'A complete photographed main author must survive OCR endorsement filtering.');
assert.ok(partialDevouredFiltered.includes('DEVOURE)'),
  'A partially read primary title must remain available for approximate matching.');
assert.ok(!partialDevouredFiltered.includes('RERECCA ROS5')
  && !partialDevouredFiltered.includes('REBECCA RGSS'),
  'Damaged reviewer bylines followed by publishing credentials must not become catalog authors.');

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
// The diagnostic surface must appear only alongside a failed scan, not
// above the camera. Android sync uses this same compiled component.
const scannerUiSource = readFileSync('src/components/AddBookModal.tsx', 'utf8');
assert.ok(scannerUiSource.includes('stripCoverPromoLines(stripCoverEndorsementLines(rawLines))'),
  'Cover scanner must strip endorsement OCR before building title and author queries.');
assert.equal((scannerUiSource.match(/aria-label="Scanner test diagnostics"/g) ?? []).length, 0,
  'Do not reintroduce a second diagnostics panel above the camera.');
assert.equal((scannerUiSource.match(/>Scanner details<\/summary>/g) ?? []).length, 1,
  'Keep exactly one Scanner details expander in the error section.');
assert.ok(scannerUiSource.includes('early-exact-title:'),
  'Try exact title evidence before exhausting the broad query budget.');

// Scanner exact-title recovery must not depend on Google alone. This
// structural regression keeps the independent catalog lanes and one-scan
// memoization from being accidentally removed in future scanner refactors.
const scannerCatalogSource = readFileSync('src/features/book-search/data/googleBooksApi.ts', 'utf8');
const exactTitleSource = scannerCatalogSource.split('export async function searchScannerCoverTitleCatalog(')[1]
  ?.split('export async function searchScannerAuthorCatalog(')[0] ?? '';
assert.ok(exactTitleSource.includes('searchOpenLibrary(`intitle:"${escaped}"`, signal)'),
  'Exact-title recovery must query Open Library by title, never as a fallback author.');
assert.ok(!exactTitleSource.includes('searchOpenLibraryWithAuthorFallback(trimmed, signal)'),
  'A missing title must not trigger an unrelated Open Library author search.');
assert.ok(exactTitleSource.includes('searchHardcoverWithBackoff(trimmed)'),
  'Exact-title recovery must query Hardcover independently.');
assert.ok(exactTitleSource.includes('searchPrhWithBackoff(trimmed)'),
  'Exact-title recovery must query Penguin Random House independently.');
assert.ok(exactTitleSource.includes('searchTrustedCatalogBaseline(trimmed)'),
  'Exact-title recovery must query the trusted catalog independently.');
assert.ok(exactTitleSource.includes('workTitle === titleKey || workTitle.startsWith'),
  'Exact-title recovery must reject unrelated catalog titles before OCR author verification.');
assert.ok(scannerUiSource.includes('searchExactTitleOnce(titleHint)'),
  'Repeated exact-title lanes must reuse one catalog request per scan.');
assert.ok(scannerUiSource.includes('Exact-title providers:'),
  'Failed scans must show per-provider exact-title counts in the existing diagnostic surface.');
assert.ok(exactTitleSource.includes('onTrace({'),
  'Exact-title catalog recovery must report pre/post exact-title filtering counts.');

// Actual Walmart OCR fragments: retain meaningful REIGN and author evidence
// but never query CROME CROME or glue unrelated stray letters into a title.
for (const rejected of [
  'CROME CROME', 'lij l bethan crome crome', 'CR OME', 'GR O ME',
  'lij l bethan crome', 'REIGN CROME CROME', '||',
]) {
  assert.equal(isUsableScannerCoverQuery(rejected), false,
    `Corrupt cover OCR must not generate a federated query: ${rejected}`);
}
for (const retained of [
  'REIGN', 'REIGN BETHAN CROME', 'DEVOURED JORDAN STEPHANIE GRAY',
  'NEVER LIE FREIDA MCFADDEN', 'IT STEPHEN KING', 'THE CIRCLE OF STONE',
]) {
  assert.equal(isUsableScannerCoverQuery(retained), true,
    `Legitimate scanner retrieval query was dropped: ${retained}`);
}

assert.equal(isUsableScannerCoverQuery('BLACKTHORN J.T. GEISSINGER'), true,
  'Initialed authors with printed periods must survive the OCR query filter.');
assert.equal(isUsableScannerCoverQuery('A J LAKE'), false,
  'Single-letter OCR fragments should be paired with a real title before querying.');

// Search can retrieve Devoured/Jordan Stephanie Gray, Nero/S. J. Tilly
// and Reign/Bethan Croome by author. Scanner must reuse the SAME Search
// author-page retrieval early, before the noisy title recovery spends budget.
const earlyGeneralSearch = scannerUiSource.indexOf('search-author-general:');
const earlySearchReuse = scannerUiSource.indexOf('search-author-page:');
const earlyTitleOnly = scannerUiSource.indexOf('early-exact-title:');
assert.ok(earlyGeneralSearch >= 0 && earlySearchReuse > earlyGeneralSearch && earlyTitleOnly > earlySearchReuse,
  'Scanner must reuse Search general author query, then the paginated author results, before title-only fallback.');
assert.ok(scannerUiSource.includes('await searchPriorityCatalogOnce(printedAuthor)')
  && scannerUiSource.includes('await authorPageOnce(printedAuthor, 0)'),
  'Scanner must use both normal Search retrieval paths with the shared lookup budget.');
assert.ok(scannerUiSource.includes('search-author-page:')
  && scannerUiSource.includes('coverMatchesWork(cleanLines, work.title, work.authors)'),
  'Author results must still pass independent photographed cover verification.');

// The scanned Devoured cover had correct title + author, but broad Open
// Library title search returned only other authors. Fielded retrieval must
// run before the noisy general lanes, and result acceptance stays gated.
const openLibrarySource = readFileSync('src/features/book-search/data/openLibraryApi.ts', 'utf8');
const fieldedOpenLibrarySource = openLibrarySource.split('export async function searchOpenLibraryTitleAuthor(')[1]
  ?.split('export async function searchOpenLibraryAuthorBibliography(')[0] ?? '';
assert.ok(fieldedOpenLibrarySource.includes('title: cleanTitle')
  && fieldedOpenLibrarySource.includes('author: cleanAuthor'),
  'Open Library must use independent title and author search fields.');
assert.ok(scannerCatalogSource.includes('export async function searchScannerCoverTitleAuthorCatalog(')
  && scannerCatalogSource.includes('searchOpenLibraryTitleAuthor(title, author, signal)'),
  'Scanner must filter fielded results to the photographed primary title.');
assert.ok(scannerUiSource.includes('fielded-open-library:')
  && scannerUiSource.includes('searchOpenLibraryTitleAuthorOnce('),
  'Scanner must try fielded title+author retrieval before exhausting broad searches.');

// Walmart Devoured: the actual full author is printed cleanly; the
// quoted Rebecca Ross endorsement must not outrank that author or consume
// multiple high-priority provider calls.
assert.ok(scannerUiSource.includes('const primaryPrintedAuthorHints = cleanLines.filter('),
  'Scanner must prioritize an independently printed full author credit.');
assert.ok(scannerUiSource.includes("!/^[-–—]/.test(line)"),
  'Review-attribution bylines must not become first-priority author candidates.');
assert.ok(scannerUiSource.includes('titleAuthorPartQueries(rankedTitleEvidence.slice(0, 1), authorRecoveryQueries.slice(0, 1), 3)'),
  'Initial federated retrieval must not fan out across multiple endorsements and OCR title variants.');
assert.ok(scannerUiSource.includes('Printed author candidates:'),
  'Failed scan report should show which full author line got priority.');

// A single photographed cover must not fire 60+ federated calls, including
// its direct Google and paginated author lanes. The budget is shared and
// rejects repeated damaged OCR tokens before issuing a network request.
assert.ok(scannerUiSource.includes('const MAX_COVER_LOOKUPS = 22;'),
  'Scanner cover lookups must have a bounded cross-lane request budget.');
assert.ok(scannerUiSource.includes('isUsableScannerCoverQuery(query)'),
  'Each catalog query must pass the pure OCR evidence gate.');
assert.ok(scannerUiSource.includes('const MAX_GENERAL_LOOKUPS = 14;')
  && scannerUiSource.includes('generalLookupsUsed >= MAX_GENERAL_LOOKUPS'),
  'Low-confidence generic queries must not spend the author/exact-title reserve.');
assert.ok(scannerUiSource.includes('await directCatalogOnce(query)'),
  'Direct Google recovery must use the shared request budget.');
assert.ok(scannerUiSource.includes('await authorPageOnce(authorQuery, startIndex)'),
  'Paginated Google author recovery must use the shared request budget.');
assert.ok(scannerUiSource.includes('Cover request budget:'),
  'Failed scan diagnostics must report consumed, rejected and skipped requests.');

// Regular Android testing preserves Scanner details in the same app. Native
// App Check follows APK signing: Android Studio debug -> Firebase debug token,
// signed store release -> Play Integrity, regardless of Vite UI mode.
const androidRuntimeSource = readFileSync('src/platform/initializeAndroidRuntime.ts', 'utf8');
const androidPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
assert.ok(androidPackage.scripts['android:sync'].includes('--scanner-inspection')
  && !androidPackage.scripts['android:sync'].includes('--scanner-debug'),
  'Regular android:sync must keep scanner details without requiring a separate web debug mode.');
assert.ok(androidPackage.scripts['build:scanner-inspection'].includes('--mode scanner-inspection'),
  'Scanner inspection must have an explicit production Vite build mode.');
assert.ok(androidPackage.scripts['android:release:sync'].includes('build:android')
  && !androidPackage.scripts['android:release:sync'].includes('scanner-inspection'),
  'The Google Play store release must remain a clean production build.');
assert.ok(scannerUiSource.includes("import.meta.env.MODE === 'scanner-inspection'"),
  'Scanner details must be available in regular Android inspection builds.');
assert.ok(androidRuntimeSource.includes('...(nativeDebugBuild ? { debugToken: true } : {})')
  && !androidRuntimeSource.includes('scannerDiagnosticsBuild && nativeDebugBuild'),
  'Firebase App Check must select debug attestation by native APK type, not scanner UI mode.');
assert.ok(scannerCatalogSource.includes('classifyGoogleScannerFailure'),
  'Scanner must distinguish provider access, quota and rate-limit errors.');

// Search's author pagination must recover from an unavailable protected
// Firebase endpoint exactly as its general Google Books catalog path does.
// The public fallback does not bypass Firebase App Check enforcement.
assert.ok(scannerCatalogSource.includes("Protected author-page catalog lookup unavailable; retrying public Google Books."),
  'Author pagination must have the same public fallback as general Search.');
assert.ok(scannerCatalogSource.includes('payload = await requestDirectGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE)'),
  'An author-page Firebase failure must retry the public Google Books endpoint.');

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

console.log('Inkbound scanner cover regressions passed.');