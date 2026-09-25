import type { UserBookRecord } from '../../types';

export interface SeriesDetectionEvidence {
  seriesName: string;
  position: number | null;
  title: string;
  authors: string[];
  isbn10?: string;
  isbn13?: string;
  sourceId: string;
  recordId: string;
  providerId: string;
  providerCount?: number;
  structured: boolean;
  exactIdentifier: boolean;
  exactTitle: boolean;
  exactAuthor: boolean;
  score: number;
}

const GENERIC_SERIES_WORDS = new Set(['book', 'books', 'series', 'volume', 'vol', 'part', 'edition', 'novel']);

export const normalizeDetectiveText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

export const compactDetectiveIsbn = (value?: string): string =>
  value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

export const comparableDetectiveTitle = (value?: string): string => {
  const title = value?.trim() ?? '';
  if (!title) return '';
  const withoutSeriesSuffix = inferDetectiveSeriesFromTitle(title)
    ? title.replace(/\s*[\[(][^\])]+[\])]\s*$/, '').trim()
    : title;
  return normalizeDetectiveText(withoutSeriesSuffix);
};

export const canonicalDetectiveAuthor = (value?: string): string => {
  const raw = value?.trim() ?? '';
  if (!raw) return '';

  const commaIndex = raw.indexOf(',');
  if (commaIndex >= 0) {
    const family = normalizeDetectiveText(raw.slice(0, commaIndex));
    const given = normalizeDetectiveText(raw.slice(commaIndex + 1));
    if (family && given) return `${given} ${family}`.replace(/\s+/g, ' ').trim();
  }

  return normalizeDetectiveText(raw);
};

export const canonicalDetectiveSeries = (value?: string): string =>
  normalizeDetectiveText(value)
    .replace(/\b(?:the|series|saga|novels|novel|books|book|collection)\b/g, ' ')
    .replace(/\b(?:x|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const detectiveSeriesNamesCompatible = (a?: string, b?: string): boolean => {
  const left = canonicalDetectiveSeries(a);
  const right = canonicalDetectiveSeries(b);
  return Boolean(left && right && left === right);
};

const ORDINAL_POSITIONS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};

const GENERIC_SUBTITLE_WORDS = new Set([
  'novel', 'novella', 'memoir', 'romance', 'thriller', 'mystery', 'fantasy',
  'story', 'stories', 'edition', 'editions', 'anniversary', 'illustrated',
  'hardcover', 'paperback', 'ebook', 'audiobook',
]);

export const plausibleDetectiveSeriesSubtitle = (value?: string): string | null => {
  const candidate = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!candidate) return null;
  const identity = canonicalDetectiveSeries(candidate);
  const words = identity.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 6) return null;
  if (words.some((word) => GENERIC_SUBTITLE_WORDS.has(word))) return null;
  return candidate;
};

export const inferKnownDetectiveSeriesFromText = (
  value: string | undefined,
  wantedSeriesName: string,
): { name: string; position: number | null } | null => {
  const text = value?.trim();
  if (!text) return null;
  const parts = text.split(':');
  const candidate = (parts.length > 1 ? parts[parts.length - 1] : text).trim();
  const match = candidate.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;
  const name = match[1].trim().replace(/[,:;\-]+$/g, '');
  if (!detectiveSeriesNamesCompatible(name, wantedSeriesName)) return null;
  const parsed = Number.parseFloat(match[2]);
  return { name, position: Number.isFinite(parsed) && parsed >= 0 ? parsed : null };
};

export const inferKnownDetectiveSeriesFromDescription = (
  value: string | undefined,
  wantedSeriesName: string,
): { name: string; position: number | null } | null => {
  const text = normalizeDetectiveText(value);
  const seriesIdentity = canonicalDetectiveSeries(wantedSeriesName);
  if (!text || !seriesIdentity) return null;

  const seriesTokens = seriesIdentity.split(' ').filter(Boolean);
  if (!seriesTokens.every((token) => text.includes(token))) return null;

  const qualifierPattern = /\b(?:series|saga|novels?|books?|collection)\b/i;
  if (seriesTokens.length === 1 && !qualifierPattern.test(text)) return null;

  const seriesIndex = text.indexOf(seriesTokens[0]);
  const start = Math.max(0, seriesIndex - 120);
  const end = Math.min(text.length, seriesIndex + seriesIdentity.length + 120);
  const context = text.slice(start, end);
  let position: number | null = null;

  for (const pattern of [
    /\b(?:book|volume|vol|part)\s*#?\s*(\d+(?:\.\d+)?)\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:st|nd|rd|th)?\s+(?:book|novel|volume|part)\b/i,
  ]) {
    const match = context.match(pattern);
    const parsed = match ? Number(match[1]) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      position = parsed;
      break;
    }
  }

  if (position === null) {
    const match = context.match(new RegExp(
      '\\b(' + Object.keys(ORDINAL_POSITIONS).join('|') + ')\\s+(?:book|novel|volume|part)\\b',
      'i',
    ));
    if (match) position = ORDINAL_POSITIONS[match[1].toLowerCase()] ?? null;
  }

  return { name: wantedSeriesName.trim(), position };
};

export const inferDetectiveSeriesFromTitle = (
  value?: string,
): { name: string; position: number | null } | null => {
  const text = value?.trim();
  if (!text) return null;
  const suffix = text.match(/[\[(]([^\])]+)[\])]\s*$/)?.[1]?.trim();
  const candidate = suffix ?? text.split(':').slice(-1)[0]?.trim();
  if (!candidate) return null;

  const match = candidate.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;

  const name = match[1].trim().replace(/[,:;\-]+$/g, '');
  if (name.length < 2 || GENERIC_SERIES_WORDS.has(name.toLowerCase())) return null;
  const parsed = Number.parseFloat(match[2]);
  return { name, position: Number.isFinite(parsed) && parsed >= 0 ? parsed : null };
};

export const buildSeriesDetectionQueries = (book: UserBookRecord): { workQuery: string; identifiers: string[] } => {
  const identifiers = [...new Set(
    book.editions
      .flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )];
  return {
    workQuery: `${book.work.title} ${book.work.author}`.trim(),
    identifiers,
  };
};

export const scoreDetectiveEvidence = (
  input: Omit<SeriesDetectionEvidence, 'score'>,
): SeriesDetectionEvidence => {
  let score = 0;
  if (input.structured) score += 100;
  else score += 35;
  if (input.exactIdentifier) score += 120;
  if (input.exactTitle) score += 35;
  if (input.exactAuthor) score += 35;
  if (typeof input.position === 'number') score += 10;
  return { ...input, score };
};

export const selectVerifiedDetectiveEvidence = (
  evidence: SeriesDetectionEvidence[],
): SeriesDetectionEvidence | null => {
  const eligible = evidence.filter((item) =>
    (item.structured && item.exactIdentifier)
    || (item.structured && item.exactTitle && item.exactAuthor)
    || (!item.structured && item.exactTitle && item.exactAuthor),
  );
  if (!eligible.length) return null;

  const groups = new Map<string, SeriesDetectionEvidence[]>();
  eligible.forEach((item) => {
    const key = `${canonicalDetectiveSeries(item.seriesName)}::${item.position ?? 'unknown'}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  });

  return [...groups.values()]
    .map((group) => ({
      best: [...group].sort((a, b) => b.score - a.score)[0],
      distinctProviders: new Set(group.map((item) => item.providerId)).size,
      corroboratingProviders: Math.max(...group.map((item) => item.providerCount ?? 1)),
    }))
    .filter(({ best, distinctProviders, corroboratingProviders }) =>
      best.structured && best.score >= 170
      || !best.structured
        && Math.max(distinctProviders, corroboratingProviders) >= 2
        && best.score >= 100,
    )
    .sort((a, b) =>
      b.best.score - a.best.score
      || b.corroboratingProviders - a.corroboratingProviders
      || b.distinctProviders - a.distinctProviders,
    )[0]?.best ?? null;
};
