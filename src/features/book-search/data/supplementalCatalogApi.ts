import type { Format } from '../../../types';
import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';
import { hardenCatalogGroups } from '../catalogHardening';

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; response: BookSearchResponse }>();
const inFlight = new Map<string, Promise<BookSearchResponse>>();

const compact = (value?: string) => value?.replace(/\s+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const yearFrom = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const match = String(value ?? '').match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : undefined;
};
const formatFromText = (value?: string): Format => {
  const text = value?.toLowerCase() ?? '';
  if (/paper|softcover|soft cover/.test(text)) return 'paperback';
  if (/ebook|electronic|digital|epub|pdf/.test(text)) return 'ebook';
  if (/audio|sound|mp3|cd/.test(text)) return 'audiobook';
  return 'unknown';
};

const cachedRequest = async (
  key: string,
  loader: () => Promise<BookSearchResponse>,
): Promise<BookSearchResponse> => {
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.response;
  if (current) cache.delete(key);

  let pending = inFlight.get(key);
  if (!pending) {
    pending = loader()
      .then((response) => {
        const hardened = { ...response, groups: hardenCatalogGroups(response.groups) };
        cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, response: hardened });
        return hardened;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
};

type CrossrefItem = {
  DOI?: string;
  title?: string[];
  subtitle?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  publisher?: string;
  ISBN?: string[];
  type?: string;
  page?: string;
  published?: { 'date-parts'?: number[][] };
  issued?: { 'date-parts'?: number[][] };
  language?: string;
};

export async function searchCrossrefSupplement(query: string): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  return cachedRequest(`crossref:${trimmed.toLowerCase()}`, async () => {
    const isbn = compactIsbn(trimmed.replace(/^isbn:/i, ''));
    const params = new URLSearchParams({ rows: '12' });
    if (/^(?:978|979)\d{10}$|^\d{9}[\dX]$/.test(isbn)) params.set('filter', `isbn:${isbn}`);
    else params.set('query.bibliographic', trimmed);

    const response = await fetch(`https://api.crossref.org/works?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Crossref search failed (${response.status}).`);
    const payload = await response.json() as { message?: { 'total-results'?: number; items?: CrossrefItem[] } };
    const groups = (payload.message?.items ?? []).flatMap((item, index): BookSearchWorkGroup[] => {
      const title = compact(item.title?.[0]);
      if (!title) return [];
      const authors = (item.author ?? []).map((author) =>
        compact(author.name || [author.given, author.family].filter(Boolean).join(' ')),
      ).filter(Boolean);
      const isbns = (item.ISBN ?? []).map(compactIsbn).filter(Boolean);
      const isbn13 = isbns.find((value) => value.length === 13);
      const isbn10 = isbns.find((value) => value.length === 10);
      const pageMatch = item.page?.match(/^(\d+)\s*(?:-|–)\s*(\d+)$/);
      const pageCount = pageMatch ? Math.max(1, Number(pageMatch[2]) - Number(pageMatch[1]) + 1) : undefined;
      const dateParts = item.published?.['date-parts']?.[0] ?? item.issued?.['date-parts']?.[0];
      const publicationYear = yearFrom(dateParts?.[0]);
      const edition: BookSearchEdition = {
        source: 'crossref',
        externalEditionId: item.DOI ?? `crossref-${index}-${title}`,
        title,
        subtitle: compact(item.subtitle?.[0]) || undefined,
        authors: authors.length ? authors : [],
        genres: [],
        publisher: compact(item.publisher) || undefined,
        publicationYear,
        language: compact(item.language) || undefined,
        format: formatFromText(item.type),
        isbn10,
        isbn13,
        pageCount,
        specialFeatures: [],
      };
      return [{
        key: `crossref:${item.DOI ?? isbn13 ?? isbn10 ?? index}`,
        title,
        subtitle: edition.subtitle,
        authors: edition.authors,
        genres: [],
        editions: [edition],
      }];
    });
    return { groups, totalItems: payload.message?.['total-results'] ?? groups.length };
  });
}

type LocItem = {
  id?: string;
  title?: string;
  date?: string;
  contributor?: string[];
  creator?: string;
  subject?: string[];
  language?: string[] | string;
  description?: string[] | string;
  digitized?: boolean;
  image_url?: string[];
  number?: string[];
};

export async function searchLibraryOfCongressSupplement(query: string): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  return cachedRequest(`loc:${trimmed.toLowerCase()}`, async () => {
    const params = new URLSearchParams({ fo: 'json', q: trimmed, c: '10', at: 'results,pagination' });
    const response = await fetch(`https://www.loc.gov/books/?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Library of Congress search failed (${response.status}).`);
    const payload = await response.json() as { results?: LocItem[]; pagination?: { total?: number } };
    const groups = (payload.results ?? []).flatMap((item, index): BookSearchWorkGroup[] => {
      const title = compact(item.title);
      if (!title) return [];
      const authors = (item.contributor ?? []).map(compact).filter(Boolean);
      if (!authors.length && item.creator) authors.push(compact(item.creator));
      const identifiers = item.number ?? [];
      const isbn = identifiers.map(compactIsbn).find((value) => value.length === 13 || value.length === 10);
      const edition: BookSearchEdition = {
        source: 'library-of-congress',
        externalEditionId: item.id ?? `loc-${index}-${title}`,
        title,
        authors: authors.length ? authors : [],
        publisherSummary: Array.isArray(item.description) ? compact(item.description[0]) : compact(item.description) || undefined,
        genres: (item.subject ?? []).slice(0, 12),
        publicationYear: yearFrom(item.date),
        language: Array.isArray(item.language) ? item.language[0] : item.language,
        format: 'unknown',
        isbn10: isbn?.length === 10 ? isbn : undefined,
        isbn13: isbn?.length === 13 ? isbn : undefined,
        coverUrl: item.image_url?.find((value) => /^https?:\/\//i.test(value)),
        specialFeatures: [],
      };
      return [{
        key: `library-of-congress:${item.id ?? index}`,
        title,
        authors: edition.authors,
        publisherSummary: edition.publisherSummary,
        genres: edition.genres,
        editions: [edition],
      }];
    });
    return { groups, totalItems: payload.pagination?.total ?? groups.length };
  });
}

type ArchiveDoc = {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  year?: number | string;
  date?: string;
  language?: string | string[];
  isbn?: string | string[];
  publisher?: string | string[];
  mediatype?: string;
  description?: string | string[];
};

export async function searchInternetArchiveSupplement(query: string): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  return cachedRequest(`archive:${trimmed.toLowerCase()}`, async () => {
    const isbn = compactIsbn(trimmed.replace(/^isbn:/i, ''));
    const q = /^(?:978|979)\d{10}$|^\d{9}[\dX]$/.test(isbn)
      ? `isbn:${isbn}`
      : `title:(${trimmed.replace(/[()]/g, ' ')}) AND mediatype:texts`;
    const params = new URLSearchParams();
    params.set('q', q);
    ['identifier','title','creator','year','date','language','isbn','publisher','mediatype','description']
      .forEach((field) => params.append('fl[]', field));
    params.set('rows', '12');
    params.set('page', '1');
    params.set('output', 'json');

    const response = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Internet Archive search failed (${response.status}).`);
    const payload = await response.json() as { response?: { numFound?: number; docs?: ArchiveDoc[] } };
    const groups = (payload.response?.docs ?? []).flatMap((item, index): BookSearchWorkGroup[] => {
      const title = compact(item.title);
      if (!title) return [];
      const authors = (Array.isArray(item.creator) ? item.creator : [item.creator]).map(compact).filter(Boolean);
      const isbns = (Array.isArray(item.isbn) ? item.isbn : [item.isbn]).map(compactIsbn).filter(Boolean);
      const isbn13 = isbns.find((value) => value.length === 13);
      const isbn10 = isbns.find((value) => value.length === 10);
      const identifier = compact(item.identifier) || `archive-${index}`;
      const publisher = compact(Array.isArray(item.publisher) ? item.publisher[0] : item.publisher);
      const summary = compact(Array.isArray(item.description) ? item.description[0] : item.description);
      const edition: BookSearchEdition = {
        source: 'internet-archive',
        externalEditionId: identifier,
        title,
        authors: authors.length ? authors : [],
        publisherSummary: summary || undefined,
        genres: [],
        publisher: publisher || undefined,
        publicationYear: yearFrom(item.year ?? item.date),
        language: Array.isArray(item.language) ? item.language[0] : item.language,
        format: 'unknown',
        isbn10,
        isbn13,
        coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
        specialFeatures: ['Internet Archive'],
      };
      return [{
        key: `internet-archive:${identifier}`,
        title,
        authors: edition.authors,
        publisherSummary: edition.publisherSummary,
        genres: [],
        editions: [edition],
      }];
    });
    return { groups, totalItems: payload.response?.numFound ?? groups.length };
  });
}

export async function searchSupplementalCatalogs(query: string): Promise<BookSearchResponse> {
  const results = await Promise.allSettled([
    searchCrossrefSupplement(query),
    searchLibraryOfCongressSupplement(query),
    searchInternetArchiveSupplement(query),
  ]);
  const groups = results.flatMap((result) => result.status === 'fulfilled' ? result.value.groups : []);
  const totalItems = results.reduce(
    (total, result) => total + (result.status === 'fulfilled' ? result.value.totalItems : 0),
    0,
  );
  return { groups: hardenCatalogGroups(groups, { searchQuery: query }), totalItems };
}
