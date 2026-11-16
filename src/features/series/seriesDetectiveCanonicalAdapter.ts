import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { detectiveCandidatesAreSameWork } from './seriesDetectiveMerge';
import { comparableDetectiveTitle, canonicalDetectiveAuthor, detectiveSeriesNamesCompatible } from './seriesDetectiveEvidence';
import { replayCanonicalDetectiveEvidence } from './seriesDetectiveCanonicalReplay';
import type { DetectiveEvidenceClaim, DetectiveProviderObservation } from './seriesDetectiveEvidenceLedger';
import type { DetectiveResolvedIdentity } from './seriesDetectiveIdentityResolution';

type Provider = DetectiveMergeCandidate['provider'];

export interface DetectiveCanonicalProductionEvidence {
  readonly verified: boolean;
  readonly agreedPosition: number | null;
  readonly conflicting: boolean;
  readonly providerCount: number;
}

/**
 * Production bridge from structured catalog memberships to canonical V2.
 * This is deliberately a SECOND gate: the caller must still enforce the
 * independent owned-seed and author checks. A normalized title/author key is
 * not bibliographic proof and must never grant verification by itself.
 */
export function verifyCanonicalProductionMembership(
  sources: readonly DetectiveMergeCandidate[],
  target: DetectiveMergeCandidate,
  owned: readonly { title: string; author: string }[],
  seriesName: string,
): DetectiveCanonicalProductionEvidence {
  const workKey = (candidate: DetectiveMergeCandidate): string =>
    JSON.stringify([comparableDetectiveTitle(candidate.work.title),
      canonicalDetectiveAuthor(candidate.work.authors[0])]);
  const seriesKey = comparableDetectiveTitle(seriesName);
  const targetKey = workKey(target);
  const ownedKeys = new Set(owned.map(book => JSON.stringify([
    comparableDetectiveTitle(book.title), canonicalDetectiveAuthor(book.author),
  ])));
  const matching = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.length
    && detectiveCandidatesAreSameWork(source, target)
    && workKey(source) === targetKey);
  const seedSources = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && ownedKeys.has(workKey(source)));
  const relevant = [...new Set([...matching, ...seedSources])];
  const observations: DetectiveProviderObservation[] = [];
  const claims: DetectiveEvidenceClaim[] = [];
  const identities: DetectiveResolvedIdentity[] = [];
  for (const [index, source] of relevant.entries()) {
    const provider: Provider = source.seriesProvider ?? source.provider;
    const nativeWorkId = JSON.stringify([provider, 'work', index]);
    const nativeSeriesId = JSON.stringify([provider, 'series', index]);
    const canonicalWorkId = workKey(source);
    const prefix = provider + ':' + index;
    observations.push({ provider, operation: prefix, state: 'ok', recordCount: 1 });
    const workProof = prefix + ':work';
    const seriesProof = prefix + ':series';
    claims.push(
      { id: workProof, provider, sourceOperation: prefix, sourceRecordId: nativeWorkId,
        sourceField: 'catalog.work.title+authors', kind: 'work-identity',
        subjectId: nativeWorkId, value: canonicalWorkId, structured: true },
      { id: seriesProof, provider, sourceOperation: prefix, sourceRecordId: nativeSeriesId,
        sourceField: 'catalog.seriesName', kind: 'series-identity',
        subjectId: nativeSeriesId, value: seriesKey, structured: true },
      { id: prefix + ':membership', provider, sourceOperation: prefix,
        sourceRecordId: nativeWorkId, sourceField: 'catalog.structuredMembership',
        kind: 'series-membership', subjectId: nativeWorkId, objectId: nativeSeriesId,
        value: source.seriesName!, position: source.position, structured: true },
    );
    identities.push({ provider, nativeWorkId, nativeSeriesId, canonicalWorkId,
      canonicalSeriesId: seriesKey, identityEvidenceIds: [workProof, seriesProof] });
  }
  // A shared normalized seed key must be corroborated by two independent
  // sources. Selecting one deterministic owned key avoids combining votes
  // for different books.
  const seedKey = [...ownedKeys].find(key => new Set(seedSources
    .filter(source => workKey(source) === key)
    .map(source => source.seriesProvider ?? source.provider)).size >= 2);
  if (!seedKey) return { verified: false, agreedPosition: null, conflicting: false, providerCount: 0 };
  const replay = replayCanonicalDetectiveEvidence({
    seedCanonicalWorkId: seedKey, observations, claims, identities,
  });
  const decision = replay.decisions.find(item => item.subjectId === targetKey + '::' + seriesKey);
  const positions = matching.map(source => source.position);
  const invalid = positions.some(position => position != null
    && (!Number.isSafeInteger(position) || position <= 0));
  const valid = new Set(positions.filter((position): position is number =>
    typeof position === 'number' && Number.isSafeInteger(position) && position > 0));
  const positionedProviders = new Set(matching.filter(source => source.position != null
    && Number.isSafeInteger(source.position) && source.position > 0)
    .map(source => source.seriesProvider ?? source.provider));
  const providerCount = new Set(matching.map(source => source.seriesProvider ?? source.provider)).size;
  const conflicting = invalid || valid.size > 1 || Boolean(decision?.reasonCodes.includes('conflicting-evidence'));
  return {
    verified: decision?.status === 'verified' && !conflicting && providerCount >= 2,
    agreedPosition: !conflicting && valid.size === 1 && positionedProviders.size >= 2 ? [...valid][0] : null,
    conflicting, providerCount,
  };
}
