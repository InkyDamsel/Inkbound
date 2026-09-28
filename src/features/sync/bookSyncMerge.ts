import type { UserBookRecord } from '../../types';
import { mergeIncomingBookLoanState } from '../ownership/bookOwnership';

const preferredText = (localValue?: string, remoteValue?: string) =>
  localValue?.trim() ? localValue : remoteValue;

/**
 * Canonical sync merge used only when durable local reader intent wins a
 * local-vs-cloud conflict but the remote copy may contain bibliographic metadata
 * the local copy is missing.
 *
 * Reader-owned state stays local-authoritative. Remote data may only fill
 * metadata gaps; it must never replace manual series intent, progress, status,
 * ratings, notes, tags, collections, ownership, or other reader decisions.
 */
export function mergePendingLocalBookWithRemoteMetadata(
  localBook: UserBookRecord,
  remoteBook: UserBookRecord,
): UserBookRecord {
  const remoteEditions = new Map(remoteBook.editions.map((edition) => [edition.id, edition]));
  const mergedEditions = localBook.editions.map((localEdition) => {
    const remoteEdition = remoteEditions.get(localEdition.id);
    if (!remoteEdition) return localEdition;
    remoteEditions.delete(localEdition.id);

    return {
      ...remoteEdition,
      ...localEdition,
      coverUrl: preferredText(localEdition.coverUrl, remoteEdition.coverUrl),
      isbn: preferredText(localEdition.isbn, remoteEdition.isbn),
      isbn10: preferredText(localEdition.isbn10, remoteEdition.isbn10),
      isbn13: preferredText(localEdition.isbn13, remoteEdition.isbn13),
      asin: preferredText(localEdition.asin, remoteEdition.asin),
      lccn: preferredText(localEdition.lccn, remoteEdition.lccn),
      publisher: preferredText(localEdition.publisher, remoteEdition.publisher),
      publicationDate: preferredText(localEdition.publicationDate, remoteEdition.publicationDate),
      language: preferredText(localEdition.language, remoteEdition.language),
      editionName: preferredText(localEdition.editionName, remoteEdition.editionName),
      binding: preferredText(localEdition.binding, remoteEdition.binding),
      externalSource: localEdition.externalSource ?? remoteEdition.externalSource,
      externalEditionId: preferredText(localEdition.externalEditionId, remoteEdition.externalEditionId),
      pageCount: localEdition.pageCount || remoteEdition.pageCount,
      audiobookDurationMins: localEdition.audiobookDurationMins || remoteEdition.audiobookDurationMins,
      narrator: preferredText(localEdition.narrator, remoteEdition.narrator),
      specialFeatures: localEdition.specialFeatures?.length
        ? localEdition.specialFeatures
        : remoteEdition.specialFeatures,
      coverGradient: localEdition.coverGradient || remoteEdition.coverGradient,
    };
  });

  remoteEditions.forEach((edition) => mergedEditions.push(edition));

  const localSummary = localBook.work.summary?.trim();
  const localSummaryMissing = !localSummary || localSummary.toLowerCase() === 'summary unavailable.';
  const preserveManualSeries = localBook.work.seriesSource === 'manual';

  const merged: UserBookRecord = {
    ...remoteBook,
    ...localBook,
    work: {
      ...remoteBook.work,
      ...localBook.work,
      subtitle: preferredText(localBook.work.subtitle, remoteBook.work.subtitle),
      summary: localSummaryMissing
        ? (preferredText(remoteBook.work.summary, remoteBook.work.publisherSummary) ?? localBook.work.summary)
        : localBook.work.summary,
      publisherSummary: preferredText(localBook.work.publisherSummary, remoteBook.work.publisherSummary),
      genres: localBook.work.genres?.length ? localBook.work.genres : remoteBook.work.genres,
      seriesName: preserveManualSeries
        ? localBook.work.seriesName
        : preferredText(localBook.work.seriesName, remoteBook.work.seriesName),
      seriesOrder: preserveManualSeries
        ? localBook.work.seriesOrder
        : (typeof localBook.work.seriesOrder === 'number'
          ? localBook.work.seriesOrder
          : remoteBook.work.seriesOrder),
      seriesLabel: preserveManualSeries ? localBook.work.seriesLabel : undefined,
      seriesSource: preserveManualSeries
        ? 'manual'
        : (localBook.work.seriesSource ?? remoteBook.work.seriesSource),
      publicationYear: localBook.work.publicationYear || remoteBook.work.publicationYear,
      originalLanguage: preferredText(localBook.work.originalLanguage, remoteBook.work.originalLanguage),
      externalWorkId: preferredText(localBook.work.externalWorkId, remoteBook.work.externalWorkId),
    },
    editions: mergedEditions,
    activeEditionId: mergedEditions.some((edition) => edition.id === localBook.activeEditionId)
      ? localBook.activeEditionId
      : remoteBook.activeEditionId,
    importMetadataVerified: localBook.importMetadataVerified === true || remoteBook.importMetadataVerified === true,
    importMetadataReviewNeeded: localBook.importMetadataReviewNeeded ?? remoteBook.importMetadataReviewNeeded,
    sourceOfImport: localBook.sourceOfImport || remoteBook.sourceOfImport,
  };

  return mergeIncomingBookLoanState(localBook, merged);
}
