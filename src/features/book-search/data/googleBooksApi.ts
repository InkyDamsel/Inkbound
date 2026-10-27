import { httpsCallable } from 'firebase/functions';
import { Format } from '../../../types';
import { auth, functions } from '../../../lib/firebase';
import { readRuntimeJson } from '../../../platform/runtimeStorage';
import { searchInkboundTrustedCatalog } from '../../catalog/metadataContributions';
import { searchHardcover } from './hardcoverApi';
import { searchOpenLibrary, searchOpenLibraryAuthorBibliography } from './openLibraryApi';
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
  return `inauthor:"${normalized}"`;
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

async function searchTrustedCatalogBaseline(query: string): Promise<BookSearchResponse> {
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
  if (!response.ok) throw new Error(`Google Books search failed (${response.status}).`);
  return response.json() as Promise<GoogleVolumesResponse>;
}

async function requestGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  let payload: GoogleVolumesResponse;
  if (functions && auth?.currentUser) {
    try {
      payload = await requestProtectedGoogleBooks(query, signal);
    } catch (protectedError) {
      if (signal?.aborted) throw protectedError;
      console.warn('Protected Google Books lookup unavailable; retrying public Google Books.', protectedError);
      payload = await requestDirectGoogleBooks(query, signal);
    }
  } else {
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

  const authorQuery = buildGoogleBooksAuthorQuery(trimmedAuthor);
  let payload: GoogleVolumesResponse;
  try {
    payload = functions && auth?.currentUser
      ? await requestProtectedGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE)
      : await requestDirectGoogleBooks(authorQuery, signal, startIndex, GOOGLE_BOOKS_PAGE_SIZE);
  } catch (protectedError) {
    if (signal?.aborted) throw protectedError;

    try {
      // Author pages must remain usable even when the local/protected callable
      // is stale or unavailable. This uses the same canonical Google mapper and
      // query shape as normal Search; only the transport falls back to public.
      payload = await requestDirectGoogleBooks(
        authorQuery,
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

      const fallback = await searchGoogleBooks(authorQuery, signal);
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
  const googleGroups = groupGoogleEditions(editions);
  const prh = startIndex === 0
    ? await searchPrhWithBackoff(trimmedAuthor)
    : { groups: [], totalItems: 0 };
  // Author pages must only contain works credited to the selected author.
  // PRH's broad text lookup can return books mentioning the name in a title
  // or description; do not let those pollute an otherwise accurate catalog.
  const requestedAuthor = normalizeText(trimmedAuthor);
  const creditedToAuthor = (work: BookSearchWorkGroup) =>
    work.authors.some((author) => normalizeText(author) === requestedAuthor);
  const groups = hardenCatalogGroups([
    ...googleGroups.filter(creditedToAuthor),
    ...prh.groups.filter(creditedToAuthor),
  ]).filter(creditedToAuthor);
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

async function searchPrhWithBackoff(query: string): Promise<BookSearchResponse> {
  if (Date.now() < prhBackoffUntil) return { groups: [], totalItems: 0 };
  try {
    return await searchPenguinRandomHouse(query);
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

  // Some catalogs can identify a work from the raw barcode text even when the
  // exact edition record is missing or the provider attached incomplete ISBN
  // metadata. Treat this as a work-level fallback, never as a verified edition.
  for (const candidate of candidates) {
    if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
    const response = await searchGoogleBooks(candidate, signal);
    const fallbackWork = response.groups[0];
    const fallbackEdition = fallbackWork?.editions[0];
    if (fallbackWork && fallbackEdition) {
      return enrichIsbnLookupAuthor({ work: fallbackWork, edition: fallbackEdition, exactIsbn: false });
    }
  }

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
): Promise<BookSearchResponse> {
  const trimmed = title.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  await waitUntilAdministrationInactive(signal);

  const escaped = trimmed.replace(/"/g, '');
  let payload: GoogleVolumesResponse;
  try {
    payload = await requestDirectGoogleBooks(`intitle:"${escaped}"`, signal);
  } catch (error) {
    console.warn('Scanner exact-title Google Books recovery unavailable.', error);
    return { groups: [], totalItems: 0 };
  }

  const titleKey = normalizeText(trimmed);
  const groups = hardenCatalogGroups(groupGoogleEditions(
    (payload.items ?? []).map(mapGoogleVolume)
      .filter((item): item is BookSearchEdition => Boolean(item)),
  )).filter((work) => {
    const workTitle = normalizeText(work.title);
    return workTitle === titleKey || workTitle.startsWith(`${titleKey} `);
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
  const [openLibrary, hardcover, prh, trusted] = await Promise.all([
    searchOpenLibraryAuthorBibliography(trimmed, signal).catch((error) => {
      console.warn('Open Library scanner author bibliography unavailable.', error);
      return { groups: [], totalItems: 0 };
    }),
    searchHardcoverWithBackoff(trimmed),
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
    ...openLibrary.groups,
    ...hardcover.groups,
    ...prh.groups,
    ...trusted.groups,
  ]).filter(creditedToAuthor);

  return { groups, totalItems: groups.length };
}

export async function searchScannerCoverCatalog(
  query: string,
  signal?: AbortSignal,
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

  const groups = hardenCatalogGroups([
    ...google.groups,
    ...openLibrary.groups,
    ...hardcover.groups,
    ...prh.groups,
    ...trusted.groups,
  ]);
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
