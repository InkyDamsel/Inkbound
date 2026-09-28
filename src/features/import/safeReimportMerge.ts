import type { ImportRecordItem, ReadingStatus, UserBookRecord } from '../../types';
import { replaceCanonicalLibrary } from '../library/libraryMutations';

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalizeText = (value?: string) => value?.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

function normalizedDate(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function bookIsbns(book: UserBookRecord): string[] {
  return [...new Set((book.editions ?? []).flatMap((edition) => [
    compactIsbn(edition.isbn),
    compactIsbn(edition.isbn10),
    compactIsbn(edition.isbn13),
  ]).filter(Boolean))];
}

function sameTitleAuthor(item: ImportRecordItem, book: UserBookRecord): boolean {
  const incomingTitle = normalizeText(item.title);
  const incomingAuthor = normalizeText(item.author);
  const existingTitle = normalizeText(book.work.title);
  const existingAuthor = normalizeText(book.work.author);
  return Boolean(incomingTitle && incomingAuthor && incomingTitle === existingTitle && incomingAuthor === existingAuthor);
}

export function findExistingImportMatch(item: ImportRecordItem, library: UserBookRecord[]): UserBookRecord | undefined {
  const incomingIsbn = compactIsbn(item.isbn);
  if (incomingIsbn) {
    const isbnMatch = library.find((book) => bookIsbns(book).includes(incomingIsbn));
    if (isbnMatch) return isbnMatch;
  }
  return library.find((book) => sameTitleAuthor(item, book));
}

function splitImportedList(values?: string[]): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function mergeUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  const result = [...(existing ?? [])];
  const seen = new Set(result.map((value) => value.trim().toLowerCase()));
  for (const value of incoming ?? []) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function cautiousStatus(existing: ReadingStatus, item: ImportRecordItem, hasExistingProgress: boolean): ReadingStatus {
  if (existing === item.status) return existing;
  if (existing !== 'tbr' && existing !== 'wishlist') return existing;
  if (hasExistingProgress) return existing;
  if (item.status === 'currently-reading') return 'currently-reading';
  if (item.status === 'finished' && normalizedDate(item.dateRead)) return 'finished';
  return existing;
}

function activeEditionIndex(book: UserBookRecord): number {
  const index = book.editions.findIndex((edition) => edition.id === book.activeEditionId);
  return index >= 0 ? index : 0;
}

function hasManualCover(book: UserBookRecord): boolean {
  const edition = book.editions[activeEditionIndex(book)];
  return edition?.externalSource === 'manual';
}

export function isUserSeriesSource(value?: string): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return /(^|\b)(manual|user|custom|corrected|override)(\b|$)/.test(normalized);
}

export function restoreManualSeriesOverridesFromImport(items: ImportRecordItem[], library: UserBookRecord[]): number {
  // Compatibility name retained for existing callers/tests. The retired
  // seriesOverrides store is no longer written: imported manual corrections are
  // folded directly into the canonical book work record.
  let restored = 0;

  for (const item of items) {
    if (!isUserSeriesSource(item.seriesSource) || !item.seriesName?.trim()) continue;
    const matched = item.matchedBookId
      ? library.find((book) => book.id === item.matchedBookId)
      : findExistingImportMatch(item, library);
    if (!matched || matched.work.seriesSource === 'manual') continue;

    matched.work = {
      ...matched.work,
      seriesName: item.seriesName.trim(),
      seriesOrder: typeof item.seriesOrder === 'number' && Number.isFinite(item.seriesOrder)
        ? item.seriesOrder
        : undefined,
      seriesLabel: item.seriesLabel?.trim() || undefined,
      seriesSource: 'manual',
    };
    restored += 1;
  }

  return restored;
}

export function mergeImportIntoExistingBook(existing: UserBookRecord, item: ImportRecordItem): UserBookRecord {
  const incomingDateFinished = normalizedDate(item.dateRead);
  const hasProgress = existing.progressPages > 0 || existing.progressMinutes > 0 || existing.progressPercentage > 0 || Boolean(existing.dateStarted || existing.lastSessionDate);
  const status = cautiousStatus(existing.status, item, hasProgress);
  const editions = existing.editions.map((edition) => ({ ...edition }));
  const activeIndex = activeEditionIndex(existing);
  const activeEdition = editions[activeIndex];

  if (activeEdition) {
    if (!activeEdition.isbn && item.isbn) activeEdition.isbn = item.isbn;
    if (!activeEdition.isbn10 && compactIsbn(item.isbn).length === 10) activeEdition.isbn10 = compactIsbn(item.isbn);
    if (!activeEdition.isbn13 && compactIsbn(item.isbn).length === 13) activeEdition.isbn13 = compactIsbn(item.isbn);
    if (!activeEdition.pageCount && item.pageCount) activeEdition.pageCount = item.pageCount;
    if (!activeEdition.coverUrl && item.coverUrl && !hasManualCover(existing)) activeEdition.coverUrl = item.coverUrl;
  }

  const shelfTags = splitImportedList(item.sourceShelves);
  const importedTags = mergeUnique(splitImportedList(item.tags), shelfTags);
  const sourceCollections = splitImportedList(item.sourceCollections);
  const optionalShelfCollections = item.importShelvesAsCollections ? shelfTags : [];

  return {
    ...existing,
    work: {
      ...existing.work,
      title: existing.work.title?.trim() ? existing.work.title : item.title,
      author: existing.work.author?.trim() && normalizeText(existing.work.author) !== 'unknown author' ? existing.work.author : item.author,
      seriesName: existing.work.seriesName?.trim() ? existing.work.seriesName : item.seriesName,
      seriesOrder: existing.work.seriesOrder ?? item.seriesOrder,
      seriesLabel: existing.work.seriesLabel ?? (isUserSeriesSource(item.seriesSource) ? item.seriesLabel?.trim() || undefined : undefined),
      seriesSource: existing.work.seriesSource ?? (isUserSeriesSource(item.seriesSource) && item.seriesName?.trim() ? 'manual' : item.seriesName?.trim() ? 'metadata' : undefined),
    },
    editions,
    status,
    rating: existing.rating ?? item.rating,
    review: existing.review?.trim() ? existing.review : item.review,
    privateTags: mergeUnique(existing.privateTags, importedTags),
    collections: mergeUnique(existing.collections, [...sourceCollections, ...optionalShelfCollections]),
    dateFinished: existing.dateFinished || (status === 'finished' ? incomingDateFinished : undefined),
    importFinishedDateProvided: existing.importFinishedDateProvided || Boolean(existing.dateFinished || incomingDateFinished),
  };
}

export function applyImportExtrasToNewBook(book: UserBookRecord, item: ImportRecordItem): UserBookRecord {
  const shelfTags = splitImportedList(item.sourceShelves);
  const importedTags = mergeUnique(splitImportedList(item.tags), shelfTags);
  const sourceCollections = splitImportedList(item.sourceCollections);
  const optionalShelfCollections = item.importShelvesAsCollections ? shelfTags : [];
  return {
    ...book,
    work: {
      ...book.work,
      seriesName: book.work.seriesName?.trim() ? book.work.seriesName : item.seriesName,
      seriesOrder: book.work.seriesOrder ?? item.seriesOrder,
      seriesLabel: book.work.seriesLabel ?? (isUserSeriesSource(item.seriesSource) ? item.seriesLabel?.trim() || undefined : undefined),
      seriesSource: book.work.seriesSource ?? (isUserSeriesSource(item.seriesSource) && item.seriesName?.trim() ? 'manual' : item.seriesName?.trim() ? 'metadata' : undefined),
    },
    privateTags: mergeUnique(book.privateTags, importedTags),
    collections: mergeUnique(book.collections, [...sourceCollections, ...optionalShelfCollections]),
  };
}

export function applySafeReimportUpdates(items: ImportRecordItem[], library: UserBookRecord[]): { updatedCount: number; seriesRestored: number } {
  const mergeItems = items.filter((item) => item.duplicateAction === 'merge');
  if (mergeItems.length === 0) return { updatedCount: 0, seriesRestored: 0 };

  const byBookId = new Map<string, ImportRecordItem>();
  for (const item of mergeItems) {
    const matched = item.matchedBookId
      ? library.find((book) => book.id === item.matchedBookId)
      : findExistingImportMatch(item, library);
    if (matched) byBookId.set(matched.id, item);
  }

  if (byBookId.size === 0) return { updatedCount: 0, seriesRestored: 0 };

  const updatedLibrary = library.map((book) => {
    const item = byBookId.get(book.id);
    return item ? mergeImportIntoExistingBook(book, item) : book;
  });
  const seriesRestored = restoreManualSeriesOverridesFromImport(mergeItems, updatedLibrary);
  replaceCanonicalLibrary(updatedLibrary);
  return { updatedCount: byBookId.size, seriesRestored };
}
