import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../../lib/firebase';
import type { BookSearchResponse } from '../model/bookSearch';

interface HardcoverSearchPayload {
  groups?: BookSearchResponse['groups'];
  totalItems?: number;
  providerError?: string;
  providerDebug?: Record<string, unknown>;
}

type HardcoverSearchRequest = { query: string; authorBibliography?: boolean };

export async function searchHardcover(query: string): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed || !functions) return { groups: [], totalItems: 0 };

  try {
    if (auth) {
      await auth.authStateReady();
      if (!auth.currentUser) return { groups: [], totalItems: 0 };
    }
    const callable = httpsCallable<HardcoverSearchRequest, HardcoverSearchPayload>(functions, 'searchHardcoverBooks');
    const response = await callable({ query: trimmed });
    const groups = Array.isArray(response.data.groups) ? response.data.groups : [];
    return {
      groups,
      totalItems: typeof response.data.totalItems === 'number' ? response.data.totalItems : groups.length,
    };
  } catch (error) {
    console.warn('Hardcover catalog supplement unavailable.', error);
    return { groups: [], totalItems: 0 };
  }
}


// Author pages need a broader Hardcover candidate pool than ordinary Search.
// The server expands only this author-bibliography request; exact author-credit
// filtering still happens in the author aggregation path before anything is shown.
export async function searchHardcoverAuthorBibliography(authorName: string, propagateErrors = false): Promise<BookSearchResponse & { providerDebug?: Record<string, unknown> }> {
  const trimmed = authorName.trim();
  if (!trimmed || !functions) return { groups: [], totalItems: 0 };

  try {
    const callable = httpsCallable<HardcoverSearchRequest, HardcoverSearchPayload>(functions, 'searchHardcoverBooks');
    const response = await callable({ query: trimmed, authorBibliography: true });
    if (response.data.providerError) throw new Error(response.data.providerError);
    const groups = Array.isArray(response.data.groups) ? response.data.groups : [];
    return {
      groups,
      totalItems: typeof response.data.totalItems === 'number' ? response.data.totalItems : groups.length,
      providerDebug: response.data.providerDebug,
    };
  } catch (error) {
    console.warn('Hardcover author bibliography supplement unavailable.', error);
    if (propagateErrors) throw error;
    return { groups: [], totalItems: 0 };
  }
}
