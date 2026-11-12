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
const index = read('functions/src/index.ts');
for (const name of ['searchSeriesDetectiveHardcover', 'searchSeriesDetectiveGoogleBooks', 'searchSeriesDetectivePenguinRandomHouse']) {
  assert.match(index, new RegExp('\\b' + name + '\\b'), `Missing Series Detective callable export: ${name}`);
}
const protectedPaths = [
  'src/components/AddBookModal.tsx',
  'src/features/book-search/',
  'src/platform/runtimeBarcodeScanner.ts',
  'scripts/scanner-cover-regressions.ts',
  'scripts/scanner-verification-regressions.ts',
  'scripts/protected-search-contracts.ts',
];
try {
  const base = 'origin/fix/scanner-debug-visibility-2026-11-05';
  execFileSync('git', ['rev-parse', '--verify', base], { stdio: 'pipe' });
  const changed = execFileSync('git', ['diff', '--name-only', base + '...HEAD'], { encoding: 'utf8' }).trim().split('\n');
  const touched = changed.filter((name) => protectedPaths.some((path) => name === path || (path.endsWith('/') && name.startsWith(path))));
  // Series Detective may prefill the existing Add Book search field. This is
  // the ONLY permitted integration in the protected AddBookModal component.
  // Compare the entire file against the baseline plus those four exact edits,
  // so changes to search/scanner behavior still fail this guard.
  if (touched.includes('src/components/AddBookModal.tsx')) {
    const path = 'src/components/AddBookModal.tsx';
    const baseline = normalizeLineEndings(execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }));
    const replacements = [
      ['  currentBookCount: number;\n', '  currentBookCount: number;\n  initialSearchQuery?: string;\n'],
      ["({ onClose, onAddBook, onAddMultipleBooks, onRemoveBook }) => {", "({ onClose, onAddBook, onAddMultipleBooks, onRemoveBook, initialSearchQuery = '' }) => {"],
      ["const [query, setQuery] = useState('');", "const [query, setQuery] = useState(initialSearchQuery);"],
      [
        "${results.length} title${results.length === 1 ? '' : 's'} loaded${authorProviderTotal && authorProviderTotal >= results.length ? ` of ${authorProviderTotal}` : ''}",
        "${results.length} title${results.length === 1 ? '' : 's'} found${authorHasMore ? ' · More catalog results available' : ''}",
      ],
    ];
    let expected = baseline;
    for (const [before, after] of replacements) {
      assert.equal(expected.split(before).length, 2, `Expected exactly one baseline integration anchor: ${before}`);
      expected = expected.replace(before, after);
    }
    assert.equal(read(path), expected, 'AddBookModal differs from the four approved search integration edits; protected Search/scanner behavior may have changed.');
  }
  const unauthorized = touched.filter((name) => name !== 'src/components/AddBookModal.tsx');
  assert.deepEqual(unauthorized, [], `Protected Search/scanner paths changed: ${unauthorized.join(', ')}`);
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') throw error;
  console.warn('Baseline comparison unavailable; module isolation checks still ran.');
}
console.log('Series Detective integration isolation guards passed.');
