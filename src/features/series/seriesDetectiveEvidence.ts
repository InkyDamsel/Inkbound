import type { UserBookRecord } from '../../types';

export interface SeriesDetectionEvidence {
  seriesName: string;
  position: number | null;
  title: string;
  authors: string[];
  isbn10?: string;
  isbn13?: string;
  sourceId: string;
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

export const canonicalDetectiveAuthor = (value?: string): string => {
  const normalized = normalizeDetectiveText(value);
  if (!normalized) return '';
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 2 && value?.includes(',')) return `${parts[1]} ${parts[0]}`;
  return normalized;
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
      distinctQueries: new Set(group.map((item) => item.sourceId)).size,
    }))
    .filter(({ best, distinctQueries }) =>
      best.structured && best.score >= 170
      || !best.structured && distinctQueries >= 2 && best.score >= 100,
    )
    .sort((a, b) => b.best.score - a.best.score || b.distinctQueries - a.distinctQueries)[0]?.best ?? null;
};
