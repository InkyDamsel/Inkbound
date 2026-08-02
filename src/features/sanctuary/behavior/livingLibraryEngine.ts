import {
  LumisBehavior,
  LumisReadingContext,
  getLumisTimeOfDay,
  resolveLumisBehavior,
} from './lumisBehaviorResolver';
import { LibrarySanctuary } from '../model/librarySanctuary';

export type LivingLibraryMotionMode = 'full' | 'reduced' | 'static';

export interface LivingLibraryPreferences {
  motionMode: LivingLibraryMotionMode;
  ambientEffectsEnabled: boolean;
  ambientSoundEnabled: boolean;
}

export interface LivingLibraryContext {
  sanctuary: LibrarySanctuary;
  reading: LumisReadingContext;
  preferences: LivingLibraryPreferences;
  now?: Date;
}

export interface AmbientLayerState {
  enabled: boolean;
  intensity: number;
  motionKey: string;
  intervalSeconds: number;
}

export interface LivingLibrarySceneState {
  lumis: LumisBehavior;
  candlelight: AmbientLayerState;
  fireplace: AmbientLayerState;
  windowWeather: AmbientLayerState;
  dustMotes: AmbientLayerState;
  curtains: AmbientLayerState;
  shelfLife: AmbientLayerState;
  roomTone: 'cool' | 'neutral' | 'warm';
  soundscape: 'none' | 'rain' | 'fireplace' | 'rain-and-fire' | 'winter-hush';
  nextRefreshAt: string;
}

export function resolveLivingLibraryScene(
  context: LivingLibraryContext,
): LivingLibrarySceneState {
  const now = context.now ?? new Date();
  const motionScale = motionScaleFor(context.preferences.motionMode);
  const ambientEnabled = context.preferences.ambientEffectsEnabled;
  const effectiveWeather = resolveWeather(context.sanctuary);
  const timeOfDay = getLumisTimeOfDay(now);

  const lumis = resolveLumisBehavior({
    environment: {
      timeOfDay,
      weather: context.sanctuary.weather,
      season: context.sanctuary.season,
    },
    reading: context.reading,
    availableFurnitureIds: context.sanctuary.dragonFurnitureIds,
    reducedMotion: context.preferences.motionMode !== 'full',
  });

  const candlelightActive = ambientEnabled && (
    context.sanctuary.lightingStyle === 'candlelight'
    || timeOfDay === 'evening'
    || timeOfDay === 'night'
  );

  const fireplaceActive = ambientEnabled && (
    context.sanctuary.lightingStyle === 'fireplace'
    || timeOfDay === 'evening'
    || timeOfDay === 'night'
    || effectiveWeather === 'snow'
  );

  const rainy = effectiveWeather === 'rain' || effectiveWeather === 'thunderstorm';
  const snowy = effectiveWeather === 'snow';
  const sunny = effectiveWeather === 'clear';

  return {
    lumis,
    candlelight: layer(
      candlelightActive,
      0.55,
      context.preferences.motionMode === 'static' ? 'candle-static' : 'candle-flicker',
      5,
      motionScale,
    ),
    fireplace: layer(
      fireplaceActive,
      snowy ? 0.9 : 0.7,
      context.preferences.motionMode === 'static' ? 'fire-static' : 'fire-glow',
      6,
      motionScale,
    ),
    windowWeather: layer(
      ambientEnabled && (rainy || snowy),
      effectiveWeather === 'thunderstorm' ? 0.9 : 0.65,
      weatherMotionKey(effectiveWeather, context.preferences.motionMode),
      effectiveWeather === 'thunderstorm' ? 4 : 8,
      motionScale,
    ),
    dustMotes: layer(
      ambientEnabled && sunny,
      0.28,
      context.preferences.motionMode === 'static' ? 'dust-static' : 'dust-drift',
      14,
      motionScale,
    ),
    curtains: layer(
      ambientEnabled && effectiveWeather !== 'thunderstorm',
      0.2,
      context.preferences.motionMode === 'static' ? 'curtain-static' : 'curtain-sway',
      18,
      motionScale,
    ),
    shelfLife: layer(
      ambientEnabled && context.reading.finishedBookCount > 0,
      0.18,
      context.preferences.motionMode === 'static' ? 'shelf-static' : 'page-settle',
      32,
      motionScale,
    ),
    roomTone: resolveRoomTone(context.sanctuary, timeOfDay, effectiveWeather),
    soundscape: resolveSoundscape(
      context.preferences.ambientSoundEnabled,
      rainy,
      snowy,
      fireplaceActive,
    ),
    nextRefreshAt: nextRefresh(now).toISOString(),
  };
}

function layer(
  enabled: boolean,
  intensity: number,
  motionKey: string,
  intervalSeconds: number,
  motionScale: number,
): AmbientLayerState {
  return {
    enabled,
    intensity: enabled ? intensity * motionScale : 0,
    motionKey,
    intervalSeconds: Math.round(intervalSeconds / Math.max(motionScale, 0.25)),
  };
}

function motionScaleFor(mode: LivingLibraryMotionMode): number {
  switch (mode) {
    case 'full':
      return 1;
    case 'reduced':
      return 0.45;
    case 'static':
      return 0;
  }
}

function resolveWeather(
  sanctuary: LibrarySanctuary,
): Exclude<LibrarySanctuary['weather'], 'automatic'> {
  if (sanctuary.weather !== 'automatic') return sanctuary.weather;

  switch (sanctuary.season) {
    case 'winter':
      return 'snow';
    case 'spring':
    case 'autumn':
      return 'rain';
    case 'summer':
      return 'clear';
  }
}

function weatherMotionKey(
  weather: Exclude<LibrarySanctuary['weather'], 'automatic'>,
  mode: LivingLibraryMotionMode,
): string {
  if (mode === 'static') return `${weather}-static`;

  switch (weather) {
    case 'rain':
      return 'rain-streaks';
    case 'snow':
      return 'snow-drift';
    case 'thunderstorm':
      return 'storm-rain';
    case 'clear':
      return 'window-still';
  }
}

function resolveRoomTone(
  sanctuary: LibrarySanctuary,
  timeOfDay: ReturnType<typeof getLumisTimeOfDay>,
  weather: Exclude<LibrarySanctuary['weather'], 'automatic'>,
): LivingLibrarySceneState['roomTone'] {
  if (
    sanctuary.lightingStyle === 'fireplace'
    || sanctuary.lightingStyle === 'candlelight'
    || sanctuary.lightingStyle === 'golden-hour'
    || timeOfDay === 'evening'
  ) {
    return 'warm';
  }

  if (
    sanctuary.lightingStyle === 'moonlight'
    || weather === 'rain'
    || weather === 'snow'
    || timeOfDay === 'night'
  ) {
    return 'cool';
  }

  return 'neutral';
}

function resolveSoundscape(
  enabled: boolean,
  rainy: boolean,
  snowy: boolean,
  fireplaceActive: boolean,
): LivingLibrarySceneState['soundscape'] {
  if (!enabled) return 'none';
  if (snowy) return fireplaceActive ? 'fireplace' : 'winter-hush';
  if (rainy && fireplaceActive) return 'rain-and-fire';
  if (rainy) return 'rain';
  if (fireplaceActive) return 'fireplace';
  return 'none';
}

function nextRefresh(now: Date): Date {
  const next = new Date(now);
  next.setMinutes(next.getMinutes() + 15, 0, 0);
  return next;
}
