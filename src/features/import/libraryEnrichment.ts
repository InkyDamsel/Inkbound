import type {
  ImportRecordItem,
  UserBookRecord,
} from '../../types';
import { searchGoogleBooks } from '../book-search/data/googleBooksApi';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';

export const IMPORT_ENRICHMENT_QUEUE_KEY = 'inkbound_import_enrichment_queue_v3';
export const IMPORT_ENRICHMENT_CONCURRENCY = 3;
export const IMPORT_ENRICHMENT_BATCH_SIZE = 12;

const BOOKS_STORAGE_KEY = 'inkbound_books';
const LEGACY_BOOKS_STORAGE_KEY = 'bookhaven_books';
const importSearchCache = new Map<string, Promise<BookSearchWorkGroup[]>>();

export interface ImportEnrichmentQueueItem extends ImportRecordItem {
  targetBookId: string;
  attempts?: number;
  lastAttemptAt?: string;
}

export interface ImportEnrichmentResult {
  item: ImportEnrichmentQueueItem;
  enriched?: UserBookRecord;
  foundCover: boolean;
  foundSummary: boolean;
  success: boolean;
}

export interface ImportVerificationSummary {
  verified: ImportRecordItem[];
  unmatched: ImportRecordItem[];
  duplicates: ImportRecordItem[];
}

export interface ImportDuplicateAnalysis {
  unique: ImportRecordItem[];
  duplicates: ImportRecordItem[];
}

export function readImportEnrichmentQueue(): ImportEnrichmentQueueItem[] {
  try {
    const stored = localStorage.getItem(IMPORT_ENRICHMENT_QUEUE_KEY);
    return stored ? (JSON.parse(stored) as ImportEnrichmentQueueItem[]) : [];
  } catch {
    return [];
  }
}

export function writeImportEnrichmentQueue(items: ImportEnrichmentQueueItem[]) {
  try {
    if (items.length === 0) {
      localStorage.removeItem(IMPORT_ENRICHMENT_QUEUE_KEY);
      return;
    }
    localStorage.setItem(IMPORT_ENRICHMENT_QUEUE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn('Inkbound could not persist the full enrichment queue on this device.', error);
  }
}

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalizeText = (value?: string) => value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const authorSurname = (value?: string) => normalizeText(value).split(' ').filter(Boolean).at(-1) ?? '';

function normalizeTitleCore(value?: string): string {
  if (!value) return '';
  const withoutParentheticalSeries = value
    .replace(/\([^)]*(?:#\s*\d+|book\s*\d+|series|volume\s*\d+|vol\.?\s*\d+)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*(?:#\s*\d+|book\s*\d+|series|volume\s*\d+|vol\.?\s*\d+)[^\]]*\]/gi, ' ');
  const withoutSeriesSuffix = withoutParentheticalSeries.replace(
    /\s*[:\-–—]\s*[^:–—-]*(?:#\s*\d+|book\s*\d+|series|volume\s*\d+|vol\.?\s*\d+).*$/gi,
    ' ',
  );
  return normalizeText(withoutSeriesSuffix);
}

function authorMatches(importAuthor?: string, candidateAuthor?: string): boolean {
  const wanted = normalizeText(importAuthor);
  const candidate = normalizeText(candidateAuthor);
  if (!wanted || !candidate || wanted === 'unknown author' || candidate === 'unknown author') return false;
  if (wanted === candidate) return true;

  const wantedParts = wanted.split(' ').filter(Boolean);
  const candidateParts = candidate.split(' ').filter(Boolean);
  if (wantedParts.length === 0 || candidateParts.length === 0) return false;
  if (wantedParts.at(-1) !== candidateParts.at(-1)) return false;

  const wantedFirst = wantedParts[0];
  const candidateFirst = candidateParts[0];
  return Boolean(wantedFirst && candidateFirst && wantedFirst[0] === candidateFirst[0]);
}

function titleSimilarity(importTitle?: string, candidateTitle?: string): number {
  const wanted = normalizeText(importTitle);
  const candidate = normalizeText(candidateTitle);
  if (!wanted || !candidate) return 0;
  if (wanted === candidate) return 1;

  const wantedCore = normalizeTitleCore(importTitle);
  const candidateCore = normalizeTitleCore(candidateTitle);
  if (wantedCore && wantedCore === candidateCore) return 0.98;

  const wantedTokens = [...new Set((wantedCore || wanted).split(' ').filter(Boolean))];
  const candidateTokens = [...new Set((candidateCore || candidate).split(' ').filter(Boolean))];
  if (wantedTokens.length === 0 || candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const intersection = wantedTokens.filter((token) => candidateSet.has(token)).length;
  const smaller = Math.min(wantedTokens.length, candidateTokens.length);
  const larger = Math.max(wantedTokens.length, candidateTokens.length);
  const containment = intersection / smaller;
  const coverage = intersection / larger;

  if (smaller === 1 && containment === 1 && coverage >= 0.5) return 0.9;
  if (containment === 1 && coverage >= 0.66) return 0.94;
  if (containment >= 0.85 && coverage >= 0.72) return 0.9;
  if (containment >= 0.75 && coverage >= 0.7) return 0.84;
  return Math.min(containment, coverage);
}

function readCurrentLibrary(): UserBookRecord[] {
  try {
    const stored = localStorage.getItem(BOOKS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_BOOKS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as UserBookRecord[]) : [];
  } catch {
    return [];
  }
}

function recordIdentifiers(item: ImportRecordItem): string[] {
  const isbn = compactIsbn(item.isbn);
  return isbn ? [isbn] : [];
}

function bookIdentifiers(book: UserBookRecord): string[] {
  return [...new Set(book.editions.flatMap((edition) => [
    compactIsbn(edition.isbn13),
    compactIsbn(edition.isbn10),
    compactIsbn(edition.isbn),
  ]).filter(Boolean))];
}

function titleAuthorKey(title?: string, author?: string): string {
  const normalizedTitle = normalizeText(title);
  const normalizedAuthor = normalizeText(author);
  if (!normalizedTitle || !normalizedAuthor || normalizedAuthor === 'unknown author') return '';
  return `${normalizedTitle}::${normalizedAuthor}`;
}

function isSameBookIdentity(item: ImportRecordItem, book: UserBookRecord): boolean {
  const incomingIsbns = recordIdentifiers(item);
  const existingIsbns = bookIdentifiers(book);
  if (incomingIsbns.length > 0 && incomingIsbns.some((isbn) => existingIsbns.includes(isbn))) return true;

  const incomingKey = titleAuthorKey(item.title, item.author);
  const existingKey = titleAuthorKey(book.work.title, book.work.author);
  return Boolean(incomingKey && existingKey && incomingKey === existingKey);
}

export function analyzeImportDuplicates(items: ImportRecordItem[]): ImportDuplicateAnalysis {
  const library = readCurrentLibrary();
  const unique: ImportRecordItem[] = [];
  const duplicates: ImportRecordItem[] = [];
  const seenIsbns = new Set<string>();
  const seenTitleAuthors = new Set<string>();

  for (const item of items) {
    const isbn = compactIsbn(item.isbn);
    const key = titleAuthorKey(item.title, item.author);
    const matchesExistingLibrary = library.some((book) => isSameBookIdentity(item, book));
    const matchesCurrentBatch = Boolean((isbn && seenIsbns.has(isbn)) || (key && seenTitleAuthors.has(key)));

    if (matchesExistingLibrary || matchesCurrentBatch) {
      duplicates.push({ ...item, duplicateAction: 'skip' });
      continue;
    }

    unique.push(item);
    if (isbn) seenIsbns.add(isbn);
    if (key) seenTitleAuthors.add(key);
  }

  return { unique, duplicates };
}

async function searchImportedBookMetadata(query: string): Promise<BookSearchWorkGroup[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const cached = importSearchCache.get(normalizedQuery);
  if (cached) return cached;

  const request = searchGoogleBooks(query)
    .then((response) => response.groups)
    .catch((error) => {
      importSearchCache.delete(normalizedQuery);
      throw error;
    });
  importSearchCache.set(normalizedQuery, request);
  return request;
}

function groupHasExactIsbn(work: BookSearchWorkGroup, requestedIsbn: string): boolean {
  if (!requestedIsbn) return false;
  return work.editions.some((edition) =>
    compactIsbn(edition.isbn13) === requestedIsbn || compactIsbn(edition.isbn10) === requestedIsbn,
  );
}

function isHighConfidenceTitleAuthorMatch(item: ImportRecordItem, work: BookSearchWorkGroup): boolean {
  if (!work.authors.some((author) => authorMatches(item.author, author))) return false;
  return titleSimilarity(item.title, work.title) >= 0.84;
}

function isVerifiedWork(item: ImportRecordItem, work: BookSearchWorkGroup): boolean {
  const requestedIsbn = compactIsbn(item.isbn);
  if (requestedIsbn && groupHasExactIsbn(work, requestedIsbn)) return true;
  return isHighConfidenceTitleAuthorMatch(item, work);
}

function chooseImportedEdition(
  item: ImportRecordItem,
  groups: BookSearchWorkGroup[],
): { work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition } {
  const verifiedGroups = groups
    .filter((work) => isVerifiedWork(item, work))
    .sort((a, b) => {
      const aIsbn = compactIsbn(item.isbn) && groupHasExactIsbn(a, compactIsbn(item.isbn)) ? 1 : 0;
      const bIsbn = compactIsbn(item.isbn) && groupHasExactIsbn(b, compactIsbn(item.isbn)) ? 1 : 0;
      if (aIsbn !== bIsbn) return bIsbn - aIsbn;
      return titleSimilarity(item.title, b.title) - titleSimilarity(item.title, a.title);
    });
  const requestedIsbn = compactIsbn(item.isbn);

  const exactIsbnCandidates = requestedIsbn
    ? verifiedGroups.flatMap((work) =>
        work.editions
          .filter((edition) =>
            compactIsbn(edition.isbn13) === requestedIsbn || compactIsbn(edition.isbn10) === requestedIsbn,
          )
          .map((edition) => ({ work, edition })),
      )
    : [];

  const workCandidates = verifiedGroups.flatMap((work) =>
    work.editions.map((edition) => ({ work, edition })),
  );

  let selected = exactIsbnCandidates.find(({ edition }) => edition.format === item.format);
  selected ??= exactIsbnCandidates[0];
  selected ??= workCandidates.find(({ edition }) => edition.format === item.format && Boolean(edition.coverUrl));
  selected ??= workCandidates.find(({ edition }) => Boolean(edition.coverUrl));
  selected ??= workCandidates[0];
  if (!selected) return {};

  const coverEdition = selected.edition.coverUrl
    ? selected.edition
    : selected.work.editions.find((edition) => Boolean(edition.coverUrl));

  return { work: selected.work, edition: selected.edition, coverEdition };
}

async function findBestImportedMetadata(
  item: ImportRecordItem,
): Promise<{ work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition }> {
  const isbn = item.isbn?.trim();
  if (isbn) {
    const isbnGroups = await searchImportedBookMetadata(isbn);
    const isbnMatch = chooseImportedEdition(item, isbnGroups);
    if (isbnMatch.work && isbnMatch.edition) return isbnMatch;
  }

  if (!item.title.trim() || !item.author.trim() || normalizeText(item.author) === 'unknown author') return {};

  // Search the title first. The shared provider layer already fans this out to
  // Google Books, Open Library, and Hardcover. If the title-only pass misses,
  // use narrower fallbacks before giving up. This avoids requiring providers to
  // format title + series text exactly like the import source.
  const titleGroups = await searchImportedBookMetadata(item.title);
  const titleMatch = chooseImportedEdition(item, titleGroups);
  if (titleMatch.work && titleMatch.edition) return titleMatch;

  const combinedGroups = await searchImportedBookMetadata(`${item.title} ${item.author}`);
  const combinedMatch = chooseImportedEdition(item, combinedGroups);
  if (combinedMatch.work && combinedMatch.edition) return combinedMatch;

  const authorGroups = await searchImportedBookMetadata(item.author);
  return chooseImportedEdition(item, authorGroups);
}

async function canVerifyImportedBook(item: ImportRecordItem): Promise<boolean> {
  try {
    const match = await findBestImportedMetadata(item);
    return Boolean(match.work && match.edition);
  } catch {
    return false;
  }
}

export async function verifyImportRecords(
  items: ImportRecordItem[],
  onProgress?: (completed: number, total: number) => void,
): Promise<ImportVerificationSummary> {
  const { unique, duplicates } = analyzeImportDuplicates(items);
  const verifiedFlags = new Array<boolean>(unique.length).fill(false);
  let nextIndex = 0;
  let completed = 0;

  if (unique.length === 0) {
    onProgress?.(items.length, items.length);
    return { verified: [], unmatched: [], duplicates };
  }

  const worker = async () => {
    while (nextIndex < unique.length) {
      const index = nextIndex;
      nextIndex += 1;
      verifiedFlags[index] = await canVerifyImportedBook(unique[index]);
      completed += 1;
      onProgress?.(completed + duplicates.length, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IMPORT_ENRICHMENT_CONCURRENCY, unique.length) }, () => worker()),
  );

  return {
    verified: unique.filter((_, index) => verifiedFlags[index]),
    unmatched: unique.filter((_, index) => !verifiedFlags[index]),
    duplicates,
  };
}

export function createFallbackImportedBook(item: ImportRecordItem): UserBookRecord {
  const editionId = `edition-import-${item.id}`;
  return {
    id: `book-import-${item.id}`,
    work: {
      id: `work-import-${item.id}`,
      title: item.title,
      author: item.author,
      summary: 'Summary unavailable.',
      personalSummary: item.review?.trim() || undefined,
      genres: [],
      publicationYear: item.dateRead ? Number(item.dateRead.slice(0, 4)) || new Date().getFullYear() : new Date().getFullYear(),
    },
    activeEditionId: editionId,
    editions: [{
      id: editionId,
      format: item.format,
      isbn: item.isbn,
      isbn13: compactIsbn(item.isbn).length === 13 ? compactIsbn(item.isbn) : undefined,
      isbn10: compactIsbn(item.isbn).length === 10 ? compactIsbn(item.isbn) : undefined,
      coverGradient: item.coverGradient,
      externalSource: 'import',
    }],
    status: item.status,
    ownership: 'owned',
    progressPages: 0,
    progressMinutes: 0,
    progressPercentage: item.status === 'finished' ? 100 : 0,
    rating: item.rating,
    review: item.review,
    favoriteQuotes: [],
    privateTags: ['imported'],
    priority: 'medium',
    moods: [],
    collections: [],
    sourceOfImport: 'Library import',
    importMetadataVerified: false,
    importMetadataReviewNeeded: false,
    dateAdded: item.dateAdded,
    dateFinished: item.dateRead,
  };
}

function createUnmatchedCleanupRecord(item: ImportEnrichmentQueueItem): UserBookRecord {
  const editionId = `edition-import-${item.id}`;
  const normalizedIsbn = compactIsbn(item.isbn);
  return {
    id: item.targetBookId,
    work: {
      id: `work-import-${item.id}`,
      title: item.title,
      author: item.author,
      summary: 'Summary unavailable.',
      personalSummary: item.review?.trim() || undefined,
      genres: [],
      publicationYear: item.dateRead ? Number(item.dateRead.slice(0, 4)) || new Date().getFullYear() : new Date().getFullYear(),
    },
    activeEditionId: editionId,
    editions: [{
      id: editionId,
      format: item.format,
      isbn: item.isbn,
      isbn10: normalizedIsbn.length === 10 ? normalizedIsbn : undefined,
      isbn13: normalizedIsbn.length === 13 ? normalizedIsbn : undefined,
      coverGradient: item.coverGradient,
      externalSource: 'import',
    }],
    status: item.status,
    ownership: 'owned',
    progressPages: 0,
    progressMinutes: 0,
    progressPercentage: item.status === 'finished' ? 100 : 0,
    rating: item.rating,
    review: item.review,
    favoriteQuotes: [],
    privateTags: ['imported'],
    priority: 'medium',
    moods: [],
    collections: [],
    sourceOfImport: 'Library import - metadata needs review',
    importMetadataVerified: false,
    importMetadataReviewNeeded: true,
    dateAdded: item.dateAdded,
    dateFinished: item.dateRead,
  };
}

async function enrichImportedBook(item: ImportEnrichmentQueueItem): Promise<ImportEnrichmentResult> {
  try {
    const { work, edition, coverEdition } = await findBestImportedMetadata(item);
    if (!work || !edition) {
      return {
        item,
        enriched: createUnmatchedCleanupRecord(item),
        foundCover: false,
        foundSummary: false,
        success: true,
      };
    }

    const publisherSummary = work.publisherSummary?.trim();
    const coverUrl = coverEdition?.coverUrl;
    const editionId = `edition-enriched-${item.id}`;
    const pageCount = edition.pageCount;
    const enriched: UserBookRecord = {
      id: item.targetBookId,
      work: {
        id: `work-enriched-${item.id}`,
        title: item.title,
        subtitle: work.subtitle,
        author: item.author,
        summary: publisherSummary || 'Summary unavailable.',
        publisherSummary: publisherSummary || undefined,
        personalSummary: item.review?.trim() || undefined,
        genres: work.genres,
        publicationYear: edition.publicationYear || new Date().getFullYear(),
        originalLanguage: edition.language,
        externalWorkId: work.key,
      },
      activeEditionId: editionId,
      editions: [{
        id: editionId,
        format: item.format,
        isbn: item.isbn || edition.isbn13 || edition.isbn10,
        isbn10: compactIsbn(item.isbn).length === 10 ? compactIsbn(item.isbn) : edition.isbn10,
        isbn13: compactIsbn(item.isbn).length === 13 ? compactIsbn(item.isbn) : edition.isbn13,
        pageCount,
        publisher: edition.publisher,
        publicationDate: edition.publicationDate,
        coverGradient: item.coverGradient,
        coverUrl,
        language: edition.language,
        editionName: edition.editionName,
        binding: edition.binding,
        specialFeatures: edition.specialFeatures,
        externalSource: edition.source,
        externalEditionId: edition.externalEditionId,
      }],
      status: item.status,
      ownership: 'owned',
      progressPages: item.status === 'finished' ? pageCount ?? 0 : 0,
      progressMinutes: 0,
      progressPercentage: item.status === 'finished' ? 100 : 0,
      rating: item.rating,
      review: item.review,
      favoriteQuotes: [],
      privateTags: ['imported'],
      priority: 'medium',
      moods: [],
      collections: [],
      sourceOfImport: 'Library import + verified metadata',
      importMetadataVerified: true,
      importMetadataReviewNeeded: false,
      dateAdded: item.dateAdded,
      dateFinished: item.dateRead,
    };

    return {
      item,
      enriched,
      foundCover: Boolean(coverUrl),
      foundSummary: Boolean(publisherSummary),
      success: true,
    };
  } catch {
    return { item, foundCover: false, foundSummary: false, success: false };
  }
}

export async function enrichImportedBooks(items: ImportEnrichmentQueueItem[]): Promise<ImportEnrichmentResult[]> {
  const results = new Array<ImportEnrichmentResult>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await enrichImportedBook(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IMPORT_ENRICHMENT_CONCURRENCY, items.length) }, () => worker()),
  );
  return results;
}

export function mergeEnrichedImportedBook(current: UserBookRecord, enriched: UserBookRecord): UserBookRecord {
  const activeEdition = current.editions.find((edition) => edition.id === current.activeEditionId) ?? current.editions[0];

  if (enriched.importMetadataReviewNeeded) {
    const cleanedEdition = activeEdition
      ? {
          id: activeEdition.id,
          format: activeEdition.format,
          isbn: activeEdition.isbn,
          isbn10: activeEdition.isbn10,
          isbn13: activeEdition.isbn13,
          coverGradient: activeEdition.coverGradient,
          externalSource: 'import' as const,
        }
      : enriched.editions[0];

    return {
      ...current,
      work: {
        ...current.work,
        subtitle: undefined,
        summary: 'Summary unavailable.',
        publisherSummary: undefined,
        genres: [],
        originalLanguage: undefined,
        externalWorkId: undefined,
      },
      editions: current.editions.map((edition) =>
        edition.id === current.activeEditionId && cleanedEdition ? cleanedEdition : edition,
      ),
      sourceOfImport: 'Library import - metadata needs review',
      importMetadataVerified: false,
      importMetadataReviewNeeded: true,
    };
  }

  const enrichedEdition = enriched.editions[0];
  const mergedActiveEdition = activeEdition
    ? {
        ...activeEdition,
        ...enrichedEdition,
        id: activeEdition.id,
        format: activeEdition.format,
        coverGradient: activeEdition.coverGradient,
        coverUrl: enrichedEdition?.coverUrl,
        isbn: activeEdition.isbn || enrichedEdition?.isbn,
        isbn10: activeEdition.isbn10 || enrichedEdition?.isbn10,
        isbn13: activeEdition.isbn13 || enrichedEdition?.isbn13,
      }
    : enrichedEdition;

  return {
    ...current,
    work: {
      ...current.work,
      subtitle: current.work.subtitle || enriched.work.subtitle,
      summary: enriched.work.publisherSummary || current.work.publisherSummary || current.work.summary || 'Summary unavailable.',
      publisherSummary: enriched.work.publisherSummary || current.work.publisherSummary,
      personalSummary: current.work.personalSummary || enriched.work.personalSummary,
      genres: current.work.genres.length > 0 ? current.work.genres : enriched.work.genres,
      publicationYear: current.work.publicationYear || enriched.work.publicationYear,
      originalLanguage: current.work.originalLanguage || enriched.work.originalLanguage,
      externalWorkId: enriched.work.externalWorkId,
    },
    editions: current.editions.map((edition) =>
      edition.id === current.activeEditionId && mergedActiveEdition ? mergedActiveEdition : edition,
    ),
    sourceOfImport: 'Library import + verified metadata',
    importMetadataVerified: true,
    importMetadataReviewNeeded: false,
  };
}

function needsPublisherSummary(book: UserBookRecord): boolean {
  const summary = book.work.publisherSummary?.trim();
  if (summary) return false;
  const visibleSummary = book.work.summary?.trim().toLowerCase() ?? '';
  return !visibleSummary || visibleSummary === 'summary unavailable.' || visibleSummary.startsWith('no publisher description');
}

function needsCover(book: UserBookRecord): boolean {
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  return !activeEdition?.coverUrl;
}

function isImportedBook(book: UserBookRecord): boolean {
  return Boolean(
    book.sourceOfImport?.toLowerCase().includes('import') ||
    book.privateTags?.includes('imported') ||
    book.id.startsWith('book-import-'),
  );
}

export function buildRepairQueueItems(
  books: UserBookRecord[],
  existingQueue: ImportEnrichmentQueueItem[],
): ImportEnrichmentQueueItem[] {
  const byBookId = new Map(existingQueue.map((item) => [item.targetBookId, item]));

  books.forEach((book) => {
    if (!isImportedBook(book)) return;
    if (book.importMetadataReviewNeeded) {
      byBookId.delete(book.id);
      return;
    }

    const mustVerifyLegacyMetadata = book.importMetadataVerified !== true;
    if (!mustVerifyLegacyMetadata && !needsCover(book) && !needsPublisherSummary(book)) {
      byBookId.delete(book.id);
      return;
    }
    if (byBookId.has(book.id)) return;

    const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
    const sourceItemId = book.id.startsWith('book-import-') ? book.id.slice('book-import-'.length) : `repair-${book.id}`;
    byBookId.set(book.id, {
      id: sourceItemId,
      targetBookId: book.id,
      title: book.work.title,
      author: book.work.author,
      isbn: activeEdition?.isbn13 || activeEdition?.isbn10 || activeEdition?.isbn,
      format: activeEdition?.format || 'hardcover',
      status: book.status,
      rating: book.rating,
      dateRead: book.dateFinished,
      dateAdded: book.dateAdded,
      review: book.review,
      confidence: 100,
      duplicateAction: 'merge',
      coverGradient: activeEdition?.coverGradient || 'from-[#5c3d62] via-[#35243f] to-[#171117]',
      attempts: 0,
    });
  });

  return [...byBookId.values()];
}

export function queueImportedItems(items: ImportRecordItem[]): ImportEnrichmentQueueItem[] {
  return items.map((item) => ({
    ...item,
    targetBookId: `book-import-${item.id}`,
    attempts: 0,
  }));
}
