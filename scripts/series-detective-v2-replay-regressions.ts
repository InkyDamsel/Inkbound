import assert from 'node:assert/strict';
import { validateDetectiveClaimProvenance } from '../src/features/series/seriesDetectiveProvenance';
import { resolveDetectiveMembershipIdentities } from '../src/features/series/seriesDetectiveIdentityResolution';
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

/**
 * Identity resolution is intentionally NOT yet connected to the legacy
 * verifier. These tests establish the canonicalization contract before cutover.
 */
const nativeOl = claim('ol-native', 'open-library', '/works/OL1W', 'ol:series:7', 'The Shining');
const nativeHc = claim('hc-native', 'hardcover', 'hc:work:42', 'hc:series:99', 'The Shining');
const identityMappings = [
  {
    provider: 'open-library' as const, nativeWorkId: '/works/OL1W', nativeSeriesId: 'ol:series:7',
    canonicalWorkId: 'canonical:work:1', canonicalSeriesId: 'canonical:series:1',
    identityEvidenceIds: ['identity:ol:1'],
  },
  {
    provider: 'hardcover' as const, nativeWorkId: 'hc:work:42', nativeSeriesId: 'hc:series:99',
    canonicalWorkId: 'canonical:work:1', canonicalSeriesId: 'canonical:series:1',
    identityEvidenceIds: ['identity:hc:1'],
  },
];
const resolvedNative = resolveDetectiveMembershipIdentities([nativeOl, nativeHc], identityMappings);
assert.equal(resolvedNative.memberships.length, 1);
assert.deepEqual(resolvedNative.memberships[0].claims.map(item => item.id), ['hc-native', 'ol-native']);
assert.deepEqual(resolvedNative.unresolvedClaimIds, []);
assert.deepEqual(resolveDetectiveMembershipIdentities([nativeOl, nativeHc], []).unresolvedClaimIds,
  ['hc-native', 'ol-native'], 'Matching series labels alone must not canonicalize provider identities');
assert.deepEqual(resolveDetectiveMembershipIdentities([nativeOl, nativeHc], [
  ...identityMappings,
  { ...identityMappings[1], canonicalSeriesId: 'canonical:series:other' },
]).conflictingClaimIds, ['hc-native'], 'Contradictory identity mappings must fail closed');
const multiSeries = resolveDetectiveMembershipIdentities([
  nativeOl, { ...nativeOl, id: 'ol-second', objectId: 'ol:series:8', value: 'Related Series' },
], [...identityMappings, {
  ...identityMappings[0], nativeSeriesId: 'ol:series:8',
  canonicalSeriesId: 'canonical:series:2', identityEvidenceIds: ['identity:ol:2'],
}]);
assert.equal(multiSeries.memberships.length, 2, 'Legitimate dual-series membership must not collapse');
console.log('Series Detective provider-independent identity join checks passed.');

const provenanceGood = validateDetectiveClaimProvenance(observation, [ol, hc]);
assert.deepEqual(provenanceGood.quarantinedClaimIds, []);
assert.equal(provenanceGood.admissibleClaims.length, 2);
const provenanceFailure = validateDetectiveClaimProvenance([
  { ...observation[0], state: 'failed' }, observation[1],
], [ol, hc]);
assert.deepEqual(provenanceFailure.quarantinedClaimIds, ['ol-1']);
assert.deepEqual(validateDetectiveClaimProvenance([], [ol, hc]).quarantinedClaimIds, ['hc-1', 'ol-1']);
const provenanceDuplicate = validateDetectiveClaimProvenance(observation, [
  ol, { ...ol, value: 'Conflicting Series' }, hc,
]);
assert.deepEqual(provenanceDuplicate.quarantinedClaimIds, ['ol-1']);
assert.deepEqual(provenanceDuplicate.admissibleClaims.map(item => item.id), ['hc-1'],
  'A bad duplicate must not discard valid independent evidence');
console.log('Series Detective claim provenance quarantine checks passed.');

const replayFailedProvider = replayDetectiveEvidence({
  seedBookId: 'seed', observations: [{ ...observation[0], state: 'failed' }, observation[1]],
  claims: [ol, hc],
});
assert.deepEqual(replayFailedProvider.quarantinedClaimIds, ['ol-1']);
assert.equal(replayFailedProvider.decisions[0].status, 'review',
  'Failed-provider claims must not corroborate successful claims');
const replayNoObservation = replayDetectiveEvidence({
  seedBookId: 'seed', observations: [], claims: [ol, hc],
});
assert.deepEqual(replayNoObservation.quarantinedClaimIds, ['hc-1', 'ol-1']);
assert.equal(replayNoObservation.decisions.length, 0);
const replayBadDuplicate = replayDetectiveEvidence({
  seedBookId: 'seed', observations: observation,
  claims: [ol, { ...ol, value: 'Different Series' }, hc],
});
assert.deepEqual(replayBadDuplicate.quarantinedClaimIds, ['ol-1']);
assert.equal(replayBadDuplicate.decisions[0].status, 'review');
console.log('Series Detective replay provenance integration checks passed.');

const mixedOperations: DetectiveProviderObservation[] = [
  { provider: 'open-library', operation: 'series-search', state: 'ok', recordCount: 3 },
  { provider: 'open-library', operation: 'edition-hydration', state: 'failed', recordCount: 0 },
];
assert.deepEqual(validateDetectiveClaimProvenance(mixedOperations, [
  { ...ol, sourceOperation: 'edition-hydration' },
]).quarantinedClaimIds, ['ol-1'], 'A successful search must not launder failed edition hydration');
assert.deepEqual(validateDetectiveClaimProvenance(mixedOperations, [
  { ...ol, sourceOperation: 'series-search' },
]).quarantinedClaimIds, [], 'Claims with a successful exact operation remain admissible');
assert.deepEqual(validateDetectiveClaimProvenance(mixedOperations, [ol]).quarantinedClaimIds,
  ['ol-1'], 'Missing operation provenance fails closed when provider health is mixed');
console.log('Series Detective per-operation provenance checks passed.');
