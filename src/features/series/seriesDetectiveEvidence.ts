import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { canonicalAuthorIdentity, canonicalLanguageCode } from '../book-search/catalogHardening';
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
  const wanted = canonicalAuthorIdentity(author);
  return !wanted || group.authors.some((candidate) => canonicalAuthorIdentity(candidate) === wanted);
};

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  canonicalLanguageCode(
    (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language,
  );

export const buildSeriesDetectionQueries = (book: UserBookRecord): { workQuery: string; identifiers: string[] } => {
  const identifiers = [...new Set(
    book.editions
      .flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )];

  return {
    workQuery: `${book.work.title} ${book.work.author}`.trim(),
    identifiers,
  };
};

export const inferKnownSeriesFromBibliographicText = (
  value: string | undefined,
  wantedSeriesName: string,
): { name: string; position: number | null } | null => {
  const text = value?.trim();
  if (!text) return null;

  const parts = text.split(':');
  const candidate = (parts.length > 1 ? parts[parts.length - 1] : text).trim();
  const match = candidate.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;

  const name = match[1].trim().replace(/[,:;\-]+$/g, '');
  if (!seriesNamesAreCompatible(name, wantedSeriesName)) return null;

  const position = Number.parseFloat(match[2]);
  return {
    name,
    position: Number.isFinite(position) && position >= 0 ? position : null,
  };
};

const ORDINAL_WORD_POSITIONS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

export const inferKnownSeriesFromBibliographicDescription = (
  value: string | undefined,
  wantedSeriesName: string,
): { name: string; position: number | null } | null => {
  const text = value?.trim();
  if (!text) return null;

  const normalized = normalize(text);
  const seriesTokens = canonicalSeriesIdentity(wantedSeriesName).split(' ').filter(Boolean);
  if (!normalized || !seriesTokens.length) return null;

  const tokenPattern = seriesTokens.map(escapeRegExp).join('(?:\\s+(?:x|and|the))?\\s+');
  const explicitSeries = new RegExp('\\b' + tokenPattern + '\\b(?:\\s+(?:series|saga|novels?|books?|collection))?', 'i');
  const match = explicitSeries.exec(normalized);
  if (!match) return null;

  // Single-word series names need an explicit bibliographic qualifier so an
  // incidental word such as "selection" is never treated as membership proof.
  if (seriesTokens.length === 1 && !/\b(?:series|saga|novels?|books?|collection)\b/i.test(match[0])) return null;

  const start = Math.max(0, match.index - 100);
  const end = Math.min(normalized.length, match.index + match[0].length + 100);
  const context = normalized.slice(start, end);
  let position: number | null = null;

  for (const pattern of [
    /\b(?:book|volume|vol|part)\s*#?\s*(\d+(?:\.\d+)?)\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:st|nd|rd|th)?\s+(?:book|novel|volume|part)\b/i,
  ]) {
    const numberMatch = context.match(pattern);
    const parsed = numberMatch ? Number(numberMatch[1]) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) { position = parsed; break; }
  }

  if (position === null) {
    const ordinalMatch = context.match(new RegExp(
      '\\b(' + Object.keys(ORDINAL_WORD_POSITIONS).join('|') + ')\\s+(?:book|novel|volume|part)\\b',
      'i',
    ));
    if (ordinalMatch) position = ORDINAL_WORD_POSITIONS[ordinalMatch[1].toLocaleLowerCase()] ?? null;
  }

  return { name: wantedSeriesName.trim(), position };
};
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

export const plausibleSeriesSubtitle = (value?: string): string | null => {
  const candidate = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!candidate) return null;
  const identity = canonicalSeriesIdentity(candidate);
  const words = identity.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 6) return null;
  if (words.some((word) => GENERIC_SUBTITLE_SERIES_WORDS.has(word))) return null;
  return candidate;
};

const subtitleSeriesCandidate = plausibleSeriesSubtitle;

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
  if (canonicalLanguageCode(edition.language) && canonicalLanguageCode(edition.language) === activeEditionLanguage(book)) score += 5;

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
