import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchGoogleBooks, searchGoogleBooksAuthorPage, searchGoogleBooksPage } from '../book-search/data/googleBooksApi';
import { searchHardcover } from '../book-search/data/hardcoverApi';
import { searchInkboundTrustedCatalog } from '../catalog/metadataContributions';
import { searchOpenLibraryPage } from '../book-search/data/openLibraryApi';
import { catalogEditionQualityScore, hardenCatalogGroups } from '../book-search/catalogHardening';
import { inferSeriesHintFromTitle, resolveEffectiveSeriesMetadata } from './seriesLibrary';
import { scoreSeriesEvidence, selectVerifiedSeriesEvidence } from './seriesDetectiveEvidence';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const sameSeries = (edition: BookSearchEdition, seriesName: string) =>
  Boolean(edition.seriesName && normalize(edition.seriesName) === normalize(seriesName));

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

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
