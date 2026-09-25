import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../lib/firebase';

interface GoogleIndustryIdentifier {
  type?: string;
  identifier?: string;
}

export interface DetectiveGoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    description?: string;
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
    industryIdentifiers?: GoogleIndustryIdentifier[];
    seriesInfo?: {
      bookDisplayNumber?: string;
      volumeSeries?: Array<{
        seriesId?: string;
        orderNumber?: number;
        issue?: Array<{ issueOrderNumber?: number }>;
      }>;
    };
  };
  saleInfo?: { isEbook?: boolean };
}

interface GooglePayload {
  totalItems?: number;
  items?: DetectiveGoogleVolume[];
}

export interface DetectiveGoogleCatalog {
  items: DetectiveGoogleVolume[];
  seriesTitlesById: Record<string, string>;
}

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim();
const DETAIL_LIMIT = 20;
const detailCache = new Map<string, DetectiveGoogleVolume>();
const seriesTitleCache = new Map<string, string>();

const protectedSearch = async (query: string): Promise<GooglePayload> => {
  if (!functions || !auth?.currentUser) return { items: [], totalItems: 0 };
  const callable = httpsCallable<{ query: string; provider: 'google-books' }, GooglePayload>(
    functions,
    'searchHardcoverBooks',
  );
  const response = await callable({ query, provider: 'google-books' });
  return response.data;
};

const directSearch = async (query: string, signal?: AbortSignal): Promise<GooglePayload> => {
  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    maxResults: '40',
  });
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);
  const response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Google Books Detective search failed (${response.status}).`);
  return response.json() as Promise<GooglePayload>;
};

const hydrateDetails = async (payload: GooglePayload, signal?: AbortSignal): Promise<GooglePayload> => {
  const items = payload.items ?? [];
  const hydrated = await Promise.all(items.map(async (volume, index) => {
    if (!volume.id) return volume;
    const cached = detailCache.get(volume.id);
    if (cached) return {
      ...volume,
      ...cached,
      volumeInfo: { ...volume.volumeInfo, ...cached.volumeInfo },
    };
    if (index >= DETAIL_LIMIT || volume.volumeInfo?.seriesInfo?.volumeSeries?.length) {
      detailCache.set(volume.id, volume);
      return volume;
    }
    try {
      const params = new URLSearchParams({ projection: 'full' });
      if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);
      const response = await fetch(
        `${GOOGLE_BOOKS_ENDPOINT}/${encodeURIComponent(volume.id)}?${params.toString()}`,
        { signal },
      );
      if (!response.ok) return volume;
      const detail = await response.json() as DetectiveGoogleVolume;
      const merged = {
        ...volume,
        ...detail,
        volumeInfo: { ...volume.volumeInfo, ...detail.volumeInfo },
      };
      detailCache.set(volume.id, merged);
      return merged;
    } catch (error) {
      if (signal?.aborted) throw error;
      return volume;
    }
  }));
  return { ...payload, items: hydrated };
};

const fetchSeriesTitles = async (
  items: DetectiveGoogleVolume[],
  signal?: AbortSignal,
): Promise<Record<string, string>> => {
  const ids = [...new Set(items.flatMap((volume) =>
    volume.volumeInfo?.seriesInfo?.volumeSeries
      ?.map((membership) => membership.seriesId?.trim())
      .filter((value): value is string => Boolean(value)) ?? [],
  ))];
  if (!ids.length) return {};

  const resolved: Record<string, string> = {};
  const missingIds: string[] = [];
  ids.forEach((id) => {
    const cached = seriesTitleCache.get(id);
    if (cached) resolved[id] = cached;
    else missingIds.push(id);
  });
  if (!missingIds.length) return resolved;

  try {
    const params = new URLSearchParams();
    missingIds.forEach((id) => params.append('series_id', id));
    if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);
    const response = await fetch(`https://www.googleapis.com/books/v1/series/get?${params.toString()}`, { signal });
    if (!response.ok) return {};
    const payload = await response.json() as { series?: Array<{ seriesId?: string; title?: string }> };
    for (const series of payload.series ?? []) {
      const id = series.seriesId?.trim();
      const title = series.title?.trim();
      if (!id || !title) continue;
      seriesTitleCache.set(id, title);
      resolved[id] = title;
    }
    return resolved;
  } catch (error) {
    if (signal?.aborted) throw error;
    return resolved;
  }
};

export async function searchDetectiveGoogleBooks(
  query: string,
  signal?: AbortSignal,
): Promise<DetectiveGoogleCatalog> {
  const trimmed = query.trim();
  if (!trimmed) return { items: [], seriesTitlesById: {} };

  const raw = functions && auth?.currentUser
    ? await protectedSearch(trimmed)
    : await directSearch(trimmed, signal);
  const hydrated = await hydrateDetails(raw, signal);
  const items = hydrated.items ?? [];
  return {
    items,
    seriesTitlesById: await fetchSeriesTitles(items, signal),
  };
}
