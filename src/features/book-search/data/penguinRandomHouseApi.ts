import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';
import type { BookSearchResponse } from '../model/bookSearch';

interface PrhSearchPayload {
  groups?: BookSearchResponse['groups'];
  totalItems?: number;
}

export async function searchPenguinRandomHouse(query: string, authorBibliography = false, propagateErrors = false): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed || !functions) return { groups: [], totalItems: 0 };

  try {
    const callable = httpsCallable<
      { query: string; expandSeries?: boolean; authorBibliography?: boolean },
      PrhSearchPayload
    >(functions, 'searchSeriesDetectivePenguinRandomHouse');

    const response = await callable({
      query: trimmed,
      expandSeries: false,
      authorBibliography,
    });

    const groups = Array.isArray(response.data.groups) ? response.data.groups : [];
    return {
      groups,
      totalItems: typeof response.data.totalItems === 'number'
        ? response.data.totalItems
        : groups.length,
    };
  } catch (error) {
    console.warn('Penguin Random House catalog supplement unavailable.', error);
    if (propagateErrors) throw error;
    return { groups: [], totalItems: 0 };
  }
}
