import type {
  ImportRecordItem,
  UserBookRecord,
} from '../../types';
import { getRuntimeStorage, removeRuntimeValue, writeRuntimeJson } from '../../platform/runtimeStorage';
import { searchGoogleBooks } from '../book-search/data/googleBooksApi';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { LEGACY_SYNC_STORAGE_KEYS, SYNC_STORAGE_KEYS } from '../sync/storageKeys';

export const IMPORT_ENRICHMENT_QUEUE_KEY = SYNC_STORAGE_KEYS.importEnrichmentQueue;
export const IMPORT_ENRICHMENT_CONCURRENCY = 2;
export const IMPORT_ENRICHMENT_BATCH_SIZE = 1;

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const LEGACY_BOOKS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.books;
const IMPORT_SEARCH_TIMEOUT_MS = 3000;
const IMPORT_BOOK_TIMEOUT_MS = 9000;
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
    const stored = getRuntimeStorage().getItem(IMPORT_ENRICHMENT_QUEUE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed as ImportEnrichmentQueueItem[] : [];
  } catch {
    return [];
  }
}

export function writeImportEnrichmentQueue(items: ImportEnrichmentQueueItem[]) {
  try {
    if (items.length === 0) {
      removeRuntimeValue(IMPORT_ENRICHMENT_QUEUE_KEY);
      return;
    }
    writeRuntimeJson(IMPORT_ENRICHMENT_QUEUE_KEY, items);
  } catch (error) {
    console.warn('Inkbound could not persist the full enrichment queue on this device.', error);
  }
}

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalizeText = (value?: string) => value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

function normalizeImportDate(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const canonical = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (canonical) {
    const year = Number(canonical[1]);
    const month = Number(canonical[2]);
    const day = Number(canonical[3]);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) return trimmed;
    return undefined;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function stripImportTitleNoise(value?: string): string {
  if (!value) return '';
  return value
    .replace(/\([^)]*(?:#\s*\d+|book\s*\d+|series|volume\s*\d+|vol\.?\s*\d+|kindle|audible|ebook|audiobook|edition|boxed?\s*set|collection)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*(?:#\s*\d+|book\s*\d+|series|volume\s*\d+|vol\.?\s*\d+|kindle|audible|ebook|audiobook|edition|boxed?\s*set|collection)[^\]]*\]/gi, ' ')
    .replace(/\b(?:kindle|audible|ebook|e-book|audiobook|audio book)\s+edition\b/gi, ' ')
    .replace(/\b(?:book|volume|vol\.?|part)\s*#?\s*\d+(?:\.\d+)?\b/gi, ' ')
    .replace(/\b(?:boxed?\s*set|omnibus|complete\s+series|collection)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleCore(value?: string): string {
  const cleaned = stripImportTitleNoise(value);
  if (!cleaned) return '';
  return normalizeText(
    cleaned
      .replace(/\s*[:\-–—]\s*[^:–—-]*(?:#\s*\d+|book\s*\d+|series|volume\s*\d+|vol\.?\s*\d+).*$/gi, ' '),
  );
}

function titleSearchVariants(value?: string): string[] {
  const raw = value?.trim() ?? '';
  if (!raw) return [];
  const cleaned = stripImportTitleNoise(raw);
  const beforeSubtitle = cleaned.split(/\s*[:–—]\s*/)[0]?.trim() ?? '';
  const normalizedCore = normalizeTitleCore(raw);
  return [...new Set([raw, cleaned, beforeSubtitle, normalizedCore].filter(Boolean))];
}

function authorSearchVariants(value?: string): string[] {
  const raw = value?.trim() ?? '';
  const normalized = normalizeText(raw);
  if (!raw || !normalized || normalized === 'unknown author') return [];
  const parts = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const surname = parts.at(-1) ?? '';
  const first = parts[0] ?? '';
  const noMiddle = parts.length > 2 ? `${first} ${surname}` : raw;
  const initials = parts.length > 1
    ? `${parts.slice(0, -1).map((part) => part[0]).filter(Boolean).join(' ')} ${surname}`.trim()
    : '';
  return [...new Set([raw, noMiddle, initials].filter(Boolean))];
}

function authorMatches(importAuthor?: string, candidateAuthor?: string): boolean {
  const wanted = normalizeText(importAuthor);
  const candidate = normalizeText(candidateAuthor);
  if (!wanted || !candidate || wanted === 'unknown author' || candidate === 'unknown author') return false;
  if (wanted === candidate || wanted.includes(candidate) || candidate.includes(wanted)) return true;

  const wantedParts = wanted.split(' ').filter(Boolean);
  const candidateParts = candidate.split(' ').filter(Boolean);
  if (wantedParts.length === 0 || candidateParts.length === 0) return false;
  if (wantedParts.at(-1) !== candidateParts.at(-1)) return false;

  const wantedFirst = wantedParts[0];
  const candidateFirst = candidateParts[0];
  return Boolean(wantedFirst && candidateFirst && wantedFirst[0] === candidateFirst[0]);
}

function authorSimilarity(importAuthor?: string, candidateAuthor?: string): number {
  const wanted = normalizeText(importAuthor);
  const candidate = normalizeText(candidateAuthor);
  if (!wanted || !candidate || wanted === 'unknown author' || candidate === 'unknown author') return 0;
  if (wanted === candidate) return 1;
  if (wanted.includes(candidate) || candidate.includes(wanted)) return 0.94;
  if (authorMatches(importAuthor, candidateAuthor)) return 0.86;
  const wantedParts = wanted.split(' ').filter(Boolean);
  const candidateParts = candidate.split(' ').filter(Boolean);
  if (wantedParts.at(-1) && wantedParts.at(-1) === candidateParts.at(-1)) return 0.55;
  return 0;
}

function titleSimilarity(importTitle?: string, candidateTitle?: string): number {
  const wanted = normalizeText(importTitle);
  const candidate = normalizeText(candidateTitle);
  if (!wanted || !candidate) return 0;
  if (wanted === candidate) return 1;

  const wantedCore = normalizeTitleCore(importTitle);
  const candidateCore = normalizeTitleCore(candidateTitle);
  if (wantedCore && candidateCore && wantedCore === candidateCore) return 0.99;
  if (wantedCore && candidateCore && (wantedCore.includes(candidateCore) || candidateCore.includes(wantedCore))) return 0.92;

  const wantedTokens = [...new Set((wantedCore || wanted).split(' ').filter(Boolean))];
  const candidateTokens = [...new Set((candidateCore || candidate).split(' ').filter(Boolean))];
  if (wantedTokens.length === 0 || candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const intersection = wantedTokens.filter((token) => candidateSet.has(token)).length;
  const containment = intersection / Math.min(wantedTokens.length, candidateTokens.length);
  const coverage = intersection / Math.max(wantedTokens.length, candidateTokens.length);

  if (containment === 1 && coverage >= 0.55) return 0.9;
  if (containment >= 0.8 && coverage >= 0.65) return 0.84;
  if (containment >= 0.7 && coverage >= 0.6) return 0.76;
  return Math.min(containment, coverage);
}

function readCurrentLibrary(): UserBookRecord[] {
  try {
    const storage = getRuntimeStorage();
    const stored = storage.getItem(BOOKS_STORAGE_KEY) ?? storage.getItem(LEGACY_BOOKS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

function recordIdentifiers(item: ImportRecordItem): string[] {
  const isbn = compactIsbn(item.isbn);
  return isbn ? [isbn] : [];
}

function bookIdentifiers(book: UserBookRecord): string[] {
  return [...new Set((book.editions ?? []).flatMap((edition) => [
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
  if (incomingIsbns.some((isbn) => existingIsbns.includes(isbn))) return true;

  const incomingKey = titleAuthorKey(item.title, item.author);
  const existingKey = titleAuthorKey(book.work.title, book.work.author);
  return Boolean(incomingKey && existingKey && incomingKey === existingKey);
}

export function analyzeImportDuplicates(
  items: ImportRecordItem[],
  library: UserBookRecord[] = readCurrentLibrary(),
): ImportDuplicateAnalysis {
  const unique: ImportRecordItem[] = [];
  const duplicates: ImportRecordItem[] = [];
  const seenIsbns = new Set<string>();
  const seenTitleAuthors = new Set<string>();

  const libraryIsbns = new Set<string>();
  const libraryTitleAuthors = new Set<string>();
  for (const book of library) {
    bookIdentifiers(book).forEach((isbn) => libraryIsbns.add(isbn));
    const key = titleAuthorKey(book.work.title, book.work.author);
    if (key) libraryTitleAuthors.add(key);
  }

  for (const item of items) {
    const isbn = compactIsbn(item.isbn);
    const key = titleAuthorKey(item.title, item.author);
    const matchesExistingLibrary = Boolean(
      (isbn && libraryIsbns.has(isbn)) || (key && libraryTitleAuthors.has(key)),
    );
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
  if (!normalizedQuery) return [];
  const cached = importSearchCache.get(normalizedQuery);
  if (cached) return cached;

  const catalogRequest = searchGoogleBooks(query).then((response) => response.groups);
  const request = Promise.race([
    catalogRequest,
    new Promise<BookSearchWorkGroup[]>((resolve) => {
      window.setTimeout(() => resolve([]), IMPORT_SEARCH_TIMEOUT_MS);
    }),
  ])
    .then((groups) => {
      if (groups.length === 0) importSearchCache.delete(normalizedQuery);
      return groups;
    })
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

function workMatchScore(item: ImportRecordItem, work: BookSearchWorkGroup): number {
  const requestedIsbn = compactIsbn(item.isbn);
  if (requestedIsbn && groupHasExactIsbn(work, requestedIsbn)) return 1;

  const titleScore = titleSimilarity(item.title, work.title);
  const bestAuthorScore = Math.max(0, ...work.authors.map((author) => authorSimilarity(item.author, author)));
  if (bestAuthorScore < 0.55 || titleScore < 0.68) return 0;

  const coverBonus = work.editions.some((edition) => edition.coverUrl) ? 0.015 : 0;
  const formatBonus = work.editions.some((edition) => edition.format === item.format) ? 0.015 : 0;
  return Math.min(0.99, (titleScore * 0.72) + (bestAuthorScore * 0.25) + coverBonus + formatBonus);
}

function chooseImportedEdition(
  item: ImportRecordItem,
  groups: BookSearchWorkGroup[],
): { work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition } {
  const requestedIsbn = compactIsbn(item.isbn);
  const scoredGroups = groups
    .map((work) => ({ work, score: workMatchScore(item, work) }))
    .filter(({ score }) => score >= 0.78)
    .sort((a, b) => b.score - a.score);

  const verifiedGroups = scoredGroups.map(({ work }) => work);
  const exactIsbnCandidates = requestedIsbn
    ? verifiedGroups.flatMap((work) => work.editions
      .filter((edition) => compactIsbn(edition.isbn13) === requestedIsbn || compactIsbn(edition.isbn10) === requestedIsbn)
      .map((edition) => ({ work, edition })))
    : [];
  const workCandidates = verifiedGroups.flatMap((work) => work.editions.map((edition) => ({ work, edition })));

  let selected = exactIsbnCandidates.find(({ edition }) => edition.format === item.format && Boolean(edition.coverUrl));
  selected ??= exactIsbnCandidates.find(({ edition }) => Boolean(edition.coverUrl));
  selected ??= exactIsbnCandidates.find(({ edition }) => edition.format === item.format);
  selected ??= exactIsbnCandidates[0];
  selected ??= workCandidates.find(({ edition }) => edition.format === item.format && Boolean(edition.coverUrl));
  selected ??= workCandidates.find(({ edition }) => edition.format === item.format);
  selected ??= workCandidates.find(({ edition }) => Boolean(edition.coverUrl));
  selected ??= workCandidates[0];
  if (!selected) return {};

  const coverEdition = selected.edition.coverUrl
    ? selected.edition
    : selected.work.editions.find((edition) => edition.format === item.format && Boolean(edition.coverUrl))
      ?? selected.work.editions.find((edition) => Boolean(edition.coverUrl));
  return { work: selected.work, edition: selected.edition, coverEdition };
}

function formatSearchTerms(item: ImportRecordItem): string[] {
  if (item.format === 'ebook') return ['ebook', 'kindle'];
  if (item.format === 'audiobook') return ['audiobook', 'audible'];
  if (item.format === 'paperback') return ['paperback'];
  if (item.format === 'hardcover') return ['hardcover'];
  return [];
}

function importSearchQueries(item: ImportRecordItem): string[] {
  const titles = titleSearchVariants(item.title);
  const authors = authorSearchVariants(item.author);
  const attempts = 'attempts' in item && typeof item.attempts === 'number' ? item.attempts : 0;
  const queries: string[] = [];
  const fullTitle = titles[0];
  const cleanedTitle = titles[1] || titles[0];
  const shortTitle = titles[2] || cleanedTitle;
  const normalizedTitle = titles[3] || shortTitle;
  const primaryAuthor = authors[0];
  const alternateAuthor = authors[1] || authors[2];
  const formatTerms = formatSearchTerms(item);
  const hasIsbn = Boolean(compactIsbn(item.isbn));

  if (!hasIsbn && fullTitle && primaryAuthor) {
    formatTerms.forEach((term) => queries.push(`${fullTitle} ${primaryAuthor} ${term}`));
  }
  if (!hasIsbn && cleanedTitle && primaryAuthor && cleanedTitle !== fullTitle) {
    formatTerms.forEach((term) => queries.push(`${cleanedTitle} ${primaryAuthor} ${term}`));
  }

  if (fullTitle && primaryAuthor) queries.push(`${fullTitle} ${primaryAuthor}`);
  if (cleanedTitle && primaryAuthor) queries.push(`${cleanedTitle} ${primaryAuthor}`);
  if (shortTitle && primaryAuthor) queries.push(`${shortTitle} ${primaryAuthor}`);
  if (attempts > 0 && shortTitle && alternateAuthor) queries.push(`${shortTitle} ${alternateAuthor}`);
  if (attempts > 1 && normalizedTitle && primaryAuthor) queries.push(`${normalizedTitle} ${primaryAuthor}`);
  if (attempts > 1 && shortTitle) queries.push(shortTitle);

  const maxQueries = !hasIsbn && formatTerms.length > 0 ? 5 : 4;
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, maxQueries);
}

async function findBestImportedMetadata(
  item: ImportRecordItem,
): Promise<{ work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition }> {
  const isbn = compactIsbn(item.isbn);
  if (isbn) {
    const match = chooseImportedEdition(item, await searchImportedBookMetadata(isbn));
    if (match.work && match.edition) return match;
  }

  const title = item.title.trim();
  const author = item.author.trim();
  if (!title || !author || normalizeText(author) === 'unknown author') return {};

  const seenGroups = new Map<string, BookSearchWorkGroup>();
  for (const query of importSearchQueries(item)) {
    const groups = await searchImportedBookMetadata(query);
    groups.forEach((group) => seenGroups.set(group.key, group));
    const match = chooseImportedEdition(item, [...seenGroups.values()]);
    if (match.work && match.edition) return match;
  }
  return {};
}

async function findBestImportedMetadataWithTimeout(
  item: ImportRecordItem,
): Promise<{ work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition }> {
  return Promise.race([
    findBestImportedMetadata(item),
    new Promise<{}>((resolve) => {
      window.setTimeout(() => resolve({}), IMPORT_BOOK_TIMEOUT_MS);
    }),
  ]);
}

async function canVerifyImportedBook(item: ImportRecordItem): Promise<boolean> {
  try {
    const match = await findBestImportedMetadataWithTimeout(item);
    return Boolean(match.work && match.edition);
  } catch {
    return false;
  }
}

export async function verifyImportRecords(
  items: ImportRecordItem[],
  onProgress?: (completed: number, total: number) => void,
  library?: UserBookRecord[],
): Promise<ImportVerificationSummary> {
  const { unique, duplicates } = analyzeImportDuplicates(items, library);
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

  await Promise.all(Array.from(
    { length: Math.min(IMPORT_ENRICHMENT_CONCURRENCY, unique.length) },
    () => worker(),
  ));

  return {
    verified: unique.filter((_, index) => verifiedFlags[index]),
    unmatched: unique.filter((_, index) => !verifiedFlags[index]),
    duplicates,
  };
}

export function createFallbackImportedBook(item: ImportRecordItem): UserBookRecord {
  const editionId = `edition-import-${item.id}`;
  const normalizedIsbn = compactIsbn(item.isbn);
  const dateAdded = normalizeImportDate(item.dateAdded) ?? new Date().toISOString().slice(0, 10);
  const dateStarted = normalizeImportDate(item.dateStarted);
  const dateFinished = item.status === 'finished' ? normalizeImportDate(item.dateRead) : undefined;
  const pageCount = typeof item.pageCount === 'number' && Number.isFinite(item.pageCount) && item.pageCount > 0
    ? Math.round(item.pageCount)
    : undefined;
  const coverUrl = item.coverUrl?.trim() || undefined;
  return {
    id: `book-import-${item.id}`,
    work: {
      id: `work-import-${item.id}`,
      title: item.title,
      author: item.author,
      summary: 'Summary unavailable.',
      personalSummary: item.review?.trim() || undefined,
      genres: [],
      publicationYear: dateFinished ? Number(dateFinished.slice(0, 4)) || new Date().getFullYear() : new Date().getFullYear(),
    },
    activeEditionId: editionId,
    editions: [{
      id: editionId,
      format: item.format,
      isbn: item.isbn,
      isbn13: normalizedIsbn.length === 13 ? normalizedIsbn : undefined,
      isbn10: normalizedIsbn.length === 10 ? normalizedIsbn : undefined,
      pageCount,
      coverGradient: item.coverGradient,
      coverUrl,
      externalSource: 'import',
    }],
    status: item.status,
    ownership: 'owned',
    progressPages: 0,
    progressMinutes: 0,
    progressPercentage: 0,
    rating: item.rating,
    spiceLevel: item.spiceLevel,
    review: item.review,
    favoriteQuotes: [],
    privateTags: ['imported'],
    priority: 'medium',
    moods: [],
    collections: [],
    sourceOfImport: 'Library import',
    importMetadataVerified: false,
    importMetadataReviewNeeded: false,
    importFinishedDateProvided: Boolean(dateFinished),
    dateAdded,
    dateStarted,
    dateFinished,
  };
}

async function enrichImportedBook(item: ImportEnrichmentQueueItem): Promise<ImportEnrichmentResult> {
  try {
    const { work, edition, coverEdition } = await findBestImportedMetadataWithTimeout(item);
    if (!work || !edition) {
      return { item, foundCover: false, foundSummary: false, success: false };
    }

    const publisherSummary = work.publisherSummary?.trim();
    const sourcePageCount = typeof item.pageCount === 'number' && Number.isFinite(item.pageCount) && item.pageCount > 0
      ? Math.round(item.pageCount)
      : undefined;
    const sourceCoverUrl = item.coverUrl?.trim() || undefined;
    const coverUrl = sourceCoverUrl || coverEdition?.coverUrl;
    const editionId = `edition-enriched-${item.id}`;
    const pageCount = sourcePageCount || edition.pageCount;
    const dateAdded = normalizeImportDate(item.dateAdded) ?? new Date().toISOString().slice(0, 10);
    const dateStarted = normalizeImportDate(item.dateStarted);
    const dateFinished = item.status === 'finished' ? normalizeImportDate(item.dateRead) : undefined;
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
      // Metadata enrichment must never invent reading progress. Finished history
      // and a known page count do not prove the exact tracked endpoint.
      progressPages: 0,
      progressMinutes: 0,
      progressPercentage: 0,
      rating: item.rating,
      spiceLevel: item.spiceLevel,
      review: item.review,
      favoriteQuotes: [],
      privateTags: ['imported'],
      priority: 'medium',
      moods: [],
      collections: [],
      sourceOfImport: 'Library import + verified metadata',
      importMetadataVerified: true,
      importMetadataReviewNeeded: false,
      importFinishedDateProvided: Boolean(dateFinished),
      dateAdded,
      dateStarted,
      dateFinished,
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

  await Promise.all(Array.from(
    { length: Math.min(IMPORT_ENRICHMENT_CONCURRENCY, items.length) },
    () => worker(),
  ));
  return results;
}

const isPlaceholderSummary = (value?: string): boolean => {
  const normalized = value?.trim().toLowerCase() ?? '';
  return !normalized || normalized === 'summary unavailable.' || normalized.startsWith('no publisher description');
};

export function mergeEnrichedImportedBook(current: UserBookRecord, enriched: UserBookRecord): UserBookRecord {
  const activeEdition = current.editions.find((edition) => edition.id === current.activeEditionId) ?? current.editions[0];
  const enrichedEdition = enriched.editions[0];
  const normalizedEditionIsbns = (edition: typeof activeEdition) => new Set(
    [edition?.isbn, edition?.isbn10, edition?.isbn13].map(compactIsbn).filter(Boolean),
  );
  const currentIsbns = normalizedEditionIsbns(activeEdition);
  const incomingIsbns = normalizedEditionIsbns(enrichedEdition);
  const compatibleEdition = Boolean(activeEdition && enrichedEdition
    && activeEdition.format === enrichedEdition.format
    && (currentIsbns.size === 0 || incomingIsbns.size === 0
      || [...currentIsbns].some((isbn) => incomingIsbns.has(isbn))));

  const mergedActiveEdition = compatibleEdition && activeEdition && enrichedEdition
    ? {
        ...enrichedEdition,
        ...activeEdition,
        id: activeEdition.id,
        format: activeEdition.format,
        coverGradient: activeEdition.coverGradient,
        coverUrl: activeEdition.coverUrl || enrichedEdition.coverUrl,
        isbn: activeEdition.isbn || enrichedEdition.isbn,
        isbn10: activeEdition.isbn10 || enrichedEdition.isbn10,
        isbn13: activeEdition.isbn13 || enrichedEdition.isbn13,
        pageCount: activeEdition.pageCount || enrichedEdition.pageCount,
        publisher: activeEdition.publisher || enrichedEdition.publisher,
        publicationDate: activeEdition.publicationDate || enrichedEdition.publicationDate,
        language: activeEdition.language || enrichedEdition.language,
        editionName: activeEdition.editionName || enrichedEdition.editionName,
        binding: activeEdition.binding || enrichedEdition.binding,
        externalSource: activeEdition.externalSource === 'manual' ? activeEdition.externalSource : enrichedEdition.externalSource,
        externalEditionId: activeEdition.externalEditionId || enrichedEdition.externalEditionId,
      }
    : activeEdition ?? enrichedEdition;

  const publisherSummary = current.work.publisherSummary || enriched.work.publisherSummary;
  const visibleSummary = isPlaceholderSummary(current.work.summary)
    ? publisherSummary || enriched.work.summary || current.work.summary
    : current.work.summary;

  return {
    ...current,
    work: {
      ...current.work,
      subtitle: current.work.subtitle || enriched.work.subtitle,
      summary: visibleSummary,
      publisherSummary,
      personalSummary: current.work.personalSummary || enriched.work.personalSummary,
      genres: current.work.genres?.length ? current.work.genres : enriched.work.genres,
      publicationYear: current.work.publicationYear || enriched.work.publicationYear,
      originalLanguage: current.work.originalLanguage || enriched.work.originalLanguage,
      externalWorkId: current.work.externalWorkId || enriched.work.externalWorkId,
    },
    editions: mergedActiveEdition
      ? current.editions.map((edition) => edition.id === current.activeEditionId ? mergedActiveEdition : edition)
      : current.editions,
    // Catalog enrichment owns catalog fields, never reader reading history.
    // An empty date may be a deliberate correction; never refill it.
    dateStarted: current.dateStarted,
    dateFinished: current.dateFinished,
    importFinishedDateProvided: current.importFinishedDateProvided,
    sourceOfImport: 'Library import + verified metadata',
    importMetadataVerified: true,
    importMetadataReviewNeeded: false,
  };
}

function needsPublisherSummary(book: UserBookRecord): boolean {
  return !book.work.publisherSummary?.trim() && isPlaceholderSummary(book.work.summary);
}

function needsCover(book: UserBookRecord): boolean {
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  return !activeEdition?.coverUrl;
}

function isImportedBook(book: UserBookRecord): boolean {
  return Boolean(
    book.sourceOfImport?.toLowerCase().includes('import')
    || book.privateTags?.includes('imported')
    || book.id.startsWith('book-import-'),
  );
}

export function buildRepairQueueItems(
  books: UserBookRecord[],
  existingQueue: ImportEnrichmentQueueItem[],
): ImportEnrichmentQueueItem[] {
  const byBookId = new Map(existingQueue.map((item) => [item.targetBookId, item]));

  books.forEach((book) => {
    if (!isImportedBook(book)) return;

    const mustVerifyLegacyMetadata = book.importMetadataVerified !== true;
    if (!mustVerifyLegacyMetadata && !needsCover(book) && !needsPublisherSummary(book)) {
      byBookId.delete(book.id);
      return;
    }

    const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
    const sourceItemId = book.id.startsWith('book-import-') ? book.id.slice('book-import-'.length) : `repair-${book.id}`;
    const previous = byBookId.get(book.id);
    byBookId.set(book.id, {
      id: previous?.id ?? sourceItemId,
      targetBookId: book.id,
      title: book.work.title,
      author: book.work.author,
      isbn: activeEdition?.isbn13 || activeEdition?.isbn10 || activeEdition?.isbn,
      format: activeEdition?.format || 'hardcover',
      status: book.status,
      rating: book.rating,
      dateStarted: book.dateStarted,
      dateRead: book.dateFinished,
      dateAdded: book.dateAdded,
      pageCount: activeEdition?.pageCount,
      coverUrl: activeEdition?.coverUrl,
      review: book.review,
      confidence: 100,
      duplicateAction: 'merge',
      coverGradient: activeEdition?.coverGradient || 'from-[#5c3d62] via-[#35243f] to-[#171117]',
      attempts: previous?.attempts ?? 0,
      lastAttemptAt: previous?.lastAttemptAt,
    });
  });

  const existingIds = new Set(books.map((book) => book.id));
  return [...byBookId.values()].filter((item) => existingIds.has(item.targetBookId));
}

export function queueImportedItems(items: ImportRecordItem[]): ImportEnrichmentQueueItem[] {
  return items.map((item) => ({
    ...item,
    targetBookId: `book-import-${item.id}`,
    attempts: 0,
  }));
}
