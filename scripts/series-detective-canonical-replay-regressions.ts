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
      identityEvidenceIds: ['proof:ol:' + work] },
    { provider: 'hardcover' as const, nativeWorkId: 'hc:' + work,
      nativeSeriesId: work === 'unrelated' ? 'hc:other' : 'hc:series',
      canonicalWorkId: work, canonicalSeriesId: work === 'unrelated' ? 'other' : 'grant',
      identityEvidenceIds: ['proof:hc:' + work] },
  ])),
];
const claims = [olSeed, hcSeed, olSibling, hcSibling, olUnrelated, hcUnrelated];
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
assert.deepEqual(run({ identities: [] }).unresolvedClaimIds, claims.map(c => c.id).sort());
const positionConflict = run({ claims: claims.map(c => c.id === 'hc-sibling' ? { ...c, position: 3 } : c) });
assert.equal(positionConflict.decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'review');
const unnumbered = run({ claims: claims.map(c => c.id.includes('sibling') ? { ...c, position: null } : c) });
assert.equal(unnumbered.decisions.find(d => d.subjectId === 'sibling::grant')?.status, 'verified');
assert.ok(unnumbered.decisions.find(d => d.subjectId === 'sibling::grant')?.reasonCodes.includes('unverified-order'));
const failed = run({ observations: [{ ...observations[0], state: 'failed' }, observations[1]] });
assert.equal(failed.decisions.some(d => d.status === 'verified'), false);
assert.deepEqual(result, run({ observations: [...observations].reverse(), claims: [...claims].reverse(), identities: [...identities].reverse() }));
console.log('Series Detective canonical replay contract checks passed.');
