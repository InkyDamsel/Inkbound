import { Format } from '../../../types';
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
    printType?: string;
    categories?: string[];
    imageLinks?: GoogleImageLinks;
    language?: string;
  };
  saleInfo?: {
    isEbook?: boolean;
  };
}

interface GoogleVolumesResponse {
  totalItems?: number;
  items?: GoogleVolume[];
}

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const normalizeCoverUrl = (links?: GoogleImageLinks): string | undefined => {
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return source?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const publicationYear = (value?: string): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
};

const inferFormat = (volume: GoogleVolume): Format => {
  if (volume.saleInfo?.isEbook) return 'ebook';
  return 'hardcover';
};

const getIdentifier = (volume: GoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const mapVolume = (volume: GoogleVolume): BookSearchEdition | null => {
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
    coverUrl: normalizeCoverUrl(info.imageLinks),
    editionName: info.subtitle?.toLocaleLowerCase().includes('edition') ? info.subtitle : undefined,
    binding: volume.saleInfo?.isEbook ? 'Digital' : undefined,
    specialFeatures: [],
  };
};

const groupEditions = (editions: BookSearchEdition[]): BookSearchWorkGroup[] => {
  const groups = new Map<string, BookSearchWorkGroup>();

  editions.forEach((edition) => {
    const authorKey = normalizeText(edition.authors[0]);
    const key = `${normalizeText(edition.title)}::${authorKey}`;
    const existing = groups.get(key);

    if (existing) {
      const duplicate = existing.editions.some((candidate) =>
        candidate.externalEditionId === edition.externalEditionId ||
        Boolean(candidate.isbn13 && edition.isbn13 && candidate.isbn13 === edition.isbn13),
      );
      if (!duplicate) existing.editions.push(edition);
      if (!existing.publisherSummary && edition.publisherSummary) existing.publisherSummary = edition.publisherSummary;
      if (existing.genres.length === 0 && edition.genres.length > 0) existing.genres = edition.genres;
      return;
    }

    groups.set(key, {
      key,
      title: edition.title,
      subtitle: edition.subtitle,
      authors: edition.authors,
      publisherSummary: edition.publisherSummary,
      genres: edition.genres,
      editions: [edition],
    });
  });

  return [...groups.values()].map((group) => ({
    ...group,
    editions: [...group.editions].sort((a, b) => {
      if (Boolean(a.coverUrl) !== Boolean(b.coverUrl)) return a.coverUrl ? -1 : 1;
      return (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
    }),
  }));
};

export const buildGoogleBooksQuery = (value: string): string => {
  const trimmed = value.trim();
  const compact = trimmed.replace(/[-\s]/g, '');
  if (/^(?:97[89])?\d{9}[\dX]$/i.test(compact)) return `isbn:${compact}`;
  return trimmed;
};

export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const normalizedQuery = buildGoogleBooksQuery(query);
  if (!normalizedQuery) return { groups: [], totalItems: 0 };

  const params = new URLSearchParams({
    q: normalizedQuery,
    printType: 'books',
    projection: 'full',
    maxResults: '40',
  });
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);

  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Book search failed (${response.status}). Please try again.`);

  const payload = (await response.json()) as GoogleVolumesResponse;
  const editions = (payload.items ?? []).map(mapVolume).filter((item): item is BookSearchEdition => Boolean(item));

  return {
    groups: groupEditions(editions),
    totalItems: payload.totalItems ?? editions.length,
  };
}
