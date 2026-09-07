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

export const normalizeSeriesPositionLabel = (position: number | null, label?: string) => {
  const custom = label?.trim();
  if (custom) return custom;
  if (typeof position !== 'number' || !Number.isFinite(position)) return 'Series book';
  return `Book ${position}`;
};
