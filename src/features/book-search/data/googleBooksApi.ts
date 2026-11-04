import { httpsCallable } from 'firebase/functions';
import { Format } from '../../../types';
import { auth, functions } from '../../../lib/firebase';
import { readRuntimeJson } from '../../../platform/runtimeStorage';
import { searchInkboundTrustedCatalog } from '../../catalog/metadataContributions';
import { searchHardcover, searchHardcoverAuthorBibliography } from './hardcoverApi';
import { searchOpenLibrary, searchOpenLibraryAuthorBibliography, searchOpenLibraryTitleAuthor } from './openLibraryApi';
import { searchPenguinRandomHouse } from './penguinRandomHouseApi';
import { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';
import { combineIsbnProviderGroups, compactCatalogIsbn, equivalentCatalogIsbns } from '../isbnResolution';
import {
  catalogTitlesAreCompatible,
  hardenCatalogGroups,
  selectExactIsbnEdition,
} from '../catalogHardening';

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

export interface AuthorCatalogDiagnostics {
  googleRaw: number;
  googleCredited: number;
  providers: Array<{ provider: string; raw: number; credited: number; reportedTotal: number; error?: string; debug?: Record<string, unknown> }>;
  googleError?: string;
  mergedBeforeHardening: number;
  mergedAfterHardening: number;
}

interface GoogleBooksAuthorPage extends BookSearchResponse {
  providerTotalItems: number;
  nextStartIndex: number;
  hasMore: boolean;
  diagnostics?: AuthorCatalogDiagnostics;
}

const GOOGLE_BOOKS_PAGE_SIZE = 40;

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_BACKOFF_MS = 5 * 60 * 1000;
const ACTIVE_TAB_STORAGE_KEY = 'inkbound_active_tab';
const searchCache = new Map<string, { expiresAt: number; response: BookSearchResponse }>();
const googleAuthorPageCache = new Map<string, { expiresAt: number; payload: GoogleVolumesResponse }>();
const googleAuthorPageInFlight = new Map<string, Promise<GoogleVolumesResponse>>();
let googleBackoffUntil = 0;
let googleScannerFailure: 'rate-limit' | 'quota' | 'access-denied' | 'unavailable' | 'unknown' | null = null;
const classifyGoogleScannerFailure = (error: unknown): typeof googleScannerFailure => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/dailyLimitExceeded|quotaExceeded|daily quota/i.test(message)) return 'quota';
  if (/\b429\b|rateLimitExceeded|resource-exhausted/i.test(message)) return 'rate-limit';
  if (/\b40[13]\b|permission-denied|attestation/i.test(message)) return 'access-denied';
  if (/\b503\b|unavailable|timeout/i.test(message)) return 'unavailable';
  return 'unknown';
};

let hardcoverBackoffUntil = 0;
let prhBackoffUntil = 0;

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = compactCatalogIsbn;

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

const buildGoogleBooksAuthorQuery = (authorName: string): string => {
  const normalized = authorName.trim().replace(/"/g, '');
  return `inauthor:${normalized}`;
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

const groupAuthorsCompatible = (left: BookSearchWorkGroup, right: BookSearchWorkGroup): boolean => {
  const leftAuthor = normalizeText(left.authors[0]);
  const rightAuthor = normalizeText(right.authors[0]);
  return !leftAuthor
    || !rightAuthor
    || leftAuthor === 'unknown author'
    || rightAuthor === 'unknown author'
    || leftAuthor === rightAuthor;
};

const mergeGroups = (
  primary: BookSearchWorkGroup[],
  supplements: BookSearchWorkGroup[][],
): BookSearchWorkGroup[] => {
  // The primary provider owns result ordering. Canonical hardening sees all
  // compatible provider records so it can fill missing metadata field-by-field,
  // but supplement-only works never get injected into a successful primary
  // result set.
  const hardened = hardenCatalogGroups([...primary, ...supplements.flat()]);
  const used = new Set<string>();
  const result: BookSearchWorkGroup[] = [];

  for (const primaryGroup of primary) {
    const match = hardened.find((candidate) =>
      !used.has(candidate.key)
      && groupAuthorsCompatible(primaryGroup, candidate)
      && catalogTitlesAreCompatible(primaryGroup.title, candidate.title),
    );
    if (!match) continue;
    used.add(match.key);
    result.push(match);
  }

  return result.slice(0, 50);
};

async function searchTrustedCatalogBaseline(query: string, authorOnly = false): Promise<BookSearchResponse> {
  if (authorOnly) return searchInkboundTrustedCatalog({ author: query.trim() });
  const isbnQuery = query.trim().replace(/^isbn:\s*/i, '');
  const compact = compactIsbn(isbnQuery);
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
  if (!response.ok) {
    // Whitelist only Google's documented failure reason, never response bodies
    // or request URLs (which could contain credentials), in scanner traces.
    let reason = '';
    try {
      const failure = await response.json() as { error?: { errors?: Array<{ reason?: string }> } };
      const code = failure.error?.errors?.[0]?.reason ?? '';
      if (/^(?:dailyLimitExceeded|quotaExceeded|rateLimitExceeded|userRateLimitExceeded)$/.test(code)) {
        reason = `; ${code}`;
      }
    } catch { /* HTTP status is enough if the provider returned no JSON. */ }
    throw new Error(`Google Books search failed (${response.status}${reason}).`);
  }
  return response.json() as Promise<GoogleVolumesResponse>;
}

const googleAuthorPageKey = (authorQuery: string, startIndex: number) =>
  `${authorQuery.trim().toLowerCase()}::${startIndex}::${GOOGLE_BOOKS_PAGE_SIZE}`;

async function requestGoogleAuthorPage(
  authorQuery: string,
  startIndex: number,
  signal?: AbortSignal,
): Promise<GoogleVolumesResponse> {
  const key = googleAuthorPageKey(authorQuery, startIndex);
  const cached = googleAuthorPageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  if (cached) googleAuthorPageCache.delete(key);

  const existing = googleAuthorPageInFlight.get(key);
  if (existing) return existing;

  // Match the general Search catalog transport: a failed protected request
  // should not strand author-page retrieval when the PUBLIC Google Books API
  // is available. Firebase App Check remains enforced for protected calls.
  const request = (async () => {
    let payload: GoogleVolumesResponse;
    if (functions && auth?.currentUser) {
      try {
        payload = await requestProtectedGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (Date.now() < googleBackoffUntil) {
          throw new Error('Public Google Books fallback cooling down (429); protected author-page lookup failed.');
        }
        console.warn('Protected author-page catalog lookup unavailable; retrying public Google Books.', error);
        payload = await requestDirectGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);
      }
    } else {
      if (Date.now() < googleBackoffUntil) {
        throw new Error('Public Google Books fallback cooling down (429).');
      }
      payload = await requestDirectGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);
    }
    googleAuthorPageCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, payload });
    return payload;
  })().finally(() => {
    googleAuthorPageInFlight.delete(key);
  });

  googleAuthorPageInFlight.set(key, request);
  return request;
}

async function requestGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  let payload: GoogleVolumesResponse;
  if (functions && auth?.currentUser) {
    try {
      payload = await requestProtectedGoogleBooks(query, signal);
    } catch (protectedError) {
      if (signal?.aborted) throw protectedError;
      if (Date.now() < googleBackoffUntil) {
        throw new Error('Public Google Books fallback cooling down (429); protected lookup failed.');
      }
      console.warn('Protected Google Books lookup unavailable; retrying public Google Books.', protectedError);
      payload = await requestDirectGoogleBooks(query, signal);
    }
  } else {
    if (Date.now() < googleBackoffUntil) {
      throw new Error('Public Google Books fallback cooling down (429).');
    }
    payload = await requestDirectGoogleBooks(query, signal);
  }

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
    return { groups: [], totalItems: 0, providerTotalItems: 0, nextStartIndex: startIndex, hasMore: false };
  }
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  const authorQuery = buildGoogleBooksAuthorQuery(trimmedAuthor);
  let payload: GoogleVolumesResponse = { totalItems: 0, items: [] };
  let googleError: string | undefined;
  const googleCoolingDown = Date.now() < googleBackoffUntil;
  // Public API cooldown does not block the independent protected catalog.
  // Preserve accurate diagnostics instead of reporting zero without trying.
  if (googleCoolingDown) googleError = 'Public Google Books fallback cooling down; protected catalog may still respond.';
  try {
    if (googleCoolingDown && !(functions && auth?.currentUser)) {
      throw new Error('Public Google Books provider cooling down (429).');
    }
    // Author pages are reused by normal author-shaped Search, the author
    // catalog view and scanner recovery. Deduplicate identical in-flight calls
    // and keep the page briefly so those paths do not repeatedly spend Google
    // quota for the same author/page. A legitimate empty protected response is
    // authoritative; do not immediately repeat it against the public endpoint.
    payload = await requestGoogleAuthorPage(authorQuery, startIndex, signal);
  } catch (protectedError) {
    if (signal?.aborted) throw protectedError;
    if (shouldBackOffCatalog(protectedError)) {
      googleBackoffUntil = Math.max(googleBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
      googleError = protectedError instanceof Error ? protectedError.message : String(protectedError);
    } else try {
      if (Date.now() < googleBackoffUntil) {
        throw new Error('Public Google Books fallback cooling down (429).');
      }
      payload = await requestDirectGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);
    } catch (directError) {
      googleError = directError instanceof Error ? directError.message : String(directError);
      if (shouldBackOffCatalog(directError)) {
        googleBackoffUntil = Math.max(googleBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
      }
      console.warn('Google Books author lookup unavailable; alternate author catalogs remain available.', protectedError, directError);
    }
  }

  const rawItems = payload.items ?? [];
  const googleGroups = groupGoogleEditions(
    rawItems.map(mapGoogleVolume).filter((item): item is BookSearchEdition => Boolean(item)),
  );

  type SupplementResult = BookSearchResponse & { error?: string; providerDebug?: Record<string, unknown> };
  const safeSupplement = async (
    provider: string,
    run: () => Promise<BookSearchResponse>,
  ): Promise<SupplementResult> => {
    try {
      return await run();
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${provider} author supplement unavailable.`, error);
      return { groups: [], totalItems: 0, error: message };
    }
  };

  const supplements: SupplementResult[] = startIndex === 0
    ? await Promise.all([
        safeSupplement('Open Library', () => searchOpenLibraryAuthorBibliography(trimmedAuthor, signal, 5)),
        safeSupplement('Hardcover', () => searchHardcoverAuthorWithBackoff(trimmedAuthor)),
        safeSupplement('Penguin Random House', () => searchPrhWithBackoff(trimmedAuthor, true)),
        safeSupplement('Trusted catalog', () => searchTrustedCatalogBaseline(trimmedAuthor, true)),
      ])
    : [];

  const requestedAuthor = normalizeText(trimmedAuthor);
  const creditedToAuthor = (work: BookSearchWorkGroup) =>
    work.authors.some((author) => normalizeText(author) === requestedAuthor);
  const googleCredited = googleGroups.filter(creditedToAuthor);
  const supplementCredited = supplements.map((response) => response.groups.filter(creditedToAuthor));
  const groups = hardenCatalogGroups([
    ...googleCredited,
    ...supplementCredited.flat(),
  ]).filter(creditedToAuthor);

  const diagnostics: AuthorCatalogDiagnostics | undefined = startIndex === 0
    ? {
        googleRaw: googleGroups.length,
        googleCredited: googleCredited.length,
        ...(googleError ? { googleError } : {}),
        providers: supplements.map((response, index) => ({
          provider: ['open-library', 'hardcover', 'prh', 'trusted'][index] ?? `supplement-${index}`,
          raw: response.groups.length,
          credited: supplementCredited[index]?.length ?? 0,
          reportedTotal: response.totalItems,
          ...(response.error ? { error: response.error } : {}),
          ...(response.providerDebug ? { debug: response.providerDebug } : {}),
        })),
        mergedBeforeHardening: googleCredited.length + supplementCredited.reduce((sum, items) => sum + items.length, 0),
        mergedAfterHardening: groups.length,
      }
    : undefined;

  if (diagnostics) console.info('[Inkbound author catalog] provider merge', { author: trimmedAuthor, diagnostics });

  const providerTotalItems = Math.max(0, payload.totalItems ?? 0);
  const nextStartIndex = startIndex + rawItems.length;
  const hasMore = rawItems.length > 0 && (
    providerTotalItems > 0 ? nextStartIndex < providerTotalItems : rawItems.length === GOOGLE_BOOKS_PAGE_SIZE
  );

  return {
    groups,
    totalItems: providerTotalItems || groups.length,
    providerTotalItems,
    nextStartIndex,
    hasMore,
    diagnostics,
  };
}

async function searchGoogleBaseline(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  // Public Google Books throttling must NOT disable a healthy signed-in
  // Firebase catalog request. Android does not bundle the browser API key,
  // so its public fallback has a different quota and may cool down while
  // the protected backend is still able to return a result.
  if (Date.now() < googleBackoffUntil && !(functions && auth?.currentUser)) {
    return { groups: [], totalItems: 0 };
  }
  try {
    const response = await requestGoogleBooks(buildGoogleBooksQuery(query), signal);
    googleScannerFailure = null;
    return response;
  } catch (error) {
    googleScannerFailure = classifyGoogleScannerFailure(error);
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

async function searchHardcoverAuthorWithBackoff(authorName: string): Promise<BookSearchResponse> {
  if (Date.now() < hardcoverBackoffUntil) return { groups: [], totalItems: 0 };
  try {
    return await searchHardcoverAuthorBibliography(authorName, true);
  } catch (error) {
    if (shouldBackOffCatalog(error)) {
      hardcoverBackoffUntil = Math.max(hardcoverBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
    }
    console.warn('Hardcover author bibliography supplement failed.', error);
    return { groups: [], totalItems: 0 };
  }
}

async function searchPrhWithBackoff(query: string, authorBibliography = false): Promise<BookSearchResponse> {
  if (Date.now() < prhBackoffUntil) return { groups: [], totalItems: 0 };
  try {
    return await searchPenguinRandomHouse(query, authorBibliography, authorBibliography);
  } catch (error) {
    if (shouldBackOffCatalog(error)) {
      prhBackoffUntil = Math.max(prhBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
    }
    console.warn('Penguin Random House supplement failed.', error);
    return { groups: [], totalItems: 0 };
  }
}

function cacheSearchResponse(cacheKey: string, response: BookSearchResponse): BookSearchResponse {
  if (response.groups.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response });
  }
  return response;
}

export interface IsbnLookupResult {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
  exactIsbn: boolean;
  matchedIsbn?: string;
}

// Author identification is work-level metadata. A verified title match can
// repair a missing author without borrowing another edition's ISBN/pages/cover.
export async function enrichIsbnLookupAuthor(
  result: IsbnLookupResult,
  searchByTitle: (title: string) => Promise<BookSearchResponse> = (title) => searchGoogleBooks(title),
): Promise<IsbnLookupResult> {
  const knownAuthor = (authors: string[]) =>
    authors.some((name) => Boolean(name.trim()) && normalizeText(name) !== 'unknown author');
  if (knownAuthor(result.work.authors)) return result;
  const titleKey = normalizeText(result.work.title);
  if (!titleKey) return result;
  try {
    const response = await searchByTitle(result.work.title);
    const matching = response.groups.filter((group) =>
      normalizeText(group.title) === titleKey && knownAuthor(group.authors));
    const authorKeys = new Set(matching.map((group) =>
      group.authors.map((name) => normalizeText(name)).filter((name) => name !== 'unknown author').join('|')));
    if (authorKeys.size !== 1 || !matching.length) return result;
    return { ...result, work: { ...result.work, authors: matching[0].authors } };
  } catch {
    // An enrichment failure must not discard a valid ISBN result.
    return result;
  }
}

// Scanner-only work discovery for ISBNs absent from the regular search index.
// This endpoint is independent of Open Library's search.json and /isbn route.
// Never treat its title as proof that a particular edition's metadata matches.
async function discoverIsbnWorkFromOpenLibraryBooksApi(
  isbn: string,
  signal?: AbortSignal,
): Promise<IsbnLookupResult | null> {
  const key = `ISBN:${isbn}`;
  const params = new URLSearchParams({ bibkeys: key, format: 'json', jscmd: 'data' });
  const response = await fetch(`https://openlibrary.org/api/books?${params}`, { signal });
  if (!response.ok) return null;
  const payload = await response.json() as Record<string, {
    title?: string;
    authors?: Array<{ name?: string }>;
  }>;
  const record = payload[key];
  const title = record?.title?.trim();
  if (!title) return null;
  const authorNames = (record.authors ?? []).map((author) => author.name?.trim() ?? '').filter(Boolean);
  const searched = await searchGoogleBooks(title, signal);
  const titleKey = normalizeText(title);
  const authorKeys = authorNames.map(normalizeText);
  const matches = searched.groups.filter((group) =>
    normalizeText(group.title) === titleKey
    && (!authorKeys.length || group.authors.some((name) => authorKeys.includes(normalizeText(name)))));
  const matched = matches.find((group) => group.editions.length > 0);
  if (!matched) return null;
  return { work: matched, edition: matched.editions[0], exactIsbn: false };
}

export async function resolveCatalogIsbn(
  rawIsbn: string,
  signal?: AbortSignal,
): Promise<IsbnLookupResult | null> {
  const candidates = equivalentCatalogIsbns(rawIsbn);
  if (!candidates.length) return null;

  const combinedGroups: BookSearchWorkGroup[] = [];
  for (const candidate of candidates) {
    if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
    const response = await searchGoogleBooks(`isbn:${candidate}`, signal);
    combinedGroups.push(...response.groups);

    const exact = selectExactIsbnEdition(response.groups, candidate);
    if (exact) {
      return enrichIsbnLookupAuthor({ work: exact.work, edition: exact.edition, exactIsbn: true, matchedIsbn: candidate });
    }
  }

  const hardened = hardenCatalogGroups(combinedGroups);
  for (const candidate of candidates) {
    const exact = selectExactIsbnEdition(hardened, candidate);
    if (exact) {
      return enrichIsbnLookupAuthor({ work: exact.work, edition: exact.edition, exactIsbn: true, matchedIsbn: candidate });
    }
  }

  // The protected catalog proxy can lag behind newly published or retailer-only
  // ISBNs. Before asking a reader to type, independently query Google's public
  // ISBN index. Never silently attach the scanned ISBN to a different edition.
  for (const candidate of candidates) {
    if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
    try {
      const payload = await requestDirectGoogleBooks(`isbn:${candidate}`, signal);
      const groups = hardenCatalogGroups(groupGoogleEditions(
        (payload.items ?? []).map(mapGoogleVolume)
          .filter((item): item is BookSearchEdition => Boolean(item)),
      ));
      const exact = selectExactIsbnEdition(groups, candidate);
      if (exact) {
        return enrichIsbnLookupAuthor({ work: exact.work, edition: exact.edition, exactIsbn: true, matchedIsbn: candidate });
      }
      // Google's ISBN-specific search can return the correct work even if its
      // edition metadata lacks the identifier. Accept only an unambiguous work.
      if (groups.length === 1 && groups[0].editions.length > 0) {
        return enrichIsbnLookupAuthor({ work: groups[0], edition: groups[0].editions[0], exactIsbn: false });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Direct Google Books ISBN recovery unavailable.', error);
    }
  }

  // An alternate Open Library bibliographic endpoint may recognize an ISBN
  // missing from the search index. Only use it to discover the work and offer
  // a catalog edition; it does not verify the scanned physical edition.
  for (const candidate of candidates) {
    if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
    try {
      const discovered = await discoverIsbnWorkFromOpenLibraryBooksApi(candidate, signal);
      if (discovered) return enrichIsbnLookupAuthor(discovered);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Alternate ISBN work discovery unavailable.', error);
    }
  }

  // No catalog has proved this ISBN. Do not promote an unrelated first
  // relevance result into a physical-edition suggestion. Keep the scanned
  // identifier for explicit title/cover/manual recovery instead.

  return null;
}

// Scanner-only cover recovery. Unlike normal Search, cover OCR must inspect
// matching works from every catalog because a noisy Google relevance result
// must not hide an exact title/author match returned only by a supplement.
// The scanner still verifies title + author against OCR before offering it.
// Scanner-only exact-title recovery. Cover OCR often gives us a literal title,
// so do not force that evidence through broad relevance ranking. Query Google's
// title index directly and keep only catalog works whose normalized title is
// exactly the OCR title or begins with it before a subtitle. This does not
// change normal Search and does not weaken cover title+author verification.
export async function searchScannerCoverTitleCatalog(
  title: string,
  signal?: AbortSignal,
  onTrace?: (trace: ScannerCatalogProviderTrace) => void,
): Promise<BookSearchResponse> {
  const trimmed = title.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  // This scanner-only lookup must NOT depend on Google alone. In real stores
  // Google can be unavailable/rate-limited even when the photographed title
  // was OCR'd exactly. Ask independent catalogs concurrently and retain only
  // works whose primary title matches the photograph. The caller still verifies
  // the photographed author; this is retrieval, never identity acceptance.
  const escaped = trimmed.replace(/"/g, '');
  const googleExact = async (): Promise<BookSearchResponse> => {
    if (Date.now() < googleBackoffUntil && !(functions && auth?.currentUser)) {
      return { groups: [], totalItems: 0 };
    }
    try {
      // Use Search's canonical protected-first transport, not a scanner-only
      // unkeyed public Google request. The latter was rate-limited on Android.
      const response = await requestGoogleBooks(`intitle:"${escaped}"`, signal);
      googleScannerFailure = null;
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      googleScannerFailure = classifyGoogleScannerFailure(error);
      if (shouldBackOffCatalog(error)) {
        googleBackoffUntil = Math.max(googleBackoffUntil, Date.now() + CATALOG_BACKOFF_MS);
      }
      console.warn('Scanner exact-title Google Books retrieval unavailable; using independent catalogs.', error);
      return { groups: [], totalItems: 0 };
    }
  };
  const [google, openLibrary, hardcover, prh, trusted] = await Promise.all([
    googleExact(),
    // Explicit title operator prevents a failed title lookup from issuing an
    // unrelated author search for the same string.
    searchOpenLibrary(`intitle:"${escaped}"`, signal).catch((error) => {
      if (signal?.aborted) throw error;
      console.warn('Scanner exact-title Open Library retrieval unavailable.', error);
      return { groups: [], totalItems: 0 };
    }),
    searchHardcoverWithBackoff(trimmed),
    searchPrhWithBackoff(trimmed),
    searchTrustedCatalogBaseline(trimmed).catch((error) => {
      if (signal?.aborted) throw error;
      console.warn('Scanner exact-title trusted catalog unavailable.', error);
      return { groups: [], totalItems: 0 };
    }),
  ]);

  const titleKey = normalizeText(trimmed);
  const groups = hardenCatalogGroups([
    ...google.groups, ...openLibrary.groups, ...hardcover.groups,
    ...prh.groups, ...trusted.groups,
  ]).filter((work) => {
    const workTitle = normalizeText(work.title);
    return workTitle === titleKey || workTitle.startsWith(`${titleKey} `);
  });
  if (onTrace) {
    const sources = [
      { name: 'Google', response: google, cooling: Date.now() < googleBackoffUntil, detail: googleScannerFailure },
      { name: 'Open Library', response: openLibrary, cooling: false, detail: null },
      { name: 'Hardcover', response: hardcover, cooling: Date.now() < hardcoverBackoffUntil, detail: null },
      { name: 'PRH', response: prh, cooling: Date.now() < prhBackoffUntil, detail: null },
      { name: 'Trusted', response: trusted, cooling: false, detail: null },
    ];
    onTrace({
      query: trimmed,
      providers: sources.map(({ name, response, cooling, detail }) => ({
        name,
        count: response.groups.length,
        status: cooling ? 'cooldown' as const : response.groups.length ? 'ok' as const : detail ? 'error' as const : 'empty' as const,
        ...(detail ? { detail } : {}),
      })),
      beforeHardening: sources.reduce((sum, source) => sum + source.response.groups.length, 0),
      afterHardening: groups.length,
    });
  }
  return { groups, totalItems: groups.length };
}

// Scanner-only independent fielded retrieval before broad OCR fallback.
// Open Library may have hundreds of unrelated works for a one-word title;
// constrain by the author visible on the photographed cover first.
export async function searchScannerCoverTitleAuthorCatalog(
  title: string,
  author: string,
  signal?: AbortSignal,
): Promise<BookSearchResponse> {
  if (!title.trim() || !author.trim()) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
  await waitUntilAdministrationInactive(signal);
  const response = await searchOpenLibraryTitleAuthor(title, author, signal);
  const normalizedTitle = normalizeText(title);
  const groups = hardenCatalogGroups(response.groups).filter((work) => {
    const bookTitle = normalizeText(work.title);
    return bookTitle === normalizedTitle || bookTitle.startsWith(`${normalizedTitle} `);
  });
  return { groups, totalItems: groups.length };
}

export async function searchScannerAuthorCatalog(
  authorName: string,
  signal?: AbortSignal,
): Promise<BookSearchResponse> {
  const trimmed = authorName.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  // Scanner-only bibliography recovery. Broad text searches can stop after a
  // handful of relevance-ranked works, which hides newer/less-indexed titles.
  // Ask providers explicitly for the author and retain only exact author
  // credits before OCR title verification sees these works.
  // Google is intentionally included here as a PAGINATED author bibliography,
  // not a relevance-ranked text search. This path only runs during scanner
  // recovery after cover OCR has already supplied author-shaped evidence.
  // Walking a bounded bibliography prevents a newer/retailer title from being
  // hidden simply because it was not in Google's first relevance page.
  const googleAuthorBibliography = async (): Promise<BookSearchResponse> => {
    const groups: BookSearchWorkGroup[] = [];
    let startIndex = 0;
    for (let page = 0; page < 8; page += 1) {
      if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
      const response = await searchGoogleBooksAuthorPage(trimmed, startIndex, signal);
      groups.push(...response.groups);
      if (!response.hasMore || response.nextStartIndex <= startIndex) break;
      startIndex = response.nextStartIndex;
    }
    return { groups, totalItems: groups.length };
  };

  const [google, openLibrary, hardcover, prh, trusted] = await Promise.all([
    googleAuthorBibliography().catch((error) => {
      console.warn('Google Books scanner author bibliography unavailable.', error);
      return { groups: [], totalItems: 0 };
    }),
    searchOpenLibraryAuthorBibliography(trimmed, signal, 8).catch((error) => {
      console.warn('Open Library scanner author bibliography unavailable.', error);
      return { groups: [], totalItems: 0 };
    }),
    searchHardcoverAuthorWithBackoff(trimmed),
    searchPrhWithBackoff(trimmed),
    searchTrustedCatalogBaseline(trimmed).catch((error) => {
      console.warn('Trusted catalog scanner author supplement failed.', error);
      return { groups: [], totalItems: 0 };
    }),
  ]);

  const requestedAuthor = normalizeText(trimmed);
  const requestedWords = requestedAuthor.split(/\s+/).filter(Boolean);
  const creditedToAuthor = (work: BookSearchWorkGroup) =>
    work.authors.some((author) => {
      const normalizedAuthor = normalizeText(author);
      if (normalizedAuthor === requestedAuthor) return true;
      // Scanner surname recovery intentionally supplies only the surname when
      // OCR damages a short given name. Treat a single requested token as a
      // complete author-name token, never a substring (REID matches Ava Reid,
      // but not Reidinger). Final cover verification still requires both the
      // catalog surname and approximate full title from the photograph.
      if (requestedWords.length !== 1 || requestedWords[0].length < 4) return false;
      return normalizedAuthor.split(/\s+/).includes(requestedWords[0]);
    });

  const groups = hardenCatalogGroups([
    ...google.groups,
    ...openLibrary.groups,
    ...hardcover.groups,
    ...prh.groups,
    ...trusted.groups,
  ]).filter(creditedToAuthor);

  return { groups, totalItems: groups.length };
}

export type ScannerCatalogProviderTrace = {
  query: string;
  providers: Array<{ name: string; count: number; status: 'ok' | 'empty' | 'cooldown' | 'error'; detail?: string }>;
  beforeHardening: number;
  afterHardening: number;
};

export async function searchScannerCoverCatalog(
  query: string,
  signal?: AbortSignal,
  onTrace?: (trace: ScannerCatalogProviderTrace) => void,
): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  const [google, openLibrary, hardcover, prh, trusted] = await Promise.all([
    searchGoogleBaseline(trimmed, signal),
    searchOpenLibraryWithAuthorFallback(trimmed, signal),
    searchHardcoverWithBackoff(trimmed),
    searchPrhWithBackoff(trimmed),
    searchTrustedCatalogBaseline(trimmed).catch((error) => {
      console.warn('Trusted catalog scanner supplement failed.', error);
      return { groups: [], totalItems: 0 };
    }),
  ]);

  const originalGroups = [
    ...google.groups,
    ...openLibrary.groups,
    ...hardcover.groups,
    ...prh.groups,
    ...trusted.groups,
  ];
  const groups = hardenCatalogGroups(originalGroups);
  if (onTrace) {
    const providerEntries = [
      { name: 'Google', response: google, cooling: Date.now() < googleBackoffUntil, detail: googleScannerFailure },
      { name: 'Open Library', response: openLibrary, cooling: false, detail: null },
      { name: 'Hardcover', response: hardcover, cooling: Date.now() < hardcoverBackoffUntil, detail: null },
      { name: 'PRH', response: prh, cooling: Date.now() < prhBackoffUntil, detail: null },
      { name: 'Trusted', response: trusted, cooling: false, detail: null },
    ];
    onTrace({ query: trimmed,
      providers: providerEntries.map(({ name, response, cooling, detail }) => ({
        name, count: response.groups.length,
        status: cooling ? 'cooldown' as const : response.groups.length ? 'ok' as const : detail ? 'error' as const : 'empty' as const,
        ...(detail ? { detail } : {}),
      })),
      beforeHardening: originalGroups.length, afterHardening: groups.length,
    });
  }
  return { groups, totalItems: groups.length };
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

  // An ISBN is an exact identifier, not a relevance-ranked title search.
  // Do not discard an exact match from Open Library, PRH, or Hardcover just
  // because Google (or the trusted catalog) returned a different work first.
  // Title/author searches below retain their Google-first ranking unchanged.
  if (isIsbnLookup) {
    // Google Books and Open Library understand the explicit isbn: operator.
    // Hardcover, PRH, and the trusted catalog are more reliable when given the
    // identifier itself rather than provider-specific query syntax.
    const exactIsbn = compactIsbn(trimmed.replace(/^isbn:\s*/i, ''));
    const [trusted, google, openLibrary, hardcover, prh] = await Promise.all([
      searchTrustedCatalogBaseline(exactIsbn).catch((error) => {
        console.warn('Trusted catalog ISBN lookup failed; alternate catalogs remain available.', error);
        return { groups: [], totalItems: 0 };
      }),
      searchGoogleBaseline(`isbn:${exactIsbn}`, signal),
      searchOpenLibraryWithAuthorFallback(`isbn:${exactIsbn}`, signal),
      searchHardcoverWithBackoff(exactIsbn),
      searchPrhWithBackoff(exactIsbn),
    ]);
    const groups = combineIsbnProviderGroups([
      trusted.groups, google.groups, openLibrary.groups, hardcover.groups, prh.groups,
    ]);
    return cacheSearchResponse(cacheKey, { groups, totalItems: groups.length });
  }

  const [google, openLibrary, hardcover, prh] = await Promise.all([
    searchGoogleBaseline(trimmed, signal),
    searchOpenLibraryWithAuthorFallback(trimmed, signal),
    searchHardcoverWithBackoff(trimmed),
    searchPrhWithBackoff(trimmed),
  ]);

  if (google.groups.length > 0) {
    return cacheSearchResponse(cacheKey, {
      groups: mergeGroups(google.groups, [openLibrary.groups, hardcover.groups, prh.groups]),
      totalItems: google.totalItems,
    });
  }

  if (openLibrary.groups.length > 0) {
    return cacheSearchResponse(cacheKey, {
      groups: mergeGroups(openLibrary.groups, [hardcover.groups, prh.groups]),
      totalItems: openLibrary.totalItems,
    });
  }

  if (!isIsbnLookup) {
    const trusted = await searchTrustedCatalogBaseline(trimmed);
    if (trusted.groups.length > 0) {
      return cacheSearchResponse(cacheKey, {
        groups: mergeGroups(trusted.groups, [hardcover.groups, prh.groups]),
        totalItems: trusted.totalItems,
      });
    }
  }

  if (hardcover.groups.length > 0) return cacheSearchResponse(cacheKey, hardcover);
  if (prh.groups.length > 0) return cacheSearchResponse(cacheKey, prh);

  return { groups: [], totalItems: 0 };
}
