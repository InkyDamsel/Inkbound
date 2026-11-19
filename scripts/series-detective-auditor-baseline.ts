import assert from 'node:assert/strict';
import { replayDetectiveEvidence } from '../src/features/series/seriesDetectiveReplay';
import { classifyDetectiveSeriesLabel } from '../src/features/series/seriesDetectiveLabelClassifier';
import type { DetectiveEvidenceClaim, DetectiveProviderObservation } from '../src/features/series/seriesDetectiveEvidenceLedger';

/**
 * Auditor reproduction baseline, NOT acceptance tests.
 *
 * These checks intentionally document CURRENT DEFECTS on the legacy V2 replay
 * model, using synthetic claims. Passing means the defects were reproduced,
 * NOT that Series Detective is correct. Do not put this in release:verify.
 * Replace with real provider-payload replay at the production entry points.
 */
const observations: DetectiveProviderObservation[] = [
  { provider: 'hardcover', operation: 'seed', state: 'ok', recordCount: 1 },
  { provider: 'google-books', operation: 'seed', state: 'ok', recordCount: 1 },
];
const claim = (
  id: string, provider: DetectiveEvidenceClaim['provider'], subjectId: string,
  objectId: string, value: string, position?: number,
): DetectiveEvidenceClaim => ({
  id, provider, sourceRecordId: id, kind: 'series-membership',
  subjectId, objectId, value, structured: true, sourceField: 'series', position,
});
const run = (claims: DetectiveEvidenceClaim[], states = observations, seedBookId = 'seed') =>
  replayDetectiveEvidence({ seedBookId, observations: states, claims });
const hc = claim('hc', 'hardcover', 'hc:work:12', 'hc:series:9', 'Grant County');
const gb = claim('gb', 'google-books', 'gb:work:abc', 'gb:series:xyz', 'Grant County');

// Real providers use different native identifiers. Current replay cannot join them.
const native = run([hc, gb]);
assert.equal(native.decisions.length, 2);
assert.ok(native.decisions.every(d => d.status === 'review'));

// Even when work IDs match, distinct provider series IDs are incorrectly conflicting.
const sameWork = run([{ ...hc, subjectId: 'canonical-work' }, { ...gb, subjectId: 'canonical-work' }]);
assert.equal(sameWork.decisions[0].status, 'review');
assert.ok(sameWork.decisions[0].reasonCodes.includes('conflicting-evidence'));

// An unrelated work can be verified without any relationship to the seed.
const unrelated = run([
  claim('h-unrelated', 'hardcover', 'unrelated', 'series-1', 'Unknown Series'),
  claim('g-unrelated', 'google-books', 'unrelated', 'series-1', 'Unknown Series'),
]);
assert.equal(unrelated.decisions[0].status, 'verified');

// A failed provider can contribute corroboration, because claims are not tied to observations.
const failed = run([
  claim('h-failed', 'hardcover', 'work', 'series', 'Unknown Series'),
  claim('g-ok', 'google-books', 'work', 'series', 'Unknown Series'),
], [{ ...observations[0], state: 'failed' }, observations[1]]);
assert.equal(failed.decisions[0].status, 'verified');

// Contradictory positions are not examined at all.
const positions = run([
  claim('h-position', 'hardcover', 'work', 'series', 'Unknown Series', 1),
  claim('g-position', 'google-books', 'work', 'series', 'Unknown Series', 3),
]);
assert.equal(positions.decisions[0].status, 'verified');

// Current label heuristic mistakes an actual numbered series for a publisher collection.
assert.equal(classifyDetectiveSeriesLabel('Goosebumps 2000'), 'publisher-collection');

console.log('Auditor reproduction baseline confirmed: 6 known defects (NOT a passing acceptance suite).');
