/**
 * Provider-independent identity resolution for offline Series Detective replay.
 *
 * Native provider IDs are NEVER treated as cross-provider IDs. The resolver
 * requires independently supplied, validated canonical work and series keys.
 * It does not guess identities from a series label, position or search query.
 * Production adapters must provide auditable identity evidence before use.
 */
import type { DetectiveEvidenceClaim } from './seriesDetectiveEvidenceLedger';

export interface DetectiveResolvedIdentity {
  readonly provider: DetectiveEvidenceClaim['provider'];
  readonly nativeWorkId: string;
  readonly canonicalWorkId: string;
  readonly nativeSeriesId: string;
  readonly canonicalSeriesId: string;
  /** Evidence record proving both mappings, not a title-only guess. */
  readonly identityEvidenceIds: readonly string[];
}

export interface DetectiveResolvedMembership {
  readonly canonicalWorkId: string;
  readonly canonicalSeriesId: string;
  readonly claims: readonly DetectiveEvidenceClaim[];
  readonly identityEvidenceIds: readonly string[];
}

export interface DetectiveIdentityResolution {
  readonly memberships: readonly DetectiveResolvedMembership[];
  readonly unresolvedClaimIds: readonly string[];
  readonly conflictingClaimIds: readonly string[];
}

const key = (provider: string, work: string, series: string): string =>
  JSON.stringify([provider, work, series]);
const stableCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/**
 * Explicit, fail-closed identity join. In particular, two different native
 * series IDs sharing a label do NOT establish canonical identity.
 */
export function resolveDetectiveMembershipIdentities(
  claims: readonly DetectiveEvidenceClaim[],
  identities: readonly DetectiveResolvedIdentity[],
): DetectiveIdentityResolution {
  const mappings = new Map<string, DetectiveResolvedIdentity>();
  const ambiguous = new Set<string>();
  for (const mapping of identities) {
    const nativeKey = key(mapping.provider, mapping.nativeWorkId, mapping.nativeSeriesId);
    if (!mapping.nativeWorkId.trim() || !mapping.nativeSeriesId.trim()
      || !mapping.canonicalWorkId.trim() || !mapping.canonicalSeriesId.trim()
      || mapping.identityEvidenceIds.length === 0
      || mapping.identityEvidenceIds.some(id => !id.trim())) {
      ambiguous.add(nativeKey);
      continue;
    }
    const previous = mappings.get(nativeKey);
    if (previous && (previous.canonicalWorkId !== mapping.canonicalWorkId
      || previous.canonicalSeriesId !== mapping.canonicalSeriesId)) {
      ambiguous.add(nativeKey);
    } else {
      mappings.set(nativeKey, mapping);
    }
  }

  const groups = new Map<string, { claims: DetectiveEvidenceClaim[]; evidence: Set<string> }>();
  const unresolvedClaimIds: string[] = [];
  const conflictingClaimIds: string[] = [];
  for (const claim of claims) {
    if (claim.kind !== 'series-membership') continue;
    const nativeKey = key(claim.provider, claim.subjectId, claim.objectId ?? '');
    if (ambiguous.has(nativeKey)) {
      conflictingClaimIds.push(claim.id);
      continue;
    }
    const mapping = mappings.get(nativeKey);
    if (!mapping) {
      unresolvedClaimIds.push(claim.id);
      continue;
    }
    const groupKey = JSON.stringify([mapping.canonicalWorkId, mapping.canonicalSeriesId]);
    const group = groups.get(groupKey) ?? { claims: [], evidence: new Set<string>() };
    group.claims.push(claim);
    mapping.identityEvidenceIds.forEach(id => group.evidence.add(id));
    groups.set(groupKey, group);
  }
  const memberships = [...groups.entries()].sort(([a], [b]) => stableCompare(a, b))
    .map(([groupKey, group]) => {
      const [canonicalWorkId, canonicalSeriesId] = JSON.parse(groupKey) as [string, string];
      return {
        canonicalWorkId, canonicalSeriesId,
        claims: group.claims.sort((a, b) => stableCompare(a.id, b.id)),
        identityEvidenceIds: [...group.evidence].sort(stableCompare),
      };
    });
  return {
    memberships,
    unresolvedClaimIds: unresolvedClaimIds.sort(stableCompare),
    conflictingClaimIds: conflictingClaimIds.sort(stableCompare),
  };
}
