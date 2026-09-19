import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { inferSeriesHintFromTitle } from './seriesLibrary';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

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
