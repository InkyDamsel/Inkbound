import { ACCOUNT_DATA_STORAGE_KEYS, SYNC_STORAGE_KEYS } from '../sync/storageKeys';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { notifyRuntimeStorageChanged, readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';
import type { UserBookRecord } from '../../types';

export interface CustomOwnershipCategory {
  id: string;
  name: string;
  createdAt: string;
}

export const CUSTOM_OWNERSHIP_CATEGORIES_KEY = ACCOUNT_DATA_STORAGE_KEYS.customOwnershipCategories;
export const CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT = 'inkbound:custom-ownership-categories-changed';

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ');
const slug = (value: string) => normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const readCustomOwnershipCategories = (): CustomOwnershipCategory[] =>
  readRuntimeJson<CustomOwnershipCategory[]>(CUSTOM_OWNERSHIP_CATEGORIES_KEY, [])
    .filter((category) => Boolean(category?.id && category?.name?.trim()))
    .sort((a, b) => a.name.localeCompare(b.name));

const notifyCategoriesChanged = () => {
  notifyRuntimeStorageChanged(CUSTOM_OWNERSHIP_CATEGORIES_KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT));
};

const writeCategories = (categories: CustomOwnershipCategory[]) => {
  const saved = writeRuntimeJson(CUSTOM_OWNERSHIP_CATEGORIES_KEY, categories);
  if (saved) notifyCategoriesChanged();
  return saved;
};

export const createCustomOwnershipCategory = (name: string): CustomOwnershipCategory | null => {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const current = readCustomOwnershipCategories();
  const existing = current.find((category) => category.name.toLowerCase() === normalized.toLowerCase());
  if (existing) return existing;
  const category: CustomOwnershipCategory = {
    id: `ownership-${slug(normalized) || 'custom'}-${Date.now().toString(36)}`,
    name: normalized,
    createdAt: new Date().toISOString(),
  };
  return writeCategories([...current, category]) ? category : null;
};

export const renameCustomOwnershipCategory = (id: string, name: string): boolean => {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  const current = readCustomOwnershipCategories();
  if (current.some((category) => category.id !== id && category.name.toLowerCase() === normalized.toLowerCase())) return false;
  return writeCategories(current.map((category) => category.id === id ? { ...category, name: normalized } : category));
};

export const customOwnershipCategoryLabel = (categoryId?: string): string | undefined =>
  categoryId ? readCustomOwnershipCategories().find((category) => category.id === categoryId)?.name : undefined;

export const deleteCustomOwnershipCategory = (id: string, books: UserBookRecord[]): { deleted: boolean; affectedBooks: number } => {
  const current = readCustomOwnershipCategories();
  if (!current.some((category) => category.id === id)) return { deleted: false, affectedBooks: 0 };

  const affectedBooks = books.filter((book) => book.ownership === 'custom' && book.customOwnershipCategoryId === id).length;
  const nextBooks = books.map((book) => book.ownership === 'custom' && book.customOwnershipCategoryId === id
    ? {
        ...book,
        ownership: 'none' as const,
        customOwnershipCategoryId: undefined,
      }
    : book);

  if (!writeCategories(current.filter((category) => category.id !== id))) return { deleted: false, affectedBooks: 0 };
  if (affectedBooks > 0 && writeRuntimeJson(SYNC_STORAGE_KEYS.books, nextBooks)) {
    // Refresh mounted canonical state only after the runtime write has emitted
    // its local mutation signal and entered the durable cloud queue.
    notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
  }
  return { deleted: true, affectedBooks };
};
