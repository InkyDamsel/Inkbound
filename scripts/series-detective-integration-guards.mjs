import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');
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
  const changed = execFileSync('git', ['diff', '--name-only', base + '...HEAD'], { encoding: 'utf8' }).trim().split('\\n');
  const touched = changed.filter((name) => protectedPaths.some((path) => name === path || (path.endsWith('/') && name.startsWith(path))));
  assert.deepEqual(touched, [], `Protected Search/scanner paths changed: ${touched.join(', ')}`);
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') throw error;
  console.warn('Baseline comparison unavailable; module isolation checks still ran.');
}
console.log('Series Detective integration isolation guards passed.');
