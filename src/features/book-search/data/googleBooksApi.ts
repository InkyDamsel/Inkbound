import { Format } from '../../../types';
import { searchHardcover } from './hardcoverApi';
import { searchOpenLibrary } from './openLibraryApi';
import { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';

interface GoogleIndustryIdentifier {
  type?: string;
  identifier?: string;
}

interface GoogleImageLinks {
  smallThumbnail?: string;
  thumbnail?: string;
  small?: string;
  medium?: string;
  large?: string;
  extraLarge?: string;
}

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: GoogleIndustryIdentifier[];
    pageCount?: number;
    printType?: string;
    categories?: string[];
    imageLinks?: GoogleImageLinks;
    language?: string;
  };
  saleInfo?: {
    isEbook?: boolean;
  };
}

interface GoogleVolumesResponse {
  totalItems?: number;
  items?: GoogleVolume[];
}

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();
const SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'book', 'books', 'edition', 'editions', 'volume', 'volumes', 'series', 'complete',
]);

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const normalizeCoverUrl = (links?: GoogleImageLinks): string | undefined => {
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return source?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const publicationYear = (value?: string): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
};

const inferFormat = (volume: GoogleVolume): Format => volume.saleInfo?.isEbook ? 'ebook' : 'hardcover';

const getIdentifier = (volume: GoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const mapVolume = (volume: GoogleVolume): BookSearchEdition | null => {
  const info = volume.volumeInfo;
  if (!info?.title) return null;
  return {
    source: 'google-books',
    externalEditionId: volume.id,
    title: info.title,
    subtitle: info.subtitle,
    authors: info.authors?.length ? info.authors : ['Unknown author'],
    publisherSummary: info.description,
    genres: info.categories ?? [],
    publisher: info.publisher,
    publicationDate: info.publishedDate,
    publicationYear: publicationYear(info.publishedDate),
    language: info.language,
    format: inferFormat(volume),
    isbn10: getIdentifier(volume, 'ISBN_10'),
    isbn13: getIdentifier(volume, 'ISBN_13'),
    pageCount: info.pageCount,
    coverUrl: normalizeCoverUrl(info.imageLinks),
    editionName: info.subtitle?.toLocaleLowerCase().includes('edition') ? info.subtitle : undefined,
    binding: volume.saleInfo?.isEbook ? 'Digital' : undefined,
    specialFeatures: [],
  };
};

const groupEditions = (editions: BookSearchEdition[]): BookSearchWorkGroup[] => {
  const groups = new Map<string, BookSearchWorkGroup>();
  editions.forEach((edition) => {
    const key = `${normalizeText(edition.title)}::${normalizeText(edition.authors[0])}`;
    const existing = groups.get(key);
    if (existing) {
      const duplicate = existing.editions.some((candidate) =>
        (candidate.source === edition.source && candidate.externalEditionId === edition.externalEditionId) ||
        Boolean(candidate.isbn13 && edition.isbn13 && candidate.isbn13 === edition.isbn13) ||
        Boolean(candidate.isbn10 && edition.isbn10 && candidate.isbn10 === edition.isbn10),
      );
      if (!duplicate) existing.editions.push(edition);
      if (!existing.publisherSummary && edition.publisherSummary) existing.publisherSummary = edition.publisherSummary;
      if (existing.genres.length === 0 && edition.genres.length > 0) existing.genres = edition.genres;
      return;
    }
    groups.set(key, {
      key,
      title: edition.title,
      subtitle: edition.subtitle,
      authors: edition.authors,
      publisherSummary: edition.publisherSummary,
      genres: edition.genres,
      editions: [edition],
    });
  });
  return [...groups.values()];
};

const searchTokens = (query: string): string[] => {
  const cleaned = query.replace(/\b(?:intitle|inauthor|isbn|subject):/gi, ' ').replace(/["']/g, ' ');
  return [...new Set(normalizeText(cleaned).split(' ').filter((token) => token.length >= 3 && !SEARCH_STOP_WORDS.has(token)))];
};

const compactIsbn = (value: string): string => value.replace(/[^0-9X]/gi, '').toUpperCase();

const minimumRequiredMatches = (tokenCount: number): number => {
  if (tokenCount <= 1) return tokenCount;
  if (tokenCount <= 3) return 2;
  return Math.max(3, Math.ceil(tokenCount * 0.5));
};

const rankGroups = (groups: BookSearchWorkGroup[], query: string): BookSearchWorkGroup[] => {
  const isbnQuery = compactIsbn(query);
  const isExactIsbnSearch = /^(?:97[89])?\d{9}[\dX]$/i.test(isbnQuery);
  const tokens = searchTokens(query);
  const requiredMatches = minimumRequiredMatches(tokens.length);

  return groups.map((group) => {
    const title = normalizeText(group.title);
    const subtitle = normalizeText(group.subtitle);
    const authors = normalizeText(group.authors.join(' '));
    const searchable = `${title} ${subtitle} ${authors}`;
    const matchingTokens = tokens.filter((token) => searchable.includes(token));
    const titleMatches = tokens.filter((token) => title.includes(token));
    const authorMatches = tokens.filter((token) => authors.includes(token));
    const exactIsbnMatch = group.editions.some((edition) =>
      [edition.isbn10, edition.isbn13].filter(Boolean).some((identifier) => compactIsbn(identifier ?? '') === isbnQuery),
    );
    let score = exactIsbnMatch ? 500 : 0;
    tokens.forEach((token) => {
      if (title.includes(token)) score += 28;
      if (authors.includes(token)) score += 24;
      if (subtitle.includes(token)) score += 10;
    });
    if (tokens.length > 0 && matchingTokens.length === tokens.length) score += 80;
    if (titleMatches.length >= 2) score += 45;
    if (titleMatches.length > 0 && authorMatches.length > 0) score += 55;
    if (group.editions.some((edition) => edition.coverUrl)) score += 30;
    if (group.editions.some((edition) => edition.isbn13 || edition.isbn10)) score += 12;
    if (group.editions.some((edition) => edition.publisher)) score += 6;
    if (authors.includes('unknown author')) score -= 35;
    return { group, score, matchingTokens: matchingTokens.length, titleMatches: titleMatches.length, exactIsbnMatch };
  }).filter((item) => {
    if (isExactIsbnSearch) return item.exactIsbnMatch;
    if (tokens.length === 0) return true;
    if (item.matchingTokens < requiredMatches) return false;
    if (tokens.length >= 3 && item.titleMatches === 0) return false;
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 40).map(({ group }) => ({
    ...group,
    editions: [...group.editions].sort((a, b) => {
      if (Boolean(a.coverUrl) !== Boolean(b.coverUrl)) return a.coverUrl ? -1 : 1;
      if (Boolean(a.isbn13) !== Boolean(b.isbn13)) return a.isbn13 ? -1 : 1;
      return (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
    }),
  }));
};

const mergeProviderGroups = (providerGroups: BookSearchWorkGroup[][]): BookSearchWorkGroup[] => {
  const merged = new Map<string, BookSearchWorkGroup>();
  providerGroups.flat().forEach((group) => {
    const key = `${normalizeText(group.title)}::${normalizeText(group.authors[0])}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...group, key: `inkbound:${key}`, editions: [...group.editions] });
      return;
    }
    if (!existing.subtitle && group.subtitle) existing.subtitle = group.subtitle;
    if (!existing.publisherSummary && group.publisherSummary) existing.publisherSummary = group.publisherSummary;
    existing.genres = [...new Set([...existing.genres, ...group.genres])].slice(0, 16);
    group.editions.forEach((edition) => {
      const duplicate = existing.editions.some((candidate) =>
        Boolean(candidate.isbn13 && edition.isbn13 && compactIsbn(candidate.isbn13) === compactIsbn(edition.isbn13)) ||
        Boolean(candidate.isbn10 && edition.isbn10 && compactIsbn(candidate.isbn10) === compactIsbn(edition.isbn10)) ||
        (candidate.source === edition.source && candidate.externalEditionId === edition.externalEditionId),
      );
      if (!duplicate) existing.editions.push(edition);
    });
  });
  return [...merged.values()];
};

export const buildGoogleBooksQuery = (value: string): string => {
  const trimmed = value.trim();
  const compact = trimmed.replace(/[-\s]/g, '');
  if (/^(?:97[89])?\d{9}[\dX]$/i.test(compact)) return `isbn:${compact}`;
  return trimmed;
};

async function searchGoogleBooksProvider(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const normalizedQuery = buildGoogleBooksQuery(query);
  if (!normalizedQuery) return { groups: [], totalItems: 0 };
  const params = new URLSearchParams({ q: normalizedQuery, printType: 'books', projection: 'full', orderBy: 'relevance', maxResults: '40' });
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);
  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Google Books search failed (${response.status}).`);
  const payload = (await response.json()) as GoogleVolumesResponse;
  const editions = (payload.items ?? []).map(mapVolume).filter((item): item is BookSearchEdition => Boolean(item));
  return { groups: groupEditions(editions), totalItems: payload.totalItems ?? editions.length };
}

// Kept under the existing exported name so Add Book, Cover Manager, and import
// enrichment all automatically share the same provider aggregation pipeline.
export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  const settled = await Promise.allSettled([
    searchGoogleBooksProvider(trimmed, signal),
    searchOpenLibrary(trimmed, signal),
    searchHardcover(trimmed),
  ]);
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  const successful = settled
    .filter((result): result is PromiseFulfilledResult<BookSearchResponse> => result.status === 'fulfilled')
    .map((result) => result.value);
  if (successful.length === 0) throw new Error('Book search is temporarily unavailable. Please try again.');

  const groups = rankGroups(mergeProviderGroups(successful.map((response) => response.groups)), trimmed);
  return { groups, totalItems: groups.length };
}
