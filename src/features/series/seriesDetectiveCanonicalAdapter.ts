import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { detectiveCandidatesAreSameWork } from './seriesDetectiveMerge';
import { comparableDetectiveTitle, canonicalDetectiveAuthor, detectiveSeriesNamesCompatible, compactDetectiveIsbn } from './seriesDetectiveEvidence';

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
  // An ISBN is independently assigned edition evidence. Display title and
  // author are useful for discovery, but must never be forged into a
  // provider-independent identity proof.
  const isbnsOf = (candidate: DetectiveMergeCandidate): string[] =>
    [...new Set([candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter((isbn) => (isbn.length === 13 && /^\\d{13}$/.test(isbn))
        || (isbn.length === 10 && /^\\d{9}[\\dX]$/.test(isbn))))];
  // Catalogs sometimes put an empty placeholder before the actual author.
  // Use the first nonempty author, never an empty identity key.
  const workKey = (candidate: DetectiveMergeCandidate): string =>
    JSON.stringify([comparableDetectiveTitle(candidate.work.title),
      canonicalDetectiveAuthor(candidate.work.authors.find(author => Boolean(author?.trim())) ?? '')]);
  const targetKey = workKey(target);
  const ownedKeys = new Set(owned.filter(book => Boolean(book.title?.trim())
    && Boolean(book.author?.trim())).map(book => JSON.stringify([
    comparableDetectiveTitle(book.title), canonicalDetectiveAuthor(book.author),
  ])));
  const matching = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.some(author => Boolean(author?.trim()))
    && detectiveCandidatesAreSameWork(source, target)
    && workKey(source) === targetKey);
  const seedSources = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.some(author => Boolean(author?.trim()))
    && ownedKeys.has(workKey(source)));
  // A matching ISBN corroborates edition identity across catalogs. It does
  // not by itself prove membership; only structured series claims count.
  const independentWorkEvidence = (group: readonly DetectiveMergeCandidate[]): boolean => {
    const byIsbn = new Map<string, Set<Provider>>();
    for (const source of group) {
      for (const isbn of isbnsOf(source)) {
        const providers = byIsbn.get(isbn) ?? new Set<Provider>();
        providers.add(source.seriesProvider ?? source.provider);
        byIsbn.set(isbn, providers);
      }
    }
    return [...byIsbn.values()].some(providers => providers.size >= 2);
  };
  if (!independentWorkEvidence(matching)
    || ![...ownedKeys].some(key => independentWorkEvidence(seedSources.filter(source => workKey(source) === key)))) {
    return { verified: false, agreedPosition: null, conflicting: false,
      providerCount: new Set(matching.map(source => source.seriesProvider ?? source.provider)).size };
  }
  // Require the same independently corroborated owned work to anchor the
  // requested series. A generic matching series phrase is not enough.
  const anchored = [...ownedKeys].some(key =>
    independentWorkEvidence(seedSources.filter(source => workKey(source) === key)));
  // Count only structured native membership claims, not search mirrors.
  const providers = new Set(matching.map(source => source.seriesProvider ?? source.provider));
  const positions = matching.filter(source => source.position !== null
    && Number.isInteger(source.position) && source.position > 0)
    .map(source => ({ provider: source.seriesProvider ?? source.provider, position: source.position! }));
  const distinctPositions = new Set(positions.map(item => item.position));
  const conflicting = distinctPositions.size > 1;
  const agreedPosition = !conflicting && positions.length > 0
    && new Set(positions.map(item => item.provider)).size >= 2
    ? positions[0].position : null;
  // Membership and ordering are distinct evidence. The final decision engine
  // must keep disputed ordering review-only for safe bulk operations.
  return { verified: anchored && providers.size >= 2,
    agreedPosition, conflicting, providerCount: providers.size };
}
