import { UserBookRecord } from '../../types';
import { orderedSeriesOverrides, SeriesOverrides } from './seriesOverrides';

export interface SeriesBookEntry {
  book: UserBookRecord;
  position: number | null;
  displayPosition: string;
}

export interface SeriesSummary {
  id: string;
  name: string;
  author: string;
  books: SeriesBookEntry[];
  finishedCount: number;
  currentlyReadingCount: number;
  tbrCount: number;
  unreadCount: number;
  ownedCount: number;
  borrowedCount: number;
  subscriptionCount: number;
  notOwnedCount: number;
  completionPercent: number;
  averageRating: number | null;
  isManual: boolean;
}

export interface SeriesHint {
  name: string;
  position: number | null;
}

export interface EffectiveSeriesMetadata extends SeriesHint {
  label: string;
  source: 'manual' | 'metadata' | 'inferred';
}

const normalizeSeriesName = (value: string) => value.trim().replace(/\s+/g, ' ');
const SERIES_CONNECTOR_TOKENS = new Set(['a', 'an', 'the', 'and', 'x']);
const SERIES_TRAILING_QUALIFIERS = new Set(['series', 'saga', 'novel', 'novels', 'book', 'books', 'collection', 'collections']);

export const canonicalSeriesIdentity = (value?: string): string => {
  const tokens = (value ?? '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 1 && SERIES_TRAILING_QUALIFIERS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.filter((token) => !SERIES_CONNECTOR_TOKENS.has(token)).join(' ');
};

export const seriesNamesAreCompatible = (left?: string, right?: string): boolean => {
  const leftKey = canonicalSeriesIdentity(left);
  const rightKey = canonicalSeriesIdentity(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
};

const seriesId = (name: string, author: string) => `${canonicalSeriesIdentity(name)}::${author}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const GENERIC_SERIES_NAMES = new Set(['book', 'books', 'series', 'volume', 'vol', 'part', 'edition']);

export function inferSeriesHintFromTitle(title: string): SeriesHint | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const suffix = trimmed.match(/[\[(]([^\])]+)[\])]\s*$/)?.[1]?.trim();
  if (!suffix) return null;
  const match = suffix.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;
  const name = normalizeSeriesName(match[1].replace(/[,:;\-]+$/g, ''));
  if (name.length < 2 || GENERIC_SERIES_NAMES.has(name.toLowerCase())) return null;
  const parsedPosition = Number.parseFloat(match[2]);
  return { name, position: Number.isFinite(parsedPosition) && parsedPosition >= 0 ? parsedPosition : null };
}

/**
 * Some older/custom imports converted a blank Series Number cell into numeric 0.
 * When the title itself contains an unambiguous matching series suffix, recover
 * the real position from that title instead of letting a bogus Book 0 override it.
 * A genuine explicit 0 is preserved when the title does not prove otherwise.
 */
function recoverSeriesPosition(book: UserBookRecord, seriesName: string, position: number | null): number | null {
  if (position !== 0) return position;
  const inferred = inferSeriesHintFromTitle(book.work.title);
  if (!inferred || inferred.position === null) return position;
  if (!seriesNamesAreCompatible(inferred.name, seriesName)) return position;
  return inferred.position;
}

export function resolveSeriesMetadata(book: UserBookRecord): SeriesHint | null {
  const explicitName = book.work.seriesName?.trim();
  if (!explicitName) return null;
  const explicitPosition = typeof book.work.seriesOrder === 'number' && Number.isFinite(book.work.seriesOrder)
    ? book.work.seriesOrder
    : null;
  return {
    name: normalizeSeriesName(explicitName),
    position: recoverSeriesPosition(book, explicitName, explicitPosition),
  };
}

/** Canonical resolver for any screen/export that needs the series the reader sees. */
export function resolveEffectiveSeriesMetadata(book: UserBookRecord): EffectiveSeriesMetadata | null {
  const explicitName = book.work.seriesName?.trim();
  if (explicitName) {
    return {
      ...resolveSeriesMetadata(book)!,
      label: book.work.seriesLabel?.trim() ?? '',
      source: book.work.seriesSource === 'manual' ? 'manual' : 'metadata',
    };
  }
  return null;
}

/** Presentation-only cleanup; the canonical imported title stays untouched. */
export function seriesBookDisplayTitle(book: UserBookRecord, seriesName?: string): string {
  const title = book.work.title.trim();
  if (/^untitled\b/i.test(title)) return 'Untitled / Upcoming';
  const inferred = inferSeriesHintFromTitle(title);
  const sameSeries = inferred && (!seriesName || seriesNamesAreCompatible(inferred.name, seriesName));
  if (!sameSeries) return title;
  const withoutSuffix = title.replace(/\s*[\[(][^\])]+[\])]\s*$/, '').trim();
  return withoutSuffix || title;
}

const positionNoun = (book: UserBookRecord) => {
  const type = book.work.materialType ?? 'book';
  if (type === 'manga' || type === 'light-novel') return 'Volume';
  if (type === 'comic' || type === 'magazine') return 'Issue';
  return 'Book';
};

export function seriesPositionLabel(book: UserBookRecord, position: number | null, customLabel?: string): string {
  const custom = customLabel?.trim();
  if (custom) return custom;
  if (typeof position !== 'number' || !Number.isFinite(position)) return 'Series item';
  return `${positionNoun(book)} ${position}`;
}

const summarize = (id: string, name: string, author: string, entries: SeriesBookEntry[], isManual: boolean): SeriesSummary => {
  const ordered = [...entries].sort((a, b) => {
    if (typeof a.position === 'number' && typeof b.position === 'number') return a.position - b.position;
    if (typeof a.position === 'number') return -1;
    if (typeof b.position === 'number') return 1;
    return a.book.work.publicationYear - b.book.work.publicationYear || a.book.work.title.localeCompare(b.book.work.title);
  });
  const finishedCount = ordered.filter(({ book }) => book.status === 'finished').length;
  const currentlyReadingCount = ordered.filter(({ book }) => book.status === 'currently-reading').length;
  const tbrCount = ordered.filter(({ book }) => book.status === 'tbr').length;
  const unreadCount = ordered.length - finishedCount;
  const ownedCount = ordered.filter(({ book }) => book.ownership === 'owned').length;
  const borrowedCount = ordered.filter(({ book }) => ['borrowed-library', 'borrowed-person'].includes(book.ownership)).length;
  const subscriptionCount = ordered.filter(({ book }) => book.ownership === 'subscription').length;
  const notOwnedCount = ordered.filter(({ book }) => ['none', 'wishlist'].includes(book.ownership)).length;
  const rated = ordered.map(({ book }) => book.rating).filter((rating): rating is number => typeof rating === 'number' && rating > 0);
  return {
    id, name, author, books: ordered, finishedCount, currentlyReadingCount, tbrCount, unreadCount, ownedCount, borrowedCount,
    subscriptionCount, notOwnedCount,
    completionPercent: ordered.length ? Math.round((finishedCount / ordered.length) * 100) : 0,
    averageRating: rated.length ? rated.reduce((sum, rating) => sum + rating, 0) / rated.length : null,
    isManual,
  };
};

export function buildSeriesLibrary(books: UserBookRecord[]): SeriesSummary[] {
  const summaries: SeriesSummary[] = [];
  const metadataGroups = new Map<string, { name: string; author: string; entries: SeriesBookEntry[]; isManual: boolean }>();
  books.forEach((book) => {
    const resolved = resolveEffectiveSeriesMetadata(book);
    if (!resolved) return;
    const name = resolved.name;
    const author = book.work.author.trim() || 'Unknown author';
    const key = `${canonicalSeriesIdentity(name)}::${author.toLowerCase()}`;
    const current = metadataGroups.get(key) ?? { name, author, entries: [], isManual: false };
    current.entries.push({
      book,
      position: resolved.position,
      displayPosition: seriesPositionLabel(book, resolved.position, resolved.label),
    });
    current.isManual ||= resolved.source === 'manual';
    metadataGroups.set(key, current);
  });

  metadataGroups.forEach(({ name, author, entries, isManual }) =>
    summaries.push(summarize(seriesId(name, author), name, author, entries, isManual)));
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
