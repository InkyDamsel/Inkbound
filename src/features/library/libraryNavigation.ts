import {
  notifyRuntimeStorageChanged,
  readRuntimeJson,
  removeRuntimeValue,
  writeRuntimeJson,
} from '../../platform/runtimeStorage';

export type LibrarySection = 'books' | 'series' | 'collections';

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

/** One-shot target consumed by SeriesLibraryPanel after the Series view opens. */
export function consumeLibrarySeriesFocusBookId(): string | null {
  const bookId = readRuntimeJson<string | null>(SERIES_FOCUS_BOOK_STORAGE_KEY, null);
  if (bookId) removeRuntimeValue(SERIES_FOCUS_BOOK_STORAGE_KEY);
  return bookId;
}
