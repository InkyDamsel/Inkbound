import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { detectiveSeriesNamesCompatible } from './seriesDetectiveEvidence';
import { hasExplicitCrossAuthorSeriesBrand } from './seriesDetectiveBranding';

/**
 * Single admission policy for a candidate whose author differs from the
 * reader's series authors. Admission is NOT verification.
 *
 * A native structured series claim may be reviewed before the family is
 * established. A title explicitly branded with the series may also be
 * reviewed. Generic topical subtitles must not bootstrap membership.
 */
export function evaluateCrossAuthorMembership(
  candidate: DetectiveMergeCandidate,
  requestedSeries: string,
  resolvedSeries: string | undefined,
  matchingAuthor: boolean,
  establishedMultiAuthorFamily: boolean,
): { admitted: boolean; reviewOnly: boolean } {
  if (matchingAuthor) return { admitted: true, reviewOnly: false };
  if (!resolvedSeries || !detectiveSeriesNamesCompatible(resolvedSeries, requestedSeries)) {
    return { admitted: false, reviewOnly: false };
  }
  if (candidate.seriesStructured === true && establishedMultiAuthorFamily) {
    return { admitted: true, reviewOnly: false };
  }
  const reviewOnly = candidate.seriesStructured === true
    || hasExplicitCrossAuthorSeriesBrand(candidate, requestedSeries);
  return { admitted: reviewOnly, reviewOnly };
}
