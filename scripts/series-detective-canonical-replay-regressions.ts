import assert from 'node:assert/strict';
import { replayCanonicalDetectiveEvidence } from '../src/features/series/seriesDetectiveCanonicalReplay';
import type { DetectiveEvidenceClaim, DetectiveProviderObservation } from '../src/features/series/seriesDetectiveEvidenceLedger';
import type { DetectiveResolvedIdentity } from '../src/features/series/seriesDetectiveIdentityResolution';

const observations: DetectiveProviderObservation[] = [
  { provider: 'open-library', operation: 'seed', state: 'ok', recordCount: 2 },
  { provider: 'hardcover', operation: 'seed', state: 'ok', recordCount: 2 },
];
const claim = (id: string, provider: DetectiveEvidenceClaim['provider'], subjectId: string,
  objectId: string, value: string, position?: number): DetectiveEvidenceClaim => ({
  id, provider, sourceRecordId: id, sourceField: 'series', kind: 'series-membership',
  subjectId, objectId, value, position, structured: true,
});
const olSeed = claim('ol-seed', 'open-library', 'ol:seed', 'ol:series', 'Grant County', 1);
const hcSeed = claim('hc-seed', 'hardcover', 'hc:seed', 'hc:series', 'Grant County', 1);
const olSibling = claim('ol-sibling', 'open-library', 'ol:sibling', 'ol:series', 'Grant County', 2);
const hcSibling = claim('hc-sibling', 'hardcover', 'hc:sibling', 'hc:series', 'Grant County', 2);
const olUnrelated = claim('ol-unrelated', 'open-library', 'ol:unrelated', 'ol:other', 'Other Series', 1);
const hcUnrelated = claim('hc-unrelated', 'hardcover', 'hc:unrelated', 'hc:other', 'Other Series', 1);
const identities: DetectiveResolvedIdentity[] = [
  ...(['seed', 'sibling', 'unrelated'] as const).flatMap(work => ([
    { provider: 'open-library' as const, nativeWorkId: 'ol:' + work,
      nativeSeriesId: work === 'unrelated' ? 'ol:other' : 'ol:series',
      canonicalWorkId: work, canonicalSeriesId: work === 'unrelated' ? 'other' : 'grant',
      identityEvidenceIds: ['proof:ol:' + work + ':work', 'proof:ol:' + work + ':series'] },
    { provider: 'hardcover' as const, nativeWorkId: 'hc:' + work,
      nativeSeriesId: work === 'unrelated' ? 'hc:other' : 'hc:series',
      canonicalWorkId: work, canonicalSeriesId: work === 'unrelated' ? 'other' : 'grant',
      identityEvidenceIds: ['proof:hc:' + work + ':work', 'proof:hc:' + work + ':series'] },
  ])),
];
const membershipClaims = [olSeed, hcSeed, olSibling, hcSibling, olUnrelated, hcUnrelated];
const identityClaims: DetectiveEvidenceClaim[] = identities.flatMap(mapping => [
  {
    id: mapping.identityEvidenceIds[0], provider: mapping.provider,
    sourceRecordId: mapping.nativeWorkId, sourceField: 'work.key',
    kind: 'work-identity', subjectId: mapping.nativeWorkId,
    value: mapping.canonicalWorkId, structured: true,
  },
  {
    id: mapping.identityEvidenceIds[1], provider: mapping.provider,
    sourceRecordId: mapping.nativeSeriesId, sourceField: 'series.key',
    kind: 'series-identity', subjectId: mapping.nativeSeriesId,
    value: mapping.canonicalSeriesId, structured: true,
  },
]);
const claims = [...membershipClaims, ...identityClaims];
const run = (patch: Partial<Parameters<typeof replayCanonicalDetectiveEvidence>[0]> = {}) =>
  replayCanonicalDetectiveEvidence({
    seedCanonicalWorkId: 'seed', observations, claims, identities, ...patch,
  });
const result = run();
assert.equal(result.decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'verified');
assert.equal(result.decisions.find(d => d.subjectId === 'unrelated::other')?.status, 'review');
assert.ok(result.decisions.find(d => d.subjectId === 'unrelated::other')?.reasonCodes.includes('work-identity-conflict'));
assert.equal(run({ seedCanonicalWorkId: '' }).decisions.some(d => d.status === 'verified'), false);
assert.equal(run({ identities: [] }).decisions.length, 0);
assert.deepEqual(run({ identities: [] }).unresolvedClaimIds, membershipClaims.map(c => c.id).sort());
assert.equal(run({ claims: membershipClaims }).decisions.length, 0,
  'Unaudited identity mappings cannot verify membership');
const forgedMappings = identities.map(mapping => mapping.nativeWorkId === 'ol:sibling'
  ? { ...mapping, nativeWorkId: 'ol:forged' } : mapping);
assert.equal(run({ identities: forgedMappings }).decisions.find(d =>
  d.subjectId === 'sibling::grant')?.status, 'review',
  'A proof for one native work must not authorize a different work');
const uncorroboratedSeed = run({ claims: claims.filter(c => c.id !== 'ol-seed') });
assert.equal(uncorroboratedSeed.decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'review',
  'One-provider seed membership cannot authorize verified siblings');
const positionConflict = run({ claims: claims.map(c => c.id === 'hc-sibling' ? { ...c, position: 3 } : c) });
assert.equal(positionConflict.decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'review');
const unnumbered = run({ claims: claims.map(c => c.id.includes('sibling') ? { ...c, position: null } : c) });
assert.equal(unnumbered.decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'verified');
assert.ok(unnumbered.decisions.find(d => d.subjectId === 'sibling::grant')?.reasonCodes.includes('unverified-order'));
const failed = run({ observations: [{ ...observations[0], state: 'failed' }, observations[1]] });
assert.equal(failed.decisions.some(d => d.status === 'verified'), false);
assert.deepEqual(result, run({ observations: [...observations].reverse(), claims: [...claims].reverse(), identities: [...identities].reverse() }));
const multipleSuccessfulOperations = run({
  observations: [
    ...observations,
    { provider: 'open-library', operation: 'author', state: 'ok', recordCount: 2 },
  ],
});
assert.equal(multipleSuccessfulOperations.decisions.some(d => d.status === 'verified'), false,
  'Unscoped claims must not borrow one of several successful provider operations');
const operationScopedClaims = claims.map(c => c.provider === 'open-library'
  ? { ...c, sourceOperation: 'seed' } : c);
assert.equal(run({
  claims: operationScopedClaims,
  observations: [...observations, { provider: 'open-library', operation: 'author', state: 'ok', recordCount: 2 }],
}).decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'verified',
'Explicitly scoped claims must remain admissible with multiple successful operations');
console.log('Series Detective canonical replay contract checks passed.');
