import { ACCOUNT_DATA_STORAGE_KEYS, SYNC_STORAGE_KEYS } from '../sync/storageKeys';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { notifyRuntimeStorageChanged, readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';
import type { UserBookRecord } from '../../types';
import { withReadingStatus } from './bookReadingState';

export interface CustomReadingStatus {
  id: string;
  name: string;
  createdAt: string;
}

export const CUSTOM_READING_STATUSES_KEY = ACCOUNT_DATA_STORAGE_KEYS.customReadingStatuses;
export const CUSTOM_READING_STATUSES_CHANGED_EVENT = 'inkbound:custom-reading-statuses-changed';

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ');
const slug = (value: string) => normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const readCustomReadingStatuses = (): CustomReadingStatus[] =>
  readRuntimeJson<CustomReadingStatus[]>(CUSTOM_READING_STATUSES_KEY, [])
    .filter((status) => Boolean(status?.id && status?.name?.trim()))
    .sort((a, b) => a.name.localeCompare(b.name));

const notifyStatusesChanged = () => {
  notifyRuntimeStorageChanged(CUSTOM_READING_STATUSES_KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CUSTOM_READING_STATUSES_CHANGED_EVENT));
};

const writeStatuses = (statuses: CustomReadingStatus[]) => {
  const saved = writeRuntimeJson(CUSTOM_READING_STATUSES_KEY, statuses);
  if (saved) notifyStatusesChanged();
  return saved;
};

export const createCustomReadingStatus = (name: string): CustomReadingStatus | null => {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const current = readCustomReadingStatuses();
  const existing = current.find((status) => status.name.toLowerCase() === normalized.toLowerCase());
  if (existing) return existing;
  const status: CustomReadingStatus = {
    id: `reading-status-${slug(normalized) || 'custom'}-${Date.now().toString(36)}`,
    name: normalized,
    createdAt: new Date().toISOString(),
  };
  return writeStatuses([...current, status]) ? status : null;
};

export const renameCustomReadingStatus = (id: string, name: string): boolean => {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  const current = readCustomReadingStatuses();
  if (current.some((status) => status.id !== id && status.name.toLowerCase() === normalized.toLowerCase())) return false;
  return writeStatuses(current.map((status) => status.id === id ? { ...status, name: normalized } : status));
};

export const customReadingStatusLabel = (statusId?: string): string | undefined =>
  statusId ? readCustomReadingStatuses().find((status) => status.id === statusId)?.name : undefined;

export const readingStatusLabelForBook = (book: UserBookRecord): string => {
  if (book.status === 'custom') return customReadingStatusLabel(book.customReadingStatusId) ?? 'Custom';
  if (book.status === 'currently-reading') return 'Currently Reading';
  if (book.status === 'tbr') return 'To Be Read';
  if (book.status === 'finished') return 'Read';
  if (book.status === 'paused') return 'Paused';
  if (book.status === 'dnf') return 'Did Not Finish';
  if (book.status === 'wishlist') return 'Wishlist';
  return book.status;
};

export const withCustomReadingStatus = (book: UserBookRecord, customReadingStatusId: string): UserBookRecord => ({
  ...withReadingStatus(book, 'custom'),
  customReadingStatusId,
});

export const deleteCustomReadingStatus = (id: string, books: UserBookRecord[]): { deleted: boolean; affectedBooks: number } => {
  const current = readCustomReadingStatuses();
  if (!current.some((status) => status.id === id)) return { deleted: false, affectedBooks: 0 };

  const affectedBooks = books.filter((book) => book.status === 'custom' && book.customReadingStatusId === id).length;
  const nextBooks = books.map((book) => book.status === 'custom' && book.customReadingStatusId === id
    ? { ...withReadingStatus(book, 'tbr'), customReadingStatusId: undefined }
    : book);

  if (!writeStatuses(current.filter((status) => status.id !== id))) return { deleted: false, affectedBooks: 0 };
  if (affectedBooks > 0 && writeRuntimeJson(SYNC_STORAGE_KEYS.books, nextBooks)) {
    notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
  }
  return { deleted: true, affectedBooks };
};
