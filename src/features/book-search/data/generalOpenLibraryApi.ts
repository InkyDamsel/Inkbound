import { Format } from '../../../types';
import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';

interface OpenLibraryEdition {
  key?: string;
  title?: string;
  subtitle?: string;
  publisher?: string[] | string;
  publish_date?: unknown;
  publish_year?: unknown;
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
  first_publish_year?: unknown;
  publisher?: string[] | string;
  subject?: string[];
  language?: string[];
  isbn?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  number_of_pages_median?: number;
  editions?: { docs?: OpenLibraryEdition[] };
}

interface OpenLibraryResponse {
  numFound?: number;
  num_found?: number;
  docs?: OpenLibraryWork[];
}

interface OpenLibraryWorkDetails {
  description?: string | { value?: string };
}

const OPEN_LIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';
const FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher', 'subject', 'language',
  'isbn', 'cover_i', 'cover_edition_key', 'number_of_pages_median', 'editions', 'editions.key',
  'editions.title', 'editions.subtitle', 'editions.publisher', 'editions.publish_date', 'editions.publish_year',
  'editions.isbn', 'editions.isbn_10', 'editions.isbn_13', 'editions.number_of_pages',
  'editions.number_of_pages_median', 'editions.cover_i', 'editions.cover_edition_key',
  'editions.language', 'editions.ebook_access',
].join(',');

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const firstUsable = value.find((item) => typeof item === 'string' || typeof item === 'number');
    return firstUsable === undefined ? undefined : String(firstUsable);
  }
  return undefined;
};

const numericYear = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = stringValue(value);
  const match = text?.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
  return match ? Number(match[0]) : undefined;
};

const publicationYear = (value: unknown, fallback?: unknown): number =>
  numericYear(value) ?? numericYear(fallback) ?? new Date().getFullYear();

const first = (value?: string[] | string): string | undefined =>
  Array.isArray(value) ? value.find(Boolean) : value || undefined;

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const stripQuotes = (value: string) => value.trim().replace(/^['"]|['"]$/g, '').trim();

const inferFormat = (edition: OpenLibraryEdition): Format => {
  const access = edition.ebook_access?.toLowerCase();
  return access && access !== 'no_ebook' ? 'ebook' : 'hardcover';
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
  const publicationDate = stringValue(edition.publish_date);
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
    publicationYear: publicationYear(publicationDate, edition.publish_year ?? work.first_publish_year),
    language: edition.language?.[0] ?? work.language?.[0],
    format: inferFormat(edition),
    isbn10,
    isbn13,
    pageCount: edition.number_of_pages ?? edition.number_of_pages_median ?? work.number_of_pages_median,
    coverUrl: coverUrl(edition, work),
    specialFeatures: [],
  };
};

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

function buildSearchParams(query: string): URLSearchParams {
  const trimmed = query.trim();
  const operator = trimmed.match(/^(inauthor|intitle|isbn):\s*(.+)$/i);
  const params = new URLSearchParams({ limit: '40', fields: FIELDS });
  if (!operator) {
    params.set('q', trimmed);
    return params;
  }

  const [, kind, rawValue] = operator;
  const value = stripQuotes(rawValue);
  if (kind.toLowerCase() === 'inauthor') params.set('author', value);
  else if (kind.toLowerCase() === 'intitle') params.set('title', value);
  else params.set('isbn', compactIsbn(value));
  return params;
}

export async function searchGeneralOpenLibrary(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  const params = buildSearchParams(trimmed);
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

export async function fetchGeneralOpenLibrarySummary(title: string, author: string, signal?: AbortSignal): Promise<string | undefined> {
  const params = new URLSearchParams({
    title: title.trim(),
    author: author.trim(),
    limit: '8',
    fields: 'key,title,author_name',
  });
  const response = await fetch(`${OPEN_LIBRARY_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return undefined;

  const payload = (await response.json()) as OpenLibraryResponse;
  const wantedTitle = normalize(title);
  const wantedAuthor = normalize(author);
  const candidate = (payload.docs ?? []).find((work) => {
    const candidateTitle = normalize(work.title);
    const candidateAuthors = normalize((work.author_name ?? []).join(' '));
    const titleMatch = candidateTitle === wantedTitle || candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle);
    const authorTokens = wantedAuthor.split(' ').filter(Boolean);
    const authorMatch = authorTokens.length === 0 || authorTokens.every((token) => candidateAuthors.includes(token));
    return Boolean(work.key && titleMatch && authorMatch);
  });
  if (!candidate?.key) return undefined;

  const workPath = candidate.key.startsWith('/') ? candidate.key : `/works/${candidate.key}`;
  const detailsResponse = await fetch(`https://openlibrary.org${workPath}.json`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!detailsResponse.ok) return undefined;
  const details = (await detailsResponse.json()) as OpenLibraryWorkDetails;
  const description = typeof details.description === 'string' ? details.description : details.description?.value;
  return description?.trim() || undefined;
}
