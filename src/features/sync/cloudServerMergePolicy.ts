import type { UserBookRecord } from '../../types';
import { mergeIncomingBookLoanState } from '../ownership/bookOwnership';
import { mergeIncomingBookQuoteState } from '../reading/bookQuotePersistence';
import { mergeIncomingManualCoverState } from './bookUserOwnedPersistence';

export interface PendingMutation<T> {
  operation: 'upsert' | 'delete';
  data?: T;
  clientUpdatedAt: string;
}

export function mergeServerCollectionById<T extends { id: string }>(
  current: T[],
  server: T[],
  pending: Record<string, PendingMutation<T>>,
): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    const localMutation = pending[item.id];
    if (localMutation?.operation === 'delete') return;
    if (localMutation?.operation === 'upsert' && localMutation.data) {
      merged.set(item.id, localMutation.data);
      return;
    }

    // An explicit server refresh is a reconciliation pass, not a metadata-only
    // lookup. With no pending local intent, the saved account record is the
    // canonical current record for this ID and must replace stale device state.
    merged.set(item.id, item);
  });
  return [...merged.values()];
}

function preferredText(localValue?: string, serverValue?: string) {
  return localValue?.trim() ? localValue : serverValue;
}

function mergeServerMetadataIntoBook(localBook: UserBookRecord, serverBook: UserBookRecord): UserBookRecord {
  const serverEditions = new Map(serverBook.editions.map((edition) => [edition.id, edition]));
  const mergedEditions = localBook.editions.map((localEdition) => {
    const serverEdition = serverEditions.get(localEdition.id);
    if (!serverEdition) return localEdition;
    serverEditions.delete(localEdition.id);

    return {
      ...serverEdition,
      ...localEdition,
      coverUrl: preferredText(localEdition.coverUrl, serverEdition.coverUrl),
      isbn: preferredText(localEdition.isbn, serverEdition.isbn),
      isbn10: preferredText(localEdition.isbn10, serverEdition.isbn10),
      isbn13: preferredText(localEdition.isbn13, serverEdition.isbn13),
      publisher: preferredText(localEdition.publisher, serverEdition.publisher),
      publicationDate: preferredText(localEdition.publicationDate, serverEdition.publicationDate),
      language: preferredText(localEdition.language, serverEdition.language),
      editionName: preferredText(localEdition.editionName, serverEdition.editionName),
      binding: preferredText(localEdition.binding, serverEdition.binding),
      externalSource: localEdition.externalSource ?? serverEdition.externalSource,
      externalEditionId: preferredText(localEdition.externalEditionId, serverEdition.externalEditionId),
      pageCount: localEdition.pageCount || serverEdition.pageCount,
      specialFeatures: localEdition.specialFeatures?.length ? localEdition.specialFeatures : serverEdition.specialFeatures,
      coverGradient: localEdition.coverGradient || serverEdition.coverGradient,
    };
  });

  serverEditions.forEach((edition) => mergedEditions.push(edition));

  const localSummary = localBook.work.summary?.trim();
  const localSummaryMissing = !localSummary || localSummary.toLowerCase() === 'summary unavailable.';

  return {
    ...serverBook,
    ...localBook,
    work: {
      ...serverBook.work,
      ...localBook.work,
      subtitle: preferredText(localBook.work.subtitle, serverBook.work.subtitle),
      summary: localSummaryMissing
        ? (preferredText(serverBook.work.summary, serverBook.work.publisherSummary) ?? localBook.work.summary)
        : localBook.work.summary,
      publisherSummary: preferredText(localBook.work.publisherSummary, serverBook.work.publisherSummary),
      genres: localBook.work.genres?.length ? localBook.work.genres : serverBook.work.genres,
      publicationYear: localBook.work.publicationYear || serverBook.work.publicationYear,
      originalLanguage: preferredText(localBook.work.originalLanguage, serverBook.work.originalLanguage),
      externalWorkId: preferredText(localBook.work.externalWorkId, serverBook.work.externalWorkId),
    },
    editions: mergedEditions,
    activeEditionId: mergedEditions.some((edition) => edition.id === localBook.activeEditionId)
      ? localBook.activeEditionId
      : serverBook.activeEditionId,
    importMetadataVerified: localBook.importMetadataVerified === true || serverBook.importMetadataVerified === true,
    importMetadataReviewNeeded: localBook.importMetadataReviewNeeded ?? serverBook.importMetadataReviewNeeded,
    sourceOfImport: localBook.sourceOfImport || serverBook.sourceOfImport,
  };
}

export function mergeBooksFromServer(
  current: UserBookRecord[],
  server: UserBookRecord[],
  pending: Record<string, PendingMutation<UserBookRecord>>,
): UserBookRecord[] {
  const serverById = new Map(server.map((book) => [book.id, book]));
  const merged = current.map((localBook) => {
    const serverBook = serverById.get(localBook.id);
    if (!serverBook) return localBook;
    serverById.delete(localBook.id);

    const pendingMutation = pending[localBook.id];
    if (pendingMutation?.operation === 'delete') return localBook;

    if (pendingMutation?.operation === 'upsert' && pendingMutation.data) {
      // Unsynced local intent wins. Server metadata may fill genuine gaps, but
      // never replace the pending reader-owned state.
      return mergeServerMetadataIntoBook(pendingMutation.data, serverBook);
    }

    // No local mutation is pending: the account copy is the canonical latest
    // record. Preserve only the explicitly protected reader-owned fields whose
    // dedicated merge policies are intentionally stronger than provider/cloud
    // replacement (quotes, loan state, and manual cover choices).
    const withQuotes = mergeIncomingBookQuoteState(localBook, serverBook);
    const withLoan = mergeIncomingBookLoanState(localBook, withQuotes);
    return mergeIncomingManualCoverState(localBook, withLoan);
  });

  serverById.forEach((serverBook, id) => {
    if (pending[id]?.operation !== 'delete') merged.push(serverBook);
  });

  return merged;
}
