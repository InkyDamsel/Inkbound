import type { ImportRecordItem, ReadingStatus, UserBookRecord } from '../../types';
import { readSeriesOverrides, SERIES_OVERRIDES_STORAGE_KEY, makeSeriesOverrideId, type SeriesOverrides } from '../series/seriesOverrides';
import { writeRuntimeJson } from '../../platform/runtimeStorage';

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
  const manualItems = items.filter((item) => isUserSeriesSource(item.seriesSource) && item.seriesName?.trim());
  if (manualItems.length === 0) return 0;

  const current = readSeriesOverrides();
  const next: SeriesOverrides = Object.fromEntries(
    Object.entries(current).map(([key, value]) => [key, { ...value, books: value.books.map((book) => ({ ...book })) }]),
  );
  const alreadyManuallyAssigned = new Set(Object.values(current).flatMap((override) => override.books.map((book) => book.bookId)));
  const now = new Date().toISOString();
  let restored = 0;

  for (const item of manualItems) {
    const matched = item.matchedBookId
      ? library.find((book) => book.id === item.matchedBookId)
      : findExistingImportMatch(item, library);
    if (!matched || alreadyManuallyAssigned.has(matched.id)) continue;

    const seriesName = item.seriesName!.trim();
    const author = matched.work.author?.trim() || item.author.trim() || 'Unknown Author';
    const overrideId = makeSeriesOverrideId(seriesName, author);
    const existingOverride = next[overrideId];
    const bookEntry = {
      bookId: matched.id,
      position: typeof item.seriesOrder === 'number' && Number.isFinite(item.seriesOrder) ? item.seriesOrder : null,
      ...(item.seriesLabel?.trim() ? { label: item.seriesLabel.trim() } : {}),
    };

    if (existingOverride) {
      if (existingOverride.books.some((book) => book.bookId === matched.id)) continue;
      existingOverride.books.push(bookEntry);
      existingOverride.updatedAt = now;
    } else {
      next[overrideId] = {
        id: overrideId,
        name: seriesName,
        author,
        books: [bookEntry],
        createdAt: now,
        updatedAt: now,
      };
    }

    alreadyManuallyAssigned.add(matched.id);
    restored += 1;
  }

  if (restored > 0) writeRuntimeJson(SERIES_OVERRIDES_STORAGE_KEY, next);
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
    },
    privateTags: mergeUnique(book.privateTags, importedTags),
    collections: mergeUnique(book.collections, [...sourceCollections, ...optionalShelfCollections]),
  };
}
