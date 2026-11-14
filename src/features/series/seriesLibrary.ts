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
const SERIES_LEADING_ARTICLES = new Set(['a', 'an', 'the']);
const SERIES_CONNECTOR_TOKENS = new Set(['and', 'x']);
const SERIES_TRAILING_QUALIFIERS = new Set(['series', 'saga', 'novel', 'novels', 'book', 'books', 'collection', 'collections', 'trilogy', 'duology', 'duet', 'quartet', 'quintet', 'sextet', 'septet', 'octet']);

export const canonicalSeriesIdentity = (value?: string): string => {
  const tokens = (value ?? '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // No series-specific aliases: identity remains conservative.
  while (tokens.length > 1 && SERIES_LEADING_ARTICLES.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && SERIES_TRAILING_QUALIFIERS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.filter((token) => !SERIES_CONNECTOR_TOKENS.has(token)).join(' ');
};

/** Compare normalized series labels without merging unrelated names by substring. */
export const seriesNamesAreCompatible = (left: string, right: string): boolean => {
  const a = canonicalSeriesIdentity(left);
  const b = canonicalSeriesIdentity(right);
  return Boolean(a && b && a === b);
};

const seriesId = (name: string, discriminator = '') =>
  `${canonicalSeriesIdentity(name)}::${discriminator}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
  if (explicitName) {
    const explicitPosition = typeof book.work.seriesOrder === 'number' && Number.isFinite(book.work.seriesOrder) ? book.work.seriesOrder : null;
    return {
      name: normalizeSeriesName(explicitName),
      position: recoverSeriesPosition(book, explicitName, explicitPosition),
    };
  }
  return inferSeriesHintFromTitle(book.work.title);
}

/** Canonical resolver for any screen/export that needs the series the reader sees. */
export function resolveEffectiveSeriesMetadata(book: UserBookRecord, overrides: SeriesOverrides = {}): EffectiveSeriesMetadata | null {
  for (const override of orderedSeriesOverrides(overrides)) {
    const entry = override.books.find((candidate) => candidate.bookId === book.id);
    if (!entry) continue;
    return {
      name: override.name,
      position: recoverSeriesPosition(book, override.name, entry.position),
      label: entry.label?.trim() ?? '',
      source: 'manual',
    };
  }
  const explicitName = book.work.seriesName?.trim();
  if (explicitName) return { ...resolveSeriesMetadata(book)!, label: '', source: 'metadata' };
  const inferred = inferSeriesHintFromTitle(book.work.title);
  return inferred ? { ...inferred, label: '', source: 'inferred' } : null;
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

export function buildSeriesLibrary(books: UserBookRecord[], overrides: SeriesOverrides = {}): SeriesSummary[] {
  const booksById = new Map(books.map((book) => [book.id, book]));
  const manuallyAssignedBookIds = new Set<string>();
  const summaries: SeriesSummary[] = [];

  orderedSeriesOverrides(overrides).forEach((override) => {
    const entries = override.books.flatMap((entry) => {
      const book = booksById.get(entry.bookId);
      if (!book || manuallyAssignedBookIds.has(book.id)) return [];
      manuallyAssignedBookIds.add(book.id);
      const position = recoverSeriesPosition(book, override.name, entry.position);
      return [{ book, position, displayPosition: seriesPositionLabel(book, position, entry.label) }];
    });
    if (entries.length > 0) summaries.push(summarize(override.id, override.name, override.author, entries, true));
  });

  // Start conservatively with series + author. Some publisher/shared-world
  // series legitimately span authors, but unrelated authors can also reuse the
  // same series name. Cross-author groups merge only when explicit numbered
  // positions exist on both sides and those positions do not conflict.
  const metadataGroups = new Map<string, { name: string; author: string; entries: SeriesBookEntry[] }>();
  books.forEach((book) => {
    if (manuallyAssignedBookIds.has(book.id)) return;
    const resolved = resolveSeriesMetadata(book);
    if (!resolved) return;
    const name = resolved.name;
    const author = book.work.author.trim() || 'Unknown author';
    const key = `${canonicalSeriesIdentity(name)}::${author.toLowerCase()}`;
    const current = metadataGroups.get(key) ?? { name, author, entries: [] };
    current.entries.push({ book, position: resolved.position, displayPosition: seriesPositionLabel(book, resolved.position) });
    metadataGroups.set(key, current);
  });

  type MetadataCluster = { name: string; authors: Set<string>; entries: SeriesBookEntry[] };
  const clustersBySeries = new Map<string, MetadataCluster[]>();

  const numberedPositions = (entries: SeriesBookEntry[]) =>
    new Set(entries
      .map((entry) => entry.position)
      .filter((position): position is number => typeof position === 'number' && Number.isFinite(position)));

  const canMergeCrossAuthor = (
    seriesIdentity: string,
    left: MetadataCluster,
    rightEntries: SeriesBookEntry[],
  ) => {
    // A one-word series name is too collision-prone to join across authors
    // automatically. Multi-author publisher/shared-world series such as
    // "A Twisted Tale" retain at least two canonical identity tokens.
    if (seriesIdentity.split(' ').filter(Boolean).length < 2) return false;
    const leftPositions = numberedPositions(left.entries);
    const rightPositions = numberedPositions(rightEntries);
    if (leftPositions.size === 0 || rightPositions.size === 0) return false;
    return [...rightPositions].every((position) => !leftPositions.has(position));
  };

  metadataGroups.forEach(({ name, author, entries }) => {
    const identity = canonicalSeriesIdentity(name);
    const clusters = clustersBySeries.get(identity) ?? [];
    const compatible = clusters.find((cluster) =>
      cluster.authors.has(author) || canMergeCrossAuthor(identity, cluster, entries),
    );

    if (compatible) {
      compatible.authors.add(author);
      compatible.entries.push(...entries);
    } else {
      clusters.push({ name, authors: new Set([author]), entries: [...entries] });
    }
    clustersBySeries.set(identity, clusters);
  });

  clustersBySeries.forEach((clusters) => {
    clusters.forEach(({ name, authors, entries }) => {
      const authorList = [...authors].sort();
      const author = authorList.length === 1 ? authorList[0] : 'Various authors';
      summaries.push(summarize(seriesId(name, authorList.join('|')), name, author, entries, false));
    });
  });
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
