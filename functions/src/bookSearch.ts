import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

type BookSource = 'google-books' | 'hardcover';
type BookFormat = 'hardcover' | 'paperback' | 'ebook' | 'audiobook';

interface NormalizedEdition {
  source: BookSource;
  externalEditionId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  publisher?: string;
  publicationDate?: string;
  publicationYear: number;
  language?: string;
  format: BookFormat;
  isbn10?: string;
  isbn13?: string;
  pageCount?: number;
  coverUrl?: string;
  editionName?: string;
  binding?: string;
  specialFeatures: string[];
}

interface NormalizedGroup {
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  editions: NormalizedEdition[];
}

interface SearchResponse {
  groups: NormalizedGroup[];
  totalItems: number;
}

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
}

interface GoogleVolumesResponse {
  totalItems?: number;
  items?: GoogleVolume[];
}

interface HardcoverSearchResult {
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
  book?: {
    id?: number | string;
    title?: string;
    subtitle?: string;
    description?: string;
    release_year?: number;
    image?: { url?: string };
  };
}

const searchCache = new Map<string, { expiresAt: number; response: SearchResponse }>();

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value: string): string => value.replace(/[^0-9X]/gi, '').toUpperCase();

const publicationYear = (value?: string): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
};

const normalizeGoogleCover = (links?: GoogleImageLinks): string | undefined => {
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return source?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const googleIdentifier = (volume: GoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const normalizeHardcoverFormat = (value?: string): BookFormat => {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('audio')) return 'audiobook';
  if (normalized.includes('ebook') || normalized.includes('digital') || normalized.includes('kindle')) return 'ebook';
  if (normalized.includes('paper')) return 'paperback';
  return 'hardcover';
};

const hardcoverImageUrl = (value?: HardcoverSearchResult['image']): string | undefined =>
  typeof value === 'string' ? value : value?.url;

const hardcoverAuthorNames = (result: HardcoverSearchResult): string[] => {
  if (result.author_names?.length) return result.author_names.filter(Boolean);
  if (Array.isArray(result.authors)) {
    return result.authors
      .map((author) => typeof author === 'string' ? author : author?.name ?? '')
      .filter(Boolean);
  }
  return ['Unknown author'];
};

const parseHardcoverSearchResults = (value: unknown): HardcoverSearchResult[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (record.document && typeof record.document === 'object') return [record.document as HardcoverSearchResult];
      return [item as HardcoverSearchResult];
    });
  }
  if (typeof value === 'string') {
    try {
      return parseHardcoverSearchResults(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
};

const groupIdentity = (group: NormalizedGroup): string =>
  `${normalizeText(group.title)}::${normalizeText(group.authors[0])}`;

const sameEdition = (a: NormalizedEdition, b: NormalizedEdition): boolean => {
  if (a.source === b.source && a.externalEditionId === b.externalEditionId) return true;
  if (a.isbn13 && b.isbn13 && compactIsbn(a.isbn13) === compactIsbn(b.isbn13)) return true;
  if (a.isbn10 && b.isbn10 && compactIsbn(a.isbn10) === compactIsbn(b.isbn10)) return true;
  return false;
};

const mergeGroups = (primary: NormalizedGroup[], supplement: NormalizedGroup[]): NormalizedGroup[] => {
  const merged = new Map<string, NormalizedGroup>();
  const order: string[] = [];

  const addGroup = (group: NormalizedGroup) => {
    const identity = groupIdentity(group);
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, { ...group, key: `inkbound:${identity}`, genres: [...group.genres], editions: [...group.editions] });
      order.push(identity);
      return;
    }

    if (!existing.subtitle && group.subtitle) existing.subtitle = group.subtitle;
    if (!existing.publisherSummary && group.publisherSummary) existing.publisherSummary = group.publisherSummary;
    existing.genres = [...new Set([...existing.genres, ...group.genres])].slice(0, 16);
    group.editions.forEach((edition) => {
      if (!existing.editions.some((candidate) => sameEdition(candidate, edition))) existing.editions.push(edition);
    });
  };

  primary.forEach(addGroup);
  supplement.forEach(addGroup);
  return order.map((identity) => merged.get(identity)).filter((group): group is NormalizedGroup => Boolean(group)).slice(0, 50);
};

const groupGoogleVolumes = (volumes: GoogleVolume[]): NormalizedGroup[] => {
  const groups = new Map<string, NormalizedGroup>();
  const order: string[] = [];

  volumes.forEach((volume) => {
    const info = volume.volumeInfo;
    if (!info?.title) return;
    const authors = info.authors?.length ? info.authors : ['Unknown author'];
    const edition: NormalizedEdition = {
      source: 'google-books',
      externalEditionId: volume.id,
      title: info.title,
      subtitle: info.subtitle,
      authors,
      publisherSummary: info.description,
      genres: info.categories ?? [],
      publisher: info.publisher,
      publicationDate: info.publishedDate,
      publicationYear: publicationYear(info.publishedDate),
      language: info.language,
      format: volume.saleInfo?.isEbook ? 'ebook' : 'hardcover',
      isbn10: googleIdentifier(volume, 'ISBN_10'),
      isbn13: googleIdentifier(volume, 'ISBN_13'),
      pageCount: info.pageCount,
      coverUrl: normalizeGoogleCover(info.imageLinks),
      editionName: info.subtitle?.toLocaleLowerCase().includes('edition') ? info.subtitle : undefined,
      binding: volume.saleInfo?.isEbook ? 'Digital' : undefined,
      specialFeatures: [],
    };
    const identity = `${normalizeText(edition.title)}::${normalizeText(authors[0])}`;
    const existing = groups.get(identity);
    if (!existing) {
      groups.set(identity, {
        key: `google-books:${volume.id}`,
        title: edition.title,
        subtitle: edition.subtitle,
        authors,
        publisherSummary: edition.publisherSummary,
        genres: edition.genres,
        editions: [edition],
      });
      order.push(identity);
      return;
    }
    if (!existing.editions.some((candidate) => sameEdition(candidate, edition))) existing.editions.push(edition);
    if (!existing.publisherSummary && edition.publisherSummary) existing.publisherSummary = edition.publisherSummary;
    existing.genres = [...new Set([...existing.genres, ...edition.genres])].slice(0, 16);
  });

  return order.map((identity) => groups.get(identity)).filter((group): group is NormalizedGroup => Boolean(group));
};

async function searchGoogleBooks(query: string): Promise<NormalizedGroup[]> {
  const isbn = compactIsbn(query);
  const q = /^(?:97[89])?\d{9}[\dX]$/i.test(isbn) ? `isbn:${isbn}` : query;
  const params = new URLSearchParams({
    q,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    maxResults: '40',
  });

  try {
    const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
    if (!response.ok) {
      console.warn(`Google Books search returned ${response.status}.`);
      return [];
    }
    const payload = await response.json() as GoogleVolumesResponse;
    return groupGoogleVolumes(payload.items ?? []);
  } catch (error) {
    console.warn('Google Books search failed.', error);
    return [];
  }
}

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

async function searchHardcoverProvider(query: string, token: string): Promise<NormalizedGroup[]> {
  if (!token) return [];

  try {
    const searchData = await hardcoverGraphql<{ search?: { results?: unknown } }>(
      token,
      `query SearchBooks($q: String!) {
        search(query: $q, query_type: "Book", per_page: 15, page: 1) { results }
      }`,
      { q: query },
    );
    const searchResults = parseHardcoverSearchResults(searchData.search?.results).filter((result) => result.title);
    const ids = searchResults.map((result) => Number(result.id)).filter((id) => Number.isFinite(id));

    let editions: HardcoverEdition[] = [];
    if (ids.length > 0) {
      try {
        const editionData = await hardcoverGraphql<{ editions?: HardcoverEdition[] }>(
          token,
          `query SearchEditions($ids: [Int!]!) {
            editions(where: { book_id: { _in: $ids } }, limit: 80) {
              id book_id title pages isbn_10 isbn_13 release_date edition_format
              image { url }
              publisher { name }
              book { id title subtitle description release_year image { url } }
            }
          }`,
          { ids },
        );
        editions = editionData.editions ?? [];
      } catch (error) {
        console.warn('Hardcover edition expansion failed.', error);
      }
    }

    const editionsByBook = new Map<string, HardcoverEdition[]>();
    editions.forEach((edition) => {
      const key = String(edition.book_id ?? edition.book?.id ?? '');
      if (!key) return;
      editionsByBook.set(key, [...(editionsByBook.get(key) ?? []), edition]);
    });

    return searchResults.map((result): NormalizedGroup => {
      const id = String(result.id ?? result.slug ?? result.title);
      const authors = hardcoverAuthorNames(result);
      const matchedEditions = editionsByBook.get(String(result.id ?? '')) ?? [];
      const normalizedEditions: NormalizedEdition[] = matchedEditions.length > 0
        ? matchedEditions.map((edition): NormalizedEdition => ({
            source: 'hardcover',
            externalEditionId: String(edition.id ?? `${id}-${edition.isbn_13 ?? edition.isbn_10 ?? edition.title ?? 'edition'}`),
            title: edition.title ?? edition.book?.title ?? result.title ?? 'Untitled',
            subtitle: edition.book?.subtitle ?? result.subtitle,
            authors,
            publisherSummary: edition.book?.description ?? result.description,
            genres: [],
            publisher: edition.publisher?.name,
            publicationDate: edition.release_date,
            publicationYear: Number(edition.release_date?.slice(0, 4)) || edition.book?.release_year || result.release_year || new Date().getFullYear(),
            format: normalizeHardcoverFormat(edition.edition_format),
            isbn10: edition.isbn_10,
            isbn13: edition.isbn_13,
            pageCount: edition.pages ?? result.pages,
            coverUrl: edition.image?.url ?? edition.book?.image?.url ?? result.image_url ?? hardcoverImageUrl(result.image),
            editionName: edition.title,
            binding: edition.edition_format,
            specialFeatures: [],
          }))
        : [{
            source: 'hardcover',
            externalEditionId: id,
            title: result.title ?? 'Untitled',
            subtitle: result.subtitle,
            authors,
            publisherSummary: result.description,
            genres: [],
            publicationYear: result.release_year || new Date().getFullYear(),
            format: 'hardcover',
            pageCount: result.pages,
            coverUrl: result.image_url ?? hardcoverImageUrl(result.image),
            specialFeatures: [],
          }];

      return {
        key: `hardcover:${id}`,
        title: result.title ?? 'Untitled',
        subtitle: result.subtitle,
        authors,
        publisherSummary: result.description,
        genres: [],
        editions: normalizedEditions,
      };
    });
  } catch (error) {
    console.warn('Hardcover search failed.', error);
    return [];
  }
}

export const searchHardcoverBooks = onCall({ secrets: [HARDCOVER_API_TOKEN] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to search the Inkbound catalog.');
  const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
  if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid book search is required.');

  const cacheKey = normalizeText(query);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  if (cached) searchCache.delete(cacheKey);

  const token = HARDCOVER_API_TOKEN.value().trim();
  const [googleGroups, hardcoverGroups] = await Promise.all([
    searchGoogleBooks(query),
    searchHardcoverProvider(query, token),
  ]);

  // Google Books is the baseline catalog and keeps its relevance ordering.
  // Hardcover only enriches matching works or appends additional works.
  const groups = mergeGroups(googleGroups, hardcoverGroups);
  const response: SearchResponse = { groups, totalItems: groups.length };
  searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response });
  return response;
});
