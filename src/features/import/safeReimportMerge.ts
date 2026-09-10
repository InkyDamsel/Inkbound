import type { ImportRecordItem, ReadingStatus, UserBookRecord } from '../../types';

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalizeText = (value?: string) => value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

function normalizedDate(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const canonical = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (canonical) return trimmed;
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
    privateTags: mergeUnique(book.privateTags, importedTags),
    collections: mergeUnique(book.collections, [...sourceCollections, ...optionalShelfCollections]),
  };
}
