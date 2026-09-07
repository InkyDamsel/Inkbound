import type { UserBookRecord } from '../../types';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../sync/storageKeys';

/** Replace the whole canonical local working library in one atomic local write. */
export function replaceCanonicalLibrary(nextBooks: UserBookRecord[]) {
  getRuntimeStorage().setItem(SYNC_STORAGE_KEYS.books, JSON.stringify(nextBooks));
  notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
}

/**
 * Replace one book in the canonical local working library and notify the app shell.
 * Used by embedded feature surfaces that do not receive App's state setter directly.
 * The normal storage signal then lets the cost-safe cloud bridge persist the delta.
 */
export function replaceCanonicalBook(currentBooks: UserBookRecord[], updatedBook: UserBookRecord) {
  replaceCanonicalLibrary(currentBooks.map((book) => book.id === updatedBook.id ? updatedBook : book));
}
