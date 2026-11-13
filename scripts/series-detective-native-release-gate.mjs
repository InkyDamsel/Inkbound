import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const availability = read('src/features/series/seriesDetectiveAvailability.ts');
const runtime = read('src/platform/runtimePlatform.ts');
assert.match(availability, /!isNativeRuntime\(\)/, 'Series Detective must remain web-only.');
assert.match(runtime, /buildRuntimeTarget === 'android' \|\| buildRuntimeTarget === 'ios'/,
  'Native release bundles must fail closed, even before Capacitor initializes.');

const bookDetails = read('src/components/BookDetailsModalCore.tsx');
const seriesLibrary = read('src/components/library/SeriesLibraryPanel.tsx');
assert.match(bookDetails, /isSeriesDetectiveAvailable\(\) && <SeriesDetectiveBookLookup/,
  'Book Details must hide Detective on native.');
assert.match(seriesLibrary, /isSeriesDetectiveAvailable\(\) && <SeriesDetectivePreview/,
  'Series library must hide Detective on native.');

for (const name of ['SeriesDetectiveBookLookup', 'SeriesDetectivePreview']) {
  const component = read('src/components/library/' + name + '.tsx');
  assert.match(component, /if \(!isSeriesDetectiveAvailable\(\)\) return null;/,
    name + ' must not render even if mounted directly on native.');
}

const app = read('src/App.tsx');
const gate = app.indexOf('if (!isSeriesDetectiveAvailable()) return;');
const listeners = app.indexOf("window.addEventListener('inkbound:series-detective-connect'");
assert.ok(gate > 0 && listeners > gate,
  'Native runtime must not register Detective-specific mutation handlers.');
for (const event of ['add', 'apply', 'connect', 'save']) {
  assert.ok(app.includes("window.addEventListener('inkbound:series-detective-" + event + "'"),
    'Web Detective must retain its existing ' + event + ' action.');
}

assert.ok(seriesLibrary.includes('buildSeriesLibrary(books, overrides)'),
  'Ordinary Series library functionality must remain untouched.');
console.log('Series Detective web-only native release gate passed.');
