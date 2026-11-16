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
  const isbnOf = (candidate: DetectiveMergeCandidate): string | null => {
    const isbn13 = compactDetectiveIsbn(candidate.edition.isbn13);
    const isbn10 = compactDetectiveIsbn(candidate.edition.isbn10);
    return isbn13 || isbn10 || null;
  };
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
  // The existing catalog adapter does not expose trustworthy cross-provider
  // series IDs. Do not manufacture identity records from array indexes and
  // normalized titles and then call them independently verified.
  // Until provider-native identity evidence is available, V2 cannot grant
  // verification. Preserve results as review-only in the production caller.
  const independentWorkEvidence = (group: readonly DetectiveMergeCandidate[]): boolean => {
    const byIsbn = new Map<string, Set<Provider>>();
    for (const source of group) {
      const isbn = isbnOf(source);
      if (!isbn) continue;
      const providers = byIsbn.get(isbn) ?? new Set<Provider>();
      providers.add(source.seriesProvider ?? source.provider);
      byIsbn.set(isbn, providers);
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
  // Independent structured memberships for both seed and target provide a
  // narrow production liveness path. Do not require position agreement for
  // membership: position is a separate claim, and conflicts remain review.
  return { verified: anchored && providers.size >= 2,
    agreedPosition, conflicting, providerCount: providers.size };
}
