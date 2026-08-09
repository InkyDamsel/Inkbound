import type {
  ImportRecordItem,
  UserBookRecord,
} from '../../types';
import { searchGoogleBooks } from '../book-search/data/googleBooksApi';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';

export const IMPORT_ENRICHMENT_QUEUE_KEY = 'inkbound_import_enrichment_queue_v2';
export const IMPORT_ENRICHMENT_CONCURRENCY = 3;
export const IMPORT_ENRICHMENT_BATCH_SIZE = 12;

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
    // The queue is reconstructable from the library, so storage pressure should
    // never be allowed to take down the reader UI or an active reading session.
    console.warn('Inkbound could not persist the full enrichment queue on this device.', error);
  }
}

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalizeText = (value?: string) => value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

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

function looksLikeSameWork(item: ImportRecordItem, work: BookSearchWorkGroup): boolean {
  const wantedTitle = normalizeText(item.title);
  const candidateTitle = normalizeText(work.title);
  const wantedAuthor = normalizeText(item.author);
  const candidateAuthors = normalizeText(work.authors.join(' '));

  const titleMatches =
    wantedTitle === candidateTitle ||
    wantedTitle.includes(candidateTitle) ||
    candidateTitle.includes(wantedTitle);
  const authorToken = wantedAuthor.split(' ').filter(Boolean).at(-1);
  const authorMatches = !authorToken || candidateAuthors.includes(authorToken);
  return titleMatches && authorMatches;
}

function chooseImportedEdition(
  item: ImportRecordItem,
  groups: BookSearchWorkGroup[],
): { work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition } {
  const viableGroups = groups.filter((work) => looksLikeSameWork(item, work));
  const candidates = viableGroups.flatMap((work) => work.editions.map((edition) => ({ work, edition })));
  const requestedIsbn = compactIsbn(item.isbn);

  let selected = requestedIsbn
    ? candidates.find(({ edition }) =>
        compactIsbn(edition.isbn13) === requestedIsbn || compactIsbn(edition.isbn10) === requestedIsbn,
      )
    : undefined;

  selected ??= candidates.find(({ edition }) => edition.format === item.format && Boolean(edition.coverUrl));
  selected ??= candidates.find(({ edition }) => Boolean(edition.coverUrl));
  selected ??= candidates[0];
  if (!selected) return {};

  const coverEdition = selected.edition.coverUrl
    ? selected.edition
    : selected.work.editions.find((edition) => Boolean(edition.coverUrl));

  return { work: selected.work, edition: selected.edition, coverEdition };
}

async function findBestImportedMetadata(
  item: ImportRecordItem,
): Promise<{ work?: BookSearchWorkGroup; edition?: BookSearchEdition; coverEdition?: BookSearchEdition }> {
  const titleAuthorQuery = `${item.title} ${item.author}`.trim();
  const isbn = item.isbn?.trim();

  if (isbn) {
    const isbnGroups = await searchImportedBookMetadata(isbn);
    const isbnMatch = chooseImportedEdition(item, isbnGroups);
    const isbnUseful = Boolean(
      isbnMatch.work &&
      isbnMatch.edition &&
      (isbnMatch.coverEdition?.coverUrl || isbnMatch.work.publisherSummary?.trim()),
    );
    if (isbnUseful) return isbnMatch;
  }

  if (!titleAuthorQuery) return {};
  const titleGroups = await searchImportedBookMetadata(titleAuthorQuery);
  return chooseImportedEdition(item, titleGroups);
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
    dateAdded: item.dateAdded,
    dateFinished: item.dateRead,
  };
}

async function enrichImportedBook(item: ImportEnrichmentQueueItem): Promise<ImportEnrichmentResult> {
  try {
    const { work, edition, coverEdition } = await findBestImportedMetadata(item);
    const publisherSummary = work?.publisherSummary?.trim();
    const coverUrl = coverEdition?.coverUrl;
    const success = Boolean(work && edition && (coverUrl || publisherSummary));
    if (!success || !work || !edition) {
      return { item, foundCover: false, foundSummary: false, success: false };
    }

    const editionId = `edition-enriched-${item.id}`;
    const pageCount = edition.pageCount;
    const enriched: UserBookRecord = {
      id: item.targetBookId,
      work: {
        id: `work-enriched-${item.id}`,
        title: work.title || item.title,
        subtitle: work.subtitle,
        author: work.authors.length > 0 ? work.authors.join(', ') : item.author,
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
        isbn: edition.isbn13 ?? edition.isbn10 ?? item.isbn,
        isbn10: edition.isbn10,
        isbn13: edition.isbn13,
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
      sourceOfImport: 'Library import + metadata enrichment',
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
  const enrichedEdition = enriched.editions[0];
  const activeEdition = current.editions.find((edition) => edition.id === current.activeEditionId) ?? current.editions[0];
  const mergedActiveEdition = activeEdition
    ? {
        ...activeEdition,
        ...enrichedEdition,
        id: activeEdition.id,
        format: activeEdition.format,
        coverGradient: activeEdition.coverGradient,
        coverUrl: enrichedEdition?.coverUrl || activeEdition.coverUrl,
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
      externalWorkId: current.work.externalWorkId || enriched.work.externalWorkId,
    },
    editions: current.editions.map((edition) =>
      edition.id === current.activeEditionId && mergedActiveEdition ? mergedActiveEdition : edition,
    ),
    sourceOfImport: current.sourceOfImport || enriched.sourceOfImport,
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
    if (!isImportedBook(book) || (!needsCover(book) && !needsPublisherSummary(book))) return;
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
