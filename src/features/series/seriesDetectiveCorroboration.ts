import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { detectiveCandidatesAreSameWork } from './seriesDetectiveMerge';
import { comparableDetectiveTitle, detectiveWorkTitlesCompatible, detectiveAuthorsCompatible, detectiveSeriesNamesCompatible, isCredibleDetectiveAuthor } from './seriesDetectiveEvidence';

export interface DetectiveOwnedSeed {
  readonly title: string;
  readonly author: string;
}

const providerOf = (candidate: DetectiveMergeCandidate): string =>
  candidate.seriesProvider ?? candidate.provider;

const structuredForSeries = (candidate: DetectiveMergeCandidate, seriesName: string): boolean =>
  candidate.seriesStructured === true
  && Boolean(candidate.seriesName)
  && detectiveSeriesNamesCompatible(candidate.seriesName!, seriesName);

/**
 * Evidence is scoped to an individual owned work. Two different owned books
 * with one provider apiece cannot jointly authenticate the series.
 */
export function hasCorroboratedOwnedSeed(
  candidates: readonly DetectiveMergeCandidate[],
  owned: readonly DetectiveOwnedSeed[],
  seriesName: string,
): boolean {
  return owned.some(book => isCredibleDetectiveAuthor(book.author)
    && Boolean(comparableDetectiveTitle(book.title))
    && new Set(candidates.filter(candidate =>
      structuredForSeries(candidate, seriesName)
      && detectiveWorkTitlesCompatible(candidate.work.title, book.title, seriesName)
      && candidate.work.authors.some(author => isCredibleDetectiveAuthor(author)
        && detectiveAuthorsCompatible(book.author, author)))
      .map(providerOf)).size >= 2);
}

export interface DetectiveMembershipCorroboration {
  readonly providers: number;
  readonly conflictingOrder: boolean;
  readonly agreedPosition: number | null;
}

/** An invalid or disputed ordinal cannot become a verified reading order. */
export function corroborateDetectiveMembership(
  candidates: readonly DetectiveMergeCandidate[],
  target: DetectiveMergeCandidate,
  seriesName: string,
): DetectiveMembershipCorroboration {
  const matching = candidates.filter(candidate =>
    structuredForSeries(candidate, seriesName)
    && detectiveCandidatesAreSameWork(candidate, target)
    // Never allow a record whose work identity is ambiguous to provide a
    // second independent vote merely because a reused ISBN matches.
    && detectiveWorkTitlesCompatible(candidate.work.title, target.work.title, seriesName));
  const providers = new Set(matching.map(providerOf));
  const invalidPosition = matching.some(candidate => candidate.position != null
    && (!Number.isSafeInteger(candidate.position) || candidate.position <= 0));
  const positions = new Set(matching.map(candidate => candidate.position)
    .filter((position): position is number => typeof position === 'number'
      && Number.isSafeInteger(position) && position > 0));
  const positionedProviders = new Set(matching.filter(candidate =>
    typeof candidate.position === 'number' && Number.isSafeInteger(candidate.position)
    && candidate.position > 0).map(providerOf));
  return {
    providers: providers.size,
    conflictingOrder: invalidPosition || positions.size > 1,
    agreedPosition: !invalidPosition && positions.size === 1 && positionedProviders.size >= 2
      ? [...positions][0] : null,
  };
}
