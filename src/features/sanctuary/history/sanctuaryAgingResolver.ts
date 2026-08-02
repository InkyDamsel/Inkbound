export type SanctuaryAgeStage =
  | 'new-library'
  | 'lived-in-library'
  | 'cherished-library'
  | 'heirloom-library';

export interface SanctuaryAgingBookSnapshot {
  id: string;
  dateAdded?: string | null;
  dateFinished?: string | null;
  rating?: number | null;
  isFavorite?: boolean;
}

export interface SanctuaryAgingSessionSnapshot {
  id: string;
  date: string;
  durationMinutes: number;
}

export interface SanctuaryAgingMemorySnapshot {
  id: string;
  createdAt: string;
  type: 'photo' | 'time-capsule' | 'wrapped' | 'quote' | 'dragon-keepsake';
}

export interface SanctuaryAgingContext {
  books: SanctuaryAgingBookSnapshot[];
  sessions: SanctuaryAgingSessionSnapshot[];
  memories: SanctuaryAgingMemorySnapshot[];
  sanctuaryCreatedAt?: string | null;
  currentDate?: Date;
}

export interface SanctuaryAgingState {
  stage: SanctuaryAgeStage;
  yearsTogether: number;
  finishedBookCount: number;
  readingSessionCount: number;
  memoryCount: number;
  shelfFillLevel: number;
  plantGrowthLevel: number;
  chairWearLevel: number;
  blanketVisible: boolean;
  keepsakeCount: number;
  candleCount: number;
  mantelKeepsakes: string[];
  returningSeasonalTouches: string[];
  descriptiveLabel: string;
}

export function resolveSanctuaryAging(
  context: SanctuaryAgingContext,
): SanctuaryAgingState {
  const now = context.currentDate ?? new Date();
  const firstKnownDate = resolveFirstKnownDate(context, now);
  const yearsTogether = Math.max(0, fullYearsBetween(firstKnownDate, now));
  const finishedBooks = context.books.filter((book) => Boolean(book.dateFinished));
  const favoriteBooks = context.books.filter((book) => book.isFavorite);
  const wrappedCount = context.memories.filter((memory) => memory.type === 'wrapped').length;
  const photoCount = context.memories.filter((memory) => memory.type === 'photo').length;
  const timeCapsuleCount = context.memories.filter((memory) => memory.type === 'time-capsule').length;
  const dragonKeepsakeCount = context.memories.filter((memory) => memory.type === 'dragon-keepsake').length;
  const totalReadingMinutes = context.sessions.reduce(
    (sum, session) => sum + Math.max(0, session.durationMinutes),
    0,
  );

  const stage = resolveStage(
    yearsTogether,
    finishedBooks.length,
    context.memories.length,
  );

  const shelfFillLevel = clamp(
    Math.floor(finishedBooks.length / 12) + yearsTogether,
    0,
    10,
  );

  const plantGrowthLevel = clamp(
    yearsTogether + Math.floor(context.sessions.length / 100),
    0,
    5,
  );

  const chairWearLevel = clamp(
    Math.floor(totalReadingMinutes / 6000),
    0,
    5,
  );

  const blanketVisible =
    yearsTogether >= 1
    || totalReadingMinutes >= 3000
    || favoriteBooks.length >= 3;

  const candleCount = clamp(
    1 + wrappedCount + Math.floor(finishedBooks.length / 50),
    1,
    8,
  );

  const keepsakeCount = clamp(
    photoCount
      + timeCapsuleCount
      + wrappedCount
      + dragonKeepsakeCount,
    0,
    12,
  );

  return {
    stage,
    yearsTogether,
    finishedBookCount: finishedBooks.length,
    readingSessionCount: context.sessions.length,
    memoryCount: context.memories.length,
    shelfFillLevel,
    plantGrowthLevel,
    chairWearLevel,
    blanketVisible,
    keepsakeCount,
    candleCount,
    mantelKeepsakes: resolveMantelKeepsakes({
      wrappedCount,
      photoCount,
      timeCapsuleCount,
      dragonKeepsakeCount,
      favoriteBookCount: favoriteBooks.length,
    }),
    returningSeasonalTouches: resolveReturningSeasonalTouches(
      context.sessions,
      yearsTogether,
    ),
    descriptiveLabel: descriptiveLabelFor(stage),
  };
}

function resolveFirstKnownDate(
  context: SanctuaryAgingContext,
  fallback: Date,
): Date {
  const candidates = [
    context.sanctuaryCreatedAt,
    ...context.books.flatMap((book) => [book.dateAdded, book.dateFinished]),
    ...context.sessions.map((session) => session.date),
    ...context.memories.map((memory) => memory.createdAt),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  return candidates[0] ?? fallback;
}

function resolveStage(
  yearsTogether: number,
  finishedBookCount: number,
  memoryCount: number,
): SanctuaryAgeStage {
  if (yearsTogether >= 7 || finishedBookCount >= 500 || memoryCount >= 250) {
    return 'heirloom-library';
  }

  if (yearsTogether >= 3 || finishedBookCount >= 150 || memoryCount >= 75) {
    return 'cherished-library';
  }

  if (yearsTogether >= 1 || finishedBookCount >= 30 || memoryCount >= 15) {
    return 'lived-in-library';
  }

  return 'new-library';
}

function resolveMantelKeepsakes(input: {
  wrappedCount: number;
  photoCount: number;
  timeCapsuleCount: number;
  dragonKeepsakeCount: number;
  favoriteBookCount: number;
}): string[] {
  const keepsakes: string[] = [];

  if (input.wrappedCount > 0) keepsakes.push('wrapped-book');
  if (input.photoCount > 0) keepsakes.push('framed-reading-photo');
  if (input.timeCapsuleCount > 0) keepsakes.push('sealed-letter');
  if (input.dragonKeepsakeCount > 0) keepsakes.push('lumis-keepsake');
  if (input.favoriteBookCount >= 3) keepsakes.push('favorite-book-marker');

  return keepsakes.slice(0, 5);
}

function resolveReturningSeasonalTouches(
  sessions: SanctuaryAgingSessionSnapshot[],
  yearsTogether: number,
): string[] {
  if (yearsTogether < 1) return [];

  const yearsBySeason = new Map<string, Set<number>>();

  sessions.forEach((session) => {
    const date = new Date(session.date);
    if (Number.isNaN(date.getTime())) return;

    const season = seasonForMonth(date.getMonth());
    const years = yearsBySeason.get(season) ?? new Set<number>();
    years.add(date.getFullYear());
    yearsBySeason.set(season, years);
  });

  return [...yearsBySeason.entries()]
    .filter(([, years]) => years.size >= 2)
    .map(([season]) => `${season}-returning-touch`)
    .sort();
}

function seasonForMonth(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

function descriptiveLabelFor(stage: SanctuaryAgeStage): string {
  switch (stage) {
    case 'new-library':
      return 'A young sanctuary waiting to be filled with stories.';
    case 'lived-in-library':
      return 'A warmly lived-in library shaped by familiar reading rituals.';
    case 'cherished-library':
      return 'A cherished sanctuary rich with books, memories, and quiet traditions.';
    case 'heirloom-library':
      return 'An heirloom library carrying years of stories and a lifetime of meaning.';
  }
}

function fullYearsBetween(start: Date, end: Date): number {
  let years = end.getFullYear() - start.getFullYear();
  const anniversary = new Date(
    end.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );

  if (end < anniversary) years -= 1;
  return years;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
