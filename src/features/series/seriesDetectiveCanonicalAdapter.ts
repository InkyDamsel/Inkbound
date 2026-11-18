import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { detectiveCandidatesAreSameWork } from './seriesDetectiveMerge';
import { detectiveWorkTitlesCompatible, detectiveAuthorsCompatible, detectiveSeriesNamesCompatible, canonicalDetectiveIsbn13 } from './seriesDetectiveEvidence';

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
      .map(canonicalDetectiveIsbn13)
      .filter((isbn): isbn is string => Boolean(isbn)))];
  const matching = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.some(author => Boolean(author?.trim()))
    && detectiveCandidatesAreSameWork(source, target)
    && detectiveWorkTitlesCompatible(source.work.title, target.work.title, seriesName)
    && source.work.authors.some(author => target.work.authors.some(other =>
      Boolean(author?.trim()) && Boolean(other?.trim()) && detectiveAuthorsCompatible(author, other))));
  const seedSources = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.some(author => Boolean(author?.trim()))
    && owned.some(book => Boolean(book.title?.trim()) && Boolean(book.author?.trim())
      && detectiveWorkTitlesCompatible(source.work.title, book.title, seriesName)
      && source.work.authors.some(author => Boolean(author?.trim())
        && detectiveAuthorsCompatible(author, book.author))));
  // ISBN corroboration proves an edition. Two independently identified native
  // catalog memberships can corroborate a work even across different editions.
  // A textual series label alone must never count as that native evidence.
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
  const independentNativeWorkEvidence = (group: readonly DetectiveMergeCandidate[]): boolean => {
    const idsByProvider = new Map<Provider, Set<string>>();
    for (const source of group) {
      if (source.seriesStructured !== true || !source.nativeSeriesId?.trim()) continue;
      const provider = source.seriesProvider ?? source.provider;
      const ids = idsByProvider.get(provider) ?? new Set<string>();
      ids.add(source.nativeSeriesId.trim());
      idsByProvider.set(provider, ids);
    }
    // A provider contradicting itself about a work's native series membership
    // must not contribute to a cross-edition verification vote.
    return idsByProvider.size >= 2
      && [...idsByProvider.values()].every(ids => ids.size === 1);
  };
  const independentlyCorroborated = (group: readonly DetectiveMergeCandidate[]): boolean =>
    independentWorkEvidence(group) || independentNativeWorkEvidence(group);
  const corroboratedOwnedSeed = owned.some(book => Boolean(book.title?.trim())
    && Boolean(book.author?.trim()) && independentlyCorroborated(seedSources.filter(source =>
      detectiveWorkTitlesCompatible(source.work.title, book.title, seriesName)
      && source.work.authors.some(author => Boolean(author?.trim())
        && detectiveAuthorsCompatible(author, book.author)))));
  if (!independentlyCorroborated(matching) || !corroboratedOwnedSeed) {
    return { verified: false, agreedPosition: null, conflicting: false,
      providerCount: new Set(matching.map(source => source.seriesProvider ?? source.provider)).size };
  }
  // Require the same independently corroborated owned work to anchor the
  // requested series. A generic matching series phrase is not enough.
  const anchored = corroboratedOwnedSeed;
  // Count only structured native membership claims, not search mirrors.
  const providers = new Set(matching.map(source => source.seriesProvider ?? source.provider));
  const positions = matching.filter(source => source.position !== null
    && Number.isInteger(source.position) && source.position > 0)
    .map(source => ({ provider: source.seriesProvider ?? source.provider, position: source.position! }));
  const invalidPosition = matching.some(source => source.position !== null
    && (!Number.isSafeInteger(source.position) || source.position <= 0));
  const distinctPositions = new Set(positions.map(item => item.position));
  const conflicting = invalidPosition || distinctPositions.size > 1;
  const agreedPosition = !conflicting && positions.length > 0
    && new Set(positions.map(item => item.provider)).size >= 2
    ? positions[0].position : null;
  // Membership and ordering are distinct evidence. The final decision engine
  // must keep disputed ordering review-only for safe bulk operations.
  return { verified: anchored && providers.size >= 2 && !conflicting,
    agreedPosition, conflicting, providerCount: providers.size };
}
