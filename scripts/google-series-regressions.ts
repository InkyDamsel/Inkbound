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
assert.equal(twistedTale.authorityId, 'google-books:twisted-tale');

const harryPotter = resolveGoogleSeriesMetadata(
  {
    bookDisplayNumber: 'Book 4',
    volumeSeries: [{ seriesId: 'harry-potter', orderNumber: 4 }],
  },
  { 'harry-potter': 'Harry Potter' },
);
assert.equal(harryPotter.name, 'Harry Potter');
assert.equal(harryPotter.order, 4);
assert.equal(harryPotter.authorityId, 'google-books:harry-potter');

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

const bibliographicTwistedTale = resolveGoogleSeriesMetadata(
  undefined,
  {},
  { name: 'A Twisted Tale' },
);
assert.equal(bibliographicTwistedTale.name, 'A Twisted Tale');
assert.equal(bibliographicTwistedTale.order, undefined);

const bibliographicSaga = resolveGoogleSeriesMetadata(
  undefined,
  {},
  { name: 'Hades x Persephone', position: 1 },
);
assert.equal(bibliographicSaga.name, 'Hades x Persephone');
assert.equal(bibliographicSaga.order, 1);

const structuredWinsOverBibliographicFallback = resolveGoogleSeriesMetadata(
  {
    volumeSeries: [{ seriesId: 'harry-potter', orderNumber: 2 }],
  },
  { 'harry-potter': 'Harry Potter' },
  { name: 'Wrong Subtitle Series', position: 99 },
);
assert.equal(structuredWinsOverBibliographicFallback.name, 'Harry Potter');
assert.equal(structuredWinsOverBibliographicFallback.order, 2);

console.log('Inkbound Google series metadata regressions passed.');
