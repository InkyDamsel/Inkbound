import assert from 'node:assert/strict';
import { resolveGoogleSeriesMetadata } from '../src/features/book-search/mapping/googleSeriesMetadata';

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

console.log('Inkbound Google series metadata regressions passed.');
