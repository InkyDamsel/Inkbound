import { UserBookRecord } from '../../types';

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
  completionPercent: number;
  averageRating: number | null;
}

const normalizeSeriesName = (value: string) => value.trim().replace(/\s+/g, ' ');

const seriesId = (name: string, author: string) =>
  `${name}::${author}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const displayPosition = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Series book';
  if (Number.isInteger(value)) return `Book ${value}`;
  return `Book ${value}`;
};

export function buildSeriesLibrary(books: UserBookRecord[]): SeriesSummary[] {
  const groups = new Map<string, { name: string; author: string; books: UserBookRecord[] }>();

  books.forEach((book) => {
    const rawName = book.work.seriesName?.trim();
    if (!rawName) return;
    const name = normalizeSeriesName(rawName);
    const author = book.work.author.trim() || 'Unknown author';
    const key = `${name.toLowerCase()}::${author.toLowerCase()}`;
    const current = groups.get(key) ?? { name, author, books: [] };
    current.books.push(book);
    groups.set(key, current);
  });

  return [...groups.values()]
    .map(({ name, author, books: seriesBooks }): SeriesSummary => {
      const entries = [...seriesBooks]
        .sort((a, b) => {
          const aOrder = a.work.seriesOrder;
          const bOrder = b.work.seriesOrder;
          if (typeof aOrder === 'number' && typeof bOrder === 'number') return aOrder - bOrder;
          if (typeof aOrder === 'number') return -1;
          if (typeof bOrder === 'number') return 1;
          return a.work.publicationYear - b.work.publicationYear || a.work.title.localeCompare(b.work.title);
        })
        .map((book) => ({
          book,
          position: typeof book.work.seriesOrder === 'number' ? book.work.seriesOrder : null,
          displayPosition: displayPosition(book.work.seriesOrder),
        }));

      const finishedCount = entries.filter(({ book }) => book.status === 'finished').length;
      const currentlyReadingCount = entries.filter(({ book }) => book.status === 'currently-reading').length;
      const tbrCount = entries.filter(({ book }) => book.status === 'tbr').length;
      const rated = entries.map(({ book }) => book.rating).filter((rating): rating is number => typeof rating === 'number' && rating > 0);

      return {
        id: seriesId(name, author),
        name,
        author,
        books: entries,
        finishedCount,
        currentlyReadingCount,
        tbrCount,
        completionPercent: entries.length ? Math.round((finishedCount / entries.length) * 100) : 0,
        averageRating: rated.length ? rated.reduce((sum, rating) => sum + rating, 0) / rated.length : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
