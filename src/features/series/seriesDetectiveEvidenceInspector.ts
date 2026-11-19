import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { corroborateDetectiveMembership, hasCorroboratedOwnedSeed } from './seriesDetectiveCorroboration';
import { verifyCanonicalProductionMembership } from './seriesDetectiveCanonicalAdapter';
import { decideDetectiveMembership } from './seriesDetectiveDecision';
import { detectiveCandidatesAreSameWork } from './seriesDetectiveMerge';
import { detectiveSeriesNamesCompatible } from './seriesDetectiveEvidence';

export interface DetectiveEvidenceInspection {
  verification: 'verified' | 'review';
  position: number | null;
  conflictingOrder: boolean;
  ownedSeedCorroborated: boolean;
  candidateProviders: string[];
  providerClaims: Array<{
    provider: string;
    nativeSeriesId: string | null;
    origin: string;
    position: number | null;
    structured: boolean;
  }>;
  reasons: string[];
}

/** Read-only explanation built from the same decision used in production. */
export function inspectDetectiveEvidence(
  sources: readonly DetectiveMergeCandidate[],
  candidate: DetectiveMergeCandidate,
  owned: readonly { title: string; author: string }[],
  seriesName: string,
): DetectiveEvidenceInspection {
  const decision = decideDetectiveMembership(sources, candidate, owned, seriesName);
  const corroboration = corroborateDetectiveMembership(sources, candidate, seriesName);
  const canonical = verifyCanonicalProductionMembership(sources, candidate, owned, seriesName);
  const seed = hasCorroboratedOwnedSeed(sources, owned, seriesName);
  const claims = sources.filter(source =>
    source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && detectiveCandidatesAreSameWork(source, candidate))
    .map(source => ({
      provider: source.seriesProvider ?? source.provider,
      nativeSeriesId: source.nativeSeriesId ?? null,
      origin: source.evidenceOrigin ?? (source.seriesStructured ? 'structured-catalog' : 'catalog-context'),
      position: source.position,
      structured: source.seriesStructured === true,
    }));
  const reasons: string[] = [];
  if (!seed) reasons.push('Owned seed lacks independent structured corroboration');
  if (corroboration.providers < 2) reasons.push('Candidate lacks two structured catalog providers');
  if (!canonical.verified) reasons.push('Canonical work and edition corroboration incomplete');
  if (decision.conflictingOrder) reasons.push('Conflicting series order; bulk addition blocked');
  if (!candidate.seriesStructured) reasons.push('No structured membership on selected candidate');
  if (!reasons.length) reasons.push('Corroborated membership and order meet the current production requirements');
  return {
    ...decision, ownedSeedCorroborated: seed,
    candidateProviders: [...new Set(claims.map(claim => claim.provider))],
    providerClaims: claims, reasons,
  };
}
