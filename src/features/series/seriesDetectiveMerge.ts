import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import {
  canonicalDetectiveAuthor,
  compactDetectiveIsbn,
  detectiveSeriesNamesCompatible,
  normalizeDetectiveText,
} from './seriesDetectiveEvidence';

export interface DetectiveMergeCandidate {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
  seriesName: string;
  position: number | null;
  provider: 'google-books' | 'open-library';
}

const nonEmpty = (value?: string): string | undefined => value?.trim() || undefined;

const sameAuthor = (left: string[], right: string[]): boolean => {
  const leftIds = new Set(left.map(canonicalDetectiveAuthor).filter(Boolean));
  const rightIds = right.map(canonicalDetectiveAuthor).filter(Boolean);
  return rightIds.some((author) => leftIds.has(author));
};

export const detectiveCandidatesAreSameWork = (
  left: DetectiveMergeCandidate,
  right: DetectiveMergeCandidate,
): boolean =>
  normalizeDetectiveText(left.work.title) === normalizeDetectiveText(right.work.title)
  && sameAuthor(left.work.authors, right.work.authors);

const exactIsbnMatch = (left: BookSearchEdition, right: BookSearchEdition): boolean => {
  const left13 = compactDetectiveIsbn(left.isbn13);
  const right13 = compactDetectiveIsbn(right.isbn13);
  if (left13 && right13) return left13 === right13;

  const left10 = compactDetectiveIsbn(left.isbn10);
  const right10 = compactDetectiveIsbn(right.isbn10);
  return Boolean(left10 && right10 && left10 === right10);
};

const sameProviderEdition = (left: BookSearchEdition, right: BookSearchEdition): boolean =>
  left.source === right.source
  && Boolean(left.externalEditionId)
  && left.externalEditionId === right.externalEditionId;

const editionQuality = (edition: BookSearchEdition): number => {
  let score = 0;
  if (edition.isbn13) score += 20;
  if (edition.isbn10) score += 10;
  if (edition.pageCount && edition.pageCount > 0) score += 8;
  if (edition.coverUrl) score += 6;
  if (edition.publisher) score += 3;
  if (edition.publicationDate) score += 3;
  if (edition.language) score += 2;
  if (edition.publisherSummary) score += 2;
  if (edition.source === 'google-books') score += 1;
  return score;
};

const mergeString = (preferred?: string, supplement?: string): string | undefined =>
  nonEmpty(preferred) ?? nonEmpty(supplement);

const mergeExactEdition = (
  left: BookSearchEdition,
  right: BookSearchEdition,
): BookSearchEdition => {
  const preferred = editionQuality(right) > editionQuality(left) ? right : left;
  const supplement = preferred === left ? right : left;

  return {
    ...supplement,
    ...preferred,
    title: mergeString(preferred.title, supplement.title) ?? preferred.title,
    subtitle: mergeString(preferred.subtitle, supplement.subtitle),
    authors: preferred.authors.length ? preferred.authors : supplement.authors,
    publisherSummary: mergeString(preferred.publisherSummary, supplement.publisherSummary),
    genres: [...new Set([...preferred.genres, ...supplement.genres])].slice(0, 16),
    publisher: mergeString(preferred.publisher, supplement.publisher),
    publicationDate: mergeString(preferred.publicationDate, supplement.publicationDate),
    publicationYear: preferred.publicationYear || supplement.publicationYear,
    language: mergeString(preferred.language, supplement.language),
    isbn10: mergeString(preferred.isbn10, supplement.isbn10),
    isbn13: mergeString(preferred.isbn13, supplement.isbn13),
    asin: mergeString(preferred.asin, supplement.asin),
    pageCount: preferred.pageCount && preferred.pageCount > 0
      ? preferred.pageCount
      : supplement.pageCount,
    coverUrl: mergeString(preferred.coverUrl, supplement.coverUrl),
    editionName: mergeString(preferred.editionName, supplement.editionName),
    binding: mergeString(preferred.binding, supplement.binding),
    specialFeatures: [...new Set([...preferred.specialFeatures, ...supplement.specialFeatures])].slice(0, 12),
  };
};

const mergeSeries = (
  left: DetectiveMergeCandidate,
  right: DetectiveMergeCandidate,
): { name: string; position: number | null } => {
  const compatible = detectiveSeriesNamesCompatible(left.seriesName, right.seriesName);
  if (!compatible) {
    // Do not manufacture a consensus when two providers disagree on the series.
    // Keep the candidate with the more specific position and let both survive as
    // separate evidence if the caller cannot reconcile them.
    const winner = left.position !== null && right.position === null ? left
      : right.position !== null && left.position === null ? right
      : left;
    return { name: winner.seriesName, position: winner.position };
  }

  return {
    name: left.seriesName.trim() || right.seriesName.trim(),
    position: left.position ?? right.position,
  };
};

const mergeWork = (
  left: BookSearchWorkGroup,
  right: BookSearchWorkGroup,
  editions: BookSearchEdition[],
): BookSearchWorkGroup => ({
  key: left.key || right.key,
  title: nonEmpty(left.title) ?? right.title,
  subtitle: mergeString(left.subtitle, right.subtitle),
  authors: left.authors.length ? left.authors : right.authors,
  publisherSummary: mergeString(left.publisherSummary, right.publisherSummary),
  genres: [...new Set([...left.genres, ...right.genres])].slice(0, 16),
  editions,
});

export const mergeDetectiveCandidates = (
  candidates: DetectiveMergeCandidate[],
): DetectiveMergeCandidate[] => {
  const merged: DetectiveMergeCandidate[] = [];

  for (const incoming of candidates) {
    const workIndex = merged.findIndex((current) => detectiveCandidatesAreSameWork(current, incoming));
    if (workIndex < 0) {
      merged.push({
        ...incoming,
        work: { ...incoming.work, editions: [...incoming.work.editions] },
        edition: { ...incoming.edition },
      });
      continue;
    }

    const current = merged[workIndex];
    if (!detectiveSeriesNamesCompatible(current.seriesName, incoming.seriesName)) {
      // Conflicting series claims for the same work are intentionally not
      // flattened into one truth. Preserve both for downstream verification.
      merged.push({
        ...incoming,
        work: { ...incoming.work, editions: [...incoming.work.editions] },
        edition: { ...incoming.edition },
      });
      continue;
    }

    const currentEditions = [...current.work.editions];
    const matchingEditionIndex = currentEditions.findIndex((edition) =>
      exactIsbnMatch(edition, incoming.edition)
      || sameProviderEdition(edition, incoming.edition),
    );

    let chosenEdition = current.edition;
    if (matchingEditionIndex >= 0) {
      const mergedEdition = mergeExactEdition(currentEditions[matchingEditionIndex], incoming.edition);
      currentEditions[matchingEditionIndex] = mergedEdition;

      if (
        exactIsbnMatch(current.edition, incoming.edition)
        || sameProviderEdition(current.edition, incoming.edition)
      ) {
        chosenEdition = mergedEdition;
      } else if (editionQuality(incoming.edition) > editionQuality(current.edition)) {
        chosenEdition = incoming.edition;
      }
    } else {
      currentEditions.push(incoming.edition);
      if (editionQuality(incoming.edition) > editionQuality(current.edition)) {
        chosenEdition = incoming.edition;
      }
    }

    const series = mergeSeries(current, incoming);
    merged[workIndex] = {
      work: mergeWork(current.work, incoming.work, currentEditions),
      edition: chosenEdition,
      seriesName: series.name,
      position: series.position,
      provider: current.provider,
    };
  }

  return merged;
};
