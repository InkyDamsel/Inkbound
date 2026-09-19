import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchGoogleBooks, searchGoogleBooksAuthorPage, searchGoogleBooksPage } from '../book-search/data/googleBooksApi';
import { searchHardcover } from '../book-search/data/hardcoverApi';
import { searchInkboundTrustedCatalog } from '../catalog/metadataContributions';
import { searchOpenLibraryPage } from '../book-search/data/openLibraryApi';
import { catalogEditionQualityScore, hardenCatalogGroups } from '../book-search/catalogHardening';
import { inferSeriesHintFromTitle, resolveEffectiveSeriesMetadata } from './seriesLibrary';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const sameSeries = (edition: BookSearchEdition, seriesName: string) =>
  Boolean(edition.seriesName && normalize(edition.seriesName) === normalize(seriesName));

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

export interface SeriesEvidence {
  name: string;
  position: number | null;
  edition: BookSearchEdition;
  work: BookSearchWorkGroup;
  structured: boolean;
  exactIdentifier: boolean;
  exactTitle: boolean;
  exactAuthor: boolean;
  score: number;
}

export const scoreSeriesEvidence = (
  work: BookSearchWorkGroup,
  edition: BookSearchEdition,
  book: UserBookRecord,
): SeriesEvidence | null => {
  const structuredName = edition.seriesName?.trim();
  const inferred = inferSeriesHintFromTitle(edition.title) ?? inferSeriesHintFromTitle(work.title);
  const name = structuredName || inferred?.name;
  if (!name) return null;

  const position = typeof edition.seriesOrder === 'number'
    ? edition.seriesOrder
    : inferred?.position ?? null;
  const activeEdition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const activeIdentifiers = new Set(
    [activeEdition?.isbn13, activeEdition?.isbn10, activeEdition?.isbn]
      .map(compactIsbn)
      .filter(Boolean),
  );
  const candidateIdentifiers = [edition.isbn13, edition.isbn10].map(compactIsbn).filter(Boolean);
  const exactIdentifier = candidateIdentifiers.some((identifier) => activeIdentifiers.has(identifier));
  const exactTitle = normalize(work.title) === normalize(book.work.title) || normalize(edition.title) === normalize(book.work.title);
  const exactAuthor = exactAuthorMatch(work, book.work.author);
  const structured = Boolean(structuredName);

  let score = 0;
  if (structured) score += 100;
  else score += 40;
  if (exactIdentifier) score += 120;
  if (exactTitle) score += 35;
  if (exactAuthor) score += 35;
  if (edition.source === 'inkbound-catalog') score += 35;
  else if (edition.source === 'hardcover') score += 20;
  else if (edition.source === 'google-books') score += 15;
  else if (edition.source === 'open-library') score += 10;
  if (typeof position === 'number') score += 10;
  if (edition.language && edition.language === activeEditionLanguage(book)) score += 5;

  return { name, position, edition, work, structured, exactIdentifier, exactTitle, exactAuthor, score };
};

export const selectVerifiedSeriesEvidence = (evidence: SeriesEvidence[]): SeriesEvidence | null => {
  const eligible = evidence.filter((item) => item.exactAuthor && (item.exactTitle || item.exactIdentifier));
  if (!eligible.length) return null;

  const bySeries = new Map<string, SeriesEvidence[]>();
  for (const item of eligible) {
    const key = `${normalize(item.name)}::${item.position ?? 'unknown'}`;
    const current = bySeries.get(key) ?? [];
    current.push(item);
    bySeries.set(key, current);
  }

  const ranked = [...bySeries.values()].map((group) => {
    const distinctSources = new Set(group.map((item) => item.edition.source)).size;
    const best = [...group].sort((a, b) => b.score - a.score)[0];
    const verified =
      best.exactIdentifier && best.structured
      || best.structured && best.score >= 150
      || distinctSources >= 2 && best.score >= 110;
    return { best, distinctSources, verified };
  }).filter((item) => item.verified)
    .sort((a, b) => b.best.score - a.best.score || b.distinctSources - a.distinctSources);

  return ranked[0]?.best ?? null;
};

const SERIES_DISCOVERY_MAX_PAGES = 4;
const SERIES_DISCOVERY_PAGE_SIZE = 40;

const candidateSeriesMetadata = (
  work: BookSearchWorkGroup,
  edition: BookSearchEdition,
  wantedSeriesName: string,
): { name: string; position: number | null } | null => {
  if (sameSeries(edition, wantedSeriesName)) {
    return {
      name: edition.seriesName!,
      position: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : null,
    };
  }

  for (const title of [edition.title, work.title]) {
    const inferred = inferSeriesHintFromTitle(title);
    if (inferred && normalize(inferred.name) === normalize(wantedSeriesName)) {
      return { name: inferred.name, position: inferred.position };
    }
  }

  return null;
};

const collectPagedGroups = async (
  fetchPage: (startIndex: number) => Promise<{ groups: BookSearchWorkGroup[]; nextStartIndex: number; hasMore: boolean }>,
): Promise<BookSearchWorkGroup[]> => {
  const groups: BookSearchWorkGroup[] = [];
  let startIndex = 0;

  for (let pageNumber = 0; pageNumber < SERIES_DISCOVERY_MAX_PAGES; pageNumber += 1) {
    const page = await fetchPage(startIndex);
    groups.push(...page.groups);
    if (!page.hasMore || page.nextStartIndex <= startIndex) break;
    startIndex = page.nextStartIndex;
  }

  return groups;
};

export interface SeriesDetectiveCandidate {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
  seriesName: string;
  position: number | null;
}

export interface SeriesDetectiveResult {
  seriesName: string;
  author: string;
  candidates: SeriesDetectiveCandidate[];
  missing: SeriesDetectiveCandidate[];
}

export async function detectSeriesForBook(book: UserBookRecord): Promise<{ name: string; position: number | null } | null> {
  const existing = resolveEffectiveSeriesMetadata(book);
  if (existing) return { name: existing.name, position: existing.position };

  const wantedTitle = normalize(book.work.title);
  const wantedAuthor = normalize(book.work.author);
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  const identifiers = [activeEdition?.isbn13, activeEdition?.isbn10].filter((value): value is string => Boolean(value?.trim()));

  const [googleAuthorGroups, openLibraryAuthorGroups, ...searches] = await Promise.all([
    collectPagedGroups((startIndex) => searchGoogleBooksAuthorPage(book.work.author, startIndex)),
    collectPagedGroups((startIndex) => searchOpenLibraryPage(`inauthor:${book.work.author}`, startIndex, SERIES_DISCOVERY_PAGE_SIZE)),
    searchInkboundTrustedCatalog({ title: book.work.title, author: book.work.author }),
    searchHardcover(`${book.work.title} ${book.work.author}`),
    searchGoogleBooks(`${book.work.title} ${book.work.author}`),
    searchOpenLibraryPage(`intitle:"${book.work.title}"`, 0, SERIES_DISCOVERY_PAGE_SIZE),
    ...identifiers.map((isbn) => searchInkboundTrustedCatalog({ isbn })),
    ...identifiers.map((isbn) => searchHardcover(isbn)),
    ...identifiers.map((isbn) => searchGoogleBooks(`isbn:${isbn}`)),
    ...identifiers.map((isbn) => searchOpenLibraryPage(`isbn:${isbn}`, 0, SERIES_DISCOVERY_PAGE_SIZE)),
  ]);

  const groups = hardenCatalogGroups(
    [
      ...searches.flatMap((response) => response.groups),
      ...googleAuthorGroups,
      ...openLibraryAuthorGroups,
    ],
    { preferredAuthor: book.work.author },
  );

  const evidence = groups
    .filter((group) =>
      normalize(group.title) === wantedTitle
      || normalize(group.title).includes(wantedTitle)
      || wantedTitle.includes(normalize(group.title)),
    )
    .filter((group) => !wantedAuthor || exactAuthorMatch(group, book.work.author))
    .flatMap((group) => group.editions.map((edition) => scoreSeriesEvidence(group, edition, book)))
    .filter((item): item is SeriesEvidence => Boolean(item));

  const match = selectVerifiedSeriesEvidence(evidence);
  return match ? { name: match.name, position: match.position } : null;
}

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
): Promise<SeriesDetectiveResult> {
  const [googleSeriesGroups, googleExactSeriesGroups, googleAuthorGroups, openLibrarySeriesGroups, openLibraryAuthorGroups, hardcoverSeries, hardcoverAuthor] = await Promise.all([
    collectPagedGroups((startIndex) => searchGoogleBooksPage(`${seriesName} ${author}`, startIndex)),
    collectPagedGroups((startIndex) => searchGoogleBooksPage(`"${seriesName}" inauthor:${author}`, startIndex)),
    collectPagedGroups((startIndex) => searchGoogleBooksAuthorPage(author, startIndex)),
    collectPagedGroups((startIndex) => searchOpenLibraryPage(`${seriesName} ${author}`, startIndex, SERIES_DISCOVERY_PAGE_SIZE)),
    collectPagedGroups((startIndex) => searchOpenLibraryPage(`inauthor:${author}`, startIndex, SERIES_DISCOVERY_PAGE_SIZE)),
    searchHardcover(`${seriesName} ${author}`),
    searchHardcover(author),
  ]);

  const merged = hardenCatalogGroups(
    [
      ...googleSeriesGroups,
      ...googleExactSeriesGroups,
      ...googleAuthorGroups,
      ...openLibrarySeriesGroups,
      ...openLibraryAuthorGroups,
      ...hardcoverSeries.groups,
      ...hardcoverAuthor.groups,
    ],
    { preferredAuthor: author },
  );
  const seen = new Map<string, SeriesDetectiveCandidate>();
  const candidates: SeriesDetectiveCandidate[] = [];

  const seriesBooks = libraryBooks.filter((book) => {
    const metadata = resolveEffectiveSeriesMetadata(book);
    return metadata && normalize(metadata.name) === normalize(seriesName) && normalize(book.work.author) === normalize(author);
  });
  const preferredLanguages = new Set(seriesBooks.map(activeEditionLanguage).filter((value): value is string => Boolean(value)));

  for (const work of merged) {
    if (!exactAuthorMatch(work, author)) continue;

    for (const edition of work.editions) {
      const metadata = candidateSeriesMetadata(work, edition, seriesName);
      if (!metadata) continue;
      if (preferredLanguages.size > 0 && edition.language && !preferredLanguages.has(edition.language.toLocaleLowerCase())) continue;

      const candidate: SeriesDetectiveCandidate = {
        work,
        edition,
        seriesName: metadata.name,
        position: metadata.position,
      };
      const key = metadata.position !== null ? `position:${metadata.position}` : `title:${normalize(work.title)}`;
      const current = seen.get(key);
      if (!current || catalogEditionQualityScore(candidate.edition) > catalogEditionQualityScore(current.edition)) {
        seen.set(key, candidate);
      }
    }
  }

  candidates.push(...seen.values());

  const existingPositions = new Set<number>();
  const existingTitles = new Set<string>();
  seriesBooks.forEach((book) => {
    const metadata = resolveEffectiveSeriesMetadata(book);
    if (typeof metadata?.position === 'number') existingPositions.add(metadata.position);
    existingTitles.add(normalize(book.work.title));
  });

  const missing = candidates.filter((candidate) => {
    if (candidate.position !== null && existingPositions.has(candidate.position)) return false;
    return !existingTitles.has(normalize(candidate.work.title));
  }).sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.work.title.localeCompare(b.work.title);
  });

  return {
    seriesName,
    author,
    candidates,
    missing,
  };
}
