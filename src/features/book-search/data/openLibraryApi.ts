import { Format } from '../../../types';
import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';
import { catalogTitlesAreCompatible, hardenCatalogGroups, mergeCatalogEditionData } from '../catalogHardening';

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
  physical_format?: string;
  series?: string[];
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

export interface OpenLibraryCatalogPage extends BookSearchResponse {
  providerTotalItems: number;
  nextStartIndex: number;
  hasMore: boolean;
}

const OPEN_LIBRARY_ENDPOINT = 'https://openlibrary.org/search.json';
const DEFAULT_PAGE_SIZE = 40;
const FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher', 'subject', 'language', 'series',
  'isbn', 'cover_i', 'cover_edition_key', 'number_of_pages_median', 'editions', 'editions.key',
  'editions.title', 'editions.subtitle', 'editions.publisher', 'editions.publish_date', 'editions.publish_year',
  'editions.isbn', 'editions.isbn_10', 'editions.isbn_13', 'editions.number_of_pages',
  'editions.number_of_pages_median', 'editions.cover_i', 'editions.cover_edition_key',
  'editions.language', 'editions.ebook_access', 'editions.physical_format', 'editions.series',
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
  numericYear(value) ?? numericYear(fallback) ?? 0;

const first = (value?: string[] | string): string | undefined =>
  Array.isArray(value) ? value.find(Boolean) : value || undefined;

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const stripQuotes = (value: string) => value.trim().replace(/^['"]|['"]$/g, '').trim();

const inferFormat = (edition: OpenLibraryEdition): Format => {
  const physical = edition.physical_format?.toLowerCase() ?? '';
  if (/paperback|softcover|soft cover|mass market|trade paper/.test(physical)) return 'paperback';
  if (/hardcover|hardback|hard cover|library binding/.test(physical)) return 'hardcover';
  const access = edition.ebook_access?.toLowerCase();
  return access && access !== 'no_ebook' ? 'ebook' : 'hardcover';
};

const coverUrl = (edition: OpenLibraryEdition, work: OpenLibraryWork): string | undefined => {
  // Edition identity wins. Never borrow a work-level cover before trying the
  // exact edition/ISBN, otherwise an English ISBN can inherit an international
  // cover from another edition of the same work.
  if (edition.cover_i) return `https://covers.openlibrary.org/b/id/${edition.cover_i}-L.jpg`;
  if (edition.cover_edition_key) return `https://covers.openlibrary.org/b/olid/${edition.cover_edition_key}-L.jpg`;
  const editionIsbn = edition.isbn_13?.[0] ?? edition.isbn_10?.[0] ?? edition.isbn?.[0];
  if (editionIsbn) return `https://covers.openlibrary.org/b/isbn/${compactIsbn(editionIsbn)}-L.jpg`;
  if (work.cover_i) return `https://covers.openlibrary.org/b/id/${work.cover_i}-L.jpg`;
  if (work.cover_edition_key) return `https://covers.openlibrary.org/b/olid/${work.cover_edition_key}-L.jpg`;
  const workIsbn = work.isbn?.[0];
  return workIsbn ? `https://covers.openlibrary.org/b/isbn/${compactIsbn(workIsbn)}-L.jpg` : undefined;
};

const parseSeries = (values?: string[]): { name?: string; order?: number } => {
  const raw = values?.find((value) => value?.trim())?.trim();
  if (!raw) return {};
  // Open Library sometimes stores multiple series memberships in one string,
  // separated by semicolons. The first membership is the edition's primary
  // bibliographic series and should be parsed independently.
  const primary = raw.split(';').map((value) => value.trim()).find(Boolean) ?? raw;
  const match = primary.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*|,\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return { name: primary };
  const order = Number(match[2]);
  return { name: match[1].replace(/[,:;\-]+$/g, '').trim() || primary, order: Number.isFinite(order) ? order : undefined };
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
    // Work medians belong to the work, not this ISBN. Attaching them to an
    // edition is exactly how correct ISBN matches acquired the wrong page count.
    pageCount: edition.number_of_pages ?? edition.number_of_pages_median,
    coverUrl: coverUrl(edition, work),
    binding: edition.physical_format,
    specialFeatures: [],
  };
};

const OPEN_LIBRARY_EDITION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const openLibraryEditionCache = new Map<string, { expiresAt: number; value: OpenLibraryEdition }>();
const openLibraryEditionInFlight = new Map<string, Promise<OpenLibraryEdition | null>>();
const openLibraryWorkEditionsCache = new Map<string, { expiresAt: number; value: OpenLibraryEdition[] }>();
const openLibraryWorkEditionsInFlight = new Map<string, Promise<OpenLibraryEdition[]>>();


const fetchOpenLibraryEditionDetails = async (
  externalEditionId: string,
  signal?: AbortSignal,
): Promise<OpenLibraryEdition | null> => {
  const path = externalEditionId.startsWith('/books/')
    ? externalEditionId
    : /^OL\d+M$/i.test(externalEditionId)
      ? `/books/${externalEditionId}`
      : '';
  if (!path) return null;

  const cached = openLibraryEditionCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) openLibraryEditionCache.delete(path);

  let pending = openLibraryEditionInFlight.get(path);
  if (!pending) {
    pending = fetch(`https://openlibrary.org${path}.json`, {
      signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const detail = await response.json() as OpenLibraryEdition;
        openLibraryEditionCache.set(path, {
          expiresAt: Date.now() + OPEN_LIBRARY_EDITION_CACHE_TTL_MS,
          value: detail,
        });
        return detail;
      })
      .catch(() => null)
      .finally(() => openLibraryEditionInFlight.delete(path));
    openLibraryEditionInFlight.set(path, pending);
  }
  return pending;
};

const fetchOpenLibraryWorkEditions = async (
  workKey: string,
  signal?: AbortSignal,
): Promise<OpenLibraryEdition[]> => {
  const path = workKey.startsWith('/works/')
    ? workKey
    : /^OL\d+W$/i.test(workKey)
      ? `/works/${workKey}`
      : '';
  if (!path) return [];

  const cached = openLibraryWorkEditionsCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) openLibraryWorkEditionsCache.delete(path);

  let pending = openLibraryWorkEditionsInFlight.get(path);
  if (!pending) {
    pending = fetch(`https://openlibrary.org${path}/editions.json?limit=30`, {
      signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json() as { entries?: OpenLibraryEdition[] };
        const entries = payload.entries ?? [];
        openLibraryWorkEditionsCache.set(path, {
          expiresAt: Date.now() + OPEN_LIBRARY_EDITION_CACHE_TTL_MS,
          value: entries,
        });
        return entries;
      })
      .catch(() => [])
      .finally(() => openLibraryWorkEditionsInFlight.delete(path));
    openLibraryWorkEditionsInFlight.set(path, pending);
  }
  return pending;
};

const hydrateOpenLibraryGroupFromWork = async (
  group: BookSearchWorkGroup,
  signal?: AbortSignal,
): Promise<BookSearchWorkGroup> => {
  const rawKey = group.key.replace(/^open-library:/, '');
  if (!rawKey.startsWith('/works/') && !/^OL\d+W$/i.test(rawKey)) return group;

  const details = await fetchOpenLibraryWorkEditions(rawKey, signal);
  if (!details.length) return group;

  // Hydration is enrichment, never replacement. Preserve every known
  // field from the thin search payload and merge richer edition details into it
  // only when the records refer to the same edition identity.
  const primarySeriesEdition = group.editions.find((edition) => edition.seriesName);
  const inheritedSeries = primarySeriesEdition?.seriesName
    ? [
        typeof primarySeriesEdition.seriesOrder === 'number'
          ? `${primarySeriesEdition.seriesName} #${primarySeriesEdition.seriesOrder}`
          : primarySeriesEdition.seriesName,
      ]
    : undefined;

  const workLike: OpenLibraryWork = {
    key: rawKey,
    title: group.title,
    subtitle: group.subtitle,
    author_name: group.authors,
    subject: group.genres,
    series: inheritedSeries,
  };

  const detailedEditions = details
    .map((edition, index) => toEdition(workLike, edition, index))
    .filter((edition): edition is BookSearchEdition => Boolean(edition));

  if (!detailedEditions.length) return group;

  const mergedEditions = [...group.editions];

  for (const detailed of detailedEditions) {
    const detailedIsbns = [detailed.isbn13, detailed.isbn10].map(compactIsbn).filter(Boolean);
    const matchIndex = mergedEditions.findIndex((existing) => {
      if (
        existing.source === detailed.source
        && existing.externalEditionId
        && detailed.externalEditionId
        && existing.externalEditionId === detailed.externalEditionId
      ) return true;

      const existingIsbns = [existing.isbn13, existing.isbn10].map(compactIsbn).filter(Boolean);
      return detailedIsbns.some((isbn) => existingIsbns.includes(isbn));
    });

    if (matchIndex >= 0) {
      mergedEditions[matchIndex] = mergeCatalogEditionData(mergedEditions[matchIndex], detailed);
    } else {
      mergedEditions.push(detailed);
    }
  }

  return hardenCatalogGroups([{
    ...group,
    editions: mergedEditions,
  }])[0] ?? group;
};

const hydrateOpenLibraryExactGroups = async (
  groups: BookSearchWorkGroup[],
  query: string,
  signal?: AbortSignal,
): Promise<BookSearchWorkGroup[]> => {
  const operator = query.trim().match(/^(inauthor|intitle|isbn):\s*(.+)$/i);
  const operatorKind = operator?.[1].toLowerCase();
  const rawWanted = operator ? stripQuotes(operator[2]) : query;
  const wantedTitle = operatorKind === 'isbn' || operatorKind === 'inauthor' ? '' : normalize(rawWanted);
  const wantedIsbn = operatorKind === 'isbn' ? compactIsbn(rawWanted) : '';

  const candidates = operatorKind === 'inauthor'
    ? groups.slice(0, 20)
    : groups.filter((group) => {
        if (wantedTitle) {
          return normalize(group.title) === wantedTitle
            || catalogTitlesAreCompatible(group.title, rawWanted);
        }
        if (wantedIsbn) {
          return group.editions.some((edition) =>
            [edition.isbn13, edition.isbn10].map(compactIsbn).includes(wantedIsbn),
          );
        }
        return false;
      }).slice(0, 3);

  if (!candidates.length) return groups;

  const candidateKeys = new Set(candidates.map((group) => group.key));
  return Promise.all(groups.map(async (group) => {
    if (!candidateKeys.has(group.key)) return group;

    // Search payload edition docs are often intentionally thin. For author and
    // exact/compatible title matches, hydrate the canonical work's edition list
    // first so physical editions can recover ISBN, binding, and page counts
    // before individual edition detail enrichment runs.
    const workHydrated = operatorKind === 'inauthor' || Boolean(wantedTitle)
      ? await hydrateOpenLibraryGroupFromWork(group, signal)
      : group;

    if (operatorKind === 'inauthor') {
      return workHydrated;
    }

    const hydratedEditions = await Promise.all(workHydrated.editions.slice(0, 12).map(async (edition) => {
      if (edition.source !== 'open-library') return edition;
      if (edition.pageCount && edition.seriesName && edition.isbn13) return edition;

      const detail = await fetchOpenLibraryEditionDetails(edition.externalEditionId, signal);
      if (!detail) return edition;
      const detailSeries = parseSeries(detail.series);
      const detailIsbn13 = detail.isbn_13?.[0] ?? detail.isbn?.find((value) => compactIsbn(value).length === 13);
      const detailIsbn10 = detail.isbn_10?.[0] ?? detail.isbn?.find((value) => compactIsbn(value).length === 10);

      return {
        ...edition,
        isbn13: edition.isbn13 || detailIsbn13,
        isbn10: edition.isbn10 || detailIsbn10,
        pageCount: edition.pageCount || detail.number_of_pages || detail.number_of_pages_median,
        seriesName: edition.seriesName || detailSeries.name,
        seriesOrder: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : detailSeries.order,
        binding: edition.binding || detail.physical_format,
        format: edition.binding ? edition.format : inferFormat(detail),
        publisher: edition.publisher || first(detail.publisher),
        publicationDate: edition.publicationDate || stringValue(detail.publish_date),
      };
    }));

    return {
      ...workHydrated,
      editions: [
        ...hydratedEditions,
        ...workHydrated.editions.slice(12),
      ],
    };
  }));
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

function buildSearchParams(query: string, page = 1, limit = DEFAULT_PAGE_SIZE): URLSearchParams {
  const trimmed = query.trim();
  const operator = trimmed.match(/^(inauthor|intitle|isbn):\s*(.+)$/i);
  const params = new URLSearchParams({ limit: String(limit), page: String(page), fields: FIELDS });
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

export async function searchOpenLibraryPage(
  query: string,
  startIndex = 0,
  pageSize = DEFAULT_PAGE_SIZE,
  signal?: AbortSignal,
): Promise<OpenLibraryCatalogPage> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { groups: [], totalItems: 0, providerTotalItems: 0, nextStartIndex: startIndex, hasMore: false };
  }

  const safePageSize = Math.max(1, Math.min(pageSize, 100));
  const page = Math.floor(Math.max(0, startIndex) / safePageSize) + 1;
  const params = buildSearchParams(trimmed, page, safePageSize);
  const response = await fetch(`${OPEN_LIBRARY_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Open Library search failed (${response.status}).`);

  const payload = (await response.json()) as OpenLibraryResponse;
  const rawDocs = payload.docs ?? [];
  const authorOperator = trimmed.match(/^inauthor:\s*(.+)$/i);
  const initialGroups = hardenCatalogGroups(
    rawDocs
      .map(mapWork)
      .filter((group): group is BookSearchWorkGroup => Boolean(group)),
    authorOperator
      ? { preferredAuthor: stripQuotes(authorOperator[1]) }
      : { searchQuery: trimmed },
  );
  const hydratedGroups = authorOperator && startIndex > 0
    ? initialGroups
    : await hydrateOpenLibraryExactGroups(initialGroups, trimmed, signal);
  const groups = hardenCatalogGroups(
    hydratedGroups,
    authorOperator
      ? { preferredAuthor: stripQuotes(authorOperator[1]) }
      : { searchQuery: trimmed },
  );
  const providerTotalItems = payload.numFound ?? payload.num_found ?? groups.length;
  const nextStartIndex = Math.max(0, startIndex) + rawDocs.length;
  const hasMore = rawDocs.length > 0 && nextStartIndex < providerTotalItems;

  return {
    groups,
    totalItems: providerTotalItems,
    providerTotalItems,
    nextStartIndex,
    hasMore,
  };
}

/**
 * Series-context lookup used only by Series Detective's zero-result fallback.
 * This intentionally does not apply normal title-search relevance because an
 * installment title may share no words with its series name.
 */
export async function searchOpenLibrarySeriesContext(
  seriesName: string,
  signal?: AbortSignal,
): Promise<BookSearchResponse> {
  const trimmed = seriesName.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };

  const params = new URLSearchParams({
    q: `series:"${trimmed.replace(/"/g, '')}"`,
    limit: String(DEFAULT_PAGE_SIZE),
    fields: FIELDS,
  });
  const response = await fetch(`${OPEN_LIBRARY_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Open Library series-context search failed (${response.status}).`);

  const payload = (await response.json()) as OpenLibraryResponse;
  const groups = hardenCatalogGroups(
    (payload.docs ?? [])
      .map(mapWork)
      .filter((group): group is BookSearchWorkGroup => Boolean(group)),
  );

  return {
    groups,
    totalItems: payload.numFound ?? payload.num_found ?? groups.length,
  };
}

export async function searchOpenLibrary(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const page = await searchOpenLibraryPage(query, 0, DEFAULT_PAGE_SIZE, signal);
  return { groups: page.groups, totalItems: page.totalItems };
}

export async function searchOpenLibraryExactTitleAuthor(
  title: string,
  author: string,
  signal?: AbortSignal,
): Promise<BookSearchResponse> {
  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();
  if (!trimmedTitle || !trimmedAuthor) return { groups: [], totalItems: 0 };

  const params = new URLSearchParams({
    title: trimmedTitle,
    author: trimmedAuthor,
    limit: '8',
    fields: FIELDS,
  });
  const response = await fetch(`${OPEN_LIBRARY_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Open Library exact title/author search failed (${response.status}).`);

  const payload = (await response.json()) as OpenLibraryResponse;
  const initialGroups = hardenCatalogGroups(
    (payload.docs ?? [])
      .map(mapWork)
      .filter((group): group is BookSearchWorkGroup => Boolean(group)),
    { searchQuery: trimmedTitle },
  );

  const wantedAuthor = normalize(trimmedAuthor);
  const authorMatched = initialGroups.filter((group) => {
    const candidateAuthors = normalize(group.authors.join(' '));
    const tokens = wantedAuthor.split(' ').filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => candidateAuthors.includes(token));
  });

  const hydrated = await hydrateOpenLibraryExactGroups(
    authorMatched,
    trimmedTitle,
    signal,
  );

  const groups = hardenCatalogGroups(hydrated, { searchQuery: trimmedTitle });
  return {
    groups,
    totalItems: payload.numFound ?? payload.num_found ?? groups.length,
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
