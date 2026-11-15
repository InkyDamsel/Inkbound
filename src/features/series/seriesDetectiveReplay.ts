import { classifyDetectiveSeriesLabel } from './seriesDetectiveLabelClassifier';
import {
  assembleDetectiveEvidenceSnapshot,
  type DetectiveEvidenceClaim,
  type DetectiveEvidenceDecision,
  type DetectiveEvidenceSnapshot,
  type DetectiveProviderObservation,
} from './seriesDetectiveEvidenceLedger';

/**
 * Offline V2 replay boundary. Input is a recorded provider evidence snapshot;
 * this module never performs requests or reads/writes the user's library.
 */
export interface DetectiveReplayInput {
  readonly seedBookId: string;
  readonly observations: readonly DetectiveProviderObservation[];
  readonly claims: readonly DetectiveEvidenceClaim[];
}

export interface DetectiveReplayResult {
  readonly snapshot: DetectiveEvidenceSnapshot;
  readonly decisions: readonly DetectiveEvidenceDecision[];
}

/** A structured provider claim is only useful if it identifies the series. */
const hasSeriesIdentity = (claim: DetectiveEvidenceClaim): boolean =>
  Boolean(claim.objectId?.trim() && claim.subjectId.trim() && claim.value.trim());

export function replayDetectiveEvidence(input: DetectiveReplayInput): DetectiveReplayResult {
  const snapshot = assembleDetectiveEvidenceSnapshot(input.seedBookId, input.observations, input.claims);
  const membershipClaims = snapshot.claims.filter(claim => claim.kind === 'series-membership');
  const bySubject = new Map<string, DetectiveEvidenceClaim[]>();
  for (const claim of membershipClaims) {
    const list = bySubject.get(claim.subjectId) ?? [];
    list.push(claim);
    bySubject.set(claim.subjectId, list);
  }

  const unavailable = snapshot.providerObservations.some(item => item.state !== 'ok');
  const decisions: DetectiveEvidenceDecision[] = [];
  for (const [subjectId, claims] of [...bySubject].sort(([a], [b]) => a.localeCompare(b))) {
    const qualifying = claims.filter(claim => hasSeriesIdentity(claim)
      && classifyDetectiveSeriesLabel(claim.value) !== 'publisher-collection');
    const excluded = claims.filter(claim => classifyDetectiveSeriesLabel(claim.value) === 'publisher-collection');
    const seriesIds = new Set(qualifying.map(claim => claim.objectId));
    const conflicting = seriesIds.size > 1;
    const structured = qualifying.filter(claim => claim.structured);
    const corroborated = new Set(structured.map(claim => claim.provider)).size >= 2;
    // This is a deliberately conservative first policy: a single structured
    // claim cannot verify without corroboration. Never count multiple records
    // from one provider as independent agreement.
    const verified = !conflicting && corroborated;
    const supportingClaimIds = qualifying.filter(claim => !conflicting)
      .map(claim => claim.id).sort();
    const conflictingClaimIds = conflicting ? claims.map(claim => claim.id).sort() : [];
    const reasonCodes: DetectiveEvidenceDecision['reasonCodes'][number][] = [];
    if (excluded.length) reasonCodes.push('publisher-collection');
    if (conflicting) reasonCodes.push('conflicting-evidence');
    else if (verified) reasonCodes.push('corroborated-membership');
    else reasonCodes.push('unverified-membership');
    if (!verified && unavailable) reasonCodes.push('provider-unavailable');
    decisions.push({
      subjectId,
      status: excluded.length && qualifying.length === 0 ? 'rejected' : verified ? 'verified' : 'review',
      reasonCodes,
      supportingClaimIds,
      conflictingClaimIds,
    });
  }
  return { snapshot, decisions };
}
