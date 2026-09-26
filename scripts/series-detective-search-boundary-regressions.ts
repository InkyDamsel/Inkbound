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
}

const sharedSearchFiles = [
  'functions/src/bookSearch.ts',
  'src/features/book-search/model/bookSearch.ts',
  'src/features/book-search/data/googleBooksApi.ts',
  'src/features/book-search/data/openLibraryApi.ts',
  'src/features/book-search/data/hardcoverApi.ts',
  'src/features/book-search/mapping/bookSearchMapper.ts',
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
