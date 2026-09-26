import { httpsCallable } from 'firebase/functions';
import { Format } from '../../../types';
import { auth, functions } from '../../../lib/firebase';
import { readRuntimeJson } from '../../../platform/runtimeStorage';
import { searchInkboundTrustedCatalog } from '../../catalog/metadataContributions';
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
    categories?: string[];
    imageLinks?: GoogleImageLinks;
    language?: string;
  };
  saleInfo?: { isEbook?: boolean };
  seriesInfo?: {
    shortSeriesBookTitle?: string;
    bookDisplayNumber?: string;
    volumeSeries?: Array<{
      seriesId?: string;
      seriesBookType?: string;
      orderNumber?: number;
      issue?: Array<{ issueOrderNumber?: number }>;
    }>;
  };
}

interface GoogleVolumesResponse {
  totalItems?: number;
  items?: GoogleVolume[];
}

export interface GoogleBooksAuthorPage extends BookSearchResponse {
  providerTotalItems: number;
  nextStartIndex: number;
  hasMore: boolean;
}

const GOOGLE_BOOKS_PAGE_SIZE = 40;

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_BACKOFF_MS = 5 * 60 * 1000;
const ACTIVE_TAB_STORAGE_KEY = 'inkbound_active_tab';
const searchCache = new Map<string, { expiresAt: number; response: BookSearchResponse }>();
let googleBackoffUntil = 0;
let hardcoverBackoffUntil = 0;

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value: string): string => value.replace(/[^0-9X]/gi, '').toUpperCase();

const isAdministrationActive = (): boolean =>
  readRuntimeJson<string>(ACTIVE_TAB_STORAGE_KEY, 'home') === 'admin';

const waitUntilAdministrationInactive = async (signal?: AbortSignal): Promise<void> => {
  while (isAdministrationActive()) {
    if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
};

const shouldBackOffCatalog = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b(?:429|503)\b|resource-exhausted|unavailable/i.test(message);
};

export const buildGoogleBooksQuery = (value: string): string => {
  const trimmed = value.trim();
  const compact = compactIsbn(trimmed);
  if (/^(?:97[89])?\d{9}[\dX]$/i.test(compact)) return `isbn:${compact}`;
  return trimmed;
};

const publicationYear = (value?: string): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
};

const inferFormat = (volume: GoogleVolume): Format => volume.saleInfo?.isEbook ? 'ebook' : 'hardcover';

const getIdentifier = (volume: GoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const coverUrl = (volume: GoogleVolume): string | undefined => {
  const links = volume.volumeInfo?.imageLinks;
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return source?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const mapGoogleVolume = (volume: GoogleVolume): BookSearchEdition | null => {
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
    seriesName: volume.seriesInfo?.shortSeriesBookTitle?.trim() || undefined,
    seriesOrder: (() => {
      const explicit = Number(volume.seriesInfo?.bookDisplayNumber);
      if (Number.isFinite(explicit) && explicit >= 0) return explicit;
      const order = volume.seriesInfo?.volumeSeries
        ?.map((item) => item.orderNumber ?? item.issue?.[0]?.issueOrderNumber)
        .find((value) => typeof value === 'number' && Number.isFinite(value));
      return typeof order === 'number' ? order : undefined;
    })(),
    format: inferFormat(volume),
    isbn10: getIdentifier(volume, 'ISBN_10'),
    isbn13: getIdentifier(volume, 'ISBN_13'),
    pageCount: info.pageCount,
    coverUrl: coverUrl(volume),
    binding: volume.saleInfo?.isEbook ? 'Digital' : undefined,
    specialFeatures: [],
  };
};

const groupGoogleEditions = (editions: BookSearchEdition[]): BookSearchWorkGroup[] => {
  const groups = new Map<string, BookSearchWorkGroup>();
  const order: string[] = [];

  editions.forEach((edition) => {
    const key = `${normalizeText(edition.title)}::${normalizeText(edition.authors[0])}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key: `google-books:${key}`,
        title: edition.title,
        subtitle: edition.subtitle,
        authors: edition.authors,
        publisherSummary: edition.publisherSummary,
        genres: edition.genres,
        editions: [edition],
      });
      order.push(key);
      return;
    }

    const duplicate = existing.editions.some((candidate) =>
      candidate.externalEditionId === edition.externalEditionId ||
      Boolean(candidate.isbn13 && edition.isbn13 && compactIsbn(candidate.isbn13) === compactIsbn(edition.isbn13)) ||
      Boolean(candidate.isbn10 && edition.isbn10 && compactIsbn(candidate.isbn10) === compactIsbn(edition.isbn10)),
    );
    if (!duplicate) existing.editions.push(edition);
    if (!existing.publisherSummary && edition.publisherSummary) existing.publisherSummary = edition.publisherSummary;
  });

  return order.map((key) => groups.get(key)).filter((group): group is BookSearchWorkGroup => Boolean(group));
};

const groupIdentity = (group: BookSearchWorkGroup): string =>
  `${normalizeText(group.title)}::${normalizeText(group.authors[0])}`;

const sameEdition = (
  a: BookSearchWorkGroup['editions'][number],
  b: BookSearchWorkGroup['editions'][number],
): boolean => {
  if (a.source === b.source && a.externalEditionId === b.externalEditionId) return true;
  if (a.isbn13 && b.isbn13 && compactIsbn(a.isbn13) === compactIsbn(b.isbn13)) return true;
  if (a.isbn10 && b.isbn10 && compactIsbn(a.isbn10) === compactIsbn(b.isbn10)) return true;
  return false;
};

const mergeGroups = (primary: BookSearchWorkGroup[], supplements: BookSearchWorkGroup[][]): BookSearchWorkGroup[] => {
  const merged = new Map<string, BookSearchWorkGroup>();
  const order: string[] = [];

  const add = (group: BookSearchWorkGroup) => {
    const key = groupIdentity(group);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...group, key: `inkbound:${key}`, genres: [...group.genres], editions: [...group.editions] });
      order.push(key);
      return;
    }
    if (!existing.subtitle && group.subtitle) existing.subtitle = group.subtitle;
    if (!existing.publisherSummary && group.publisherSummary) existing.publisherSummary = group.publisherSummary;
    existing.genres = [...new Set([...existing.genres, ...group.genres])].slice(0, 16);
    group.editions.forEach((edition) => {
      const duplicateIndex = existing.editions.findIndex((candidate) => sameEdition(candidate, edition));
      if (duplicateIndex < 0) {
        existing.editions.push(edition);
        return;
      }
      const current = existing.editions[duplicateIndex];
      if (current.source === 'inkbound-catalog') {
        existing.editions[duplicateIndex] = {
          ...edition,
          ...current,
          coverUrl: current.coverUrl || edition.coverUrl,
          publisherSummary: current.publisherSummary || edition.publisherSummary,
          binding: current.binding || edition.binding,
          specialFeatures: current.specialFeatures.length ? current.specialFeatures : edition.specialFeatures,
        };
      }
    });
  };

  primary.forEach(add);
  supplements.flat().forEach(add);
  return order.map((key) => merged.get(key)).filter((group): group is BookSearchWorkGroup => Boolean(group)).slice(0, 50);
};

async function searchTrustedCatalogBaseline(query: string): Promise<BookSearchResponse> {
  const compact = compactIsbn(query);
  if (/^(?:97[89])?\d{9}[\dX]$/i.test(compact)) {
    return searchInkboundTrustedCatalog({ isbn: compact });
  }
  return searchInkboundTrustedCatalog({ title: query.trim() });
}

async function requestProtectedGoogleBooks(
  query: string,
  signal?: AbortSignal,
  startIndex = 0,
  maxResults = GOOGLE_BOOKS_PAGE_SIZE,
): Promise<GoogleVolumesResponse> {
  if (!functions || !auth?.currentUser) {
    throw new Error('Protected Google Books search requires a signed-in Inkbound account.');
  }
  const callable = httpsCallable<
    { query: string; provider: 'google-books'; startIndex?: number; maxResults?: number },
    GoogleVolumesResponse
  >(functions, 'searchHardcoverBooks');
  const response = await callable({ query, provider: 'google-books', startIndex, maxResults });
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
  return response.data;
}

async function requestDirectGoogleBooks(
  query: string,
  signal?: AbortSignal,
  startIndex = 0,
  maxResults = GOOGLE_BOOKS_PAGE_SIZE,
): Promise<GoogleVolumesResponse> {
  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    maxResults: String(maxResults),
  });
  if (startIndex > 0) params.set('startIndex', String(startIndex));
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);

  let response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok && GOOGLE_BOOKS_API_KEY && [400, 401, 403].includes(response.status)) {
    params.delete('key');
    response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  }
  if (!response.ok) throw new Error(`Google Books search failed (${response.status}).`);
  return response.json() as Promise<GoogleVolumesResponse>;
}

async function requestGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const payload = functions && auth?.currentUser
    ? await requestProtectedGoogleBooks(query, signal)
    : await requestDirectGoogleBooks(query, signal);

  const editions = (payload.items ?? []).map(mapGoogleVolume).filter((item): item is BookSearchEdition => Boolean(item));
  const groups = groupGoogleEditions(editions);
  return { groups, totalItems: payload.totalItems ?? groups.length };
}


export async function searchGoogleBooksAuthorPage(
  authorName: string,
  startIndex = 0,
  signal?: AbortSignal,
): Promise<GoogleBooksAuthorPage> {
  const trimmedAuthor = authorName.trim();
  if (!trimmedAuthor) {
    return {
      groups: [],
      totalItems: 0,
      providerTotalItems: 0,
      nextStartIndex: startIndex,
      hasMore: false,
    };
  }
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  let payload: GoogleVolumesResponse;
  try {
    payload = functions && auth?.currentUser
      ? await requestProtectedGoogleBooks(trimmedAuthor, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE)
      : await requestDirectGoogleBooks(trimmedAuthor, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);
  } catch (protectedError) {
    if (signal?.aborted) throw protectedError;

    try {
      // Author pages must remain usable even when the local/protected callable
      // is stale or unavailable. This uses the same canonical Google mapper and
      // query shape as normal Search; only the transport falls back to public.
      payload = await requestDirectGoogleBooks(
        trimmedAuthor,
        signal,
        startIndex,
        GOOGLE_BOOKS_PAGE_SIZE,
      );
    } catch (directError) {
      console.warn(
        'Google Books author lookup unavailable; falling back to canonical catalog search.',
        protectedError,
        directError,
      );

      const fallback = await searchGoogleBooks(trimmedAuthor, signal);
      return {
        groups: fallback.groups,
        totalItems: fallback.totalItems,
        providerTotalItems: fallback.totalItems,
        nextStartIndex: startIndex + fallback.groups.length,
        hasMore: false,
      };
    }
  }

  const rawItems = payload.items ?? [];
  const editions = rawItems
    .map(mapGoogleVolume)
    .filter((item): item is BookSearchEdition => Boolean(item));
  const groups = groupGoogleEditions(editions);
  const providerTotalItems = Math.max(0, payload.totalItems ?? 0);
  const nextStartIndex = startIndex + rawItems.length;
  const hasMore = rawItems.length > 0 && (
    providerTotalItems > 0
      ? nextStartIndex < providerTotalItems
      : rawItems.length === GOOGLE_BOOKS_PAGE_SIZE
  );

  return {
    groups,
    totalItems: providerTotalItems || groups.length,
    providerTotalItems,
    nextStartIndex,
    hasMore,
  };
}

async function searchGoogleBaseline(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  if (Date.now() < googleBackoffUntil) return { groups: [], totalItems: 0 };
  try {
    return await requestGoogleBooks(buildGoogleBooksQuery(query), signal);
  } catch (error) {
    if (shouldBackOffCatalog(error)) {
      googleBackoffUntil = Math.max(googleBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
      console.warn('Google Books is cooling down after a provider rate limit/outage; alternate catalogs remain available.', error);
    } else {
      console.warn('Google Books search unavailable; using alternate catalogs.', error);
    }
    return { groups: [], totalItems: 0 };
  }
}

async function searchOpenLibraryWithAuthorFallback(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  try {
    const normal = await searchOpenLibrary(buildGoogleBooksQuery(query), signal);
    if (normal.groups.length > 0 || /^isbn:/i.test(buildGoogleBooksQuery(query))) return normal;

    if (/^[\p{L}.\-' ]{3,80}$/u.test(query.trim())) {
      return await searchOpenLibrary(`inauthor:${query.trim()}`, signal);
    }
    return normal;
  } catch (error) {
    console.warn('Open Library supplement failed.', error);
    return { groups: [], totalItems: 0 };
  }
}

async function searchHardcoverWithBackoff(query: string): Promise<BookSearchResponse> {
  if (Date.now() < hardcoverBackoffUntil) return { groups: [], totalItems: 0 };
  try {
    return await searchHardcover(query);
  } catch (error) {
    if (shouldBackOffCatalog(error)) {
      hardcoverBackoffUntil = Math.max(hardcoverBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
    }
    console.warn('Hardcover supplement failed.', error);
    return { groups: [], totalItems: 0 };
  }
}

function cacheSearchResponse(cacheKey: string, response: BookSearchResponse): BookSearchResponse {
  if (response.groups.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response });
  }
  return response;
}

export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  const cacheKey = normalizeText(trimmed);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  if (cached) searchCache.delete(cacheKey);

  const builtQuery = buildGoogleBooksQuery(trimmed);
  const isIsbnLookup = /^isbn:/i.test(builtQuery);

  // ISBN lookups are cheap and high-confidence in the trusted catalog, so try
  // Inkbound first. Title/author searches go to Google first to avoid turning
  // every imported book into several Firebase catalog calls.
  if (isIsbnLookup) {
    const trusted = await searchTrustedCatalogBaseline(trimmed);
    if (trusted.groups.length > 0) return cacheSearchResponse(cacheKey, trusted);
  }

  const google = await searchGoogleBaseline(trimmed, signal);
  if (google.groups.length > 0) return cacheSearchResponse(cacheKey, google);

  const openLibrary = await searchOpenLibraryWithAuthorFallback(trimmed, signal);
  if (openLibrary.groups.length > 0) return cacheSearchResponse(cacheKey, openLibrary);

  if (!isIsbnLookup) {
    const trusted = await searchTrustedCatalogBaseline(trimmed);
    if (trusted.groups.length > 0) return cacheSearchResponse(cacheKey, trusted);
  }

  const hardcover = await searchHardcoverWithBackoff(trimmed);
  if (hardcover.groups.length > 0) return cacheSearchResponse(cacheKey, hardcover);

  return { groups: [], totalItems: 0 };
}
