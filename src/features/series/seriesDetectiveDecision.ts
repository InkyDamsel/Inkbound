import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { corroborateDetectiveMembership, hasCorroboratedOwnedSeed } from './seriesDetectiveCorroboration';
import { verifyCanonicalProductionMembership } from './seriesDetectiveCanonicalAdapter';

/**
 * Single production decision point for series membership and reading order.
 * Adapters collect evidence; only this module grants verification.
 * Catalog disagreement about position does not erase discovery, but it
 * must block bulk-add verification until a trustworthy order is resolved.
 */
export function decideDetectiveMembership(
  sources: readonly DetectiveMergeCandidate[],
  candidate: DetectiveMergeCandidate,
  owned: readonly { title: string; author: string }[],
  seriesName: string,
): { verification: 'verified' | 'review'; position: number | null; conflictingOrder: boolean } {
  const membership = corroborateDetectiveMembership(sources, candidate, seriesName);
  const canonical = verifyCanonicalProductionMembership(sources, candidate, owned, seriesName);
  const verified = candidate.seriesStructured === true
    && hasCorroboratedOwnedSeed(sources, owned, seriesName)
    && membership.providers >= 2
    && canonical.verified
    && !membership.conflictingOrder
    && !canonical.conflicting;
  return {
    verification: verified ? 'verified' : 'review',
    position: membership.conflictingOrder ? null : membership.agreedPosition,
    conflictingOrder: membership.conflictingOrder || canonical.conflicting,
  };
}
