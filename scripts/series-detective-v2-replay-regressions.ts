import assert from 'node:assert/strict';
import { replayDetectiveEvidence } from '../src/features/series/seriesDetectiveReplay';
import { classifyDetectiveSeriesLabel } from '../src/features/series/seriesDetectiveLabelClassifier';
import type { DetectiveEvidenceClaim, DetectiveProviderObservation } from '../src/features/series/seriesDetectiveEvidenceLedger';

const observation: DetectiveProviderObservation[] = [
  { provider: 'open-library', operation: 'seed', state: 'ok', recordCount: 2 },
  { provider: 'hardcover', operation: 'seed', state: 'ok', recordCount: 2 },
];
const claim = (
  id: string, provider: DetectiveEvidenceClaim['provider'],
  subjectId: string, objectId: string, value: string,
): DetectiveEvidenceClaim => ({
  id, provider, subjectId, objectId, value, sourceRecordId: id,
  kind: 'series-membership', sourceField: 'series.memberships', structured: true,
});
const ol = claim('ol-1', 'open-library', 'work-1', 'series-1', 'Grant County');
const hc = claim('hc-1', 'hardcover', 'work-1', 'series-1', 'Grant County');
const input = { seedBookId: 'owned-seed', observations: observation, claims: [ol, hc] };
const run = replayDetectiveEvidence(input);
assert.equal(run.decisions.length, 1);
assert.equal(run.decisions[0].status, 'verified');
assert.deepEqual(run, replayDetectiveEvidence({
  ...input, observations: [...observation].reverse(), claims: [hc, ol],
}));
assert.deepEqual(input.claims, [ol, hc], 'Replay must not mutate source evidence');
assert.equal(replayDetectiveEvidence({ ...input, claims: [ol] }).decisions[0].status, 'review');
assert.equal(replayDetectiveEvidence({ ...input, claims: [
  ol, { ...ol, id: 'ol-2', sourceRecordId: 'ol-2' },
] }).decisions[0].status, 'review');
assert.equal(replayDetectiveEvidence({ ...input, claims: [
  ol, { ...hc, objectId: 'unrelated-series' },
] }).decisions[0].status, 'review');
assert.equal(replayDetectiveEvidence({ ...input, claims: [
  { ...ol, value: 'rororo 23230' }, { ...hc, value: 'rororo 23230' },
] }).decisions[0].status, 'rejected');
assert.equal(replayDetectiveEvidence({ ...input, claims: [], observations: [
  { provider: 'open-library', operation: 'seed', state: 'unavailable', recordCount: 0 },
] }).decisions.length, 0);
for (const name of ['rororo 23230', 'rororo ; 23230', 'Fischer Taschenbuch 12345', 'Heyne 43/123', 'Penguin Books Ltd']) {
  assert.equal(classifyDetectiveSeriesLabel(name), 'publisher-collection', name);
}
for (const name of ['Grant County', 'The Shining', 'A Twisted Tale', 'Hades x Persephone']) {
  assert.equal(classifyDetectiveSeriesLabel(name), 'literary-candidate', name);
}
for (let i = 0; i < 100; i++) {
  assert.deepEqual(run, replayDetectiveEvidence({
    ...input,
    claims: i % 2 ? [hc, ol] : [ol, hc],
    observations: i % 2 ? [...observation].reverse() : observation,
  }));
}
console.log('Series Detective V2 isolated replay checks passed.');
