import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';
import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';

interface HardcoverSearchPayload {
  groups?: BookSearchResponse['groups'];
  totalItems?: number;
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
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    pageCount?: number;
    categories?: string[];
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
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

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value: string): string => value.replace(/[^0-9X]/gi, '').toUpperCase();

const publicationYear = (value?: string): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
};

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
    format: volume.saleInfo?.isEbook ? 'ebook' : 'hardcover',
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
  editions.forEach((edition) => {
    const key = `${normalizeText(edition.title)}::${normalizeText(edition.authors[0])}`;
    const existing = groups.get(key);
    if (existing) {
      const duplicate = existing.editions.some((candidate) =>
        candidate.externalEditionId === edition.externalEditionId ||
        Boolean(candidate.isbn13 && edition.isbn13 && compactIsbn(candidate.isbn13) === compactIsbn(edition.isbn13)) ||
        Boolean(candidate.isbn10 && edition.isbn10 && compactIsbn(candidate.isbn10) === compactIsbn(edition.isbn10)),
      );
      if (!duplicate) existing.editions.push(edition);
      return;
    }
    groups.set(key, {
      key: `google-books:${key}`,
      title: edition.title,
      subtitle: edition.subtitle,
      authors: edition.authors,
      publisherSummary: edition.publisherSummary,
      genres: edition.genres,
      editions: [edition],
    });
  });
  return [...groups.values()];
};

async function searchGoogleBooksFallback(query: string): Promise<BookSearchResponse> {
  const isbn = compactIsbn(query);
  const q = /^(?:97[89])?\d{9}[\dX]$/i.test(isbn) ? `isbn:${isbn}` : query.trim();
  const params = new URLSearchParams({
    q,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    maxResults: '40',
  });
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);

  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Google Books fallback failed (${response.status}).`);
  }

  const payload = await response.json() as GoogleVolumesResponse;
  const editions = (payload.items ?? [])
    .map(mapGoogleVolume)
    .filter((edition): edition is BookSearchEdition => Boolean(edition));
  const groups = groupGoogleEditions(editions);
  return { groups, totalItems: payload.totalItems ?? groups.length };
}

export async function searchHardcover(query: string): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  if (functions) {
    try {
      const callable = httpsCallable<{ query: string }, HardcoverSearchPayload>(functions, 'searchHardcoverBooks');
      const response = await callable({ query: trimmed });
      const groups = Array.isArray(response.data.groups) ? response.data.groups : [];
      if (groups.length > 0) {
        return {
          groups,
          totalItems: typeof response.data.totalItems === 'number' ? response.data.totalItems : groups.length,
        };
      }
      console.warn('Inkbound catalog returned no results; trying one Google Books fallback request.');
    } catch (error) {
      console.warn('Inkbound catalog request failed; trying one Google Books fallback request.', error);
    }
  }

  try {
    return await searchGoogleBooksFallback(trimmed);
  } catch (error) {
    console.error('Google Books fallback search failed.', error);
    return { groups: [], totalItems: 0 };
  }
}
