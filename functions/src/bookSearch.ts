import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const GOOGLE_BOOKS_API_KEY = defineSecret('GOOGLE_BOOKS_API_KEY');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const GOOGLE_BOOKS_CACHE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_BOOKS_CACHE_MAX = 500;
const HARDCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HARDCOVER_CACHE_MAX = 500;
const HARDCOVER_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

type HardcoverCatalogPayload = { groups: Array<Record<string, unknown>>; totalItems: number; providerDebug?: Record<string, unknown> };
const hardcoverCatalogCache = new Map<string, { expiresAt: number; payload: HardcoverCatalogPayload }>();
let hardcoverRateLimitUntil = 0;

const hardcoverCacheKey = (query: string, authorBibliography: boolean) =>
  `${authorBibliography ? 'author' : 'search'}::${query.trim().toLowerCase()}`;

function readHardcoverCache(query: string, authorBibliography: boolean): HardcoverCatalogPayload | undefined {
  const key = hardcoverCacheKey(query, authorBibliography);
  const cached = hardcoverCatalogCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    hardcoverCatalogCache.delete(key);
    return undefined;
  }
  hardcoverCatalogCache.delete(key);
  hardcoverCatalogCache.set(key, cached);
  return cached.payload;
}

function writeHardcoverCache(query: string, authorBibliography: boolean, payload: HardcoverCatalogPayload) {
  const key = hardcoverCacheKey(query, authorBibliography);
  hardcoverCatalogCache.set(key, { expiresAt: Date.now() + HARDCOVER_CACHE_TTL_MS, payload });
  while (hardcoverCatalogCache.size > HARDCOVER_CACHE_MAX) {
    const oldestKey = hardcoverCatalogCache.keys().next().value;
    if (!oldestKey) break;
    hardcoverCatalogCache.delete(oldestKey);
  }
}

type GoogleBooksCatalogPayload = { totalItems: number; items: unknown[] };
const googleBooksCache = new Map<string, { expiresAt: number; payload: GoogleBooksCatalogPayload }>();

interface SearchResult {
  id?: number | string;
  name?: string;
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
  contributions?: Array<{ author?: { id?: number | string; name?: string } }>;
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
  if (value && typeof value === 'object') {
    const hits = (value as { hits?: unknown }).hits;
    if (Array.isArray(hits)) return parseSearchResults(hits);
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
  if (!response.ok) {
    if (response.status === 429) hardcoverRateLimitUntil = Date.now() + HARDCOVER_RATE_LIMIT_COOLDOWN_MS;
    throw new Error(`Hardcover returned ${response.status}.`);
  }
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'Hardcover search failed.');
  if (!payload.data) throw new Error('Hardcover returned an empty response.');
  return payload.data;
}

const googleBooksCacheKey = (query: string, startIndex: number, maxResults: number) =>
  `${query.trim().toLowerCase()}::${startIndex}::${maxResults}`;

function readGoogleBooksCache(
  query: string,
  startIndex: number,
  maxResults: number,
): GoogleBooksCatalogPayload | undefined {
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

function writeGoogleBooksCache(
  query: string,
  startIndex: number,
  maxResults: number,
  payload: GoogleBooksCatalogPayload,
) {
  const key = googleBooksCacheKey(query, startIndex, maxResults);
  googleBooksCache.set(key, { expiresAt: Date.now() + GOOGLE_BOOKS_CACHE_TTL_MS, payload });
  while (googleBooksCache.size > GOOGLE_BOOKS_CACHE_MAX) {
    const oldestKey = googleBooksCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    googleBooksCache.delete(oldestKey);
  }
}

async function googleBooksCatalog(
  query: string,
  startIndex = 0,
  maxResults = 40,
): Promise<GoogleBooksCatalogPayload> {
  const cached = readGoogleBooksCache(query, startIndex, maxResults);
  if (cached) return cached;

  const apiKey = GOOGLE_BOOKS_API_KEY.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Google Books mobile search is not configured.');

  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    maxResults: String(Math.max(1, Math.min(40, maxResults))),
    key: apiKey,
  });
  if (startIndex > 0) params.set('startIndex', String(startIndex));
  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`Google Books returned ${response.status}.`);
  const raw = await response.json() as { totalItems?: unknown; items?: unknown };
  const payload: GoogleBooksCatalogPayload = {
    totalItems: typeof raw.totalItems === 'number' ? raw.totalItems : 0,
    items: Array.isArray(raw.items) ? raw.items : [],
  };
  writeGoogleBooksCache(query, startIndex, maxResults, payload);
  return payload;
}

async function hardcoverCatalog(query: string, authorBibliography = false) {
  const cached = readHardcoverCache(query, authorBibliography);
  if (cached) return { ...cached, providerDebug: { ...(cached.providerDebug ?? {}), cache: 'hit' } };
  if (Date.now() < hardcoverRateLimitUntil) {
    throw new Error('Hardcover cooling down after rate limit.');
  }
  const providerDebug: Record<string, unknown> = { mode: authorBibliography ? 'author-bibliography' : 'search', cache: 'miss' };
  const token = HARDCOVER_API_TOKEN.value();
  if (!token) throw new HttpsError('failed-precondition', 'Hardcover search is not configured.');

  const searchPage = async (page: number, perPage: number) =>
    hardcoverGraphql<{ search?: { results?: unknown } }>(
      token,
      `query SearchBooks($q: String!, $perPage: Int!, $page: Int!) {
        search(query: $q, query_type: "Book", per_page: $perPage, page: $page) { results }
      }`,
      { q: query, perPage, page },
    );

  // Hardcover's search service can cap a single response below the requested
  // per_page value. Author catalogs therefore walk several result pages and
  // merge them before exact-author filtering on the client. Ordinary Search
  // remains a single page so its behavior/ranking is unchanged.
  let searchResults: SearchResult[] = [];

  if (authorBibliography) {
    // Hardcover disables wildcard string operators on the public API. Resolve
    // author candidates through search.ids, hydrate those typed author rows,
    // then exact-match locally before following the documented book relation.
    const authorQueries = Array.from(new Set([
      query.trim(),
      query.trim().replace(/\./g, ''),
    ].filter(Boolean)));
    const rawAuthorIds: string[] = [];
    for (const authorQuery of authorQueries) {
      const result = await hardcoverGraphql<{ search?: { ids?: Array<number | string> } }>(
        token,
        `query SearchAuthors($q: String!) {
          search(query: $q, query_type: "Author", per_page: 100, page: 1) { ids }
        }`,
        { q: authorQuery },
      );
      rawAuthorIds.push(...(result.search?.ids ?? []).map(String));
      // Do not fan out once an exact author is found; hydrate this page first.
      const pageIds = Array.from(new Set(rawAuthorIds))
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
      if (!pageIds.length) continue;
      const pageAuthors = await hardcoverGraphql<{
        authors?: Array<{ id?: number; name?: string; books_count?: number }>;
      }>(
        token,
        `query ResolveAuthors($ids: [Int!]!) {
          authors(where: { id: { _in: $ids } }, order_by: { books_count: desc }, limit: 100) {
            id name books_count
          }
        }`,
        { ids: pageIds },
      );
      const normalizeAuthorIdentity = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
      const wanted = normalizeAuthorIdentity(query.trim());
      const exact = (pageAuthors.authors ?? []).find((candidate) =>
        normalizeAuthorIdentity(String(candidate.name ?? '')) === wanted
      );
      if (exact?.id != null) {
        providerDebug.authorQueries = authorQueries;
        providerDebug.authorSearchIdCount = pageIds.length;
        providerDebug.hydratedAuthorCount = (pageAuthors.authors ?? []).length;
        providerDebug.resolvedAuthorName = exact.name ?? null;
        providerDebug.resolvedAuthorId = Number(exact.id);
        const authorId = Number(exact.id);
        if (Number.isFinite(authorId)) {
          const bibliography = await hardcoverGraphql<{ books?: HardcoverBook[] }>(
            token,
            `query AuthorBooks($id: Int!) {
              books(where: { contributions: { author: { id: { _eq: $id } } }, canonical_id: { _is_null: true } }, limit: 500) {
                id title subtitle description release_year image { url }
                contributions(limit: 20) { author { id name } }
                book_series { position series { id name } }
              }
            }`,
            { id: authorId },
          );
          providerDebug.bibliographyBookCount = (bibliography.books ?? []).length;
          searchResults = (bibliography.books ?? []).flatMap((book) => {
            if (!book?.id || !book.title) return [];
            const names = book.contributions?.map((entry) => entry.author?.name?.trim()).filter((name): name is string => Boolean(name)) ?? [];
            return [{ id: book.id, title: book.title, subtitle: book.subtitle, description: book.description, release_year: book.release_year, image: book.image, author_names: names.length ? names : [query.trim()] } satisfies SearchResult];
          });
        }
        break;
      }
    }
    if (!searchResults.length) {
      providerDebug.authorQueries = authorQueries;
      providerDebug.authorSearchIdCount = Array.from(new Set(rawAuthorIds)).length;
      providerDebug.resolutionFailure = 'No exact Hardcover author identity resolved within quota-safe candidate searches.';
    }

  } else {
    const searchData = await searchPage(1, 15);
    searchResults = parseSearchResults(searchData.search?.results).filter((result) => result.title);
  }
  const ids = searchResults.map((result) => Number(result.id)).filter((id) => Number.isFinite(id));

  let editions: HardcoverEdition[] = [];
  let books: HardcoverBook[] = [];
  if (ids.length > 0) {
    try {
      const detailData = await hardcoverGraphql<{ editions?: HardcoverEdition[]; books?: HardcoverBook[] }>(
        token,
        `query SearchBookDetails($ids: [Int!]!) {
          books(where: { id: { _in: $ids } }, limit: 500) {
            id title subtitle description release_year image { url }
            book_series { position series { id name } }
          }
          editions(where: { book_id: { _in: $ids } }, limit: 1000) {
            id book_id title pages isbn_10 isbn_13 release_date edition_format
            image { url }
            publisher { name }
            book { id title subtitle description release_year image { url } }
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
      ?? matchedEditions
        .map((edition) => edition.book?.book_series?.find((membership) => membership.series?.name?.trim()))
        .find(Boolean);
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
          seriesName: edition.book?.book_series
            ?.find((membership) => membership.series?.name?.trim())
            ?.series?.name?.trim() ?? seriesName,
          seriesOrder: edition.book?.book_series
            ?.find((membership) => membership.series?.name?.trim())
            ?.position ?? seriesOrder,
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

  const payload = { groups, totalItems: groups.length, ...(authorBibliography ? { providerDebug } : {}) };
  writeHardcoverCache(query, authorBibliography, payload as HardcoverCatalogPayload);
  return payload;
}

/**
 * App-Check-protected catalog gateway used by Inkbound's third-party search
 * integrations. The existing export name is retained for compatibility; Android
 * may request provider='google-books' so the Google API key stays off the WebView.
 *
 * Hardcover is supplemental metadata. Its upstream availability or credentials
 * must never turn an otherwise successful Inkbound book search into a failed
 * client request. Google Books remains the authoritative protected transport.
 */
export const searchHardcoverBooks = onCall(
  { secrets: [HARDCOVER_API_TOKEN, GOOGLE_BOOKS_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid book search is required.');
    const provider = request.data?.provider === 'google-books' ? 'google-books' : 'hardcover';
    const authorBibliography = request.data?.authorBibliography === true;
    const requestedStartIndex = Number(request.data?.startIndex);
    const requestedMaxResults = Number(request.data?.maxResults);
    const startIndex = Number.isInteger(requestedStartIndex) && requestedStartIndex >= 0
      ? requestedStartIndex
      : 0;
    const maxResults = Number.isInteger(requestedMaxResults) && requestedMaxResults > 0
      ? Math.min(40, requestedMaxResults)
      : 40;

    try {
      return provider === 'google-books'
        ? await googleBooksCatalog(query, startIndex, maxResults)
        : await hardcoverCatalog(query, authorBibliography);
    } catch (error) {
      if (provider === 'hardcover') {
        console.warn('Optional Hardcover catalog supplement unavailable.', error);
        return {
          groups: [],
          totalItems: 0,
          providerError: error instanceof Error ? error.message : 'Hardcover catalog request failed.',
        };
      }

      console.error('google-books search failed', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', error instanceof Error ? error.message : 'Protected book search failed.');
    }
  },
);
