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
assert.match(
  appSource,
  /const handleAddBook = \(newBook: UserBookRecord\)/,
  'App must own the canonical single-book add mutation.',
);
assert.match(
  appSource,
  /onAddBook=\{handleAddBook\}/,
  'Search and library surfaces must route single-book adds through App.handleAddBook.',
);

const detailsSource = fs.readFileSync(
  path.join(ROOT, 'src/components/BookDetailsModalCore.tsx'),
  'utf8',
);
assert.match(
  detailsSource,
  /detectSeriesForBook/,
  'Series Recovery Book Details must retain the verified Detective reconciliation bridge.',
);

console.log('Inkbound canonical Search/Detective architecture guards passed.');


const appSeriesRecoverySource = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
assert.match(
  appSeriesRecoverySource,
  /const reconcileAddedBookSeries = async/,
  'Automatic add reconciliation must remain App-owned.',
);
assert.match(
  appSeriesRecoverySource,
  /detectSeriesForBook\(book\)/,
  'New books missing series metadata must use verified Series Detective reconciliation.',
);
assert.match(
  appSeriesRecoverySource,
  /void reconcileAddedBookSeries\(newBook\)/,
  'Single-book adds must automatically reconcile missing series metadata.',
);
assert.match(
  appSeriesRecoverySource,
  /newBooks\.forEach[\s\S]*reconcileAddedBookSeries\(book\)/,
  'Batch adds must automatically reconcile missing series metadata.',
);

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

const detectiveEngineSource = fs.readFileSync(
  path.join(ROOT, 'src/features/series/seriesDetective.ts'),
  'utf8',
);
assert.match(
  detectiveEngineSource,
  /weakBibliographicSeriesMatch && !exactAuthor/,
  'Weak bibliographic series evidence must never override an author mismatch.',
);
