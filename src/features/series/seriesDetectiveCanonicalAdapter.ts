import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { detectiveCandidatesAreSameWork } from './seriesDetectiveMerge';
import { detectiveWorkTitlesCompatible, detectiveAuthorsCompatible, detectiveSeriesNamesCompatible, compactDetectiveIsbn } from './seriesDetectiveEvidence';

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
      .filter((isbn) => (isbn.length === 13 && /^\d{13}$/.test(isbn))
        || (isbn.length === 10 && /^\d{9}[\dX]$/.test(isbn))))];
  const matching = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.some(author => Boolean(author?.trim()))
    && detectiveCandidatesAreSameWork(source, target)
    && detectiveWorkTitlesCompatible(source.work.title, target.work.title)
    && source.work.authors.some(author => target.work.authors.some(other =>
      Boolean(author?.trim()) && Boolean(other?.trim()) && detectiveAuthorsCompatible(author, other))));
  const seedSources = sources.filter(source => source.seriesStructured === true
    && source.seriesName && detectiveSeriesNamesCompatible(source.seriesName, seriesName)
    && source.work.title.trim() && source.work.authors.some(author => Boolean(author?.trim()))
    && owned.some(book => Boolean(book.title?.trim()) && Boolean(book.author?.trim())
      && detectiveWorkTitlesCompatible(source.work.title, book.title)
      && source.work.authors.some(author => Boolean(author?.trim())
        && detectiveAuthorsCompatible(author, book.author))));
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
  const corroboratedOwnedSeed = owned.some(book => Boolean(book.title?.trim())
    && Boolean(book.author?.trim()) && independentWorkEvidence(seedSources.filter(source =>
      detectiveWorkTitlesCompatible(source.work.title, book.title)
      && source.work.authors.some(author => Boolean(author?.trim())
        && detectiveAuthorsCompatible(author, book.author)))));
  if (!independentWorkEvidence(matching) || !corroboratedOwnedSeed) {
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
