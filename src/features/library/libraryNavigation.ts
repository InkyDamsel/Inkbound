import { DEVICE_STORAGE_KEYS } from '../sync/storageKeys';
import {
  notifyRuntimeStorageChanged,
  readRuntimeJson,
  removeRuntimeValue,
  writeRuntimeJson,
} from '../../platform/runtimeStorage';

export type LibrarySection = 'books' | 'series' | 'collections' | 'loans';

export const LIBRARY_SECTION_STORAGE_KEY = 'inkbound_library_section';
export const DEFAULT_LIBRARY_SECTION: LibrarySection = 'books';

const APP_TAB_STORAGE_KEY = DEVICE_STORAGE_KEYS.activeTab;
const SERIES_FOCUS_TARGET_STORAGE_KEY = 'inkbound_library_series_focus_target';
const LEGACY_SERIES_FOCUS_BOOK_STORAGE_KEY = 'inkbound_library_series_focus_book';

export interface LibrarySeriesFocusTarget {
  bookId: string;
  seriesName?: string;
  author?: string;
}

/**
 * Navigate into My Library > Series and remember the exact series that should
 * be revealed. The book id remains as a fallback for older/manual groupings,
 * but the canonical navigation target is the series identity itself.
 */
export function openLibrarySeriesForBook(bookId: string, seriesName?: string, author?: string) {
  writeRuntimeJson(APP_TAB_STORAGE_KEY, 'library');
  writeRuntimeJson(LIBRARY_SECTION_STORAGE_KEY, 'series' satisfies LibrarySection);
  writeRuntimeJson(SERIES_FOCUS_TARGET_STORAGE_KEY, {
    bookId,
    seriesName: seriesName?.trim() || undefined,
    author: author?.trim() || undefined,
  } satisfies LibrarySeriesFocusTarget);
  removeRuntimeValue(LEGACY_SERIES_FOCUS_BOOK_STORAGE_KEY);
  notifyRuntimeStorageChanged(APP_TAB_STORAGE_KEY);
  notifyRuntimeStorageChanged(LIBRARY_SECTION_STORAGE_KEY);
}

/** One-shot target consumed by SeriesLibraryPanel after the Series view opens. */
export function consumeLibrarySeriesFocusTarget(): LibrarySeriesFocusTarget | null {
  const target = readRuntimeJson<LibrarySeriesFocusTarget | null>(SERIES_FOCUS_TARGET_STORAGE_KEY, null);
  if (target?.bookId) {
    removeRuntimeValue(SERIES_FOCUS_TARGET_STORAGE_KEY);
    return target;
  }

  // Backward compatibility for focus requests written by an older build.
  const legacyBookId = readRuntimeJson<string | null>(LEGACY_SERIES_FOCUS_BOOK_STORAGE_KEY, null);
  if (!legacyBookId) return null;
  removeRuntimeValue(LEGACY_SERIES_FOCUS_BOOK_STORAGE_KEY);
  return { bookId: legacyBookId };
}
