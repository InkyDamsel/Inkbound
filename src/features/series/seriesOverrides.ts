import { readRuntimeJson } from '../../platform/runtimeStorage';
import type { UserBookRecord } from '../../types';
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

export const readSeriesOverrides = (): SeriesOverrides =>
  readRuntimeJson<SeriesOverrides>(SERIES_OVERRIDES_STORAGE_KEY, {});

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


/**
 * Folds the retired manual-series store into canonical UserBookRecord.work
 * fields. Newest manual assignment wins when legacy data placed one book into
 * multiple overrides.
 */
export const migrateSeriesOverridesToCanonicalBooks = (
  books: UserBookRecord[],
  overrides: SeriesOverrides,
): { books: UserBookRecord[]; migratedBookIds: string[] } => {
  const assignmentByBookId = new Map<string, { override: SeriesOverride; entry: SeriesBookOverride }>();
  for (const override of orderedSeriesOverrides(overrides)) {
    for (const entry of override.books) {
      if (!assignmentByBookId.has(entry.bookId)) assignmentByBookId.set(entry.bookId, { override, entry });
    }
  }

  const migratedBookIds: string[] = [];
  const migrated = books.map((book) => {
    const assignment = assignmentByBookId.get(book.id);
    if (!assignment) return book;
    // Canonical manual intent is newer/stronger than any retired override store.
    // Legacy migration may fill missing/metadata series state, never roll back a
    // correction the reader already made in the canonical book record.
    if (book.work.seriesSource === 'manual') {
      migratedBookIds.push(book.id);
      return book;
    }
    const { override, entry } = assignment;
    migratedBookIds.push(book.id);
    return {
      ...book,
      work: {
        ...book.work,
        seriesName: override.name.trim(),
        seriesOrder: typeof entry.position === 'number' && Number.isFinite(entry.position)
          ? entry.position
          : undefined,
        seriesLabel: entry.label?.trim() || undefined,
        seriesSource: 'manual' as const,
      },
    };
  });

  return { books: migrated, migratedBookIds };
};
