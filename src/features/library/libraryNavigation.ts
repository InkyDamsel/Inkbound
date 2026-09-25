import {
  notifyRuntimeStorageChanged,
  readRuntimeJson,
  removeRuntimeValue,
  writeRuntimeJson,
} from '../../platform/runtimeStorage';

export type LibrarySection = 'books' | 'series' | 'collections' | 'loans';

export const LIBRARY_SECTION_STORAGE_KEY = 'inkbound_library_section';
export const DEFAULT_LIBRARY_SECTION: LibrarySection = 'books';

const APP_TAB_STORAGE_KEY = 'inkbound_active_tab';
const SERIES_FOCUS_BOOK_STORAGE_KEY = 'inkbound_library_series_focus_book';

/**
 * Navigate into My Library > Series and remember which library item should be
 * revealed. Both App and LibraryScreen already consume these persistent keys,
 * so Book Details does not need a second navigation state or direct component
 * coupling.
 */
export function openLibrarySeriesForBook(bookId: string) {
  writeRuntimeJson(APP_TAB_STORAGE_KEY, 'library');
  writeRuntimeJson(LIBRARY_SECTION_STORAGE_KEY, 'series' satisfies LibrarySection);
  writeRuntimeJson(SERIES_FOCUS_BOOK_STORAGE_KEY, bookId);
  notifyRuntimeStorageChanged(APP_TAB_STORAGE_KEY);
  notifyRuntimeStorageChanged(LIBRARY_SECTION_STORAGE_KEY);
}

/** Read the pending Series deep-link without destroying it.
 * SeriesLibraryPanel clears it only after the target book has resolved to a
 * concrete series. This avoids losing navigation while the library is still
 * hydrating after the view changes.
 */
export function readLibrarySeriesFocusBookId(): string | null {
  return readRuntimeJson<string | null>(SERIES_FOCUS_BOOK_STORAGE_KEY, null);
}

export function clearLibrarySeriesFocusBookId(bookId?: string) {
  const current = readLibrarySeriesFocusBookId();
  if (!current || (bookId && current !== bookId)) return;
  removeRuntimeValue(SERIES_FOCUS_BOOK_STORAGE_KEY);
}
