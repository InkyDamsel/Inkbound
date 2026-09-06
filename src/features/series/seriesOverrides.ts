export const SERIES_OVERRIDES_STORAGE_KEY = 'inkbound_series_overrides_v1';

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
  return Number.isInteger(position) ? `Book ${position}` : `Book ${position}`;
};
