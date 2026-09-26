import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const GOOGLE_BOOKS_API_KEY = defineSecret('GOOGLE_BOOKS_API_KEY');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

interface GoogleBibliographicSeriesInfo {
  name: string;
  position?: number;
}

const GOOGLE_DETECTIVE_DETAIL_LIMIT = 14;
const GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_MAX = 1000;
const googleBibliographicSeriesCache = new Map<
  string,
  { expiresAt: number; value: GoogleBibliographicSeriesInfo | null }
>();

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

const readGoogleBibliographicSeriesCache = (
  volumeId: string,
): GoogleBibliographicSeriesInfo | null | undefined => {
  const cached = googleBibliographicSeriesCache.get(volumeId);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    googleBibliographicSeriesCache.delete(volumeId);
    return undefined;
  }
  return cached.value;
};

const writeGoogleBibliographicSeriesCache = (
  volumeId: string,
  value: GoogleBibliographicSeriesInfo | null,
) => {
  googleBibliographicSeriesCache.set(volumeId, {
    expiresAt: Date.now() + GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_TTL_MS,
    value,
  });
  while (googleBibliographicSeriesCache.size > GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_MAX) {
    const oldestKey = googleBibliographicSeriesCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    googleBibliographicSeriesCache.delete(oldestKey);
  }
};

const parseGoogleBooksBibliographicSeries = (
  html: string,
  authors: string[],
): GoogleBibliographicSeriesInfo | null => {
  const titleCell = html.match(/<td[^>]*>\s*Title\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if (!titleCell) return null;

  const lines = stripGoogleBooksHtml(titleCell)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const normalizedAuthors = authors
    .map((author) => author.trim().toLocaleLowerCase())
    .filter(Boolean);

  for (const rawLine of lines.slice(1)) {
    let line = rawLine.trim();
    const lower = line.toLocaleLowerCase();
    for (const author of normalizedAuthors) {
      const suffix = ', ' + author;
      if (lower.endsWith(suffix)) line = line.slice(0, -suffix.length).trim();
    }

    const bookOfSeries = line.match(/^Book\s+(\d+(?:\.\d+)?)\s+of\s+(.+)$/i);
    if (bookOfSeries) {
      const position = Number(bookOfSeries[1]);
      const name = bookOfSeries[2].trim();
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}) };
    }

    const seriesThenBook = line.match(/^(.+?)(?:,|\s+-)?\s*Book\s+(\d+(?:\.\d+)?)$/i);
    if (seriesThenBook) {
      const name = seriesThenBook[1].trim();
      const position = Number(seriesThenBook[2]);
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}) };
    }

    const seriesThenNumber = line.match(/^(.+?)\s+#\s*(\d+(?:\.\d+)?)$/i);
    if (seriesThenNumber) {
      const name = seriesThenNumber[1].trim();
      const position = Number(seriesThenNumber[2]);
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}) };
    }

    // Do not treat an arbitrary bibliographic subtitle/marketing line as a
    // series name. That permissive fallback caused unrelated books to become
    // "verified" Series Detective candidates after provider merging.
  }

  return null;
};

async function fetchGoogleBooksBibliographicSeries(
  volumeId: string,
  authors: string[],
): Promise<GoogleBibliographicSeriesInfo | null> {
  const cached = readGoogleBibliographicSeriesCache(volumeId);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(
      'https://books.google.com/books?id=' + encodeURIComponent(volumeId),
    );
    if (!response.ok) {
      writeGoogleBibliographicSeriesCache(volumeId, null);
      return null;
    }
    const value = parseGoogleBooksBibliographicSeries(await response.text(), authors);
    writeGoogleBibliographicSeriesCache(volumeId, value);
    return value;
  } catch (error) {
    console.warn('Series Detective Google bibliographic lookup unavailable.', error);
    return null;
  }
}



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

interface HardcoverSeriesMembership {
  position?: number;
  series?: { id?: number | string; name?: string };
}

interface HardcoverBook {
  id?: number | string;
  title?: string;
  subtitle?: string;
  description?: string;
  release_year?: number;
  image?: { url?: string };
  book_series?: HardcoverSeriesMembership[];
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

async function hardcoverGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
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
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'Hardcover Detective search failed.');
  if (!payload.data) throw new Error('Hardcover returned an empty Detective response.');
  return payload.data;
}

async function detectiveHardcoverCatalog(query: string) {
  const token = HARDCOVER_API_TOKEN.value();
  if (!token) throw new HttpsError('failed-precondition', 'Series Detective Hardcover search is not configured.');

  const searchData = await hardcoverGraphql<{ search?: { results?: unknown } }>(
    token,
    `query SeriesDetectiveSearch($q: String!) {
      search(query: $q, query_type: "Book", per_page: 40, page: 1) { results }
    }`,
    { q: query },
  );

  const searchResults = parseSearchResults(searchData.search?.results).filter((result) => result.title);
  const ids = searchResults.map((result) => Number(result.id)).filter((id) => Number.isFinite(id));

  let editions: HardcoverEdition[] = [];
  let books: HardcoverBook[] = [];
  if (ids.length > 0) {
    const detailData = await hardcoverGraphql<{ editions?: HardcoverEdition[]; books?: HardcoverBook[] }>(
      token,
      `query SeriesDetectiveDetails($ids: [Int!]!) {
        books(where: { id: { _in: $ids } }, limit: 160) {
          id title subtitle description release_year image { url }
          book_series { position series { id name } }
        }
        editions(where: { book_id: { _in: $ids } }, limit: 240) {
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
    const publisherSummary = matchedBook?.description
      ?? result.description
      ?? matchedEditions.map((edition) => edition.book?.description)
        .find((description): description is string => Boolean(description?.trim()));

    const bookMembership = matchedBook?.book_series?.find((membership) => membership.series?.name?.trim());
    const normalizedEditions = matchedEditions.length > 0
      ? matchedEditions.map((edition) => {
          const membership = edition.book?.book_series?.find((item) => item.series?.name?.trim()) ?? bookMembership;
          return {
            source: 'hardcover' as const,
            externalEditionId: String(edition.id ?? `${id}-${edition.isbn_13 ?? edition.isbn_10 ?? edition.title ?? 'edition'}`),
            title: edition.title ?? edition.book?.title ?? matchedBook?.title ?? result.title ?? 'Untitled',
            subtitle: edition.book?.subtitle ?? matchedBook?.subtitle ?? result.subtitle,
            authors,
            publisherSummary: matchedBook?.description ?? edition.book?.description ?? publisherSummary,
            genres: [] as string[],
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
            specialFeatures: [] as string[],
            seriesName: membership?.series?.name?.trim(),
            seriesOrder: typeof membership?.position === 'number' ? membership.position : undefined,
          };
        })
      : [{
          source: 'hardcover' as const,
          externalEditionId: id,
          title: matchedBook?.title ?? result.title ?? 'Untitled',
          subtitle: matchedBook?.subtitle ?? result.subtitle,
          authors,
          publisherSummary,
          genres: [] as string[],
          publicationYear: matchedBook?.release_year || result.release_year || new Date().getFullYear(),
          format: 'hardcover' as const,
          pageCount: result.pages,
          coverUrl: matchedBook?.image?.url ?? result.image_url ?? imageUrl(result.image),
          specialFeatures: [] as string[],
          seriesName: bookMembership?.series?.name?.trim(),
          seriesOrder: typeof bookMembership?.position === 'number' ? bookMembership.position : undefined,
        }];

    return {
      key: `hardcover:${id}`,
      title: matchedBook?.title ?? result.title ?? 'Untitled',
      subtitle: matchedBook?.subtitle ?? result.subtitle,
      authors,
      publisherSummary,
      genres: [] as string[],
      editions: normalizedEditions,
    };
  });

  return { groups, totalItems: groups.length };
}

export const searchSeriesDetectiveHardcover = onCall(
  { secrets: [HARDCOVER_API_TOKEN], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Series Detective.');
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid Series Detective query is required.');

    try {
      return await detectiveHardcoverCatalog(query);
    } catch (error) {
      console.warn('Series Detective Hardcover catalog unavailable.', error);
      return { groups: [], totalItems: 0 };
    }
  },
);


interface DetectiveGoogleVolume {
  id?: string;
  inkboundBibliographicSeries?: GoogleBibliographicSeriesInfo;
  volumeInfo?: {
    authors?: string[];
    seriesInfo?: {
      volumeSeries?: Array<{ seriesId?: string }>;
    };
  };
}

async function detectiveGoogleCatalog(
  query: string,
  startIndex: number,
  maxResults: number,
) {
  const apiKey = GOOGLE_BOOKS_API_KEY.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Series Detective Google Books is not configured.');

  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    startIndex: String(Math.max(0, startIndex)),
    maxResults: String(Math.max(1, Math.min(40, maxResults))),
  });
  if (apiKey) params.set('key', apiKey);

  const runRequest = async (): Promise<Response> => {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
      if (response.status !== 429 && response.status !== 503) break;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    return response!;
  };

  let response = await runRequest();
  if (!response.ok && apiKey && [400, 401, 403].includes(response.status)) {
    params.delete('key');
    response = await runRequest();
  }
  if (!response.ok) throw new Error(`Google Books returned ${response.status} to Series Detective.`);
  const payload = await response.json() as { totalItems?: number; items?: DetectiveGoogleVolume[] };
  const rawItems = payload.items ?? [];
  const items = await Promise.all(rawItems.map(async (volume, index) => {
    const id = volume.id?.trim();
    if (!id || index >= GOOGLE_DETECTIVE_DETAIL_LIMIT) return volume;

    const authors = Array.isArray(volume.volumeInfo?.authors)
      ? volume.volumeInfo.authors.filter((author): author is string => typeof author === 'string')
      : [];
    const bibliographicSeries = await fetchGoogleBooksBibliographicSeries(id, authors);
    return bibliographicSeries
      ? { ...volume, inkboundBibliographicSeries: bibliographicSeries }
      : volume;
  }));

  const seriesIds = [...new Set(items.flatMap((volume) =>
    volume.volumeInfo?.seriesInfo?.volumeSeries
      ?.map((membership) => membership.seriesId?.trim())
      .filter((value): value is string => Boolean(value)) ?? [],
  ))];
  const seriesMetadataById: Record<string, string> = {};

  if (seriesIds.length > 0) {
    try {
      const seriesParams = new URLSearchParams({ key: apiKey });
      seriesIds.forEach((id) => seriesParams.append('series_id', id));
      const seriesResponse = await fetch(
        `https://www.googleapis.com/books/v1/series/get?${seriesParams.toString()}`,
      );
      if (seriesResponse.ok) {
        const seriesPayload = await seriesResponse.json() as {
          series?: Array<{ seriesId?: string; title?: string }>;
        };
        (seriesPayload.series ?? []).forEach((series) => {
          const id = series.seriesId?.trim();
          const title = series.title?.trim();
          if (id && title) seriesMetadataById[id] = title;
        });
      }
    } catch (error) {
      console.warn('Series Detective Google series-title expansion unavailable.', error);
    }
  }

  return {
    totalItems: typeof payload.totalItems === 'number' ? payload.totalItems : items.length,
    items,
    seriesMetadataById,
  };
}

export const searchSeriesDetectiveGoogleBooks = onCall(
  { secrets: [GOOGLE_BOOKS_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Series Detective.');
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    const startIndex = Number(request.data?.startIndex ?? 0);
    const maxResults = Number(request.data?.maxResults ?? 40);
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid Series Detective query is required.');

    try {
      return await detectiveGoogleCatalog(query, startIndex, maxResults);
    } catch (error) {
      console.warn('Series Detective Google Books catalog unavailable.', error);
      return { totalItems: 0, items: [], seriesMetadataById: {} };
    }
  },
);
