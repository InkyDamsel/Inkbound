import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { canonicalSeriesIdentity, inferSeriesHintFromTitle, seriesNamesAreCompatible } from './seriesLibrary';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const comparableTitle = (value?: string) => {
  const title = value?.trim() ?? '';
  if (!title) return '';
  const inferred = inferSeriesHintFromTitle(title);
  const withoutSeriesSuffix = inferred
    ? title.replace(/\s*[\[(][^\])]+[\])]\s*$/, '').trim()
    : title;
  return normalize(withoutSeriesSuffix);
};

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

export const hasKnownSeriesContextEvidence = (
  work: BookSearchWorkGroup,
  edition: BookSearchEdition,
  wantedSeriesName: string,
  providerAgreement: number,
): boolean => {
  if (providerAgreement < 2) return false;
  const wanted = normalize(wantedSeriesName);
  if (!wanted) return false;

  const workTitle = normalize(work.title);
  const wantedWords = wanted.split(' ').filter(Boolean).length;
  const titleWords = workTitle.split(' ').filter(Boolean).length;
  const brandOnlyTitle = workTitle === wanted
    || (workTitle.endsWith(` ${wanted}`) && titleWords <= wantedWords + 1);
  if (brandOnlyTitle) return false;

  return [work.title, work.subtitle, edition.title, edition.subtitle]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) =>
      normalize(value).includes(wanted)
      || seriesNamesAreCompatible(value, wantedSeriesName),
    );
};

const GENERIC_SUBTITLE_SERIES_WORDS = new Set([
  'novel', 'novella', 'memoir', 'romance', 'thriller', 'mystery', 'fantasy',
  'story', 'stories', 'edition', 'editions', 'anniversary', 'illustrated',
  'hardcover', 'paperback', 'ebook', 'audiobook',
]);

const subtitleSeriesCandidate = (value?: string): string | null => {
  const candidate = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!candidate) return null;
  const identity = canonicalSeriesIdentity(candidate);
  const words = identity.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 6) return null;
  if (words.some((word) => GENERIC_SUBTITLE_SERIES_WORDS.has(word))) return null;
  return candidate;
};

/**
 * Safe fallback for catalogs that expose a publisher line as a subtitle rather
 * than structured series metadata. One provider is never enough: the exact
 * title+author match must independently repeat the same non-generic subtitle
 * across at least two catalog sources.
 */
export const selectVerifiedSubtitleSeriesEvidence = (
  groups: BookSearchWorkGroup[],
  book: UserBookRecord,
): { name: string; position: null } | null => {
  const wantedTitle = comparableTitle(book.work.title);
  const byIdentity = new Map<string, { name: string; sources: Set<BookSearchEdition['source']> }>();

  for (const work of groups) {
    if (!exactAuthorMatch(work, book.work.author)) continue;
    if (comparableTitle(work.title) !== wantedTitle) continue;

    for (const edition of work.editions) {
      if (comparableTitle(edition.title) !== wantedTitle && comparableTitle(work.title) !== wantedTitle) continue;
      const candidate = subtitleSeriesCandidate(edition.subtitle) ?? subtitleSeriesCandidate(work.subtitle);
      if (!candidate) continue;
      const identity = canonicalSeriesIdentity(candidate);
      if (!identity) continue;
      const current = byIdentity.get(identity) ?? { name: candidate, sources: new Set<BookSearchEdition['source']>() };
      current.sources.add(edition.source);
      byIdentity.set(identity, current);
    }
  }

  const verified = [...byIdentity.values()]
    .filter((item) => item.sources.size >= 2)
    .sort((a, b) => b.sources.size - a.sources.size || a.name.localeCompare(b.name))[0];

  return verified ? { name: verified.name, position: null } : null;
};

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
  const bookTitle = comparableTitle(book.work.title);
  const exactTitle = comparableTitle(work.title) === bookTitle || comparableTitle(edition.title) === bookTitle;
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
  const eligible = evidence.filter((item) =>
    (item.exactAuthor && (item.exactTitle || item.exactIdentifier))
    || (item.structured && item.exactIdentifier),
  );
  if (!eligible.length) return null;

  const bySeries = new Map<string, SeriesEvidence[]>();
  for (const item of eligible) {
    const key = `${canonicalSeriesIdentity(item.name)}::${item.position ?? 'unknown'}`;
    const current = bySeries.get(key) ?? [];
    current.push(item);
    bySeries.set(key, current);
  }

  const ranked = [...bySeries.values()].map((group) => {
    const distinctSources = new Set(group.map((item) => item.edition.source)).size;
    const best = [...group].sort((a, b) => b.score - a.score)[0];
    // Never promote a title-inferred series from a single provider. That was
    // permissive enough to turn standalone works into invented series. Inferred
    // relationships need independent provider agreement; one strong structured
    // record may still verify when it matches this exact book.
    const verified =
      best.exactIdentifier && best.structured
      || best.structured && best.exactAuthor && best.exactTitle && best.score >= 150
      || distinctSources >= 2 && best.score >= 110;
    return { best, distinctSources, verified };
  }).filter((item) => item.verified)
    .sort((a, b) => b.best.score - a.best.score || b.distinctSources - a.distinctSources);

  return ranked[0]?.best ?? null;
};
