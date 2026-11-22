import type { SeriesDetectiveEdition, SeriesDetectiveWorkGroup } from './seriesDetectiveCatalogTypes';
import {
  canonicalDetectiveIsbn13,
  detectiveAuthorsCompatible,
  detectiveSeriesNamesCompatible,
  comparableDetectiveTitle,
  detectiveWorkTitlesCompatible,
} from './seriesDetectiveEvidence';

export interface DetectiveMergeCandidate {
  work: SeriesDetectiveWorkGroup;
  edition: SeriesDetectiveEdition;
  seriesName?: string;
  position: number | null;
  provider: 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house' | 'wikidata';
  seriesProvider?: 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house' | 'wikidata';
  seriesStructured?: boolean;
  /** Native catalog series identifier, not a normalized text alias. */
  nativeSeriesId?: string;
  /** Origin of the series assertion for evidence inspection. */
  evidenceOrigin?: string;
  providerSources?: Array<'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house' | 'wikidata'>;
}

const nonEmpty = (value?: string): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined;

const comparableWorkTitle = (value?: string): string => comparableDetectiveTitle(value);

const sameAuthor = (left: string[], right: string[]): boolean =>
  left.some((leftAuthor) =>
    Boolean(leftAuthor?.trim()) && right.some((rightAuthor) =>
      Boolean(rightAuthor?.trim())
      && detectiveAuthorsCompatible(leftAuthor, rightAuthor)),
  );

export const detectiveCandidatesAreSameWork = (
  left: DetectiveMergeCandidate,
  right: DetectiveMergeCandidate,
): boolean => {
  if (!sameAuthor(left.work.authors, right.work.authors)) return false;
  // Never collapse works with conflicting explicit series identities.
  if (left.seriesName && right.seriesName
    && !detectiveSeriesNamesCompatible(left.seriesName, right.seriesName)) return false;
  const matchingSeries = left.seriesName && right.seriesName
    && detectiveSeriesNamesCompatible(left.seriesName, right.seriesName)
    ? left.seriesName : undefined;
  const titlesCompatible = detectiveWorkTitlesCompatible(left.work.title, right.work.title, matchingSeries);

  // A provider's work identifier is stronger than its display title. Only
  // compare identifiers within the same namespace; cross-provider IDs can
  // collide accidentally. An edition ISBN is also exact shared evidence.
  if (left.work.key && right.work.key && left.work.key === right.work.key
    && left.work.key.startsWith(`${left.provider}:`)
    && right.work.key.startsWith(`${right.provider}:`)
    && titlesCompatible
    && editionIdentifiersCompatible(left.edition, right.edition)) return true;
  // A recycled or incorrect ISBN must not merge unrelated works. For
  // different titles, require compatible explicit series membership on both
  // records before accepting shared edition identifiers as work identity.
  if (exactIsbnMatch(left.edition, right.edition)) {
    const sameTitle = comparableDetectiveTitle(left.work.title, matchingSeries) === comparableDetectiveTitle(right.work.title, matchingSeries);
    if (sameTitle) return true;
    // An ISBN can be misassigned or reused in provider metadata. Two
    // differently titled works must not collapse merely because they share
    // a series label; this hides legitimate installments from discovery.
  }
  const leftTitle = comparableDetectiveTitle(left.work.title, matchingSeries);
  const rightTitle = comparableDetectiveTitle(right.work.title, matchingSeries);
  if (!leftTitle || !rightTitle) return false;
  if (titlesCompatible) return true;

  return false;
};

// ISBN-10 and ISBN-13 may describe the same edition. Never compare raw
// strings or accept malformed checksums as proof of edition identity.
const editionIdentifiers = (edition: SeriesDetectiveEdition): string[] =>
  [...new Set([edition.isbn13, edition.isbn10]
    .map(canonicalDetectiveIsbn13)
    .filter((value): value is string => Boolean(value)))];

const editionIdentifiersCompatible = (
  left: SeriesDetectiveEdition,
  right: SeriesDetectiveEdition,
): boolean => {
  const leftIds = editionIdentifiers(left);
  const rightIds = editionIdentifiers(right);
  // Conflicting valid ISBNs within either record mean ambiguous metadata.
  if (leftIds.length > 1 || rightIds.length > 1) return false;
  return leftIds.length === 0 || rightIds.length === 0 || leftIds[0] === rightIds[0];
};

const exactIsbnMatch = (left: SeriesDetectiveEdition, right: SeriesDetectiveEdition): boolean => {
  const leftIds = editionIdentifiers(left);
  const rightIds = editionIdentifiers(right);
  return editionIdentifiersCompatible(left, right)
    && leftIds.length === 1 && rightIds.length === 1 && leftIds[0] === rightIds[0];
};

const sameProviderEdition = (left: SeriesDetectiveEdition, right: SeriesDetectiveEdition): boolean =>
  left.source === right.source && Boolean(left.externalEditionId)
  && left.externalEditionId === right.externalEditionId
  && editionIdentifiersCompatible(left, right);

const editionQuality = (edition: SeriesDetectiveEdition): number => {
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
  left: SeriesDetectiveEdition,
  right: SeriesDetectiveEdition,
): SeriesDetectiveEdition => {
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
): {
  name?: string;
  position: number | null;
  provider?: 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house' | 'wikidata';
  structured?: boolean;
} => {
  const leftName = nonEmpty(left.seriesName);
  const rightName = nonEmpty(right.seriesName);
  if (!leftName) return {
    name: rightName,
    position: right.position,
    provider: right.seriesProvider ?? right.provider,
    structured: right.seriesStructured,
  };
  if (!rightName) return {
    name: leftName,
    position: left.position,
    provider: left.seriesProvider ?? left.provider,
    structured: left.seriesStructured,
  };
  const compatible = detectiveSeriesNamesCompatible(leftName, rightName);
  if (!compatible) {
    // Do not manufacture a consensus when two providers disagree on the series.
    // Keep the candidate with the more specific position and let both survive as
    // separate evidence if the caller cannot reconcile them.
    const winner = left.position !== null && right.position === null ? left
      : right.position !== null && left.position === null ? right
      : left;
    return {
      name: winner.seriesName,
      position: winner.position,
      provider: winner.seriesProvider ?? winner.provider,
      structured: winner.seriesStructured,
    };
  }

  const preferredSeriesSource = left.seriesStructured && !right.seriesStructured ? left
    : right.seriesStructured && !left.seriesStructured ? right
    : left.position !== null && right.position === null ? left
    : right.position !== null && left.position === null ? right
    : left;

  let position = left.position ?? right.position;
  if (
    left.position !== null
    && right.position !== null
    && left.position !== right.position
  ) {
    if (left.seriesStructured && !right.seriesStructured) position = left.position;
    else if (right.seriesStructured && !left.seriesStructured) position = right.position;
    else position = null;
  }

  return {
    name: leftName || rightName,
    position,
    provider: preferredSeriesSource.seriesProvider ?? preferredSeriesSource.provider,
    structured: Boolean(left.seriesStructured || right.seriesStructured),
  };
};

const mergeWork = (
  left: SeriesDetectiveWorkGroup,
  right: SeriesDetectiveWorkGroup,
  editions: SeriesDetectiveEdition[],
): SeriesDetectiveWorkGroup => ({
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
        providerSources: [...new Set([...(incoming.providerSources ?? []), incoming.provider])],
        work: { ...incoming.work, editions: [...incoming.work.editions] },
        edition: { ...incoming.edition },
      });
      continue;
    }

    const current = merged[workIndex];
    if (
      current.seriesName
      && incoming.seriesName
      && !detectiveSeriesNamesCompatible(current.seriesName, incoming.seriesName)
    ) {
      // Conflicting series claims for the same work are intentionally not
      // flattened into one truth. Preserve both for downstream verification.
      merged.push({
        ...incoming,
        providerSources: [...new Set([...(incoming.providerSources ?? []), incoming.provider])],
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
      seriesProvider: series.provider,
      // Divergent titles for an identical edition/work ID may be genuine
      // alternate titles or bad catalog metadata. Preserve the merged work,
      // but do not promote that disputed identity into automatic bulk-add.
      // A position disagreement is about ordering, not whether the work
      // belongs to the series. Preserve structured membership evidence.
      // Unsafe title variants remain review-only until identity is resolved.
      seriesStructured: !detectiveWorkTitlesCompatible(current.work.title, incoming.work.title)
        ? false : series.structured,
      providerSources: [...new Set([
        ...(current.providerSources ?? [current.provider]),
        ...(incoming.providerSources ?? [incoming.provider]),
      ])],
    };
  }

  return merged;
};
