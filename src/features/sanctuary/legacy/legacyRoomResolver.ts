export type LegacyVolumeType = 'year-in-books' | 'monthly-wrapped' | 'quarterly-wrapped';

export interface LegacyBookSnapshot {
  id: string;
  title: string;
  author: string;
  dateAdded?: string | null;
  dateFinished?: string | null;
  rating?: number | null;
  review?: string | null;
  favoriteQuotes?: string[];
  rereadCount?: number;
  isFavorite?: boolean;
}

export interface LegacySessionSnapshot {
  id: string;
  bookId: string;
  date: string;
  durationMinutes: number;
}

export interface LegacyVolumeSnapshot {
  id: string;
  type: LegacyVolumeType;
  year: number;
  month?: number | null;
  quarter?: number | null;
  createdAt: string;
  title?: string | null;
  coverGradient?: string | null;
}

export interface LegacyTimeCapsuleSnapshot {
  id: string;
  title: string;
  createdAt: string;
  openAt?: string | null;
  bookId?: string | null;
}

export interface LegacyPhotoSnapshot {
  id: string;
  createdAt: string;
  imageUrl?: string | null;
  caption?: string | null;
  bookId?: string | null;
}

export interface LegacyLumisSnapshot {
  name: string;
  hatchDay: string;
  growthStage: string;
  favoriteSleepingSpot?: string | null;
  firstGuardedBookId?: string | null;
}

export interface LegacyRoomContext {
  books: LegacyBookSnapshot[];
  sessions: LegacySessionSnapshot[];
  volumes: LegacyVolumeSnapshot[];
  timeCapsules: LegacyTimeCapsuleSnapshot[];
  photos: LegacyPhotoSnapshot[];
  lumis: LegacyLumisSnapshot;
  libraryCreatedAt?: string | null;
  currentDate?: Date;
}

export interface LegacyBookHighlight {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  bookId: string;
  occurredAt?: string;
}

export interface LegacyQuoteEntry {
  id: string;
  quote: string;
  bookId: string;
  bookTitle: string;
  author: string;
}

export interface LegacyRoomState {
  librarySince: string;
  yearsTogether: number;
  plaqueText: string;
  boundVolumes: LegacyVolumeSnapshot[];
  bookHighlights: LegacyBookHighlight[];
  timeCapsules: LegacyTimeCapsuleSnapshot[];
  framedPhotos: LegacyPhotoSnapshot[];
  guestBookQuotes: LegacyQuoteEntry[];
  lumisPortrait: {
    name: string;
    growthStage: string;
    caption: string;
  };
  timelineYears: number[];
}

export function resolveLegacyRoom(context: LegacyRoomContext): LegacyRoomState {
  const now = context.currentDate ?? new Date();
  const firstKnownDate = resolveFirstKnownDate(context, now);
  const yearsTogether = Math.max(0, fullYearsBetween(firstKnownDate, now));

  return {
    librarySince: firstKnownDate.toISOString(),
    yearsTogether,
    plaqueText: `This library has been lovingly cared for since ${formatMonthYear(firstKnownDate)}.`,
    boundVolumes: resolveBoundVolumes(context.volumes),
    bookHighlights: resolveBookHighlights(context),
    timeCapsules: [...context.timeCapsules]
      .sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt)),
    framedPhotos: [...context.photos]
      .sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt))
      .slice(0, 12),
    guestBookQuotes: resolveGuestBookQuotes(context.books),
    lumisPortrait: {
      name: context.lumis.name,
      growthStage: context.lumis.growthStage,
      caption: resolveLumisCaption(context),
    },
    timelineYears: resolveTimelineYears(context, firstKnownDate, now),
  };
}

function resolveBoundVolumes(volumes: LegacyVolumeSnapshot[]): LegacyVolumeSnapshot[] {
  const rank: Record<LegacyVolumeType, number> = {
    'year-in-books': 1,
    'quarterly-wrapped': 2,
    'monthly-wrapped': 3,
  };

  return [...volumes].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const typeDifference = rank[a.type] - rank[b.type];
    if (typeDifference !== 0) return typeDifference;
    return dateValue(a.createdAt) - dateValue(b.createdAt);
  });
}

function resolveBookHighlights(context: LegacyRoomContext): LegacyBookHighlight[] {
  const finished = context.books
    .filter((book) => Boolean(book.dateFinished))
    .sort((a, b) => dateValue(a.dateFinished) - dateValue(b.dateFinished));

  const highlights: LegacyBookHighlight[] = [];
  const firstFinished = finished[0];

  if (firstFinished) {
    highlights.push({
      id: `legacy-first-finished-${firstFinished.id}`,
      label: 'First Finished Book',
      title: firstFinished.title,
      subtitle: `The first story completed in Inkbound, by ${firstFinished.author}.`,
      bookId: firstFinished.id,
      occurredAt: firstFinished.dateFinished ?? undefined,
    });
  }

  const firstReviewed = finished.find((book) => Boolean(book.review?.trim()));
  if (firstReviewed) {
    highlights.push({
      id: `legacy-first-review-${firstReviewed.id}`,
      label: 'First Review',
      title: firstReviewed.title,
      subtitle: firstReviewed.review!.trim(),
      bookId: firstReviewed.id,
      occurredAt: firstReviewed.dateFinished ?? undefined,
    });
  }

  const mostReread = [...context.books]
    .filter((book) => (book.rereadCount ?? 0) > 0)
    .sort((a, b) => (b.rereadCount ?? 0) - (a.rereadCount ?? 0))[0];

  if (mostReread) {
    highlights.push({
      id: `legacy-most-reread-${mostReread.id}`,
      label: 'Most Reread',
      title: mostReread.title,
      subtitle: `Returned to ${mostReread.rereadCount} ${mostReread.rereadCount === 1 ? 'time' : 'times'}.`,
      bookId: mostReread.id,
      occurredAt: mostReread.dateFinished ?? undefined,
    });
  }

  const longestSession = [...context.sessions]
    .sort((a, b) => b.durationMinutes - a.durationMinutes)[0];

  if (longestSession) {
    const book = context.books.find((candidate) => candidate.id === longestSession.bookId);
    if (book) {
      highlights.push({
        id: `legacy-longest-session-${longestSession.id}`,
        label: 'Longest Reading Session',
        title: book.title,
        subtitle: `${longestSession.durationMinutes} uninterrupted minutes with ${book.author}.`,
        bookId: book.id,
        occurredAt: longestSession.date,
      });
    }
  }

  const favorite = [...context.books]
    .filter((book) => book.isFavorite)
    .sort((a, b) => dateValue(b.dateFinished) - dateValue(a.dateFinished))[0];

  if (favorite) {
    highlights.push({
      id: `legacy-favorite-${favorite.id}`,
      label: 'Beloved Story',
      title: favorite.title,
      subtitle: `A cherished place in the library, by ${favorite.author}.`,
      bookId: favorite.id,
      occurredAt: favorite.dateFinished ?? undefined,
    });
  }

  return deduplicateHighlights(highlights).slice(0, 8);
}

function resolveGuestBookQuotes(books: LegacyBookSnapshot[]): LegacyQuoteEntry[] {
  return books
    .flatMap((book) => (book.favoriteQuotes ?? []).map((quote, index) => ({
      id: `legacy-quote-${book.id}-${index}`,
      quote: quote.trim(),
      bookId: book.id,
      bookTitle: book.title,
      author: book.author,
    })))
    .filter((entry) => entry.quote.length > 0)
    .slice(0, 100);
}

function resolveLumisCaption(context: LegacyRoomContext): string {
  const firstGuardedBook = context.lumis.firstGuardedBookId
    ? context.books.find((book) => book.id === context.lumis.firstGuardedBookId)
    : undefined;

  if (firstGuardedBook) {
    return `${context.lumis.name}, now a ${context.lumis.growthStage}, first guarded ${firstGuardedBook.title}.`;
  }

  if (context.lumis.favoriteSleepingSpot) {
    return `${context.lumis.name}, ${context.lumis.growthStage}, still favors ${context.lumis.favoriteSleepingSpot.toLowerCase()}.`;
  }

  return `${context.lumis.name}, the ${context.lumis.growthStage} who has grown beside this library.`;
}

function resolveTimelineYears(
  context: LegacyRoomContext,
  firstKnownDate: Date,
  now: Date,
): number[] {
  const years = new Set<number>([firstKnownDate.getFullYear(), now.getFullYear()]);

  context.books.forEach((book) => {
    addYear(years, book.dateAdded);
    addYear(years, book.dateFinished);
  });
  context.sessions.forEach((session) => addYear(years, session.date));
  context.volumes.forEach((volume) => years.add(volume.year));
  context.timeCapsules.forEach((capsule) => addYear(years, capsule.createdAt));
  context.photos.forEach((photo) => addYear(years, photo.createdAt));
  addYear(years, context.lumis.hatchDay);

  return [...years].sort((a, b) => a - b);
}

function resolveFirstKnownDate(context: LegacyRoomContext, fallback: Date): Date {
  const values = [
    context.libraryCreatedAt,
    context.lumis.hatchDay,
    ...context.books.flatMap((book) => [book.dateAdded, book.dateFinished]),
    ...context.sessions.map((session) => session.date),
    ...context.volumes.map((volume) => volume.createdAt),
    ...context.timeCapsules.map((capsule) => capsule.createdAt),
    ...context.photos.map((photo) => photo.createdAt),
  ];

  const dates = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  return dates[0] ?? fallback;
}

function deduplicateHighlights(items: LegacyBookHighlight[]): LegacyBookHighlight[] {
  const seenLabels = new Set<string>();
  return items.filter((item) => {
    if (seenLabels.has(item.label)) return false;
    seenLabels.add(item.label);
    return true;
  });
}

function addYear(years: Set<number>, value?: string | null): void {
  if (!value) return;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) years.add(date.getFullYear());
}

function dateValue(value?: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function fullYearsBetween(start: Date, end: Date): number {
  let years = end.getFullYear() - start.getFullYear();
  const anniversary = new Date(end.getFullYear(), start.getMonth(), start.getDate());
  if (end < anniversary) years -= 1;
  return years;
}

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}
