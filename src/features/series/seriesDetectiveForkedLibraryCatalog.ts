/** Detective-only adapter for the isolated snapshot of Add Reading Material search.
 * This module never imports library mutation actions, Firestore writes, or UI state.
 * A provider's failure is not evidence that a series is empty.
 */
import { searchGoogleBooks as searchDetectiveForkedCatalog } from './seriesDetectiveSearchFork';
import type { SeriesDetectiveWorkGroup } from './seriesDetectiveCatalogTypes';
import type { BookSearchWorkGroup } from '../book-search/model/bookSearch';

export interface DetectiveForkedSearchResult {
  groups: SeriesDetectiveWorkGroup[];
  totalItems: number;
  partial: boolean;
  warning?: string;
}

const toDetectiveWork = (group: BookSearchWorkGroup): SeriesDetectiveWorkGroup | null => {
  // Trusted community catalog records are intentionally excluded here until
  // their provenance can be represented in the Detective source type.
  const editions = group.editions.filter((edition) => edition.source !== 'inkbound-catalog').map((edition) => ({
    ...edition,
    source: edition.source as 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house',
  }));
  if (!editions.length) return null;
  return { ...group, editions };
};

export async function searchDetectiveForkedLibraryCatalog(
  query: string,
  signal?: AbortSignal,
): Promise<DetectiveForkedSearchResult> {
  const response = await searchDetectiveForkedCatalog(query, signal);
  return {
    groups: response.groups.map(toDetectiveWork).filter((group): group is SeriesDetectiveWorkGroup => group !== null),
    totalItems: response.totalItems,
    partial: response.partial ?? false,
    warning: response.warning,
  };
}
