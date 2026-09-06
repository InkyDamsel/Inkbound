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

const normalizeSeriesName = (value: string) => value.trim().replace(/\s+/g, ' ');

const seriesId = (name: string, author: string) =>
  `${name}::${author}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
  const rated = ordered
    .map(({ book }) => book.rating)
    .filter((rating): rating is number => typeof rating === 'number' && rating > 0);

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
      const book = booksById.get(entry.bookId);
      if (!book) return [];
      manuallyAssignedBookIds.add(book.id);
      return [{
        book,
        position: entry.position,
        displayPosition: normalizeSeriesPositionLabel(entry.position, entry.label),
      }];
    });
    if (entries.length > 0) summaries.push(summarize(override.id, override.name, override.author, entries, true));
  });

  const metadataGroups = new Map<string, { name: string; author: string; books: UserBookRecord[] }>();
  books.forEach((book) => {
    if (manuallyAssignedBookIds.has(book.id)) return;
    const rawName = book.work.seriesName?.trim();
    if (!rawName) return;
    const name = normalizeSeriesName(rawName);
    const author = book.work.author.trim() || 'Unknown author';
    const key = `${name.toLowerCase()}::${author.toLowerCase()}`;
    const current = metadataGroups.get(key) ?? { name, author, books: [] };
    current.books.push(book);
    metadataGroups.set(key, current);
  });

  metadataGroups.forEach(({ name, author, books: seriesBooks }) => {
    const entries = seriesBooks.map((book) => ({
      book,
      position: typeof book.work.seriesOrder === 'number' ? book.work.seriesOrder : null,
      displayPosition: normalizeSeriesPositionLabel(
        typeof book.work.seriesOrder === 'number' ? book.work.seriesOrder : null,
      ),
    }));
    summaries.push(summarize(seriesId(name, author), name, author, entries, false));
  });

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
