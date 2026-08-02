import { LibrarySanctuaryRepository } from './librarySanctuaryRepository';
import {
  DEFAULT_LIBRARY_SANCTUARY,
  LibrarySanctuary,
  normalizeLibrarySanctuary,
} from '../model/librarySanctuary';

const SANCTUARY_STORAGE_KEY = 'inkbound_library_sanctuary_v1';

export class LocalLibrarySanctuaryRepository implements LibrarySanctuaryRepository {
  async load(): Promise<LibrarySanctuary> {
    try {
      const stored = window.localStorage.getItem(SANCTUARY_STORAGE_KEY);
      if (!stored) return normalizeLibrarySanctuary(DEFAULT_LIBRARY_SANCTUARY);

      return normalizeLibrarySanctuary(
        JSON.parse(stored) as Partial<LibrarySanctuary>,
      );
    } catch {
      return normalizeLibrarySanctuary(DEFAULT_LIBRARY_SANCTUARY);
    }
  }

  async save(sanctuary: LibrarySanctuary): Promise<LibrarySanctuary> {
    const normalized = normalizeLibrarySanctuary(sanctuary);
    window.localStorage.setItem(SANCTUARY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  async reset(): Promise<LibrarySanctuary> {
    const resetValue = normalizeLibrarySanctuary({
      ...DEFAULT_LIBRARY_SANCTUARY,
      updatedAt: new Date().toISOString(),
    });

    window.localStorage.setItem(SANCTUARY_STORAGE_KEY, JSON.stringify(resetValue));
    return resetValue;
  }
}
