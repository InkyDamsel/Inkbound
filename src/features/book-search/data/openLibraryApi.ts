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
  series?: string[];
  publishers?: string[];
  physical_format?: string;
  authors?: Array<{ key?: string }>;
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
  series?: string[];
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

interface OpenLibraryAuthorSearchResponse {
  numFound?: number;
  docs?: Array<{ key?: string; name?: string; work_count?: number }>;
}

interface OpenLibraryAuthorWorksResponse {
  size?: number;
  entries?: Array<OpenLibraryWork & {
    covers?: number[];
    first_publish_date?: string;
    authors?: Array<{ author?: { key?: string }; key?: string }>;
  }>;
}

const OPEN_LIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';
const FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher', 'subject', 'language', 'series',
  'isbn', 'cover_i', 'cover_edition_key', 'number_of_pages_median', 'editions', 'editions.key',
  'editions.title', 'editions.subtitle', 'editions.publisher', 'editions.publish_date', 'editions.publish_year',
  'editions.isbn', 'editions.isbn_10', 'editions.isbn_13', 'editions.number_of_pages',
  'editions.number_of_pages_median', 'editions.cover_i', 'editions.cover_edition_key',
  'editions.language', 'editions.ebook_access', 'editions.series',
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

const parseSeries = (values?: string[]): { name?: string; order?: number } => {
  const raw = values?.find((value) => value?.trim())?.trim();
  if (!raw) return {};
  const match = raw.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return { name: raw };
  const order = Number(match[2]);
  return {
    name: match[1].replace(/[,:;\-]+$/g, '').trim() || raw,
    order: Number.isFinite(order) ? order : undefined,
  };
};

const toEdition = (work: OpenLibraryWork, edition: OpenLibraryEdition, index: number): BookSearchEdition | null => {
  const title = edition.title ?? work.title;
  if (!title) return null;
  const isbn13 = edition.isbn_13?.[0] ?? edition.isbn?.find((value) => compactIsbn(value).length === 13);
  const isbn10 = edition.isbn_10?.[0] ?? edition.isbn?.find((value) => compactIsbn(value).length === 10);
  const publicationDate = stringValue(edition.publish_date);
  const publishers = edition.publisher ?? work.publisher;
  const series = parseSeries(edition.series ?? work.series);
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
    seriesName: series.name,
    seriesOrder: series.order,
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

function buildSearchParams(query: string, offset = 0): URLSearchParams {
  const trimmed = query.trim();
  const operator = trimmed.match(/^(inauthor|intitle|isbn):\s*(.+)$/i);
  const params = new URLSearchParams({ limit: '40', fields: FIELDS });
  if (offset > 0) params.set('offset', String(offset));
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

// Open Library search results only expose a small subset of each work's editions.
// For barcode scans, fetch the edition by its exact ISBN first so retail and
// special editions cannot disappear behind the search endpoint's edition limit.
async function searchExactOpenLibraryEdition(isbn: string, signal?: AbortSignal): Promise<BookSearchResponse | null> {
  const response = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Library ISBN edition lookup failed (${response.status}).`);
  const edition = (await response.json()) as OpenLibraryEdition;
  if (!edition.title) return null;
  const declaredIsbns = [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? []), ...(edition.isbn ?? [])]
    .map(compactIsbn);
  if (!declaredIsbns.includes(isbn)) return null;

  const work: OpenLibraryWork = {
    title: edition.title,
    subtitle: edition.subtitle,
    publisher: edition.publishers ?? edition.publisher,
    isbn: [isbn],
  };
  const mapped = toEdition(work, edition, 0);
  if (!mapped) return null;
  // Preserve the exact scanned ISBN even if the provider omitted its
  // normalized isbn_13 / isbn_10 field.
  if (isbn.length === 13) mapped.isbn13 = isbn;
  else mapped.isbn10 = isbn;
  if (edition.physical_format) mapped.binding = edition.physical_format;
  return {
    groups: [{
      key: `open-library:edition:${edition.key ?? isbn}`,
      title: edition.title,
      subtitle: edition.subtitle,
      authors: mapped.authors,
      genres: [],
      editions: [mapped],
    }],
    totalItems: 1,
  };
}

export async function searchOpenLibrary(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  const isbnMatch = trimmed.match(/^isbn:\s*(.+)$/i);
  if (isbnMatch) {
    const isbn = compactIsbn(isbnMatch[1]);
    if (/^(?:978|979)\d{10}$|^\d{9}[\dX]$/.test(isbn)) {
      const exact = await searchExactOpenLibraryEdition(isbn, signal);
      if (exact) return exact;
    }
  }

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

export async function searchOpenLibraryAuthorBibliography(
  authorName: string,
  signal?: AbortSignal,
  _maxPages = 5,
): Promise<BookSearchResponse> {
  const trimmed = authorName.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  // Resolve the author once, then use Open Library's purpose-built author
  // works endpoint. The old generic search path stopped after 200 results even
  // when Open Library reported a much larger bibliography.
  const authorParams = new URLSearchParams({ q: trimmed, limit: '20' });
  const authorResponse = await fetch(`https://openlibrary.org/search/authors.json?${authorParams.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!authorResponse.ok) throw new Error(`Open Library author lookup failed (${authorResponse.status}).`);

  const authorPayload = (await authorResponse.json()) as OpenLibraryAuthorSearchResponse;
  const wanted = normalize(trimmed);
  // Never silently substitute the first similarly named author.
  const author = (authorPayload.docs ?? []).find((candidate) => normalize(candidate.name) === wanted);
  const authorKey = author?.key?.replace(/^\/authors\//, '');
  if (!authorKey) return { groups: [], totalItems: 0 };

  const worksResponse = await fetch(
    `https://openlibrary.org/authors/${encodeURIComponent(authorKey)}/works.json?limit=1000`,
    { signal, headers: { Accept: 'application/json' } },
  );
  if (!worksResponse.ok) throw new Error(`Open Library author works lookup failed (${worksResponse.status}).`);

  const worksPayload = (await worksResponse.json()) as OpenLibraryAuthorWorksResponse;
  const groups = (worksPayload.entries ?? []).flatMap((entry): BookSearchWorkGroup[] => {
    if (!entry.title) return [];
    // Open Library author works include collaborations and edited collections.
    // A work is an exact-author result only if its own author reference verifies it.
    const creditedKeys = (entry.authors ?? []).map((credit) =>
      (credit.author?.key ?? credit.key ?? '').replace(/^\/authors\//, ''),
    );
    if (!creditedKeys.includes(authorKey)) return [];
    const coverId = entry.covers?.find((value) => Number.isFinite(value) && value > 0);
    const publicationDate = entry.first_publish_date;
    const edition: BookSearchEdition = {
      source: 'open-library',
      externalEditionId: entry.key ?? `${authorKey}:${normalize(entry.title)}`,
      title: entry.title,
      subtitle: entry.subtitle,
      authors: [author.name ?? trimmed],
      genres: (entry.subject ?? []).slice(0, 12),
      publicationDate,
      publicationYear: publicationYear(publicationDate, entry.first_publish_year),
      format: 'hardcover',
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
      specialFeatures: [],
    };
    return [{
      key: `open-library:${entry.key ?? `${authorKey}:${normalize(entry.title)}`}`,
      title: entry.title,
      subtitle: entry.subtitle,
      authors: [author.name ?? trimmed],
      genres: (entry.subject ?? []).slice(0, 12),
      editions: [edition],
    }];
  });

  return {
    groups,
    totalItems: worksPayload.size ?? author?.work_count ?? groups.length,
  };
}

export async function fetchOpenLibrarySummary(title: string, author: string, signal?: AbortSignal): Promise<string | undefined> {
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
