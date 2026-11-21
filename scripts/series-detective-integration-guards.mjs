import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const normalizeLineEndings = (value) => value.replace(/\r\n/g, '\n');
const read = (path) => normalizeLineEndings(fs.readFileSync(path, 'utf8'));
const detectiveFiles = [
  'src/features/series/seriesDetective.ts',
  'src/features/series/seriesDetectiveEvidence.ts',
  'src/features/series/seriesDetectiveGoogleApi.ts',
  'src/features/series/seriesDetectiveHardcoverApi.ts',
  'src/features/series/seriesDetectiveOpenLibraryApi.ts',
  'src/features/series/seriesDetectivePenguinRandomHouseApi.ts',
  'src/features/series/seriesDetectiveMerge.ts',
  'src/features/series/seriesDetectiveToLibrary.ts',
];
for (const file of detectiveFiles) {
  assert.ok(fs.existsSync(file), `Missing Series Detective module: ${file}`);
  assert.doesNotMatch(read(file), /(?:features\/book-search|\.\.\/book-search|book-search\/)/,
    `Series Detective must not depend on protected Search internals: ${file}`);
}
// The search fork is intentionally inside Series Detective, never inside the
// protected book-search tree. It may read catalog adapters, but must not
// import library UI, user-book persistence, or mutation entrypoints.
const forkPath = 'src/features/series/seriesDetectiveSearchFork.ts';
const adapterPath = 'src/features/series/seriesDetectiveForkedLibraryCatalog.ts';
assert.ok(fs.existsSync(forkPath), 'Missing isolated Detective search fork');
assert.ok(fs.existsSync(adapterPath), 'Missing Detective-only search adapter');
assert.equal(fs.existsSync('src/features/book-search/data/seriesDetectiveSearchFork.ts'), false,
  'Detective fork must not modify the protected book-search tree');
assert.doesNotMatch(read(forkPath), /inkbound_active_tab|readRuntimeJson|waitUntilAdministrationInactive/,
  'Detective search must not depend on library navigation state');
assert.doesNotMatch(read(forkPath), /from ['"](?:\\.\\.\\/)*.*(?:AddBookModal|bookReadingState|seriesDetectiveToLibrary)/,
  'Detective search must not import library UI or mutation modules');
assert.match(read(adapterPath), /from '\\.\/seriesDetectiveSearchFork'/,
  'Detective adapter must use its isolated search fork');
assert.match(read('src/features/series/seriesDetective.ts'), /searchDetectiveForkedLibraryCatalog/,
  'Series Detective must invoke its isolated search adapter');
for (const file of [forkPath, adapterPath]) {
  assert.doesNotMatch(read(file), /(?:onAddBook|onAddMultipleBooks|addDoc\s*\(|setDoc\s*\(|updateDoc\s*\(|deleteDoc\s*\()/,
    'Detective search must not invoke library mutation paths: ' + file);
}

// Guard the direction of the dependency: regular library search must never
// depend on Detective discovery, even accidentally through a later refactor.
const regularSearch = read('src/features/book-search/data/googleBooksApi.ts');
const addBookModal = read('src/components/AddBookModal.tsx');
for (const [file, source] of [
  ['src/features/book-search/data/googleBooksApi.ts', regularSearch],
  ['src/components/AddBookModal.tsx', addBookModal],
]) {
  assert.doesNotMatch(source, /seriesDetectiveSearchFork|seriesDetectiveForkedLibraryCatalog/,
    'Protected library search must not depend on Detective search: ' + file);
}
// The fork may query catalog providers but cannot write user-owned books.
assert.doesNotMatch(read(forkPath), /from ['"]firebase\\/firestore['"]|from ['"]\\.\\.\\/\\.\\.\\/services\\/userBooks/,
  'Detective fork must not import Firestore writes or user-book services');

const index = read('functions/src/index.ts');
for (const name of ['searchSeriesDetectiveHardcover', 'searchSeriesDetectiveGoogleBooks', 'searchSeriesDetectivePenguinRandomHouse']) {
  assert.match(index, new RegExp('\\b' + name + '\\b'), `Missing Series Detective callable export: ${name}`);
}
// The Search repair at a30003a91d73be67c084efb84f98fd05cd1393d9
// was explicitly approved and integrated into the widget branch. The original
// scanner-baseline comparison mistakenly rejects these legitimate Search
// changes. Pin the approved protected objects instead of reconstructing the
// entire AddBookModal from an obsolete scanner snapshot.
//
// Tree/blob hashes work in shallow CI checkouts and on Windows. Any later
// protected Search/scanner edit must be reviewed and deliberately re-baselined.
const approvedProtectedObjects = {
  'src/components/AddBookModal.tsx': 'ed171f733a9c038a24da50c7276a6314e6af7f33',
  'src/features/book-search': '3a13d0f8240cb0f91b745752b6a1481d1ac1d47a',
  'src/platform/runtimeBarcodeScanner.ts': 'c0f26bddbffccde10bff523b2b5fdb34190a059d',
  'scripts/scanner-cover-regressions.ts': '2b81d5dc041dbd1b651124cdcf6856d24db03e63',
  'scripts/scanner-verification-regressions.ts': '20ff7601d15d57b54f78e69ed268cb8acc753b4d',
  'scripts/protected-search-contracts.ts': 'e5764cd0ba576d8b6871526c17828f175a48adc0',
};

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
} catch {
  throw new Error('Git is required to verify protected Search/scanner objects; isolation check cannot be skipped.');
}

for (const [path, expected] of Object.entries(approvedProtectedObjects)) {
  const actual = execFileSync('git', ['rev-parse', 'HEAD:' + path], { encoding: 'utf8' }).trim();
  assert.equal(actual, expected,
    'Protected Search/scanner code differs from the approved baseline: ' + path);
}
const protectedPaths = Object.keys(approvedProtectedObjects);
const dirty = execFileSync('git',
  ['status', '--porcelain', '--untracked-files=all', '--', ...protectedPaths],
  { encoding: 'utf8' }).trim();
assert.equal(dirty, '',
  'Uncommitted changes affect protected Search/scanner paths: ' + dirty);

console.log('Series Detective integration isolation guards passed.');
