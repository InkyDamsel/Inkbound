import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const GOOGLE_BOOKS_API_KEY = defineSecret('GOOGLE_BOOKS_API_KEY');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const GOOGLE_BOOKS_CACHE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_BOOKS_CACHE_MAX = 500;

type GoogleBooksCatalogPayload = { totalItems: number; items: unknown[] };
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

async function googleBooksCatalog(query: string, startIndex = 0, maxResults = 40): Promise<GoogleBooksCatalogPayload> {
  const cached = readGoogleBooksCache(query, startIndex, maxResults);
  if (cached) return cached;

  const apiKey = GOOGLE_BOOKS_API_KEY.value().trim();
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
    return fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
  };

  let response = await runRequest(apiKey || undefined);
  if (!response.ok && apiKey) {
    const body = await response.text();
    const detail = googleBooksErrorDetail(body);
    const invalidKey = response.status === 400 && /api key.*not valid|valid api key/i.test(detail);
    if (invalidKey) {
      console.warn('Configured Google Books API key was rejected; retrying public catalog request without a key.');
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
  const payload: GoogleBooksCatalogPayload = {
    totalItems: typeof raw.totalItems === 'number' ? raw.totalItems : 0,
    items: Array.isArray(raw.items) ? raw.items : [],
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
          pageCount: edition.pages ?? result.pages,
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
