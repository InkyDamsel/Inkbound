export type SanctuarySeason = 'spring' | 'summer' | 'autumn' | 'winter';

export type SanctuaryLightingStyle =
  | 'candlelight'
  | 'fireplace'
  | 'moonlight'
  | 'rainy-afternoon'
  | 'golden-hour';

export type SanctuaryWeather =
  | 'automatic'
  | 'clear'
  | 'rain'
  | 'snow'
  | 'thunderstorm';

export interface SanctuaryDecorationPlacement {
  id: string;
  itemId: string;
  surfaceId: string;
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  layer: number;
}

export interface LibrarySanctuary {
  schemaVersion: 1;
  wallStyleId: string;
  wallColorId: string;
  floorStyleId: string;
  windowStyleId: string;
  outdoorSceneId: string;
  shelfStyleId: string;
  lightingStyle: SanctuaryLightingStyle;
  fireplaceStyleId: string;
  rugStyleId: string;
  season: SanctuarySeason;
  weather: SanctuaryWeather;
  decorationPlacements: SanctuaryDecorationPlacement[];
  dragonFurnitureIds: string[];
  updatedAt: string;
}

export const DEFAULT_LIBRARY_SANCTUARY: LibrarySanctuary = {
  schemaVersion: 1,
  wallStyleId: 'quiet-plaster',
  wallColorId: 'deep-charcoal',
  floorStyleId: 'dark-oak',
  windowStyleId: 'arched-library-window',
  outdoorSceneId: 'rainy-garden',
  shelfStyleId: 'walnut',
  lightingStyle: 'rainy-afternoon',
  fireplaceStyleId: 'small-stone-hearth',
  rugStyleId: 'dusty-plum-woven',
  season: 'autumn',
  weather: 'automatic',
  decorationPlacements: [],
  dragonFurnitureIds: ['lumis-book-nest'],
  updatedAt: new Date(0).toISOString(),
};

export function normalizeLibrarySanctuary(
  value: Partial<LibrarySanctuary> | null | undefined,
): LibrarySanctuary {
  return {
    ...DEFAULT_LIBRARY_SANCTUARY,
    ...value,
    schemaVersion: 1,
    decorationPlacements: Array.isArray(value?.decorationPlacements)
      ? value.decorationPlacements
      : [],
    dragonFurnitureIds: Array.isArray(value?.dragonFurnitureIds)
      ? value.dragonFurnitureIds
      : DEFAULT_LIBRARY_SANCTUARY.dragonFurnitureIds,
  };
}
