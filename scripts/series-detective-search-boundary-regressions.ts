import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const detectiveFiles = [
  'src/features/series/seriesDetective.ts',
  'src/features/series/seriesDetectiveEvidence.ts',
  'src/features/series/seriesDetectiveGoogleApi.ts',
  'src/features/series/seriesDetectiveHardcoverApi.ts',
  'src/features/series/seriesDetectiveMerge.ts',
  'src/features/series/seriesDetectiveOpenLibraryApi.ts',
  'src/features/series/seriesDetectiveCatalogTypes.ts',
  'src/features/series/seriesDetectiveToLibrary.ts',
  'src/components/library/SeriesLibraryPanel.tsx',
];

for (const relative of detectiveFiles) {
  const content = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.equal(
    /features\/book-search|\.\.\/book-search|book-search\//.test(content),
    false,
    `Series Detective boundary violation: ${relative} imports from protected book-search code.`,
  );
  assert.equal(
    /searchHardcoverBooks/.test(content),
    false,
    `Series Detective boundary violation: ${relative} calls the shared Search Hardcover gateway.`,
  );
  if (relative.includes('SeriesLibraryPanel')) {
    assert.equal(
      /appendCanonicalBook/.test(content),
      false,
      'Series Detective boundary violation: SeriesLibraryPanel must use the App-owned add path.',
    );
  }
}

const sharedSearchFiles = [
  'functions/src/bookSearch.ts',
  'src/features/book-search/model/bookSearch.ts',
  'src/features/book-search/data/googleBooksApi.ts',
  'src/features/book-search/data/openLibraryApi.ts',
  'src/features/book-search/data/hardcoverApi.ts',
  'src/features/book-search/mapping/bookSearchMapper.ts',
  'src/features/book-search/catalogHardening.ts',
];

for (const relative of sharedSearchFiles) {
  const content = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.equal(
    /seriesDetective|SeriesDetective/.test(content),
    false,
    `Protected Search file contains Series Detective logic: ${relative}`,
  );
}

console.log('Inkbound Series Detective/Search boundary regressions passed.');


const searchMapper = fs.readFileSync(
  path.join(ROOT, 'src/features/book-search/mapping/bookSearchMapper.ts'),
  'utf8',
);
assert.match(
  searchMapper,
  /hardenCatalogGroups/,
  'Canonical Search mapper must harden the work before persistence.',
);
assert.match(
  searchMapper,
  /enrichSelectedCatalogEdition/,
  'Canonical Search mapper must enrich the selected edition before persistence.',
);
assert.match(
  searchMapper,
  /seriesName/,
  'Canonical Search mapper must persist seriesName.',
);
assert.match(
  searchMapper,
  /seriesOrder/,
  'Canonical Search mapper must persist seriesOrder.',
);

const detectiveMapper = fs.readFileSync(
  path.join(ROOT, 'src/features/series/seriesDetectiveToLibrary.ts'),
  'utf8',
);
assert.match(
  detectiveMapper,
  /seriesName/,
  'Series Detective candidate mapper must persist seriesName.',
);
assert.match(
  detectiveMapper,
  /seriesOrder/,
  'Series Detective candidate mapper must persist seriesOrder.',
);

const appSource = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
assert.match(appSource, /const addDetectiveBooks = \(event: Event\) =>/,
  'Detective bulk writes must remain App-owned.');
assert.match(appSource, /isIssuedVerifiedDetectiveCandidate\(candidate\)/,
  'App must require a Detective-issued verified candidate at the mutation boundary.');
// Unverified title leads may start read-only discovery, but must not
// bypass the App-owned verified-candidate mutation gate.
const lookupSource = fs.readFileSync(
  path.join(ROOT, 'src/components/library/SeriesDetectiveBookLookup.tsx'),
  'utf8',
);
assert.match(lookupSource, /inferDetectiveSeriesLeadFromTitle\(currentBook\.work\.title\)/,
  'Detective lookup must retain its explicit unverified-title discovery path.');
assert.match(lookupSource, /const seriesToInvestigate = saved \?\? found \?\? lead/,
  'Unverified leads must be considered only after saved and verified series.');
assert.doesNotMatch(lookupSource, /(?:onAddBook|onAddMultipleBooks|commitCanonicalBooks|addDoc\s*\(|setDoc\s*\()/,
  'Read-only Detective lookup must not gain a direct library mutation path.');
// PRH author discovery must use the backend bibliography endpoint, not a
// generic title search for the author's name.
const prhClientSource = fs.readFileSync(
  path.join(ROOT, 'src/features/series/seriesDetectivePenguinRandomHouseApi.ts'),
  'utf8',
);
assert.match(prhClientSource, /authorBibliography: options\.authorBibliography === true/,
  'PRH client must forward the explicit bibliography option.');
const detectiveEngineSource = fs.readFileSync(
  path.join(ROOT, 'src/features/series/seriesDetective.ts'),
  'utf8',
);
assert.match(detectiveEngineSource, /searchSeriesDetectivePenguinRandomHouse\(author, false, \{ authorBibliography: true \}\)/,
  'PRH series discovery must use the author bibliography endpoint.');
assert.match(detectiveEngineSource, /searchSeriesDetectivePenguinRandomHouse\(book\.work\.author, false, \{ authorBibliography: true \}\)/,
  'PRH seed detection must use the author bibliography endpoint.');
assert.match(detectiveEngineSource, /candidate\.verification === 'verified' && issuedVerifiedCandidates\.has\(candidate\)/,
  'Detective-issued candidate authorization must require verified status and issued identity.');
assert.match(appSource, /findLibraryBookForCandidate\(candidate, \[\.\.\.current, \.\.\.pendingWorks\]\)/,
  'Detective bulk writes must deduplicate against existing and pending works.');
assert.match(appSource, /commitCanonicalBooks\(next\)/,
  'Detective writes must use the canonical library commit path.');
assert.match(appSource, /isSeriesDetectiveAvailable\(\)/,
  'Detective event handlers must remain web-gated.');
console.log('Inkbound canonical Detective mutation boundary guards passed.');

const detectiveCatalogServer = fs.readFileSync(
  path.join(ROOT, 'functions/src/seriesDetectiveCatalog.ts'),
  'utf8',
);
assert.match(
  detectiveCatalogServer,
  /explicit\?: boolean/,
  'Detective bibliographic evidence must carry an explicit/weak confidence marker.',
);
assert.match(
  detectiveCatalogServer,
  /return \{ name: line, explicit: false \}/,
  'Detective must preserve plain bibliographic series labels as weak evidence.',
);


assert.match(
  detectiveEngineSource,
  /weakBibliographicSeriesMatch && !exactAuthor/,
  'Weak bibliographic series evidence must never override an author mismatch.',
);
