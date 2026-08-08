import { Format } from '../../../types';
import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';

interface OpenLibraryEdition {
  key?: string;
  title?: string;
  subtitle?: string;
  publisher?: string[] | string;
  publish_date?: string;
  publish_year?: number[];
  isbn?: string[];
  isbn_10?: string[];
  isbn_13?: string[];
  number_of_pages_median?: number;
  number_of_pages?: number;
  cover_i?: number;
  cover_edition_key?: string;
  language?: string[];
  ebook_access?: string;
}

interface OpenLibraryWork {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  subject?: string[];
  language?: string[];
  isbn?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  number_of_pages_median?: number;
  editions?: {
    docs?: OpenLibraryEdition[];
  };
}

interface OpenLibraryResponse {
  numFound?: number;
  num_found?: number;
  docs?: OpenLibraryWork[];
}

const OPEN_LIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';

const publicationYear = (value?: string, fallback?: number): number => {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : fallback ?? new Date().getFullYear();
};

const first = (value?: string[] | string): string | undefined =>
  Array.isArray(value) ? value.find(Boolean) : value || undefined;

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const inferFormat = (edition: OpenLibraryEdition): Format => {
  const access = edition.ebook_access?.toLowerCase();
  if (access && access !== 'no_ebook') return 'ebook';
  return 'hardcover';
};

const coverUrl = (edition: OpenLibraryEdition, work: OpenLibraryWork): string | undefined => {
  const coverId = edition.cover_i ?? work.cover_i;
  if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  const editionKey = edition.cover_edition_key ?? work.cover_edition_key;
  if (editionKey) return `https://covers.openlibrary.org/b/olid/${editionKey}-L.jpg`;
  const isbn = edition.isbn_13?.[0] ?? edition.isbn_10?.[0] ?? edition.isbn?.[0] ?? work.isbn?.[0];
  return isbn ? `https://covers.openlibrary.org/b/isbn/${compactIsbn(isbn)}-L.jpg` : undefined;
};

const toEdition = (work: OpenLibraryWork, edition: OpenLibraryEdition, index: number): BookSearchEdition | null => {
  const title = edition.title ?? work.title;
  if (!title) return null;
  const isbn13 = edition.isbn_13?.[0] ?? edition.isbn?.find((value) => compactIsbn(value).length === 13);
  const isbn10 = edition.isbn_10?.[0] ?? edition.isbn?.find((value) => compactIsbn(value).length === 10);
  const publicationDate = edition.publish_date;
  const publishers = edition.publisher ?? work.publisher;
  return {
    source: 'open-library',
    externalEditionId: edition.key ?? `${work.key ?? title}-${index}`,
    title,
    subtitle: edition.subtitle ?? work.subtitle,
    authors: work.author_name?.length ? work.author_name : ['Unknown author'],
    genres: (work.subject ?? []).slice(0, 12),
    publisher: first(publishers),
    publicationDate,
    publicationYear: publicationYear(publicationDate, edition.publish_year?.[0] ?? work.first_publish_year),
    language: edition.language?.[0] ?? work.language?.[0],
    format: inferFormat(edition),
    isbn10,
    isbn13,
    pageCount: edition.number_of_pages ?? edition.number_of_pages_median ?? work.number_of_pages_median,
    coverUrl: coverUrl(edition, work),
    specialFeatures: [],
  };
};

const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const mapWork = (work: OpenLibraryWork): BookSearchWorkGroup | null => {
  if (!work.title) return null;
  const editionDocs = work.editions?.docs?.length ? work.editions.docs : [{}];
  const editions = editionDocs
    .map((edition, index) => toEdition(work, edition, index))
    .filter((edition): edition is BookSearchEdition => Boolean(edition));
  if (editions.length === 0) return null;
  return {
    key: `open-library:${work.key ?? `${normalize(work.title)}:${normalize(work.author_name?.[0])}`}`,
    title: work.title,
    subtitle: work.subtitle,
    authors: work.author_name?.length ? work.author_name : ['Unknown author'],
    genres: (work.subject ?? []).slice(0, 12),
    editions,
  };
};

export async function searchOpenLibrary(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  const params = new URLSearchParams({
    q: trimmed,
    limit: '20',
    fields: [
      'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher', 'subject', 'language',
      'isbn', 'cover_i', 'cover_edition_key', 'number_of_pages_median', 'editions', 'editions.key',
      'editions.title', 'editions.subtitle', 'editions.publisher', 'editions.publish_date', 'editions.publish_year',
      'editions.isbn', 'editions.isbn_10', 'editions.isbn_13', 'editions.number_of_pages',
      'editions.number_of_pages_median', 'editions.cover_i', 'editions.cover_edition_key',
      'editions.language', 'editions.ebook_access',
    ].join(','),
  });

  const response = await fetch(`${OPEN_LIBRARY_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Open Library search failed (${response.status}).`);

  const payload = (await response.json()) as OpenLibraryResponse;
  const groups = (payload.docs ?? [])
    .map(mapWork)
    .filter((group): group is BookSearchWorkGroup => Boolean(group));

  return { groups, totalItems: payload.numFound ?? payload.num_found ?? groups.length };
}
