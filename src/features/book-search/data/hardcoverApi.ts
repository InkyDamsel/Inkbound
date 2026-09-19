import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';
import type { BookSearchResponse } from '../model/bookSearch';
import { hardenCatalogGroups } from '../catalogHardening';

interface HardcoverSearchPayload {
  groups?: BookSearchResponse['groups'];
  totalItems?: number;
}

export async function searchHardcover(query: string): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed || !functions) return { groups: [], totalItems: 0 };

  try {
    const callable = httpsCallable<{ query: string }, HardcoverSearchPayload>(functions, 'searchHardcoverBooks');
    const response = await callable({ query: trimmed });
    const groups = hardenCatalogGroups(Array.isArray(response.data.groups) ? response.data.groups : []);
    return {
      groups,
      totalItems: typeof response.data.totalItems === 'number' ? response.data.totalItems : groups.length,
    };
  } catch (error) {
    console.warn('Hardcover catalog supplement unavailable.', error);
    return { groups: [], totalItems: 0 };
  }
}
