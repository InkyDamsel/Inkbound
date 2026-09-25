import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../lib/firebase';

interface GoogleIndustryIdentifier {
  type?: string;
  identifier?: string;
}

export interface DetectiveGoogleVolume {
  id: string;
  inkboundBibliographicSeries?: {
    name?: string;
    position?: number;
  };
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
  seriesMetadataById?: Record<string, string>;
}

export interface DetectiveGoogleCatalog {
  items: DetectiveGoogleVolume[];
  seriesTitlesById: Record<string, string>;
}

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const DETAIL_LIMIT = 20;
const detailCache = new Map<string, DetectiveGoogleVolume>();
const seriesTitleCache = new Map<string, string>();

const protectedSearch = async (
  query: string,
  startIndex: number,
  maxResults: number,
): Promise<GooglePayload> => {
  if (!functions || !auth?.currentUser) return { items: [], totalItems: 0 };
  const callable = httpsCallable<
    { query: string; provider: 'google-books'; startIndex: number; maxResults: number },
    GooglePayload
  >(
    functions,
    'searchHardcoverBooks',
  );
  const response = await callable({ query, provider: 'google-books', startIndex, maxResults });
  return response.data;
};

const directSearch = async (
  query: string,
  signal: AbortSignal | undefined,
  startIndex: number,
  maxResults: number,
): Promise<GooglePayload> => {
  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    startIndex: String(startIndex),
    maxResults: String(maxResults),
  });
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

export interface DetectiveGoogleCatalogPage extends DetectiveGoogleCatalog {
  totalItems: number;
  nextStartIndex: number;
  hasMore: boolean;
}

export async function searchDetectiveGoogleBooksPage(
  query: string,
  startIndex = 0,
  maxResults = 40,
  signal?: AbortSignal,
): Promise<DetectiveGoogleCatalogPage> {
  const trimmed = query.trim();
  const safeStart = Math.max(0, startIndex);
  const safeMax = Math.max(1, Math.min(40, maxResults));
  if (!trimmed) {
    return {
      items: [],
      seriesTitlesById: {},
      totalItems: 0,
      nextStartIndex: safeStart,
      hasMore: false,
    };
  }

  const raw = functions && auth?.currentUser
    ? await protectedSearch(trimmed, safeStart, safeMax)
    : await directSearch(trimmed, signal, safeStart, safeMax);
  const hydrated = await hydrateDetails(raw, signal);
  const items = hydrated.items ?? [];

  const serverSeriesTitles = hydrated.seriesMetadataById ?? {};
  Object.entries(serverSeriesTitles).forEach(([id, title]) => {
    if (id && title) seriesTitleCache.set(id, title);
  });
  const clientSeriesTitles = await fetchSeriesTitles(items, signal);
  const totalItems = Math.max(0, hydrated.totalItems ?? 0);
  const nextStartIndex = safeStart + items.length;

  return {
    items,
    seriesTitlesById: { ...clientSeriesTitles, ...serverSeriesTitles },
    totalItems,
    nextStartIndex,
    hasMore: items.length > 0 && (
      totalItems > 0
        ? nextStartIndex < totalItems
        : items.length === safeMax
    ),
  };
}

export async function searchDetectiveGoogleBooks(
  query: string,
  signal?: AbortSignal,
): Promise<DetectiveGoogleCatalog> {
  const page = await searchDetectiveGoogleBooksPage(query, 0, 40, signal);
  return { items: page.items, seriesTitlesById: page.seriesTitlesById };
}
