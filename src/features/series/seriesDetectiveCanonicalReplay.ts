import { classifyDetectiveSeriesLabel } from './seriesDetectiveLabelClassifier';
import { validateDetectiveClaimProvenance } from './seriesDetectiveProvenance';
import { resolveDetectiveMembershipIdentities, type DetectiveResolvedIdentity } from './seriesDetectiveIdentityResolution';
import type { DetectiveEvidenceClaim, DetectiveEvidenceDecision, DetectiveProviderObservation } from './seriesDetectiveEvidenceLedger';

/**
 * Strict, offline V2 verifier. The caller MUST establish a canonical seed
 * work from independent bibliographic evidence. No seed mapping = no verified
 * memberships. This does not replace the legacy production entry point yet.
 */
export interface DetectiveCanonicalReplayInput {
  readonly seedCanonicalWorkId: string;
  readonly observations: readonly DetectiveProviderObservation[];
  readonly claims: readonly DetectiveEvidenceClaim[];
  readonly identities: readonly DetectiveResolvedIdentity[];
}

export interface DetectiveCanonicalReplayResult {
  readonly decisions: readonly DetectiveEvidenceDecision[];
  readonly quarantinedClaimIds: readonly string[];
  readonly unresolvedClaimIds: readonly string[];
  readonly conflictingClaimIds: readonly string[];
}

export function replayCanonicalDetectiveEvidence(input: DetectiveCanonicalReplayInput): DetectiveCanonicalReplayResult {
  const provenance = validateDetectiveClaimProvenance(input.observations, input.claims);
  // Identity mappings supplied by an adapter are not automatically proof.
  // Each referenced identity evidence ID must exist as an admissible
  // structured identity claim from that same provider. Otherwise quarantine
  // the mapping and leave its membership unresolved.
  const admissibleIdentityClaims = new Map(provenance.admissibleClaims
    .filter(claim => claim.structured && (claim.kind === 'work-identity'
      || claim.kind === 'edition-identity' || claim.kind === 'series-identity'))
    .map(claim => [claim.id, claim]));
  const evidencedMappings = input.identities.filter(mapping => {
    if (mapping.identityEvidenceIds.length < 2) return false;
    const evidence = mapping.identityEvidenceIds.map(id => admissibleIdentityClaims.get(id));
    if (evidence.some(claim => !claim || claim.provider !== mapping.provider)) return false;
    // Proof must bind THIS native work and THIS native series to the stated
    // canonical IDs. Arbitrary valid identity records cannot authorize an
    // unrelated mapping.
    return evidence.some(claim => claim?.kind === 'work-identity'
      && claim.subjectId === mapping.nativeWorkId && claim.value === mapping.canonicalWorkId)
      && evidence.some(claim => claim?.kind === 'series-identity'
        && claim.subjectId === mapping.nativeSeriesId && claim.value === mapping.canonicalSeriesId);
  });
  const resolution = resolveDetectiveMembershipIdentities(provenance.admissibleClaims, evidencedMappings);
  const anchor = input.seedCanonicalWorkId.trim();
  // A seed is an identity anchor, not merely a book ID or a search query.
  const anchoredSeries = new Set(anchor ? resolution.memberships
    .filter(membership => membership.canonicalWorkId === anchor)
    .map(membership => membership.canonicalSeriesId) : []);
  const decisions: DetectiveEvidenceDecision[] = [];
  for (const membership of resolution.memberships) {
    const claims = membership.claims;
    const labels = new Set(claims.map(claim => claim.value.normalize('NFKC').trim().toLowerCase()));
    const positions = new Set(claims.map(claim => claim.position)
      .filter((position): position is number => typeof position === 'number' && Number.isFinite(position)));
    const conflict = labels.size > 1 || positions.size > 1;
    const excluded = claims.every(claim => classifyDetectiveSeriesLabel(claim.value) === 'publisher-collection');
    const anchored = anchoredSeries.has(membership.canonicalSeriesId);
    const structuredProviders = new Set(claims.filter(claim => claim.structured).map(claim => claim.provider));
    const verified = !conflict && !excluded && anchored && structuredProviders.size >= 2;
    const reasonCodes: DetectiveEvidenceDecision['reasonCodes'][number][] = [];
    if (excluded) reasonCodes.push('publisher-collection');
    if (conflict) reasonCodes.push('conflicting-evidence');
    if (!anchored) reasonCodes.push('work-identity-conflict');
    if (verified) reasonCodes.push('corroborated-membership');
    else if (!excluded) reasonCodes.push('unverified-membership');
    // Membership and order are independent: one provider's position is not
    // a corroborated installment number, even if membership is verified.
    const positionedProviders = new Set(claims.filter(claim =>
      typeof claim.position === 'number' && Number.isFinite(claim.position))
      .map(claim => claim.provider));
    if (positionedProviders.size < 2 && !excluded) reasonCodes.push('unverified-order');
    decisions.push({
      subjectId: membership.canonicalWorkId + '::' + membership.canonicalSeriesId,
      status: excluded ? 'rejected' : verified ? 'verified' : 'review',
      reasonCodes,
      supportingClaimIds: conflict ? [] : claims.map(claim => claim.id).sort(),
      conflictingClaimIds: conflict ? claims.map(claim => claim.id).sort() : [],
    });
  }
  return {
    decisions: decisions.sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    quarantinedClaimIds: provenance.quarantinedClaimIds,
    unresolvedClaimIds: resolution.unresolvedClaimIds,
    conflictingClaimIds: resolution.conflictingClaimIds,
  };
}
