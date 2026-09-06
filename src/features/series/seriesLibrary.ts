import { UserBookRecord } from '../../types';
import { normalizeSeriesPositionLabel, SeriesOverrides } from './seriesOverrides';

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

const seriesId = (name: string, author: string) =>
  `${name}::${author}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
  return {
    name,
    position: Number.isFinite(parsedPosition) && parsedPosition >= 0 ? parsedPosition : null,
  };
}

export function resolveSeriesMetadata(book: UserBookRecord): SeriesHint | null {
  const explicitName = book.work.seriesName?.trim();
  if (explicitName) {
    return {
      name: normalizeSeriesName(explicitName),
      position: typeof book.work.seriesOrder === 'number' && Number.isFinite(book.work.seriesOrder)
        ? book.work.seriesOrder
        : null,
    };
  }

  return inferSeriesHintFromTitle(book.work.title);
}

/** Canonical resolver for any screen/export that needs the series the reader sees. */
export function resolveEffectiveSeriesMetadata(
  book: UserBookRecord,
  overrides: SeriesOverrides = {},
): EffectiveSeriesMetadata | null {
  for (const override of Object.values(overrides)) {
    const entry = override.books.find((candidate) => candidate.bookId === book.id);
    if (!entry) continue;
    return {
      name: override.name,
      position: entry.position,
      label: entry.label?.trim() ?? '',
      source: 'manual',
    };
  }

  const explicitName = book.work.seriesName?.trim();
  if (explicitName) {
    const resolved = resolveSeriesMetadata(book)!;
    return { ...resolved, label: '', source: 'metadata' };
  }

  const inferred = inferSeriesHintFromTitle(book.work.title);
  return inferred ? { ...inferred, label: '', source: 'inferred' } : null;
}

function normalizeSeriesBook(book: UserBookRecord, resolved: SeriesHint | null): UserBookRecord {
  const isUntitledPlaceholder = Boolean(
    resolved
    && /^untitled\b/i.test(book.work.title.trim())
    && book.status !== 'finished'
    && book.status !== 'currently-reading',
  );

  if (!isUntitledPlaceholder || book.ownership !== 'owned') return book;
  return { ...book, ownership: 'none' };
}

const summarize = (
  id: string,
  name: string,
  author: string,
  entries: SeriesBookEntry[],
  isManual: boolean,
): SeriesSummary => {
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
    id,
    name,
    author,
    books: ordered,
    finishedCount,
    currentlyReadingCount,
    tbrCount,
    unreadCount,
    ownedCount,
    borrowedCount,
    subscriptionCount,
    notOwnedCount,
    completionPercent: ordered.length ? Math.round((finishedCount / ordered.length) * 100) : 0,
    averageRating: rated.length ? rated.reduce((sum, rating) => sum + rating, 0) / rated.length : null,
    isManual,
  };
};

export function buildSeriesLibrary(books: UserBookRecord[], overrides: SeriesOverrides = {}): SeriesSummary[] {
  const booksById = new Map(books.map((book) => [book.id, book]));
  const manuallyAssignedBookIds = new Set<string>();
  const summaries: SeriesSummary[] = [];

  Object.values(overrides).forEach((override) => {
    const entries = override.books.flatMap((entry) => {
      const sourceBook = booksById.get(entry.bookId);
      if (!sourceBook) return [];
      manuallyAssignedBookIds.add(sourceBook.id);
      const resolved = resolveSeriesMetadata(sourceBook) ?? { name: override.name, position: entry.position };
      const book = normalizeSeriesBook(sourceBook, resolved);
      return [{
        book,
        position: entry.position,
        displayPosition: normalizeSeriesPositionLabel(entry.position, entry.label),
      }];
    });
    if (entries.length > 0) summaries.push(summarize(override.id, override.name, override.author, entries, true));
  });

  const metadataGroups = new Map<string, { name: string; author: string; entries: SeriesBookEntry[] }>();
  books.forEach((sourceBook) => {
    if (manuallyAssignedBookIds.has(sourceBook.id)) return;
    const resolved = resolveSeriesMetadata(sourceBook);
    if (!resolved) return;

    const book = normalizeSeriesBook(sourceBook, resolved);
    const name = resolved.name;
    const author = book.work.author.trim() || 'Unknown author';
    const key = `${name.toLowerCase()}::${author.toLowerCase()}`;
    const current = metadataGroups.get(key) ?? { name, author, entries: [] };
    current.entries.push({
      book,
      position: resolved.position,
      displayPosition: normalizeSeriesPositionLabel(resolved.position),
    });
    metadataGroups.set(key, current);
  });

  metadataGroups.forEach(({ name, author, entries }) => {
    summaries.push(summarize(seriesId(name, author), name, author, entries, false));
  });

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
