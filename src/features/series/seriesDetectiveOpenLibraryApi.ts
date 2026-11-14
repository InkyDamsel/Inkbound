import type { Format } from '../../types';
import type { SeriesDetectiveEdition, SeriesDetectiveWorkGroup } from './seriesDetectiveCatalogTypes';
import {
  canonicalDetectiveAuthor,
  comparableDetectiveTitle,
  detectiveAuthorsCompatible,
  detectiveSeriesNamesCompatible,
  normalizeDetectiveText,
  parseDetectivePositionToken,
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
  work: SeriesDetectiveWorkGroup;
  edition: SeriesDetectiveEdition;
  seriesName: string;
  position: number | null;
  recordId: string;
  /** Parsed from explicit Open Library series fields or Series: subject tags, never inferred from title. */
  seriesStructured: true;
}

export interface DetectiveOpenLibraryContextCandidate {
  work: SeriesDetectiveWorkGroup;
  edition: SeriesDetectiveEdition;
  seriesName?: string;
  position: number | null;
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


/** Open Library sometimes indexes explicit series membership only as a work subject. */
const seriesSubjects = (subjects?: string[]): string[] =>
  (subjects ?? []).flatMap((subject) => {
    const match = subject.match(/^Series:\s*(.+)$/i);
    if (!match) return [];
    const name = match[1].trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    return name ? [name] : [];
  });

// Open Library may return series as objects or scalar values, despite search typings.
// Ignore malformed values instead of aborting discovery for the entire series.
const safeSeriesValues = (input: unknown): string[] => {
  const items = Array.isArray(input) ? input : [input];
  return items.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const name = record.name ?? record.title;
      return typeof name === 'string' && name.trim() ? [name.trim()] : [];
    }
    return [];
  });
};

const chooseSeriesValues = (
  editionSeries?: string[],
  workSeries?: string[],
  subjectSeries?: string[],
): string[] | undefined => {
  const editionValues = safeSeriesValues(editionSeries);
  if (editionValues.length > 0) return editionValues;
  const workValues = safeSeriesValues(workSeries);
  if (workValues.length > 0) return workValues;
  const subjectValues = safeSeriesValues(subjectSeries);
  return subjectValues.length > 0 ? subjectValues : undefined;
};

export const parseDetectiveOpenLibrarySeries = (
  values?: string[],
): { name: string; position: number | null } | null => {
  const raw = safeSeriesValues(values)[0];
  if (!raw) return null;
  const primary = raw.split(';').map((value) => value.trim()).find(Boolean) ?? raw;
  // Open Library editions may express an ordinal as "Grant County (#1)".
  // Normalize only an explicit parenthesized position, retaining the series name.
  const parenthesized = primary.match(/^(.+?)\s*\(\s*#\s*(\d+(?:\.\d+)?)\s*\)\s*$/i);
  if (parenthesized) return {
    name: parenthesized[1].trim(),
    position: parseDetectivePositionToken(parenthesized[2]),
  };
  const positionWords = [
    'one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty',
    'first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth',
    'eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth',
  ].join('|');
  const match = primary.match(new RegExp(
    `^(.*?)(?:\\s*,?\\s*)(?:#\\s*|book\\s*#?\\s*|vol(?:ume)?\\.?\\s*#?\\s*|part\\s*#?\\s*|,\\s*)(\\d+(?:\\.\\d+)?|${positionWords})\\s*$`,
    'i',
  ));
  if (!match) return { name: primary, position: null };
  return {
    name: match[1].replace(/[,:;\-]+$/g, '').trim() || primary,
    position: parseDetectivePositionToken(match[2]),
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
  // Editions may list a different series first (or a related-world series).
  // Evaluate every explicit membership before rejecting the requested one.
  // Do not merge the memberships: the requested series determines the roster.
  const seriesValues = [
    ...safeSeriesValues(edition.series),
    ...safeSeriesValues(work.series),
    ...safeSeriesValues(seriesSubjects(work.subject)),
  ].flatMap((value) => value.split(';').map((part) => part.trim()).filter(Boolean));
  const memberships = seriesValues
    .map((value) => parseDetectiveOpenLibrarySeries([value]))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const metadata = wantedSeriesName
    ? memberships.find((value) => detectiveSeriesNamesCompatible(value.name, wantedSeriesName))
    : memberships[0];
  if (!metadata) return null;

  const authors = work.author_name?.length ? work.author_name : ['Unknown author'];
  if (wantedAuthor) {
    const wanted = canonicalDetectiveAuthor(wantedAuthor);
    const exact = !wanted || authors.some((author) => detectiveAuthorsCompatible(wantedAuthor, author));
    // Open Library's explicit structured series membership can span authors, so
    // author mismatch is not a hard rejection when the series itself matches.
    if (!exact && !wantedSeriesName) return null;
  }

  const isbn13 = edition.isbn_13?.[0]
    ?? edition.isbn?.find((value) => compactIsbn(value).length === 13);
  const isbn10 = edition.isbn_10?.[0]
    ?? edition.isbn?.find((value) => compactIsbn(value).length === 10);

  const mappedEdition: SeriesDetectiveEdition = {
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

  const mappedWork: SeriesDetectiveWorkGroup = {
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
    seriesStructured: true,
  };
};

const fetchOpenLibrary = async (
  params: URLSearchParams,
  signal?: AbortSignal,
  page = 1,
): Promise<OpenLibraryWork[]> => {
  params.set('limit', '100');
  params.set('page', String(Math.max(1, page)));
  params.set('fields', FIELDS);
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Open Library Series Detective search failed (${response.status}).`);
  const payload = await response.json() as OpenLibraryResponse;
  return payload.docs ?? [];
};

const WORK_EDITION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const workEditionCache = new Map<string, { expiresAt: number; editions: OpenLibraryEdition[] }>();
const workEditionInFlight = new Map<string, Promise<OpenLibraryEdition[]>>();

const fetchWorkEditions = async (
  workKey: string,
  signal?: AbortSignal,
): Promise<OpenLibraryEdition[]> => {
  const path = workKey.startsWith('/works/')
    ? workKey
    : /^OL\d+W$/i.test(workKey)
      ? `/works/${workKey}`
      : '';
  if (!path) return [];

  const cached = workEditionCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.editions;
  if (cached) workEditionCache.delete(path);

  let pending = workEditionInFlight.get(path);
  if (!pending) {
    pending = fetch(`https://openlibrary.org${path}/editions.json?limit=30`, {
      signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json() as { entries?: OpenLibraryEdition[] };
        const editions = payload.entries ?? [];
        workEditionCache.set(path, {
          expiresAt: Date.now() + WORK_EDITION_CACHE_TTL_MS,
          editions,
        });
        return editions;
      })
      .catch((error) => {
        if (signal?.aborted) throw error;
        return [];
      })
      .finally(() => workEditionInFlight.delete(path));
    workEditionInFlight.set(path, pending);
  }
  return pending;
};

const hydrateWorksFromEditionDetails = async (
  works: OpenLibraryWork[],
  limit: number,
  signal?: AbortSignal,
): Promise<OpenLibraryWork[]> => Promise.all(works.map(async (work, index) => {
  if (index >= limit || !work.key) return work;
  const existing = work.editions?.docs ?? [];
  const hasSeries = Boolean(
    safeSeriesValues(work.series).length > 0
    || existing.some((edition) => safeSeriesValues(edition.series).length > 0)
    || seriesSubjects(work.subject).length > 0,
  );
  if (hasSeries && existing.length > 0) return work;

  const detailed = await fetchWorkEditions(work.key, signal);
  if (!detailed.length) return work;

  const seen = new Set(existing.map((edition) => edition.key).filter(Boolean));
  return {
    ...work,
    editions: {
      docs: [
        ...existing,
        ...detailed.filter((edition) => !edition.key || !seen.has(edition.key)),
      ],
    },
  };
}));

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

export async function searchDetectiveOpenLibraryContext(
  seriesName: string,
  author: string,
  signal?: AbortSignal,
  allowOtherAuthors = false,
  onFailure?: (error: unknown) => void,
): Promise<DetectiveOpenLibraryContextCandidate[]> {
  const params = new URLSearchParams({ q: allowOtherAuthors ? seriesName : `${seriesName} ${author}`.trim() });
  try {
    const works = await hydrateWorksFromEditionDetails(await fetchOpenLibrary(params, signal), 12, signal);
    const wantedAuthor = canonicalDetectiveAuthor(author);

    return works.flatMap((work) => {
      const authors = work.author_name?.length ? work.author_name : ['Unknown author'];
      if (
        wantedAuthor
        && !allowOtherAuthors
        && !authors.some((candidate) => detectiveAuthorsCompatible(author, candidate))
      ) return [];

      const docs = work.editions?.docs?.length ? work.editions.docs : [{}];
      const preferred = docs.find((edition) => parseDetectiveOpenLibrarySeries(chooseSeriesValues(edition.series, work.series, seriesSubjects(work.subject))))
        ?? docs[0];
      const title = (preferred.title ?? work.title)?.trim();
      if (!title) return [];

      const metadata = parseDetectiveOpenLibrarySeries(chooseSeriesValues(preferred.series, work.series, seriesSubjects(work.subject)));
      const isbn13 = preferred.isbn_13?.[0]
        ?? preferred.isbn?.find((value) => compactIsbn(value).length === 13);
      const isbn10 = preferred.isbn_10?.[0]
        ?? preferred.isbn?.find((value) => compactIsbn(value).length === 10);
      const edition: SeriesDetectiveEdition = {
        source: 'open-library',
        externalEditionId: preferred.key ?? `${work.key ?? normalizeDetectiveText(title)}:context`,
        title,
        subtitle: preferred.subtitle ?? work.subtitle,
        authors,
        genres: (work.subject ?? []).slice(0, 12),
        publisher: first(preferred.publisher ?? work.publisher),
        publicationDate: preferred.publish_date,
        publicationYear: year(preferred.publish_date, preferred.publish_year ?? work.first_publish_year),
        language: preferred.language?.[0] ?? work.language?.[0],
        format: formatFor(preferred),
        isbn10,
        isbn13,
        pageCount: preferred.number_of_pages ?? preferred.number_of_pages_median,
        coverUrl: coverUrl(work, preferred),
        binding: preferred.physical_format,
        specialFeatures: [],
      };
      const mappedWork: SeriesDetectiveWorkGroup = {
        key: `open-library:${work.key ?? `${normalizeDetectiveText(title)}:${canonicalDetectiveAuthor(authors[0])}`}`,
        title: work.title ?? title,
        subtitle: work.subtitle,
        authors,
        genres: (work.subject ?? []).slice(0, 12),
        editions: [edition],
      };
      return [{
        work: mappedWork,
        edition,
        seriesName: metadata?.name,
        position: metadata?.position ?? null,
      }];
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective Open Library contextual lookup failed.', error);
    onFailure?.(error);
    return [];
  }
}

export async function searchDetectiveOpenLibrarySeries(
  seriesName: string,
  author?: string,
  signal?: AbortSignal,
  onFailure?: (error: unknown) => void,
): Promise<DetectiveOpenLibraryCandidate[]> {
  const escapedSeries = seriesName.replace(/"/g, '').trim();
  const queries = [
    new URLSearchParams({ q: `series:"${escapedSeries}"` }),
    new URLSearchParams({ q: `${escapedSeries} ${author ?? ''}`.trim() }),
  ];

  const results = await Promise.all(queries.map(async (params) => {
    try {
      const works = await fetchOpenLibrary(params, signal);
      return hydrateWorksFromEditionDetails(works, 12, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Series Detective Open Library query failed.', error);
    onFailure?.(error);
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
  onFailure?: (error: unknown) => void,
): Promise<DetectiveOpenLibraryCandidate[]> {
  const trimmed = author.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({ author: trimmed });
  try {
    const works: OpenLibraryWork[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const pageWorks = await fetchOpenLibrary(new URLSearchParams(params), signal, page);
      works.push(...pageWorks);
      if (pageWorks.length < 100) break;
    }
    const hydrated = await hydrateWorksFromEditionDetails(works, 20, signal);
    return flattenCandidates(hydrated, undefined, author);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective Open Library author lookup failed.', error);
    onFailure?.(error);
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
    const works = await hydrateWorksFromEditionDetails(await fetchOpenLibrary(params, signal), 8, signal);
    return flattenCandidates(works, undefined, author)
      .filter((candidate) =>
        comparableDetectiveTitle(candidate.work.title) === comparableDetectiveTitle(title)
        || comparableDetectiveTitle(candidate.edition.title) === comparableDetectiveTitle(title),
      );
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective Open Library book lookup failed.', error);
    onFailure?.(error);
    return [];
  }
}
