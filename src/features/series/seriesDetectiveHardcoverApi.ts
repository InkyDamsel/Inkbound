import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { SeriesDetectiveCatalogResponse } from './seriesDetectiveCatalogTypes';

interface SeriesDetectiveHardcoverPayload {
  groups?: SeriesDetectiveCatalogResponse['groups'];
  totalItems?: number;
}

export async function searchSeriesDetectiveHardcover(
  query: string,
  expandSeries = false,
  options: {
    exactTitle?: string;
    seriesName?: string;
    anchorTitles?: string[];
    anchorAuthor?: string;
  } = {},
): Promise<SeriesDetectiveCatalogResponse> {
  const trimmed = query.trim();
  if (!trimmed || !functions) return { groups: [], totalItems: 0 };

  try {
    const callable = httpsCallable<{
      query: string;
      expandSeries?: boolean;
      exactTitle?: string;
      seriesName?: string;
      anchorTitles?: string[];
    anchorAuthor?: string;
    }, SeriesDetectiveHardcoverPayload>(
      functions,
      'searchSeriesDetectiveHardcover',
    );
    const response = await callable({
      query: trimmed,
      expandSeries,
      exactTitle: options.exactTitle?.trim() || undefined,
      seriesName: options.seriesName?.trim() || undefined,
      anchorTitles: options.anchorTitles?.map((title) => title.trim()).filter(Boolean).slice(0, 12),
      anchorAuthor: options.anchorAuthor?.trim() || undefined,
    });
    const groups = Array.isArray(response.data.groups) ? response.data.groups : [];
    return {
      groups,
      totalItems: typeof response.data.totalItems === 'number'
        ? response.data.totalItems
        : groups.length,
    };
  } catch (error) {
    console.warn('Series Detective Hardcover provider unavailable.', error);
    return { groups: [], totalItems: 0 };
  }
}
