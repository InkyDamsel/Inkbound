import { SanctuarySeason, SanctuaryWeather } from '../model/librarySanctuary';

export type LumisTimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export type LumisActivity =
  | 'sleeping'
  | 'reading'
  | 'watching-rain'
  | 'warming-by-fire'
  | 'resting-under-blanket'
  | 'sitting-by-window'
  | 'guarding-books'
  | 'stretching-after-reading';

export type LumisLocation =
  | 'book-nest'
  | 'window-perch'
  | 'fireplace-rug'
  | 'reading-chair'
  | 'newest-finished-book'
  | 'lower-shelf';

export interface LumisReadingContext {
  favoriteGenre?: string | null;
  finishedBookCount: number;
  longestSessionMinutes?: number | null;
  recentSessionMinutes?: number | null;
  hasFavoriteBook: boolean;
  recentlyFinishedBook: boolean;
}

export interface LumisEnvironmentContext {
  timeOfDay: LumisTimeOfDay;
  weather: SanctuaryWeather;
  season: SanctuarySeason;
}

export interface LumisBehaviorContext {
  environment: LumisEnvironmentContext;
  reading: LumisReadingContext;
  availableFurnitureIds: string[];
  reducedMotion: boolean;
}

export interface LumisBehavior {
  activity: LumisActivity;
  location: LumisLocation;
  reason: string;
  motionKey: string;
  ambientEffect: 'none' | 'fire-glow' | 'rain-window' | 'snow-window' | 'soft-sparkles';
}

export function resolveLumisBehavior(context: LumisBehaviorContext): LumisBehavior {
  const { environment, reading } = context;
  const effectiveWeather = resolveEffectiveWeather(environment.weather, environment.season);

  if (effectiveWeather === 'thunderstorm') {
    return behavior(
      'resting-under-blanket',
      hasFurniture(context, 'lumis-book-nest') ? 'book-nest' : 'fireplace-rug',
      'Thunder is rolling beyond the library windows.',
      context.reducedMotion ? 'rest-static' : 'blanket-breathing',
      'rain-window',
    );
  }

  if (effectiveWeather === 'snow') {
    return behavior(
      'warming-by-fire',
      'fireplace-rug',
      'Snow has drawn Lumis closer to the hearth.',
      context.reducedMotion ? 'rest-static' : 'fireplace-doze',
      'snow-window',
    );
  }

  if (effectiveWeather === 'rain') {
    return behavior(
      'watching-rain',
      hasFurniture(context, 'window-perch') ? 'window-perch' : 'reading-chair',
      'Rain is tapping softly against the glass.',
      context.reducedMotion ? 'watch-static' : 'tail-sway',
      'rain-window',
    );
  }

  if ((reading.recentSessionMinutes ?? 0) >= 90) {
    return behavior(
      'stretching-after-reading',
      'reading-chair',
      'A long reading session has just ended.',
      context.reducedMotion ? 'stretch-static' : 'slow-stretch',
      'soft-sparkles',
    );
  }

  if (reading.recentlyFinishedBook) {
    return behavior(
      'guarding-books',
      'newest-finished-book',
      'A newly finished story has joined the library.',
      context.reducedMotion ? 'guard-static' : 'book-nuzzle',
      'soft-sparkles',
    );
  }

  if (environment.timeOfDay === 'morning') {
    return behavior(
      'sleeping',
      hasFurniture(context, 'lumis-book-nest') ? 'book-nest' : 'lower-shelf',
      'The library is still waking up.',
      context.reducedMotion ? 'sleep-static' : 'slow-breathing',
      'none',
    );
  }

  if (environment.timeOfDay === 'afternoon') {
    return behavior(
      'reading',
      'reading-chair',
      genreReason(reading.favoriteGenre),
      context.reducedMotion ? 'read-static' : 'page-turn',
      'none',
    );
  }

  if (environment.timeOfDay === 'evening') {
    return behavior(
      'warming-by-fire',
      'fireplace-rug',
      'Evening has settled over the shelves.',
      context.reducedMotion ? 'rest-static' : 'fireplace-doze',
      'fire-glow',
    );
  }

  if (reading.hasFavoriteBook) {
    return behavior(
      'guarding-books',
      'newest-finished-book',
      'Lumis has chosen a beloved story to guard tonight.',
      context.reducedMotion ? 'guard-static' : 'book-nuzzle',
      'none',
    );
  }

  return behavior(
    'sleeping',
    hasFurniture(context, 'lumis-book-nest') ? 'book-nest' : 'fireplace-rug',
    'The library has gone quiet for the night.',
    context.reducedMotion ? 'sleep-static' : 'slow-breathing',
    'fire-glow',
  );
}

export function getLumisTimeOfDay(date: Date = new Date()): LumisTimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function resolveEffectiveWeather(
  weather: SanctuaryWeather,
  season: SanctuarySeason,
): Exclude<SanctuaryWeather, 'automatic'> {
  if (weather !== 'automatic') return weather;

  if (season === 'winter') return 'snow';
  if (season === 'autumn' || season === 'spring') return 'rain';
  return 'clear';
}

function hasFurniture(context: LumisBehaviorContext, fragment: string): boolean {
  return context.availableFurnitureIds.some((id) => id.includes(fragment));
}

function genreReason(favoriteGenre?: string | null): string {
  if (!favoriteGenre) return 'Lumis has found a small book for the afternoon.';

  const normalized = favoriteGenre.toLowerCase();
  if (normalized.includes('horror')) return 'A shadowy story has caught Lumis’s attention.';
  if (normalized.includes('mystery')) return 'Lumis is quietly investigating a curious story.';
  if (normalized.includes('cozy')) return 'A gentle story and a soft chair make a perfect afternoon.';
  if (normalized.includes('fantasy')) return 'Lumis is reading about faraway kingdoms and impossible creatures.';

  return `Lumis is spending the afternoon with a ${favoriteGenre} story.`;
}

function behavior(
  activity: LumisActivity,
  location: LumisLocation,
  reason: string,
  motionKey: string,
  ambientEffect: LumisBehavior['ambientEffect'],
): LumisBehavior {
  return { activity, location, reason, motionKey, ambientEffect };
}
