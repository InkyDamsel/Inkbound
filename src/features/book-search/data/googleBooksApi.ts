import { httpsCallable } from 'firebase/functions';
import { Format } from '../../../types';
import { auth, functions } from '../../../lib/firebase';
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
}

interface GoogleVolumesResponse {
  totalItems?: number;
  items?: GoogleVolume[];
}

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; response: BookSearchResponse }>();

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value: string): string => value.replace(/[^0-9X]/gi, '').toUpperCase();

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
      if (!existing.editions.some((candidate) => sameEdition(candidate, edition))) existing.editions.push(edition);
    });
  };

  primary.forEach(add);
  supplements.flat().forEach(add);
  return order.map((key) => merged.get(key)).filter((group): group is BookSearchWorkGroup => Boolean(group)).slice(0, 50);
};

async function requestProtectedGoogleBooks(query: string, signal?: AbortSignal): Promise<GoogleVolumesResponse> {
  if (!functions || !auth?.currentUser) {
    throw new Error('Protected Google Books search requires a signed-in Inkbound account.');
  }
  const callable = httpsCallable<
    { query: string; provider: 'google-books' },
    GoogleVolumesResponse
  >(functions, 'searchHardcoverBooks');
  const response = await callable({ query, provider: 'google-books' });
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');
  return response.data;
}

async function requestDirectGoogleBooks(query: string, signal?: AbortSignal): Promise<GoogleVolumesResponse> {
  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    maxResults: '40',
  });
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);

  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Google Books search failed (${response.status}).`);
  return response.json() as Promise<GoogleVolumesResponse>;
}

async function requestGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  // Signed-in readers always use the protected Functions gateway. This keeps the
  // Google API key out of the browser and avoids referrer/key-restriction failures
  // during import repair. Signed-out web search retains the public direct fallback.
  const payload = functions && auth?.currentUser
    ? await requestProtectedGoogleBooks(query, signal)
    : await requestDirectGoogleBooks(query, signal);

  const editions = (payload.items ?? []).map(mapGoogleVolume).filter((item): item is BookSearchEdition => Boolean(item));
  const groups = groupGoogleEditions(editions);
  return { groups, totalItems: payload.totalItems ?? groups.length };
}

async function searchGoogleBaseline(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  // Exactly one Google Books request per uncached search. Do not immediately
  // retry with anonymous/keyed variants because those bursts can trigger quotas
  // and make manual search compete with background metadata enrichment.
  try {
    return await requestGoogleBooks(buildGoogleBooksQuery(query), signal);
  } catch (error) {
    console.warn('Google Books search unavailable; using alternate catalogs.', error);
    return { groups: [], totalItems: 0 };
  }
}

async function searchOpenLibraryWithAuthorFallback(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  try {
    const normal = await searchOpenLibrary(buildGoogleBooksQuery(query), signal);
    if (normal.groups.length > 0 || /^isbn:/i.test(buildGoogleBooksQuery(query))) return normal;

    // Open Library has a dedicated author index. Use it only when the broad
    // search genuinely found nothing; this does not consume Google quota.
    if (/^[\p{L}.\-' ]{3,80}$/u.test(query.trim())) {
      return await searchOpenLibrary(`inauthor:${query.trim()}`, signal);
    }
    return normal;
  } catch (error) {
    console.warn('Open Library supplement failed.', error);
    return { groups: [], totalItems: 0 };
  }
}

export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  const cacheKey = normalizeText(trimmed);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  if (cached) searchCache.delete(cacheKey);

  const [google, hardcover, openLibrary] = await Promise.all([
    searchGoogleBaseline(trimmed, signal),
    searchHardcover(trimmed).catch((error) => {
      console.warn('Hardcover supplement failed.', error);
      return { groups: [], totalItems: 0 };
    }),
    searchOpenLibraryWithAuthorFallback(trimmed, signal),
  ]);

  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  console.info('[Inkbound search]', {
    query: trimmed,
    google: google.groups.length,
    hardcover: hardcover.groups.length,
    openLibrary: openLibrary.groups.length,
  });

  // Google is preferred when available, but alternate providers are fully valid
  // primary results when Google is rate-limited. Never show an empty search just
  // because one provider is temporarily unavailable.
  const primary = google.groups.length > 0 ? google.groups : openLibrary.groups.length > 0 ? openLibrary.groups : hardcover.groups;
  const groups = mergeGroups(primary, [google.groups, hardcover.groups, openLibrary.groups]);
  const response: BookSearchResponse = { groups, totalItems: groups.length };

  if (groups.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response });
  }

  return response;
}
