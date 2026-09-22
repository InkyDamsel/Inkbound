import { httpsCallable } from 'firebase/functions';
import { Format } from '../../../types';
import { auth, functions } from '../../../lib/firebase';
import { readRuntimeJson } from '../../../platform/runtimeStorage';
import { searchInkboundTrustedCatalog } from '../../catalog/metadataContributions';
import { searchHardcover } from './hardcoverApi';
import { searchOpenLibrary, searchOpenLibraryPage } from './openLibraryApi';
import { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';
import { resolveGoogleSeriesMetadata } from '../mapping/googleSeriesMetadata';
import { catalogTitlesAreCompatible, hardenCatalogGroups, hardenCatalogResponse, mergeCatalogEditionData, selectExactIsbnEdition } from '../catalogHardening';

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
    seriesInfo?: {
      shortSeriesBookTitle?: string;
      bookDisplayNumber?: string;
      volumeSeries?: Array<{ seriesId?: string; seriesBookType?: string; orderNumber?: number; issue?: Array<{ issueOrderNumber?: number }> }>;
    };
  };
  saleInfo?: { isEbook?: boolean };
}

interface GoogleVolumesResponse {
  totalItems?: number;
  items?: GoogleVolume[];
  seriesMetadataById?: Record<string, string>;
}

export interface GoogleBooksCatalogPage extends BookSearchResponse {
  providerTotalItems: number;
  nextStartIndex: number;
  hasMore: boolean;
}

export type GoogleBooksAuthorPage = GoogleBooksCatalogPage;

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_BACKOFF_MS = 5 * 60 * 1000;
const ACTIVE_TAB_STORAGE_KEY = 'inkbound_active_tab';
const GOOGLE_BOOKS_PAGE_SIZE = 40;
const searchCache = new Map<string, { expiresAt: number; response: BookSearchResponse }>();
let googleBackoffUntil = 0;
let hardcoverBackoffUntil = 0;

const shouldUseProtectedGoogleBooks = (): boolean =>
  !import.meta.env.DEV && Boolean(functions && auth?.currentUser);

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

const isGoogleQuotaError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b429\b|quota exceeded|resource-exhausted|queries per day/i.test(message);
};

const googleBooksErrorDetail = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Fall through to a short plain-text response body.
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 300);
};

export const buildGoogleBooksQuery = (value: string): string => {
  const trimmed = value.trim();
  const compact = compactIsbn(trimmed);
  if (/^(?:97[89])?\d{9}[\dX]$/i.test(compact)) return `isbn:${compact}`;
  return trimmed;
};

const publicationYear = (value?: string): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : 0;
};

const inferFormat = (volume: GoogleVolume): Format => volume.saleInfo?.isEbook ? 'ebook' : 'hardcover';

const getIdentifier = (volume: GoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const coverUrl = (volume: GoogleVolume): string | undefined => {
  const links = volume.volumeInfo?.imageLinks;
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return source?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const mapGoogleVolume = (
  volume: GoogleVolume,
  seriesMetadataById: Record<string, string> = {},
): BookSearchEdition | null => {
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
    seriesName: resolveGoogleSeriesMetadata(info.seriesInfo, seriesMetadataById).name,
    seriesOrder: resolveGoogleSeriesMetadata(info.seriesInfo, seriesMetadataById).order,
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
      existing.editions[duplicateIndex] = mergeCatalogEditionData(current, edition);
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

const GOOGLE_DETAIL_HYDRATION_LIMIT = 20;

async function hydrateGoogleVolumeDetails(
  payload: GoogleVolumesResponse,
  signal?: AbortSignal,
): Promise<GoogleVolumesResponse> {
  const items = payload.items ?? [];
  if (items.length === 0) return payload;

  const hydrated = await Promise.all(items.map(async (volume, index) => {
    const info = volume.volumeInfo;
    const needsDetail = !info?.pageCount || !info?.seriesInfo?.volumeSeries?.length;
    if (!needsDetail || index >= GOOGLE_DETAIL_HYDRATION_LIMIT || !volume.id) return volume;

    try {
      const response = await fetch(
        `${GOOGLE_BOOKS_ENDPOINT}/${encodeURIComponent(volume.id)}?projection=full`,
        { signal },
      );
      if (!response.ok) return volume;
      const detail = await response.json() as GoogleVolume;
      return {
        ...volume,
        ...detail,
        volumeInfo: {
          ...volume.volumeInfo,
          ...detail.volumeInfo,
          // Preserve any list-only values while preferring the fully hydrated
          // volume detail for page count and series metadata.
          seriesInfo: detail.volumeInfo?.seriesInfo ?? volume.volumeInfo?.seriesInfo,
          pageCount: detail.volumeInfo?.pageCount ?? volume.volumeInfo?.pageCount,
        },
        saleInfo: {
          ...volume.saleInfo,
          ...detail.saleInfo,
        },
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Google Books volume detail lookup unavailable.', error);
      return volume;
    }
  }));

  return { ...payload, items: hydrated };
}

async function enrichGoogleSeriesMetadata(
  payload: GoogleVolumesResponse,
  signal?: AbortSignal,
): Promise<GoogleVolumesResponse> {
  if (payload.seriesMetadataById && Object.keys(payload.seriesMetadataById).length > 0) return payload;

  const ids = [...new Set((payload.items ?? []).flatMap((volume) =>
    volume.volumeInfo?.seriesInfo?.volumeSeries
      ?.map((item) => item.seriesId?.trim())
      .filter((value): value is string => Boolean(value)) ?? [],
  ))];
  if (ids.length === 0) return payload;

  try {
    const seriesParams = new URLSearchParams();
    ids.forEach((id) => seriesParams.append('series_id', id));
    const seriesResponse = await fetch(`https://www.googleapis.com/books/v1/series/get?${seriesParams.toString()}`, { signal });
    if (!seriesResponse.ok) return payload;
    const seriesPayload = await seriesResponse.json() as { series?: Array<{ seriesId?: string; title?: string }> };
    return {
      ...payload,
      seriesMetadataById: Object.fromEntries(
        (seriesPayload.series ?? []).flatMap((series) =>
          series.seriesId?.trim() && series.title?.trim()
            ? [[series.seriesId.trim(), series.title.trim()] as const]
            : [],
        ),
      ),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Google Books series metadata lookup unavailable in browser search.', error);
    return payload;
  }
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
  const hydrated = await hydrateGoogleVolumeDetails(response.data, signal);
  return enrichGoogleSeriesMetadata(hydrated, signal);
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
    startIndex: String(startIndex),
    maxResults: String(maxResults),
  });

  // Public Google Books catalog queries do not need the browser to carry an API
  // key. Keeping VITE_GOOGLE_BOOKS_API_KEY out of this request prevents stale or
  // invalid local env values from breaking search before Firebase auth is ready.
  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) {
    const detail = googleBooksErrorDetail(await response.text());
    throw new Error(`Google Books search failed (${response.status})${detail ? `: ${detail}` : '.'}`);
  }
  const payload = await response.json() as GoogleVolumesResponse;
  const hydrated = await hydrateGoogleVolumeDetails(payload, signal);
  return enrichGoogleSeriesMetadata(hydrated, signal);
}

async function requestGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const payload = shouldUseProtectedGoogleBooks()
    ? await requestProtectedGoogleBooks(query, signal)
    : await requestDirectGoogleBooks(query, signal);

  const editions = (payload.items ?? [])
    .map((volume) => mapGoogleVolume(volume, payload.seriesMetadataById))
    .filter((item): item is BookSearchEdition => Boolean(item));
  const groups = hardenCatalogGroups(groupGoogleEditions(editions));
  return { groups, totalItems: payload.totalItems ?? groups.length };
}

export async function searchGoogleBooksPage(
  query: string,
  startIndex = 0,
  signal?: AbortSignal,
): Promise<GoogleBooksCatalogPage> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0, providerTotalItems: 0, nextStartIndex: startIndex, hasMore: false };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);
  const builtQuery = buildGoogleBooksQuery(trimmed);

  try {
    const payload = shouldUseProtectedGoogleBooks()
      ? await requestProtectedGoogleBooks(builtQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE)
      : await requestDirectGoogleBooks(builtQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);

    const rawItems = payload.items ?? [];
    const editions = rawItems
      .map((volume) => mapGoogleVolume(volume, payload.seriesMetadataById))
      .filter((item): item is BookSearchEdition => Boolean(item));
    let groups = hardenCatalogGroups(groupGoogleEditions(editions), { searchQuery: trimmed });

    // The Add Reading Material screen prefers this paged path. Enrich the first
    // page with the same supplemental metadata sources used by the standard
    // catalog chain so pagination does not silently lose series metadata.
    if (startIndex === 0 && groups.length > 0) {
      const [trusted, openLibrary, hardcover] = await Promise.all([
        searchTrustedCatalogBaseline(trimmed).catch(() => ({ groups: [], totalItems: 0 })),
        searchOpenLibraryWithAuthorFallback(trimmed, signal).catch(() => ({ groups: [], totalItems: 0 })),
        searchHardcoverWithBackoff(trimmed),
      ]);
      groups = hardenCatalogGroups(
        mergeGroups(groups, [trusted.groups, openLibrary.groups, hardcover.groups]),
        { searchQuery: trimmed },
      );
    }

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
  } catch (error) {
    if (!isGoogleQuotaError(error)) throw error;
    googleBackoffUntil = Math.max(googleBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
    console.warn('Google Books quota is exhausted; using paged Open Library results instead.', error);
    return searchOpenLibraryPage(builtQuery, startIndex, GOOGLE_BOOKS_PAGE_SIZE, signal);
  }
}

export async function searchGoogleBooksAuthorPage(
  authorName: string,
  startIndex = 0,
  signal?: AbortSignal,
): Promise<GoogleBooksAuthorPage> {
  const trimmedAuthor = authorName.trim();
  if (!trimmedAuthor) return { groups: [], totalItems: 0, providerTotalItems: 0, nextStartIndex: startIndex, hasMore: false };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);
  const query = `inauthor:${trimmedAuthor}`;

  try {
    const payload = shouldUseProtectedGoogleBooks()
      ? await requestProtectedGoogleBooks(query, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE)
      : await requestDirectGoogleBooks(query, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);

    const rawItems = payload.items ?? [];
    const editions = rawItems
      .map((volume) => mapGoogleVolume(volume, payload.seriesMetadataById))
      .filter((item): item is BookSearchEdition => Boolean(item));
    const groups = hardenCatalogGroups(groupGoogleEditions(editions), { preferredAuthor: trimmedAuthor });
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
  } catch (error) {
    if (!isGoogleQuotaError(error)) throw error;
    googleBackoffUntil = Math.max(googleBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
    console.warn('Google Books quota is exhausted for author lookup; using paged Open Library results instead.', error);
    return searchOpenLibraryPage(query, startIndex, GOOGLE_BOOKS_PAGE_SIZE, signal);
  }
}

const groupNeedsTargetedGoogleEnrichment = (group: BookSearchWorkGroup): boolean =>
  !group.editions.some((edition) => edition.pageCount)
  || !group.editions.some((edition) => edition.seriesName);

async function enrichThinCatalogGroupsWithGoogle(
  groups: BookSearchWorkGroup[],
  signal?: AbortSignal,
): Promise<BookSearchWorkGroup[]> {
  const targets = groups.filter(groupNeedsTargetedGoogleEnrichment).slice(0, 8);
  if (targets.length === 0) return groups;

  const targeted = await Promise.all(targets.map(async (group) => {
    const author = group.authors.find((value) => normalizeText(value) !== 'unknown author') ?? '';
    const title = group.title.trim();
    if (!title || !author) return [] as BookSearchWorkGroup[];

    try {
      const query = `intitle:"${title}" inauthor:"${author}"`;
      const payload = shouldUseProtectedGoogleBooks()
        ? await requestProtectedGoogleBooks(query, signal, 0, 10)
        : await requestDirectGoogleBooks(query, signal, 0, 10);
      return hardenCatalogGroups(
        groupGoogleEditions(
          (payload.items ?? [])
            .map((volume) => mapGoogleVolume(volume, payload.seriesMetadataById))
            .filter((edition): edition is BookSearchEdition => Boolean(edition)),
        ),
        { preferredAuthor: author },
      ).filter((candidate) =>
        normalizeText(candidate.authors[0]) === normalizeText(author)
        && catalogTitlesAreCompatible(group.title, candidate.title),
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Targeted Google Books enrichment unavailable.', error);
      return [] as BookSearchWorkGroup[];
    }
  }));

  return hardenCatalogGroups([...groups, ...targeted.flat()]);
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
  const hardened = hardenCatalogResponse(response);
  if (hardened.groups.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response: hardened });
  }
  return hardened;
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

  if (isIsbnLookup) {
    const [trusted, google, openLibrary, hardcover] = await Promise.all([
      searchTrustedCatalogBaseline(trimmed).catch(() => ({ groups: [], totalItems: 0 })),
      searchGoogleBaseline(trimmed, signal),
      searchOpenLibraryWithAuthorFallback(trimmed, signal),
      searchHardcoverWithBackoff(trimmed),
    ]);
    const combined = hardenCatalogGroups(
      [...trusted.groups, ...google.groups, ...openLibrary.groups, ...hardcover.groups],
      { searchQuery: trimmed },
    );
    const exact = selectExactIsbnEdition(combined, compactIsbn(trimmed));
    if (!exact) return { groups: [], totalItems: 0 };
    return cacheSearchResponse(cacheKey, {
      groups: [{ ...exact.work, editions: [exact.edition] }],
      totalItems: 1,
    });
  }

  const [google, openLibrary, trusted, hardcover] = await Promise.all([
    searchGoogleBaseline(trimmed, signal).catch(() => ({ groups: [], totalItems: 0 })),
    searchOpenLibraryWithAuthorFallback(trimmed, signal).catch(() => ({ groups: [], totalItems: 0 })),
    searchTrustedCatalogBaseline(trimmed).catch(() => ({ groups: [], totalItems: 0 })),
    searchHardcoverWithBackoff(trimmed),
  ]);

  let combined = hardenCatalogGroups(
    [...trusted.groups, ...google.groups, ...openLibrary.groups, ...hardcover.groups],
    { searchQuery: trimmed },
  );
  if (combined.length === 0) return { groups: [], totalItems: 0 };

  combined = await enrichThinCatalogGroupsWithGoogle(combined, signal);

  // Work-level fields (summary/genres) may safely supplement the same title and
  // author across providers, while edition-level fields only merge when the
  // edition identity matches. This is the canonical catalog result used by
  // search, metadata sync, and Series Detective.
  return cacheSearchResponse(cacheKey, {
    groups: combined,
    totalItems: Math.max(google.totalItems, openLibrary.totalItems, trusted.totalItems, hardcover.totalItems, combined.length),
  });
}
