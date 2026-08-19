import type { ReadingSession, UserBookRecord } from '../../types';

export interface LibraryIntegrityReport {
  bookCount: number;
  sessionCount: number;
  activeCoverCount: number;
  anyEditionCoverCount: number;
  missingActiveCoverCount: number;
  publisherSummaryCount: number;
  visibleSummaryCount: number;
  verifiedImportMetadataCount: number;
  importedBookCount: number;
  duplicateBookIdCount: number;
  duplicateSessionIdCount: number;
  missingActiveEditionCount: number;
  orphanSessionCount: number;
  duplicateIdentityGroupCount: number;
  healthy: boolean;
}

const normalizeText = (value?: string) =>
  value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

function countDuplicateIds(items: Array<{ id: string }>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  items.forEach((item) => {
    if (seen.has(item.id)) duplicates += 1;
    else seen.add(item.id);
  });
  return duplicates;
}

function identityKeys(book: UserBookRecord): string[] {
  const isbnKeys = (book.editions ?? [])
    .flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])
    .map(compactIsbn)
    .filter(Boolean)
    .map((isbn) => `isbn:${isbn}`);
  if (isbnKeys.length > 0) return [...new Set(isbnKeys)];

  const title = normalizeText(book.work?.title);
  const author = normalizeText(book.work?.author);
  return title && author && author !== 'unknown author'
    ? [`title-author:${title}::${author}`]
    : [];
}

export function analyzeLibraryIntegrity(
  books: UserBookRecord[],
  sessions: ReadingSession[],
): LibraryIntegrityReport {
  const bookIds = new Set(books.map((book) => book.id));
  let activeCoverCount = 0;
  let anyEditionCoverCount = 0;
  let missingActiveEditionCount = 0;
  let publisherSummaryCount = 0;
  let visibleSummaryCount = 0;
  let verifiedImportMetadataCount = 0;
  let importedBookCount = 0;

  const identityCounts = new Map<string, number>();

  books.forEach((book) => {
    const activeEdition = book.editions?.find((edition) => edition.id === book.activeEditionId);
    if (!activeEdition && (book.editions?.length ?? 0) > 0) missingActiveEditionCount += 1;
    const effectiveEdition = activeEdition ?? book.editions?.[0];
    if (effectiveEdition?.coverUrl) activeCoverCount += 1;
    if (book.editions?.some((edition) => Boolean(edition.coverUrl))) anyEditionCoverCount += 1;
    if (book.work?.publisherSummary?.trim()) publisherSummaryCount += 1;
    if (book.work?.summary?.trim() && book.work.summary.trim().toLowerCase() !== 'summary unavailable.') visibleSummaryCount += 1;
    if (book.importMetadataVerified === true) verifiedImportMetadataCount += 1;
    if (
      book.sourceOfImport?.toLowerCase().includes('import') ||
      book.privateTags?.includes('imported') ||
      book.id.startsWith('book-import-')
    ) importedBookCount += 1;

    identityKeys(book).forEach((key) => identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1));
  });

  const duplicateIdentityGroupCount = [...identityCounts.values()].filter((count) => count > 1).length;
  const duplicateBookIdCount = countDuplicateIds(books);
  const duplicateSessionIdCount = countDuplicateIds(sessions);
  const orphanSessionCount = sessions.filter((session) => !bookIds.has(session.bookId)).length;

  const healthy =
    duplicateBookIdCount === 0 &&
    duplicateSessionIdCount === 0 &&
    missingActiveEditionCount === 0 &&
    orphanSessionCount === 0;

  return {
    bookCount: books.length,
    sessionCount: sessions.length,
    activeCoverCount,
    anyEditionCoverCount,
    missingActiveCoverCount: Math.max(0, books.length - activeCoverCount),
    publisherSummaryCount,
    visibleSummaryCount,
    verifiedImportMetadataCount,
    importedBookCount,
    duplicateBookIdCount,
    duplicateSessionIdCount,
    missingActiveEditionCount,
    orphanSessionCount,
    duplicateIdentityGroupCount,
    healthy,
  };
}
