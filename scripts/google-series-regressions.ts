import assert from 'node:assert/strict';
import { resolveGoogleSeriesMetadata } from '../src/features/book-search/mapping/googleSeriesMetadata';
import { catalogTextMatchesSeriesLine, inferCatalogSeriesLineCandidate } from '../src/features/series/catalogSeriesLine';

const twistedTale = resolveGoogleSeriesMetadata(
  {
    bookDisplayNumber: 'Book 7',
    volumeSeries: [{ seriesId: 'twisted-tale', orderNumber: 7 }],
  },
  { 'twisted-tale': 'A Twisted Tale' },
);
assert.equal(twistedTale.name, 'A Twisted Tale');
assert.equal(twistedTale.order, 7);

const harryPotter = resolveGoogleSeriesMetadata(
  {
    bookDisplayNumber: 'Book 4',
    volumeSeries: [{ seriesId: 'harry-potter', orderNumber: 4 }],
  },
  { 'harry-potter': 'Harry Potter' },
);
assert.equal(harryPotter.name, 'Harry Potter');
assert.equal(harryPotter.order, 4);

const displayFallback = resolveGoogleSeriesMetadata(
  {
    bookDisplayNumber: 'Book 2',
    volumeSeries: [{ seriesId: 'example-series' }],
  },
  { 'example-series': 'Example Series' },
);
assert.equal(displayFallback.name, 'Example Series');
assert.equal(displayFallback.order, 2);

const shortTitleMustNotBecomeSeries = resolveGoogleSeriesMetadata(
  {
    bookDisplayNumber: '1',
    volumeSeries: [{ seriesId: 'real-series', orderNumber: 1 }],
  },
  {},
);
assert.equal(shortTitleMustNotBecomeSeries.name, undefined);
assert.equal(shortTitleMustNotBecomeSeries.order, 1);

const twistedTaleLine = inferCatalogSeriesLineCandidate("Conceal, Don't Feel", 'A Twisted Tale');
assert.deepEqual(twistedTaleLine, { name: 'A Twisted Tale' });
assert.equal(catalogTextMatchesSeriesLine("Part of Your World: A Twisted Tale", undefined, 'A Twisted Tale'), true);

const sagaLine = inferCatalogSeriesLineCandidate('A Touch of Darkness', 'Hades & Persephone Saga Book 1');
assert.deepEqual(sagaLine, { name: 'Hades & Persephone Saga', position: 1 });

const ordinarySubtitle = inferCatalogSeriesLineCandidate('Example Book', 'A completely ordinary subtitle');
assert.deepEqual(ordinarySubtitle, { name: 'A completely ordinary subtitle' });
// Extraction alone is deliberately not verification. Production code requires
// the same candidate line to appear across multiple distinct Google works before
// it becomes canonical series metadata.

console.log('Inkbound Google series metadata regressions passed.');
