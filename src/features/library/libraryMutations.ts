import type { UserBookRecord } from '../../types';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../sync/storageKeys';

/**
 * Replace one book in the canonical local working library and notify the app shell.
 * Used by embedded feature surfaces that do not receive App's state setter directly.
 * The normal storage signal then lets the cost-safe cloud bridge persist the delta.
 */
export function replaceCanonicalBook(currentBooks: UserBookRecord[], updatedBook: UserBookRecord) {
  const nextBooks = currentBooks.map((book) => book.id === updatedBook.id ? updatedBook : book);
  getRuntimeStorage().setItem(SYNC_STORAGE_KEYS.books, JSON.stringify(nextBooks));
  notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
}
