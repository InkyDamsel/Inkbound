import { ACCOUNT_DATA_STORAGE_KEYS } from '../sync/storageKeys';

export const SERIES_OVERRIDES_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.seriesOverrides;

export interface SeriesBookOverride {
  bookId: string;
  position: number | null;
  label?: string;
}

export interface SeriesOverride {
  id: string;
  name: string;
  author: string;
  books: SeriesBookOverride[];
  createdAt: string;
  updatedAt: string;
}

export type SeriesOverrides = Record<string, SeriesOverride>;

export const makeSeriesOverrideId = (name: string, author: string) =>
  `series-${name}::${author}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Manual series corrections are user intent, so the newest correction wins if
 * legacy data accidentally assigns one item to more than one manual series.
 * All Series consumers should use this order instead of relying on object key
 * insertion order, which can differ after sync/export/import round trips.
 */
export const orderedSeriesOverrides = (overrides: SeriesOverrides): SeriesOverride[] =>
  Object.values(overrides).sort((a, b) => {
    const updatedDifference = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (Number.isFinite(updatedDifference) && updatedDifference !== 0) return updatedDifference;
    const createdDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (Number.isFinite(createdDifference) && createdDifference !== 0) return createdDifference;
    return a.id.localeCompare(b.id);
  });

export const normalizeSeriesPositionLabel = (position: number | null, label?: string) => {
  const custom = label?.trim();
  if (custom) return custom;
  if (typeof position !== 'number' || !Number.isFinite(position)) return 'Series book';
  return `Book ${position}`;
};
