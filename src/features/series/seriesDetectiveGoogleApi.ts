import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
interface GoogleIndustryIdentifier {
  type?: string;
  identifier?: string;
}

export interface DetectiveGoogleVolume {
  id: string;
  inkboundBibliographicSeries?: {
    name?: string;
    position?: number;
    explicit?: boolean;
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
  providerStatus?: 'ok' | 'partial' | 'unavailable' | 'rate-limited' | 'timed-out';
  providerErrorCode?: string;
}

export interface DetectiveGoogleCatalog {
  items: DetectiveGoogleVolume[];
  seriesTitlesById: Record<string, string>;
}

const DETAIL_LIMIT = 14;
const detailCache = new Map<string, DetectiveGoogleVolume>();
const seriesTitleCache = new Map<string, string>();

const directSearch = async (
  query: string,
  signal: AbortSignal | undefined,
  startIndex: number,
  maxResults: number,
): Promise<GooglePayload> => {
  if (!functions) throw new Error('Series Detective Google Books unavailable: firebase-unavailable');
  if (signal?.aborted) throw new DOMException('Series Detective search aborted.', 'AbortError');

  const callable = httpsCallable<
    { query: string; startIndex: number; maxResults: number },
    GooglePayload
  >(functions, 'searchSeriesDetectiveGoogleBooks');
  const response = await callable({ query, startIndex, maxResults });
  if (signal?.aborted) throw new DOMException('Series Detective search aborted.', 'AbortError');
  if (response.data.providerStatus && response.data.providerStatus !== 'ok') {
    throw new Error(`Series Detective Google Books ${response.data.providerStatus}: ${response.data.providerErrorCode ?? 'unknown'}`);
  }
  return response.data;
};

const hydrateDetails = async (payload: GooglePayload, _signal?: AbortSignal): Promise<GooglePayload> => {
  const items = payload.items ?? [];
  items.forEach((volume) => {
    if (volume.id) detailCache.set(volume.id, volume);
  });
  return { ...payload, items };
};

const fetchSeriesTitles = async (
  items: DetectiveGoogleVolume[],
  _signal?: AbortSignal,
): Promise<Record<string, string>> => {
  const resolved: Record<string, string> = {};
  items.flatMap((volume) =>
    volume.volumeInfo?.seriesInfo?.volumeSeries ?? [],
  ).forEach((membership) => {
    const id = membership.seriesId?.trim();
    if (!id) return;
    const cached = seriesTitleCache.get(id);
    if (cached) resolved[id] = cached;
  });
  return resolved;
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

  // Series Detective owns its Google transport. Do not route through
  // Inkbound's shared Add Reading Material Firebase search gateway.
  const raw = await directSearch(trimmed, signal, safeStart, safeMax);
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
