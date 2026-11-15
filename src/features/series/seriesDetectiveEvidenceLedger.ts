/**
 * Series Detective V2 evidence contract.
 *
 * Provider observations are immutable claims, never canonical library records.
 * No provider response, missing response, or inferred match may mutate a
 * UserBookRecord. This module has no Firebase or network dependencies.
 */
export type DetectiveProviderId =
  | 'google-books'
  | 'open-library'
  | 'hardcover'
  | 'penguin-random-house';

export type DetectiveProviderState =
  | 'ok'
  | 'partial'
  | 'unavailable'
  | 'rate-limited'
  | 'timed-out'
  | 'failed';

export interface DetectiveProviderObservation {
  readonly provider: DetectiveProviderId;
  readonly operation: string;
  readonly state: DetectiveProviderState;
  readonly recordCount: number;
  readonly errorCode?: string;
}

/** A provider's assertion is not an independently verified fact. */
export type DetectiveClaimKind =
  | 'work-identity'
  | 'edition-identity'
  | 'series-identity'
  | 'series-membership'
  | 'installment-position';

export interface DetectiveEvidenceClaim {
  /** Stable within a replay: provider + source record + kind + claim value. */
  readonly id: string;
  readonly provider: DetectiveProviderId;
  readonly sourceRecordId: string;
  readonly kind: DetectiveClaimKind;
  /** Source-native IDs stay source-native; do not conflate works and editions. */
  readonly subjectId: string;
  readonly objectId?: string;
  readonly value: string;
  readonly position?: number | null;
  readonly structured: boolean;
  readonly sourceField: string;
}

export interface DetectiveEvidenceSnapshot {
  readonly schemaVersion: 1;
  readonly seedBookId: string;
  readonly providerObservations: readonly DetectiveProviderObservation[];
  readonly claims: readonly DetectiveEvidenceClaim[];
}

export type DetectiveDecisionStatus = 'verified' | 'review' | 'rejected';
export type DetectiveDecisionReason =
  | 'provider-identity'
  | 'corroborated-membership'
  | 'unverified-membership'
  | 'unverified-order'
  | 'conflicting-evidence'
  | 'provider-unavailable'
  | 'publisher-collection'
  | 'work-identity-conflict'
  | 'manual-override';

export interface DetectiveEvidenceDecision {
  readonly subjectId: string;
  readonly status: DetectiveDecisionStatus;
  readonly reasonCodes: readonly DetectiveDecisionReason[];
  readonly supportingClaimIds: readonly string[];
  readonly conflictingClaimIds: readonly string[];
}

/** Enforce unique claim IDs and deterministic order without changing claims. */
export function assembleDetectiveEvidenceSnapshot(
  seedBookId: string,
  observations: readonly DetectiveProviderObservation[],
  claims: readonly DetectiveEvidenceClaim[],
): DetectiveEvidenceSnapshot {
  if (!seedBookId.trim()) throw new Error('Series Detective evidence requires a seed book ID.');
  const byId = new Map<string, DetectiveEvidenceClaim>();
  for (const claim of claims) {
    if (!claim.id || !claim.sourceRecordId || !claim.sourceField) {
      throw new Error('Series Detective evidence claim is missing provenance.');
    }
    const existing = byId.get(claim.id);
    if (existing && (existing.provider !== claim.provider
      || existing.sourceRecordId !== claim.sourceRecordId
      || existing.kind !== claim.kind
      || existing.subjectId !== claim.subjectId
      || existing.objectId !== claim.objectId
      || existing.value !== claim.value
      || existing.position !== claim.position
      || existing.structured !== claim.structured
      || existing.sourceField !== claim.sourceField)) {
      throw new Error(`Conflicting Series Detective evidence claim ID: ${claim.id}`);
    }
    byId.set(claim.id, claim);
  }
  for (const observation of observations) {
    if (!observation.operation.trim() || !Number.isSafeInteger(observation.recordCount)
      || observation.recordCount < 0) {
      throw new Error('Series Detective provider observation is invalid.');
    }
  }
  return {
    schemaVersion: 1,
    seedBookId,
    providerObservations: [...observations].sort((a, b) =>
      a.provider.localeCompare(b.provider) || a.operation.localeCompare(b.operation)),
    claims: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
