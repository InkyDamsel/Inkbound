import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchGoogleBooks, searchGoogleBooksAuthorPage, searchGoogleBooksPage } from '../book-search/data/googleBooksApi';
import { resolveEffectiveSeriesMetadata } from './seriesLibrary';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const sameSeries = (edition: BookSearchEdition, seriesName: string) =>
  Boolean(edition.seriesName && normalize(edition.seriesName) === normalize(seriesName));

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

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

  const response = await searchGoogleBooks(`${book.work.title} ${book.work.author}`);
  const wantedTitle = normalize(book.work.title);
  const wantedAuthor = normalize(book.work.author);

  const candidates = response.groups
    .filter((group) => normalize(group.title) === wantedTitle || normalize(group.title).includes(wantedTitle) || wantedTitle.includes(normalize(group.title)))
    .filter((group) => !wantedAuthor || exactAuthorMatch(group, book.work.author))
    .flatMap((group) => group.editions)
    .filter((edition) => edition.seriesName);

  const preferredLanguage = activeEditionLanguage(book);
  const exactLanguage = preferredLanguage
    ? candidates.find((edition) => edition.language?.toLocaleLowerCase() === preferredLanguage)
    : undefined;
  const match = exactLanguage ?? candidates[0];
  if (!match?.seriesName) return null;
  return { name: match.seriesName, position: typeof match.seriesOrder === 'number' ? match.seriesOrder : null };
}

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
): Promise<SeriesDetectiveResult> {
  const [seriesSearch, authorSearch] = await Promise.all([
    searchGoogleBooksPage(`${seriesName} ${author}`, 0),
    searchGoogleBooksAuthorPage(author, 0),
  ]);

  const merged = [...seriesSearch.groups, ...authorSearch.groups];
  const seen = new Set<string>();
  const candidates: SeriesDetectiveCandidate[] = [];

  const seriesBooks = libraryBooks.filter((book) => {
    const metadata = resolveEffectiveSeriesMetadata(book);
    return metadata && normalize(metadata.name) === normalize(seriesName) && normalize(book.work.author) === normalize(author);
  });
  const preferredLanguages = new Set(seriesBooks.map(activeEditionLanguage).filter((value): value is string => Boolean(value)));

  for (const work of merged) {
    if (!exactAuthorMatch(work, author)) continue;
    for (const edition of work.editions) {
      if (!sameSeries(edition, seriesName)) continue;
      if (preferredLanguages.size > 0 && edition.language && !preferredLanguages.has(edition.language.toLocaleLowerCase())) continue;
      const position = typeof edition.seriesOrder === 'number' ? edition.seriesOrder : null;
      const key = position !== null ? `position:${position}` : `title:${normalize(work.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ work, edition, seriesName: edition.seriesName!, position });
    }
  }

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
