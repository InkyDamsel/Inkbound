const normalize = (value?: string) =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const cleanCandidate = (value?: string): string | undefined => {
  const candidate = value?.trim().replace(/^[\s:–—-]+|[\s:–—-]+$/g, '');
  if (!candidate || candidate.length < 3 || candidate.length > 80) return undefined;
  if (/[.!?]{2,}/.test(candidate)) return undefined;
  return candidate;
};

const parsePosition = (value?: string): number | undefined => {
  const match = value?.match(/\b(?:book|volume|vol\.?|part)\s*#?\s*(\d+(?:\.\d+)?)\b/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const stripPosition = (value: string): string =>
  value
    .replace(/\s*[-–—,:]?\s*\b(?:book|volume|vol\.?|part)\s*#?\s*\d+(?:\.\d+)?\b.*$/i, '')
    .trim();

export interface CatalogSeriesLineHint {
  name: string;
  position?: number;
}

/**
 * Extracts a possible publisher/catalog series line. This is only a candidate:
 * callers must independently verify it across multiple distinct catalog works
 * before promoting it to canonical series metadata.
 */
export function inferCatalogSeriesLineCandidate(
  title?: string,
  subtitle?: string,
): CatalogSeriesLineHint | null {
  const subtitleCandidate = cleanCandidate(subtitle);
  if (subtitleCandidate) {
    const position = parsePosition(subtitleCandidate);
    const name = cleanCandidate(stripPosition(subtitleCandidate));
    if (name) return { name, ...(typeof position === 'number' ? { position } : {}) };
  }

  const rawTitle = title?.trim() ?? '';
  const colonIndex = rawTitle.indexOf(':');
  if (colonIndex > 0 && colonIndex < rawTitle.length - 1) {
    const suffix = cleanCandidate(rawTitle.slice(colonIndex + 1));
    if (suffix) {
      const position = parsePosition(suffix);
      const name = cleanCandidate(stripPosition(suffix));
      if (name) return { name, ...(typeof position === 'number' ? { position } : {}) };
    }
  }

  return null;
}

export function catalogTextMatchesSeriesLine(
  title: string | undefined,
  subtitle: string | undefined,
  wanted: string,
): boolean {
  const candidate = inferCatalogSeriesLineCandidate(title, subtitle);
  return Boolean(candidate && normalize(candidate.name) === normalize(wanted));
}
