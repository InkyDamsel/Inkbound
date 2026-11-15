import type {
  DetectiveEvidenceClaim,
  DetectiveProviderObservation,
} from './seriesDetectiveEvidenceLedger';

/**
 * Validate source provenance before evidence can be used by a verifier.
 * A claim is admissible only when a matching successful/partial provider
 * observation exists. A failed operation cannot corroborate another provider.
 *
 * This does not assert work identity, membership or installment position.
 */
export interface DetectiveProvenanceResult {
  readonly admissibleClaims: readonly DetectiveEvidenceClaim[];
  readonly quarantinedClaimIds: readonly string[];
  readonly rejectedReasons: Readonly<Record<string, 'no-observation' | 'provider-not-successful' | 'duplicate-conflict' | 'invalid-claim'>>;
}

const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const successful = new Set(['ok', 'partial']);

export function validateDetectiveClaimProvenance(
  observations: readonly DetectiveProviderObservation[],
  claims: readonly DetectiveEvidenceClaim[],
): DetectiveProvenanceResult {
  const byProvider = new Map<string, DetectiveProviderObservation[]>();
  for (const observation of observations) {
    const list = byProvider.get(observation.provider) ?? [];
    list.push(observation);
    byProvider.set(observation.provider, list);
  }
  const grouped = new Map<string, DetectiveEvidenceClaim[]>();
  for (const claim of claims) {
    const list = grouped.get(claim.id) ?? [];
    list.push(claim);
    grouped.set(claim.id, list);
  }
  const admissibleClaims: DetectiveEvidenceClaim[] = [];
  const quarantinedClaimIds: string[] = [];
  const rejectedReasons: Record<string, 'no-observation' | 'provider-not-successful' | 'duplicate-conflict' | 'invalid-claim'> = {};
  for (const [id, duplicates] of [...grouped].sort(([a], [b]) => stableCompare(a, b))) {
    const claim = duplicates[0];
    let reason: typeof rejectedReasons[string] | undefined;
    if (!id.trim() || !claim.provider || !claim.sourceRecordId?.trim()
      || !claim.sourceField?.trim() || !claim.subjectId?.trim() || !claim.value?.trim()) {
      reason = 'invalid-claim';
    } else if (duplicates.some(other =>
      other.provider !== claim.provider || other.sourceRecordId !== claim.sourceRecordId
      || other.kind !== claim.kind || other.subjectId !== claim.subjectId
      || other.objectId !== claim.objectId || other.value !== claim.value
      || other.position !== claim.position || other.structured !== claim.structured
      || other.sourceField !== claim.sourceField)) {
      reason = 'duplicate-conflict';
    } else {
      const providerObservations = byProvider.get(claim.provider);
      if (!providerObservations?.length) reason = 'no-observation';
      else if (!providerObservations.some(item => successful.has(item.state) && item.recordCount > 0))
        reason = 'provider-not-successful';
    }
    if (reason) {
      quarantinedClaimIds.push(id);
      rejectedReasons[id] = reason;
    } else {
      admissibleClaims.push(claim);
    }
  }
  return { admissibleClaims, quarantinedClaimIds, rejectedReasons };
}
