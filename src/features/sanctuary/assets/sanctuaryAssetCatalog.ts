import { SanctuarySeason } from '../model/librarySanctuary';

export type SanctuaryAssetCategory =
  | 'wall'
  | 'floor'
  | 'window'
  | 'outdoor-scene'
  | 'shelf'
  | 'fireplace'
  | 'rug'
  | 'lighting'
  | 'decoration'
  | 'dragon-furniture';

export type SanctuaryAssetAccess = 'free' | 'premium';

export type SanctuaryPlacementSurface =
  | 'room'
  | 'wall'
  | 'floor'
  | 'shelf'
  | 'table'
  | 'window'
  | 'fireplace';

export type SanctuaryUnlockRequirement =
  | { type: 'default' }
  | { type: 'finished-books'; count: number }
  | { type: 'genre-books'; genre: string; count: number }
  | { type: 'completed-wrapped'; count: number }
  | { type: 'reading-season'; season: SanctuarySeason }
  | { type: 'premium' };

export interface SanctuaryAssetDefinition {
  id: string;
  displayName: string;
  description: string;
  category: SanctuaryAssetCategory;
  access: SanctuaryAssetAccess;
  unlockRequirement: SanctuaryUnlockRequirement;
  supportedSeasons: SanctuarySeason[];
  placementSurfaces: SanctuaryPlacementSurface[];
  assetPath: string;
  previewPath: string;
  sortOrder: number;
  tags: string[];
}

const ALL_SEASONS: SanctuarySeason[] = [
  'spring',
  'summer',
  'autumn',
  'winter',
];

export const SANCTUARY_ASSET_CATALOG: readonly SanctuaryAssetDefinition[] = [
  {
    id: 'quiet-plaster',
    displayName: 'Quiet Plaster',
    description: 'Softly textured charcoal walls for a calm, timeless library.',
    category: 'wall',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['room'],
    assetPath: '/assets/sanctuary/walls/quiet-plaster.webp',
    previewPath: '/assets/sanctuary/previews/walls/quiet-plaster.webp',
    sortOrder: 10,
    tags: ['charcoal', 'classic', 'calm'],
  },
  {
    id: 'dark-oak',
    displayName: 'Dark Oak Floor',
    description: 'Warm, worn floorboards suited to long evenings beside the fire.',
    category: 'floor',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['room'],
    assetPath: '/assets/sanctuary/floors/dark-oak.webp',
    previewPath: '/assets/sanctuary/previews/floors/dark-oak.webp',
    sortOrder: 20,
    tags: ['wood', 'warm', 'classic'],
  },
  {
    id: 'arched-library-window',
    displayName: 'Arched Library Window',
    description: 'A tall window made for watching rain move across the garden.',
    category: 'window',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['wall'],
    assetPath: '/assets/sanctuary/windows/arched-library-window.webp',
    previewPath: '/assets/sanctuary/previews/windows/arched-library-window.webp',
    sortOrder: 30,
    tags: ['rain', 'arched', 'garden'],
  },
  {
    id: 'rainy-garden',
    displayName: 'Rainy Garden',
    description: 'A quiet garden softened by steady rain and muted evening light.',
    category: 'outdoor-scene',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['window'],
    assetPath: '/assets/sanctuary/scenes/rainy-garden.webp',
    previewPath: '/assets/sanctuary/previews/scenes/rainy-garden.webp',
    sortOrder: 40,
    tags: ['rain', 'garden', 'moody'],
  },
  {
    id: 'walnut',
    displayName: 'Walnut Shelves',
    description: 'Deep walnut shelves with a gentle sheen and old-library warmth.',
    category: 'shelf',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['wall'],
    assetPath: '/assets/sanctuary/shelves/walnut.webp',
    previewPath: '/assets/sanctuary/previews/shelves/walnut.webp',
    sortOrder: 50,
    tags: ['wood', 'dark', 'library'],
  },
  {
    id: 'small-stone-hearth',
    displayName: 'Small Stone Hearth',
    description: 'A modest fireplace that fills the room with a low amber glow.',
    category: 'fireplace',
    access: 'free',
    unlockRequirement: { type: 'finished-books', count: 10 },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['floor', 'wall'],
    assetPath: '/assets/sanctuary/fireplaces/small-stone-hearth.webp',
    previewPath: '/assets/sanctuary/previews/fireplaces/small-stone-hearth.webp',
    sortOrder: 60,
    tags: ['fire', 'stone', 'cozy'],
  },
  {
    id: 'dusty-plum-woven',
    displayName: 'Dusty Plum Woven Rug',
    description: 'A muted plum rug that softens the center of the room.',
    category: 'rug',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['floor'],
    assetPath: '/assets/sanctuary/rugs/dusty-plum-woven.webp',
    previewPath: '/assets/sanctuary/previews/rugs/dusty-plum-woven.webp',
    sortOrder: 70,
    tags: ['plum', 'woven', 'soft'],
  },
  {
    id: 'pressed-flower-frame',
    displayName: 'Pressed Flower Frame',
    description: 'A delicate frame preserving flowers from a remembered season.',
    category: 'decoration',
    access: 'free',
    unlockRequirement: { type: 'reading-season', season: 'spring' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['wall', 'shelf'],
    assetPath: '/assets/sanctuary/decor/pressed-flower-frame.webp',
    previewPath: '/assets/sanctuary/previews/decor/pressed-flower-frame.webp',
    sortOrder: 80,
    tags: ['flowers', 'memory', 'gentle'],
  },
  {
    id: 'antique-globe',
    displayName: 'Antique Globe',
    description: 'A small globe for readers who have travelled through many worlds.',
    category: 'decoration',
    access: 'premium',
    unlockRequirement: { type: 'premium' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['floor', 'table'],
    assetPath: '/assets/sanctuary/decor/antique-globe.webp',
    previewPath: '/assets/sanctuary/previews/decor/antique-globe.webp',
    sortOrder: 90,
    tags: ['travel', 'vintage', 'worlds'],
  },
  {
    id: 'lumis-book-nest',
    displayName: 'Lumis Book Nest',
    description: 'A soft nest of cushions and old books made especially for Lumis.',
    category: 'dragon-furniture',
    access: 'free',
    unlockRequirement: { type: 'default' },
    supportedSeasons: ALL_SEASONS,
    placementSurfaces: ['floor'],
    assetPath: '/assets/sanctuary/dragon/lumis-book-nest.webp',
    previewPath: '/assets/sanctuary/previews/dragon/lumis-book-nest.webp',
    sortOrder: 100,
    tags: ['lumis', 'nest', 'books'],
  },
] as const;

export function getSanctuaryAsset(
  id: string,
): SanctuaryAssetDefinition | undefined {
  return SANCTUARY_ASSET_CATALOG.find((asset) => asset.id === id);
}

export function getSanctuaryAssetsByCategory(
  category: SanctuaryAssetCategory,
): SanctuaryAssetDefinition[] {
  return SANCTUARY_ASSET_CATALOG
    .filter((asset) => asset.category === category)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isSanctuaryAssetAvailableForSeason(
  asset: SanctuaryAssetDefinition,
  season: SanctuarySeason,
): boolean {
  return asset.supportedSeasons.includes(season);
}
