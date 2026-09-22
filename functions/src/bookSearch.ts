import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const GOOGLE_BOOKS_API_KEY = defineSecret('GOOGLE_BOOKS_API_KEY');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const GOOGLE_BOOKS_CACHE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_BOOKS_CACHE_MAX = 500;
const GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_MAX = 1000;

type GoogleBibliographicSeriesInfo = { name: string; position?: number };
type GoogleBooksCatalogPayload = { totalItems: number; items: unknown[]; seriesMetadataById?: Record<string, string> };
const googleBibliographicSeriesCache = new Map<string, { expiresAt: number; value: GoogleBibliographicSeriesInfo | null }>();
const googleBooksCache = new Map<string, { expiresAt: number; payload: GoogleBooksCatalogPayload }>();

interface SearchResult {
  id?: number | string;
  title?: string;
  subtitle?: string;
  author_names?: string[];
  authors?: Array<{ name?: string }> | string[];
  image?: { url?: string } | string;
  image_url?: string;
  pages?: number;
  release_year?: number;
  description?: string;
  slug?: string;
}

interface HardcoverBook {
  id?: number | string;
  title?: string;
  subtitle?: string;
  description?: string;
  release_year?: number;
  image?: { url?: string };
  book_series?: Array<{
    position?: number;
    series?: { id?: number | string; name?: string };
  }>;
}

interface HardcoverEdition {
  id?: number | string;
  book_id?: number | string;
  title?: string;
  pages?: number;
  isbn_10?: string;
  isbn_13?: string;
  release_date?: string;
  edition_format?: string;
  image?: { url?: string };
  publisher?: { name?: string };
  book?: HardcoverBook;
}

const normalizeFormat = (value?: string): 'hardcover' | 'paperback' | 'ebook' | 'audiobook' => {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('audio')) return 'audiobook';
  if (normalized.includes('ebook') || normalized.includes('digital') || normalized.includes('kindle')) return 'ebook';
  if (normalized.includes('paper')) return 'paperback';
  return 'hardcover';
};

const imageUrl = (value?: SearchResult['image']): string | undefined =>
  typeof value === 'string' ? value : value?.url;

const authorNames = (result: SearchResult): string[] => {
  if (result.author_names?.length) return result.author_names.filter(Boolean);
  if (Array.isArray(result.authors)) {
    return result.authors
      .map((author) => typeof author === 'string' ? author : author?.name ?? '')
      .filter(Boolean);
  }
  return ['Unknown author'];
};

const parseSearchResults = (value: unknown): SearchResult[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (record.document && typeof record.document === 'object') return [record.document as SearchResult];
      return [item as SearchResult];
    });
  }
  if (typeof value === 'string') {
    try {
      return parseSearchResults(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
};

async function hardcoverGraphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(HARDCOVER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Hardcover returned ${response.status}.`);
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'Hardcover search failed.');
  if (!payload.data) throw new Error('Hardcover returned an empty response.');
  return payload.data;
}

const googleBooksCacheKey = (query: string, startIndex: number, maxResults: number) =>
  `${query.trim().toLowerCase()}::${startIndex}::${maxResults}`;

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

function readGoogleBooksCache(query: string, startIndex: number, maxResults: number): GoogleBooksCatalogPayload | undefined {
  const key = googleBooksCacheKey(query, startIndex, maxResults);
  const cached = googleBooksCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    googleBooksCache.delete(key);
    return undefined;
  }
  googleBooksCache.delete(key);
  googleBooksCache.set(key, cached);
  return cached.payload;
}

function writeGoogleBooksCache(query: string, startIndex: number, maxResults: number, payload: GoogleBooksCatalogPayload) {
  const key = googleBooksCacheKey(query, startIndex, maxResults);
  googleBooksCache.set(key, { expiresAt: Date.now() + GOOGLE_BOOKS_CACHE_TTL_MS, payload });
  while (googleBooksCache.size > GOOGLE_BOOKS_CACHE_MAX) {
    const oldestKey = googleBooksCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    googleBooksCache.delete(oldestKey);
  }
}

const GOOGLE_SERIES_ENDPOINT = 'https://www.googleapis.com/books/v1/series/get';
const GOOGLE_DETAIL_HYDRATION_LIMIT = 3;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? value as Record<string, unknown> : undefined;

const googleVolumeId = (value: unknown): string | undefined => {
  const record = asRecord(value);
  return typeof record?.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
};

const googleVolumeInfo = (value: unknown): Record<string, unknown> | undefined =>
  asRecord(asRecord(value)?.volumeInfo);

const googleSeriesIdsFromItems = (items: unknown[]): string[] => {
  const ids = new Set<string>();
  for (const item of items) {
    const seriesInfo = asRecord(googleVolumeInfo(item)?.seriesInfo);
    const memberships = Array.isArray(seriesInfo?.volumeSeries) ? seriesInfo.volumeSeries : [];
    for (const membership of memberships) {
      const id = asRecord(membership)?.seriesId;
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    }
  }
  return [...ids];
};

const decodeGoogleBooksHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');

const stripGoogleBooksHtml = (value: string): string =>
  decodeGoogleBooksHtml(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

const readGoogleBibliographicSeriesCache = (volumeId: string): GoogleBibliographicSeriesInfo | null | undefined => {
  const cached = googleBibliographicSeriesCache.get(volumeId);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    googleBibliographicSeriesCache.delete(volumeId);
    return undefined;
  }
  return cached.value;
};

const writeGoogleBibliographicSeriesCache = (volumeId: string, value: GoogleBibliographicSeriesInfo | null) => {
  googleBibliographicSeriesCache.set(volumeId, { expiresAt: Date.now() + GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_TTL_MS, value });
  while (googleBibliographicSeriesCache.size > GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_MAX) {
    const oldestKey = googleBibliographicSeriesCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    googleBibliographicSeriesCache.delete(oldestKey);
  }
};

const parseGoogleBooksBibliographicSeries = (html: string, authors: string[]): GoogleBibliographicSeriesInfo | null => {
  const titleCell = html.match(/<td[^>]*>\s*Title\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if (!titleCell) return null;
  const lines = stripGoogleBooksHtml(titleCell).split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const normalizedAuthors = authors.map((author) => author.trim().toLocaleLowerCase()).filter(Boolean);
  for (const rawLine of lines.slice(1)) {
    let line = rawLine.trim();
    const lower = line.toLocaleLowerCase();
    for (const author of normalizedAuthors) {
      const suffix = ', ' + author;
      if (lower.endsWith(suffix)) line = line.slice(0, -suffix.length).trim();
    }

    const numbered = line.match(/^Book\s+(\d+(?:\.\d+)?)\s+of\s+(.+)$/i);
    if (numbered) {
      const position = Number(numbered[1]);
      const name = numbered[2].trim();
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}) };
    }

    if (line.length >= 3 && line.length <= 100 && !/^(?:edition|volume|part)\b/i.test(line)) {
      return { name: line };
    }
  }
  return null;
};

async function fetchGoogleBooksBibliographicSeries(volumeId: string, authors: string[]): Promise<GoogleBibliographicSeriesInfo | null> {
  const cached = readGoogleBibliographicSeriesCache(volumeId);
  if (cached !== undefined) return cached;
  try {
    const response = await fetch('https://books.google.com/books?id=' + encodeURIComponent(volumeId));
    if (!response.ok) {
      writeGoogleBibliographicSeriesCache(volumeId, null);
      return null;
    }
    const value = parseGoogleBooksBibliographicSeries(await response.text(), authors);
    writeGoogleBibliographicSeriesCache(volumeId, value);
    return value;
  } catch (error) {
    console.warn('Google Books bibliographic series lookup unavailable.', error);
    return null;
  }
}
const googleVolumeNeedsDetail = (value: unknown): boolean => {
  const info = googleVolumeInfo(value);
  if (!info) return true;
  const pageCount = info.pageCount;
  const seriesInfo = asRecord(info.seriesInfo);
  const memberships = Array.isArray(seriesInfo?.volumeSeries) ? seriesInfo.volumeSeries : [];
  return !(typeof pageCount === 'number' && Number.isFinite(pageCount) && pageCount > 0) || memberships.length === 0;
};

async function hydrateGoogleCatalogItems(items: unknown[], apiKey: string, query: string): Promise<unknown[]> {
  const normalizedQuery = query
    .replace(/\b(?:intitle|inauthor|isbn):/gi, '')
    .replace(/["']/g, ' ')
    .trim()
    .toLocaleLowerCase();

  return Promise.all(items.map(async (item, index) => {
    const id = googleVolumeId(item);
    const title = typeof googleVolumeInfo(item)?.title === 'string'
      ? String(googleVolumeInfo(item)?.title).trim().toLocaleLowerCase()
      : '';
    const likelyExactTitle = Boolean(
      normalizedQuery
      && title
      && (title === normalizedQuery || title.includes(normalizedQuery) || normalizedQuery.includes(title)),
    );
    const shouldHydrate = index < GOOGLE_DETAIL_HYDRATION_LIMIT && likelyExactTitle;
    if (!id || !shouldHydrate || !googleVolumeNeedsDetail(item)) return item;

    const params = new URLSearchParams({ projection: 'full' });
    if (apiKey) params.set('key', apiKey);
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}/${encodeURIComponent(id)}?${params.toString()}`);
        if (response.status !== 429 && response.status !== 503) break;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
      const hydrated = response?.ok ? await response.json() as unknown : item;
      const hydratedRecord = asRecord(hydrated) ?? asRecord(item);
      if (!hydratedRecord) return hydrated;

      const info = googleVolumeInfo(hydrated);
      const seriesInfo = asRecord(info?.seriesInfo);
      const memberships = Array.isArray(seriesInfo?.volumeSeries) ? seriesInfo.volumeSeries : [];
      if (memberships.length > 0) return hydrated;

      const authors = Array.isArray(info?.authors)
        ? info.authors.filter((value): value is string => typeof value === 'string')
        : [];
      const bibliographicSeries = await fetchGoogleBooksBibliographicSeries(id, authors);
      return bibliographicSeries
        ? { ...hydratedRecord, inkboundBibliographicSeries: bibliographicSeries }
        : hydrated;
    } catch (error) {
      console.warn('Google Books volume hydration unavailable.', error);
      return item;
    }
  }));
}

async function fetchGoogleSeriesTitles(items: unknown[], apiKey: string): Promise<Record<string, string>> {
  const ids = googleSeriesIdsFromItems(items);
  if (ids.length === 0) return {};

  const params = new URLSearchParams();
  ids.forEach((id) => params.append('series_id', id));
  if (apiKey) params.set('key', apiKey);

  try {
    const response = await fetch(`${GOOGLE_SERIES_ENDPOINT}?${params.toString()}`);
    if (!response.ok) return {};
    const payload = await response.json() as { series?: unknown[] };
    const pairs = (payload.series ?? []).flatMap((value) => {
      const record = asRecord(value);
      const seriesId = typeof record?.seriesId === 'string' ? record.seriesId.trim() : '';
      const title = typeof record?.title === 'string' ? record.title.trim() : '';
      return seriesId && title ? [[seriesId, title] as const] : [];
    });
    return Object.fromEntries(pairs);
  } catch (error) {
    console.warn('Google Books series-title lookup unavailable.', error);
    return {};
  }
}

async function googleBooksCatalog(query: string, startIndex = 0, maxResults = 40): Promise<GoogleBooksCatalogPayload> {
  const cached = readGoogleBooksCache(query, startIndex, maxResults);
  if (cached) return cached;

  const configuredApiKey = GOOGLE_BOOKS_API_KEY.value().trim();
  // The catalog endpoint is public. Local emulator requests deliberately avoid
  // a referrer-restricted production key; production may use the key and still
  // falls back to the public request if Google rejects it for that runtime.
  const apiKey = process.env.FUNCTIONS_EMULATOR === 'true' ? '' : configuredApiKey;
  let effectiveApiKey = apiKey;
  const baseParams = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    startIndex: String(startIndex),
    maxResults: String(maxResults),
  });

  const runRequest = async (key?: string) => {
    const params = new URLSearchParams(baseParams);
    if (key) params.set('key', key);

    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
      if (response.status !== 429 && response.status !== 503) return response;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    return response!;
  };

  let response = await runRequest(apiKey || undefined);
  if (!response.ok && apiKey) {
    const body = await response.text();
    const detail = googleBooksErrorDetail(body);
    const keyRestricted = (
      response.status === 400
      || response.status === 401
      || response.status === 403
    ) && /api key|credential|referer|referrer|permission|forbidden|not authorized|not valid/i.test(detail);

    if (keyRestricted) {
      console.warn(
        `Configured Google Books API key was rejected for this runtime (${response.status}); retrying the public catalog request without a key.`,
      );
      effectiveApiKey = '';
      response = await runRequest();
    } else {
      throw new Error(`Google Books returned ${response.status}${detail ? `: ${detail}` : '.'}`);
    }
  }

  if (!response.ok) {
    const detail = googleBooksErrorDetail(await response.text());
    throw new Error(`Google Books returned ${response.status}${detail ? `: ${detail}` : '.'}`);
  }

  const raw = await response.json() as { totalItems?: unknown; items?: unknown };
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = await hydrateGoogleCatalogItems(rawItems, effectiveApiKey, query);
  const payload: GoogleBooksCatalogPayload = {
    totalItems: typeof raw.totalItems === 'number' ? raw.totalItems : 0,
    items,
    seriesMetadataById: await fetchGoogleSeriesTitles(items, effectiveApiKey),
  };
  writeGoogleBooksCache(query, startIndex, maxResults, payload);
  return payload;
}

async function hardcoverCatalog(query: string) {
  const token = HARDCOVER_API_TOKEN.value();
  if (!token) throw new HttpsError('failed-precondition', 'Hardcover search is not configured.');

  const searchData = await hardcoverGraphql<{ search?: { results?: unknown } }>(
    token,
    `query SearchBooks($q: String!) {
      search(query: $q, query_type: "Book", per_page: 15, page: 1) { results }
    }`,
    { q: query },
  );
  const searchResults = parseSearchResults(searchData.search?.results).filter((result) => result.title);
  const ids = searchResults.map((result) => Number(result.id)).filter((id) => Number.isFinite(id));

  let editions: HardcoverEdition[] = [];
  let books: HardcoverBook[] = [];
  if (ids.length > 0) {
    try {
      const detailData = await hardcoverGraphql<{ editions?: HardcoverEdition[]; books?: HardcoverBook[] }>(
        token,
        `query SearchBookDetails($ids: [Int!]!) {
          books(where: { id: { _in: $ids } }, limit: 80) {
            id title subtitle description release_year image { url }
            book_series { position series { id name } }
          }
          editions(where: { book_id: { _in: $ids } }, limit: 80) {
            id book_id title pages isbn_10 isbn_13 release_date edition_format
            image { url }
            publisher { name }
            book {
              id title subtitle description release_year image { url }
              book_series { position series { id name } }
            }
          }
        }`,
        { ids },
      );
      editions = detailData.editions ?? [];
      books = detailData.books ?? [];
    } catch (error) {
      console.warn('Hardcover detail expansion unavailable.', error);
    }
  }

  const booksById = new Map<string, HardcoverBook>();
  books.forEach((book) => {
    const key = String(book.id ?? '');
    if (key) booksById.set(key, book);
  });

  const editionsByBook = new Map<string, HardcoverEdition[]>();
  editions.forEach((edition) => {
    const key = String(edition.book_id ?? edition.book?.id ?? '');
    if (!key) return;
    editionsByBook.set(key, [...(editionsByBook.get(key) ?? []), edition]);
  });

  const groups = searchResults.map((result) => {
    const id = String(result.id ?? result.slug ?? result.title);
    const authors = authorNames(result);
    const matchedEditions = editionsByBook.get(String(result.id ?? '')) ?? [];
    const matchedBook = booksById.get(String(result.id ?? ''));
    const seriesMembership = matchedBook?.book_series?.find((membership) => membership.series?.name?.trim())
      ?? matchedEditions.map((edition) => edition.book?.book_series?.find((membership) => membership.series?.name?.trim())).find(Boolean);
    const seriesName = seriesMembership?.series?.name?.trim();
    const seriesOrder = typeof seriesMembership?.position === 'number' && Number.isFinite(seriesMembership.position)
      ? seriesMembership.position
      : undefined;
    const publisherSummary = matchedBook?.description
      ?? result.description
      ?? matchedEditions.map((edition) => edition.book?.description).find((description): description is string => Boolean(description?.trim()));
    const normalizedEditions = matchedEditions.length > 0
      ? matchedEditions.map((edition) => ({
          source: 'hardcover' as const,
          externalEditionId: String(edition.id ?? `${id}-${edition.isbn_13 ?? edition.isbn_10 ?? edition.title ?? 'edition'}`),
          title: edition.title ?? edition.book?.title ?? matchedBook?.title ?? result.title ?? 'Untitled',
          subtitle: edition.book?.subtitle ?? matchedBook?.subtitle ?? result.subtitle,
          authors,
          publisherSummary: matchedBook?.description ?? edition.book?.description ?? publisherSummary,
          seriesName: edition.book?.book_series?.find((membership) => membership.series?.name?.trim())?.series?.name?.trim() ?? seriesName,
          seriesOrder: edition.book?.book_series?.find((membership) => membership.series?.name?.trim())?.position ?? seriesOrder,
          genres: [],
          publisher: edition.publisher?.name,
          publicationDate: edition.release_date,
          publicationYear: Number(edition.release_date?.slice(0, 4)) || edition.book?.release_year || matchedBook?.release_year || result.release_year || new Date().getFullYear(),
          format: normalizeFormat(edition.edition_format),
          isbn10: edition.isbn_10,
          isbn13: edition.isbn_13,
          // result.pages is work/search-result metadata and may belong to a
          // different edition. Exact ISBN editions may only use edition.pages.
          pageCount: edition.pages,
          coverUrl: edition.image?.url ?? edition.book?.image?.url ?? matchedBook?.image?.url ?? result.image_url ?? imageUrl(result.image),
          editionName: edition.title,
          binding: edition.edition_format,
          specialFeatures: [],
        }))
      : [{
          source: 'hardcover' as const,
          externalEditionId: id,
          title: matchedBook?.title ?? result.title ?? 'Untitled',
          subtitle: matchedBook?.subtitle ?? result.subtitle,
          authors,
          publisherSummary,
          seriesName,
          seriesOrder,
          genres: [],
          publicationYear: matchedBook?.release_year || result.release_year || new Date().getFullYear(),
          format: 'hardcover' as const,
          pageCount: result.pages,
          coverUrl: matchedBook?.image?.url ?? result.image_url ?? imageUrl(result.image),
          specialFeatures: [],
        }];

    return {
      key: `hardcover:${id}`,
      title: matchedBook?.title ?? result.title ?? 'Untitled',
      subtitle: matchedBook?.subtitle ?? result.subtitle,
      authors,
      publisherSummary,
      genres: [],
      editions: normalizedEditions,
    };
  });

  return { groups, totalItems: groups.length };
}

export const searchGoogleBooksCatalog = onCall(
  {
    secrets: [GOOGLE_BOOKS_API_KEY],
    // This callable returns public bibliographic metadata only. Authentication
    // prevents anonymous abuse while allowing localhost/dev parity without an
    // App Check token.
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth && process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new HttpsError('unauthenticated', 'Sign in to search the Google Books catalog.');
    }

    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid book search is required.');

    const requestedStartIndex = Number(request.data?.startIndex);
    const requestedMaxResults = Number(request.data?.maxResults);
    const startIndex = Number.isInteger(requestedStartIndex) && requestedStartIndex >= 0
      ? Math.min(requestedStartIndex, 10000)
      : 0;
    const maxResults = Number.isInteger(requestedMaxResults) && requestedMaxResults > 0
      ? Math.min(requestedMaxResults, 40)
      : 40;

    try {
      return await googleBooksCatalog(query, startIndex, maxResults);
    } catch (error) {
      console.error('Google Books catalog search failed.', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', error instanceof Error ? error.message : 'Google Books catalog search failed.');
    }
  },
);

export const searchHardcoverBooks = onCall(
  { secrets: [HARDCOVER_API_TOKEN, GOOGLE_BOOKS_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth && process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new HttpsError('unauthenticated', 'Sign in to use protected book search.');
    }
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid book search is required.');
    const provider = request.data?.provider === 'google-books' ? 'google-books' : 'hardcover';
    const requestedStartIndex = Number(request.data?.startIndex);
    const requestedMaxResults = Number(request.data?.maxResults);
    const startIndex = Number.isInteger(requestedStartIndex) && requestedStartIndex >= 0
      ? Math.min(requestedStartIndex, 10000)
      : 0;
    const maxResults = Number.isInteger(requestedMaxResults) && requestedMaxResults > 0
      ? Math.min(requestedMaxResults, 40)
      : 40;

    try {
      return provider === 'google-books'
        ? await googleBooksCatalog(query, startIndex, maxResults)
        : await hardcoverCatalog(query);
    } catch (error) {
      if (provider === 'hardcover') {
        console.warn('Optional Hardcover catalog supplement unavailable.', error);
        return { groups: [], totalItems: 0 };
      }

      console.error('google-books search failed', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', error instanceof Error ? error.message : 'Protected book search failed.');
    }
  },
);
