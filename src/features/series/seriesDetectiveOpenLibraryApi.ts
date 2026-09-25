import type { Format } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import {
  canonicalDetectiveAuthor,
  detectiveSeriesNamesCompatible,
  normalizeDetectiveText,
} from './seriesDetectiveEvidence';

interface OpenLibraryEdition {
  key?: string;
  title?: string;
  subtitle?: string;
  publish_date?: string;
  publish_year?: number;
  publisher?: string[] | string;
  isbn?: string[];
  isbn_10?: string[];
  isbn_13?: string[];
  number_of_pages?: number;
  number_of_pages_median?: number;
  language?: string[];
  physical_format?: string;
  ebook_access?: string;
  cover_i?: number;
  cover_edition_key?: string;
  series?: string[];
}

interface OpenLibraryWork {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[] | string;
  subject?: string[];
  language?: string[];
  isbn?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  series?: string[];
  editions?: { docs?: OpenLibraryEdition[] };
}

interface OpenLibraryResponse {
  docs?: OpenLibraryWork[];
}

export interface DetectiveOpenLibraryCandidate {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
  seriesName: string;
  position: number | null;
  recordId: string;
}

const ENDPOINT = 'https://openlibrary.org/search.json';
const FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher', 'subject', 'language', 'series',
  'isbn', 'cover_i', 'cover_edition_key', 'editions', 'editions.key', 'editions.title', 'editions.subtitle',
  'editions.publish_date', 'editions.publish_year', 'editions.publisher', 'editions.isbn', 'editions.isbn_10',
  'editions.isbn_13', 'editions.number_of_pages', 'editions.number_of_pages_median', 'editions.language',
  'editions.physical_format', 'editions.ebook_access', 'editions.cover_i', 'editions.cover_edition_key',
  'editions.series',
].join(',');

const compactIsbn = (value?: string): string =>
  value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const first = (value?: string[] | string): string | undefined =>
  Array.isArray(value) ? value.find(Boolean) : value || undefined;

const year = (value?: string | number, fallback?: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
  return match ? Number(match[0]) : fallback ?? 0;
};

const formatFor = (edition: OpenLibraryEdition): Format => {
  const physical = edition.physical_format?.toLowerCase() ?? '';
  if (/paperback|softcover|soft cover|mass market|trade paper/.test(physical)) return 'paperback';
  if (/audio/.test(physical)) return 'audiobook';
  if (/ebook|digital/.test(physical)) return 'ebook';
  if (/hardcover|hardback|hard cover|library binding/.test(physical)) return 'hardcover';
  const ebookAccess = edition.ebook_access?.toLowerCase();
  return ebookAccess && ebookAccess !== 'no_ebook' ? 'ebook' : 'hardcover';
};

const coverUrl = (work: OpenLibraryWork, edition: OpenLibraryEdition): string | undefined => {
  if (edition.cover_i) return `https://covers.openlibrary.org/b/id/${edition.cover_i}-L.jpg`;
  if (edition.cover_edition_key) return `https://covers.openlibrary.org/b/olid/${edition.cover_edition_key}-L.jpg`;
  const isbn = edition.isbn_13?.[0] ?? edition.isbn_10?.[0] ?? edition.isbn?.[0] ?? work.isbn?.[0];
  return isbn ? `https://covers.openlibrary.org/b/isbn/${compactIsbn(isbn)}-L.jpg` : undefined;
};

export const parseDetectiveOpenLibrarySeries = (
  values?: string[],
): { name: string; position: number | null } | null => {
  const raw = values?.find((value) => value?.trim())?.trim();
  if (!raw) return null;
  const primary = raw.split(';').map((value) => value.trim()).find(Boolean) ?? raw;
  const match = primary.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*|,\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return { name: primary, position: null };
  const parsed = Number(match[2]);
  return {
    name: match[1].replace(/[,:;\-]+$/g, '').trim() || primary,
    position: Number.isFinite(parsed) ? parsed : null,
  };
};

const mapCandidate = (
  work: OpenLibraryWork,
  edition: OpenLibraryEdition,
  index: number,
  wantedSeriesName?: string,
  wantedAuthor?: string,
): DetectiveOpenLibraryCandidate | null => {
  const title = (edition.title ?? work.title)?.trim();
  if (!title) return null;
  const metadata = parseDetectiveOpenLibrarySeries(edition.series ?? work.series);
  if (!metadata) return null;
  if (wantedSeriesName && !detectiveSeriesNamesCompatible(metadata.name, wantedSeriesName)) return null;

  const authors = work.author_name?.length ? work.author_name : ['Unknown author'];
  if (wantedAuthor) {
    const wanted = canonicalDetectiveAuthor(wantedAuthor);
    const exact = !wanted || authors.some((author) => canonicalDetectiveAuthor(author) === wanted);
    // Open Library's explicit structured series membership can span authors, so
    // author mismatch is not a hard rejection when the series itself matches.
    if (!exact && !wantedSeriesName) return null;
  }

  const isbn13 = edition.isbn_13?.[0]
    ?? edition.isbn?.find((value) => compactIsbn(value).length === 13);
  const isbn10 = edition.isbn_10?.[0]
    ?? edition.isbn?.find((value) => compactIsbn(value).length === 10);

  const mappedEdition: BookSearchEdition = {
    source: 'open-library',
    externalEditionId: edition.key ?? `${work.key ?? normalizeDetectiveText(title)}:${index}`,
    title,
    subtitle: edition.subtitle ?? work.subtitle,
    authors,
    genres: (work.subject ?? []).slice(0, 12),
    publisher: first(edition.publisher ?? work.publisher),
    publicationDate: edition.publish_date,
    publicationYear: year(edition.publish_date, edition.publish_year ?? work.first_publish_year),
    language: edition.language?.[0] ?? work.language?.[0],
    format: formatFor(edition),
    isbn10,
    isbn13,
    pageCount: edition.number_of_pages ?? edition.number_of_pages_median,
    coverUrl: coverUrl(work, edition),
    binding: edition.physical_format,
    specialFeatures: [],
  };

  const mappedWork: BookSearchWorkGroup = {
    key: `open-library:${work.key ?? `${normalizeDetectiveText(title)}:${canonicalDetectiveAuthor(authors[0])}`}`,
    title: work.title ?? title,
    subtitle: work.subtitle,
    authors,
    genres: (work.subject ?? []).slice(0, 12),
    editions: [mappedEdition],
  };

  return {
    work: mappedWork,
    edition: mappedEdition,
    seriesName: metadata.name,
    position: metadata.position,
    recordId: mappedEdition.externalEditionId,
  };
};

const fetchOpenLibrary = async (
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<OpenLibraryWork[]> => {
  params.set('limit', '100');
  params.set('fields', FIELDS);
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Open Library Series Detective search failed (${response.status}).`);
  const payload = await response.json() as OpenLibraryResponse;
  return payload.docs ?? [];
};

const flattenCandidates = (
  works: OpenLibraryWork[],
  wantedSeriesName?: string,
  wantedAuthor?: string,
): DetectiveOpenLibraryCandidate[] => works.flatMap((work) => {
  const editions = work.editions?.docs?.length ? work.editions.docs : [{}];
  return editions.flatMap((edition, index) => {
    const candidate = mapCandidate(work, edition, index, wantedSeriesName, wantedAuthor);
    return candidate ? [candidate] : [];
  });
});

export async function searchDetectiveOpenLibrarySeries(
  seriesName: string,
  author?: string,
  signal?: AbortSignal,
): Promise<DetectiveOpenLibraryCandidate[]> {
  const escapedSeries = seriesName.replace(/"/g, '').trim();
  const queries = [
    new URLSearchParams({ q: `series:"${escapedSeries}"` }),
    new URLSearchParams({ q: `${escapedSeries} ${author ?? ''}`.trim() }),
  ];

  const results = await Promise.all(queries.map(async (params) => {
    try {
      return await fetchOpenLibrary(params, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Series Detective Open Library query failed.', error);
      return [];
    }
  }));

  const seen = new Set<string>();
  return flattenCandidates(results.flat(), seriesName, author).filter((candidate) => {
    const key = `${candidate.work.key}:${candidate.edition.externalEditionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


export async function searchDetectiveOpenLibraryAuthor(
  author: string,
  signal?: AbortSignal,
): Promise<DetectiveOpenLibraryCandidate[]> {
  const trimmed = author.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({ author: trimmed });
  try {
    return flattenCandidates(await fetchOpenLibrary(params, signal), undefined, author);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective Open Library author lookup failed.', error);
    return [];
  }
}

export async function searchDetectiveOpenLibraryBook(
  title: string,
  author: string,
  signal?: AbortSignal,
): Promise<DetectiveOpenLibraryCandidate[]> {
  const params = new URLSearchParams({ title: title.trim(), author: author.trim() });
  try {
    return flattenCandidates(await fetchOpenLibrary(params, signal), undefined, author)
      .filter((candidate) =>
        normalizeDetectiveText(candidate.work.title) === normalizeDetectiveText(title)
        || normalizeDetectiveText(candidate.edition.title) === normalizeDetectiveText(title),
      );
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective Open Library book lookup failed.', error);
    return [];
  }
}
