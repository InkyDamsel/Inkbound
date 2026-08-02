export type MemoryShelfMomentType =
  | 'first-finished-book'
  | 'highest-rated-book'
  | 'longest-reading-session'
  | 'favorite-book'
  | 'seasonal-favorite'
  | 'first-wrapped'
  | 'first-photo-memory'
  | 'first-time-capsule'
  | 'lumis-first-guarded-book';

export interface MemoryShelfBookSnapshot {
  id: string;
  title: string;
  author: string;
  coverGradient?: string;
  rating?: number | null;
  dateFinished?: string | null;
  isFavorite?: boolean;
  genres?: string[];
}

export interface MemoryShelfSessionSnapshot {
  id: string;
  bookId: string;
  date: string;
  durationMinutes: number;
}

export interface MemoryShelfMemorySnapshot {
  id: string;
  type: 'photo' | 'time-capsule' | 'wrapped' | 'lumis-guarded-book';
  bookId?: string | null;
  createdAt: string;
  title?: string | null;
  imageUrl?: string | null;
}

export interface MemoryShelfContext {
  books: MemoryShelfBookSnapshot[];
  sessions: MemoryShelfSessionSnapshot[];
  memories: MemoryShelfMemorySnapshot[];
  currentDate?: Date;
  maximumItems?: number;
}

export interface MemoryShelfItem {
  id: string;
  momentType: MemoryShelfMomentType;
  title: string;
  subtitle: string;
  bookId?: string;
  bookTitle?: string;
  bookAuthor?: string;
  coverGradient?: string;
  imageUrl?: string;
  occurredAt?: string;
  displayPriority: number;
  accent: 'plum' | 'mauve' | 'lavender' | 'sage' | 'amber';
}

export interface MemoryShelf {
  items: MemoryShelfItem[];
  generatedAt: string;
  sourceVersion: 1;
}

export function resolveMemoryShelf(context: MemoryShelfContext): MemoryShelf {
  const now = context.currentDate ?? new Date();
  const maximumItems = Math.max(1, context.maximumItems ?? 8);
  const candidates: MemoryShelfItem[] = [];

  const finishedBooks = context.books
    .filter((book) => Boolean(book.dateFinished))
    .sort((a, b) => dateValue(a.dateFinished) - dateValue(b.dateFinished));

  const firstFinished = finishedBooks[0];
  if (firstFinished) {
    candidates.push(bookItem(
      'first-finished-book',
      'The Story That Began It All',
      'Your first finished book in Inkbound.',
      firstFinished,
      100,
      'plum',
    ));
  }

  const highestRated = [...finishedBooks]
    .filter((book) => typeof book.rating === 'number')
    .sort((a, b) => {
      const ratingDifference = (b.rating ?? 0) - (a.rating ?? 0);
      return ratingDifference !== 0
        ? ratingDifference
        : dateValue(b.dateFinished) - dateValue(a.dateFinished);
    })[0];

  if (highestRated && highestRated.id !== firstFinished?.id) {
    candidates.push(bookItem(
      'highest-rated-book',
      'A Five-Star Place in Your Heart',
      highestRated.rating
        ? `One of your highest-rated reads at ${highestRated.rating} stars.`
        : 'One of your most treasured reads.',
      highestRated,
      90,
      'amber',
    ));
  }

  const favoriteBook = [...context.books]
    .filter((book) => book.isFavorite)
    .sort((a, b) => dateValue(b.dateFinished) - dateValue(a.dateFinished))[0];

  if (favoriteBook && !candidates.some((item) => item.bookId === favoriteBook.id)) {
    candidates.push(bookItem(
      'favorite-book',
      'A Beloved Story',
      'A favorite book chosen for a permanent place on the shelf.',
      favoriteBook,
      88,
      'mauve',
    ));
  }

  const longestSession = [...context.sessions]
    .sort((a, b) => b.durationMinutes - a.durationMinutes)[0];

  if (longestSession) {
    const sessionBook = context.books.find((book) => book.id === longestSession.bookId);
    candidates.push({
      id: `memory-shelf-longest-session-${longestSession.id}`,
      momentType: 'longest-reading-session',
      title: 'The Longest Reading Night',
      subtitle: `${longestSession.durationMinutes} quiet minutes spent reading${sessionBook ? ` ${sessionBook.title}` : ''}.`,
      bookId: sessionBook?.id,
      bookTitle: sessionBook?.title,
      bookAuthor: sessionBook?.author,
      coverGradient: sessionBook?.coverGradient,
      occurredAt: longestSession.date,
      displayPriority: 84,
      accent: 'lavender',
    });
  }

  const seasonalFavorite = resolveSeasonalFavorite(finishedBooks, now);
  if (seasonalFavorite && !candidates.some((item) => item.bookId === seasonalFavorite.book.id)) {
    candidates.push(bookItem(
      'seasonal-favorite',
      `${capitalize(seasonalFavorite.season)} on the Shelf`,
      `A favorite memory from your ${seasonalFavorite.season} reading life.`,
      seasonalFavorite.book,
      72,
      seasonalFavorite.season === 'winter' ? 'lavender' : 'sage',
    ));
  }

  addFirstMemoryCandidate(candidates, context, 'wrapped', 'first-wrapped', 'Your First Wrapped', 'The first time Inkbound gathered a season of reading into one memory.', 86, 'sage');
  addFirstMemoryCandidate(candidates, context, 'photo', 'first-photo-memory', 'A Reading Moment Preserved', 'The first photograph kept beside your books.', 76, 'mauve');
  addFirstMemoryCandidate(candidates, context, 'time-capsule', 'first-time-capsule', 'A Letter Waiting in Time', 'The first reading time capsule entrusted to your library.', 74, 'plum');
  addFirstMemoryCandidate(candidates, context, 'lumis-guarded-book', 'lumis-first-guarded-book', 'The First Story Lumis Guarded', 'The first book Lumis chose to watch over.', 82, 'amber');

  const items = deduplicateCandidates(candidates)
    .sort((a, b) => {
      const priorityDifference = b.displayPriority - a.displayPriority;
      if (priorityDifference !== 0) return priorityDifference;
      return dateValue(a.occurredAt) - dateValue(b.occurredAt);
    })
    .slice(0, maximumItems);

  return {
    items,
    generatedAt: now.toISOString(),
    sourceVersion: 1,
  };
}

function addFirstMemoryCandidate(
  candidates: MemoryShelfItem[],
  context: MemoryShelfContext,
  memoryType: MemoryShelfMemorySnapshot['type'],
  momentType: MemoryShelfMomentType,
  title: string,
  subtitle: string,
  displayPriority: number,
  accent: MemoryShelfItem['accent'],
): void {
  const memory = context.memories
    .filter((item) => item.type === memoryType)
    .sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt))[0];

  if (!memory) return;

  const book = memory.bookId
    ? context.books.find((candidate) => candidate.id === memory.bookId)
    : undefined;

  candidates.push({
    id: `memory-shelf-${momentType}-${memory.id}`,
    momentType,
    title,
    subtitle: memory.title?.trim() || subtitle,
    bookId: book?.id,
    bookTitle: book?.title,
    bookAuthor: book?.author,
    coverGradient: book?.coverGradient,
    imageUrl: memory.imageUrl ?? undefined,
    occurredAt: memory.createdAt,
    displayPriority,
    accent,
  });
}

function bookItem(
  momentType: MemoryShelfMomentType,
  title: string,
  subtitle: string,
  book: MemoryShelfBookSnapshot,
  displayPriority: number,
  accent: MemoryShelfItem['accent'],
): MemoryShelfItem {
  return {
    id: `memory-shelf-${momentType}-${book.id}`,
    momentType,
    title,
    subtitle,
    bookId: book.id,
    bookTitle: book.title,
    bookAuthor: book.author,
    coverGradient: book.coverGradient,
    occurredAt: book.dateFinished ?? undefined,
    displayPriority,
    accent,
  };
}

function resolveSeasonalFavorite(
  books: MemoryShelfBookSnapshot[],
  now: Date,
): { book: MemoryShelfBookSnapshot; season: 'spring' | 'summer' | 'autumn' | 'winter' } | null {
  const currentSeason = seasonForMonth(now.getMonth());
  const candidates = books.filter((book) => {
    if (!book.dateFinished) return false;
    return seasonForMonth(new Date(`${book.dateFinished}T12:00:00`).getMonth()) === currentSeason;
  });

  const selected = [...candidates].sort((a, b) => {
    const favoriteDifference = Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite));
    if (favoriteDifference !== 0) return favoriteDifference;

    const ratingDifference = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDifference !== 0) return ratingDifference;

    return dateValue(b.dateFinished) - dateValue(a.dateFinished);
  })[0];

  return selected ? { book: selected, season: currentSeason } : null;
}

function deduplicateCandidates(items: MemoryShelfItem[]): MemoryShelfItem[] {
  const seenMoments = new Set<MemoryShelfMomentType>();
  const seenBooks = new Set<string>();

  return items.filter((item) => {
    if (seenMoments.has(item.momentType)) return false;

    const duplicateBook = item.bookId && seenBooks.has(item.bookId) && item.displayPriority < 90;
    if (duplicateBook) return false;

    seenMoments.add(item.momentType);
    if (item.bookId) seenBooks.add(item.bookId);
    return true;
  });
}

function seasonForMonth(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

function dateValue(value?: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
