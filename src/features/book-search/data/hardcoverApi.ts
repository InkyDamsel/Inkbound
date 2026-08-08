import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';
import type { BookSearchResponse } from '../model/bookSearch';

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
    return {
      groups: Array.isArray(response.data.groups) ? response.data.groups : [],
      totalItems: typeof response.data.totalItems === 'number' ? response.data.totalItems : 0,
    };
  } catch {
    // Hardcover is an optional enrichment provider. Search must remain usable when
    // the server token is absent, expired, rate-limited, or the reader is signed out.
    return { groups: [], totalItems: 0 };
  }
}
