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
  typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';

export const compactDetectiveIsbn = (value?: string): string =>
  typeof value === 'string' ? value.replace(/[^0-9X]/gi, '').toUpperCase() : '';

export const comparableDetectiveTitle = (value?: string, seriesName?: string): string => {
  let title = typeof value === 'string' ? value.trim() : '';
  if (!title) return '';
  // Strip all numbered series parentheticals, not just the final group.
  title = title.replace(/\s*[\[(]([^\])]+)[\])]/g, (whole, inner: string) => {
    const label = inner.trim();
    if (inferDetectiveSeriesFromTitle('Book (' + label + ')')) return '';
    // A trailing unnumbered series label may accompany a numbered label.
    // Never strip arbitrary parentheticals: they may be part of the title.
    return whole;
  });
  // Catalogs sometimes append "(Series Name 4)" without a Book/# marker.
  // Only strip that suffix when the caller supplies the matching series;
  // stripping arbitrary numeric parentheticals would merge unrelated works.
  if (seriesName) {
    title = title.replace(/\s*\(([^()]*)\)\s*$/, (whole, inner: string) => {
      const match = inner.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
      return match && detectiveSeriesNamesCompatible(match[1], seriesName) ? '' : whole;
    });
  }
  return normalizeDetectiveText(title);
};

export const canonicalDetectiveAuthor = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  const commaIndex = raw.indexOf(',');
  if (commaIndex >= 0 && raw.indexOf(',', commaIndex + 1) < 0) {
    const family = normalizeDetectiveText(raw.slice(0, commaIndex));
    const given = normalizeDetectiveText(raw.slice(commaIndex + 1));
    const familyWords = family.split(' ').filter(Boolean);
    const givenWords = given.split(' ').filter(Boolean);

    // "Last, First" is common provider formatting. A comma between two
    // multi-word names is much more likely Inkbound's stored author list
    // ("Author One, Author Two"), so do not reverse that as one person.
    const looksLikeSingleReversedName =
      familyWords.length > 0
      && givenWords.length > 0
      && !(familyWords.length >= 2 && givenWords.length >= 2);
    if (looksLikeSingleReversedName) {
      return `${given} ${family}`.replace(/\s+/g, ' ').trim();
    }
  }

  return normalizeDetectiveText(raw);
};

export const detectiveAuthorCandidates = (value?: string): string[] => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return [];

  const whole = canonicalDetectiveAuthor(raw);
  const candidates = new Set<string>(whole ? [whole] : []);

  const commaParts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (
    commaParts.length >= 2
    && commaParts.every((part) => normalizeDetectiveText(part).split(' ').filter(Boolean).length >= 2)
  ) {
    commaParts.forEach((part) => {
      const normalized = canonicalDetectiveAuthor(part);
      if (normalized) candidates.add(normalized);
    });
  }

  return [...candidates];
};

export const detectiveAuthorsCompatible = (left?: string, right?: string): boolean => {
  const leftIds = new Set(detectiveAuthorCandidates(left));
  if (!leftIds.size) return true;
  return detectiveAuthorCandidates(right).some((candidate) => leftIds.has(candidate));
};

export const canonicalDetectiveSeries = (value?: string): string => {
  const tokens = normalizeDetectiveText(value).split(' ').filter(Boolean);
  // Generic structural qualifiers only: never alias a specific franchise or series.
  while (tokens.length > 1 && ['a', 'an', 'the'].includes(tokens[0])) tokens.shift();
  while (
    tokens.length > 1
    && ['series', 'saga', 'novel', 'novels', 'book', 'books', 'collection', 'collections', 'trilogy', 'duology', 'duet', 'quartet', 'quintet', 'sextet', 'septet', 'octet'].includes(tokens[tokens.length - 1])
  ) tokens.pop();
  return tokens.filter((token) => token !== 'x' && token !== 'and').join(' ');
};

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

const CARDINAL_POSITIONS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const POSITION_WORDS = { ...ORDINAL_POSITIONS, ...CARDINAL_POSITIONS };

export const parseDetectivePositionToken = (value?: string): number | null => {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!token) return null;
  const numeric = Number(token);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  return POSITION_WORDS[token] ?? null;
};

const detectivePositionPattern = () =>
  `(?:\\d+(?:\\.\\d+)?|${Object.keys(POSITION_WORDS).join('|')})`;

const GENERIC_SUBTITLE_WORDS = new Set([
  'novel', 'novella', 'memoir', 'romance', 'thriller', 'mystery', 'fantasy',
  'story', 'stories', 'edition', 'editions', 'anniversary', 'illustrated',
  'hardcover', 'paperback', 'ebook', 'audiobook',
]);

export const plausibleDetectiveSeriesSubtitle = (value?: string): string | null => {
  const candidate = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
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
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const parts = text.split(':');
  const candidate = (parts.length > 1 ? parts[parts.length - 1] : text).trim();
  const match = candidate.match(new RegExp(
    `^(.*?)(?:\\s*,?\\s*)(?:#\\s*|book\\s*#?\\s*|vol(?:ume)?\\.?\\s*#?\\s*|part\\s*#?\\s*)(${detectivePositionPattern()})\\s*$`,
    'i',
  ));
  if (!match) return null;
  const name = match[1].trim().replace(/[,:;\-]+$/g, '');
  if (!detectiveSeriesNamesCompatible(name, wantedSeriesName)) return null;
  return { name, position: parseDetectivePositionToken(match[2]) };
};

export const inferDetectiveSeriesFromDescription = (
  value?: string,
): { name: string; position: number | null } | null => {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return null;

  const position = detectivePositionPattern();
  const patterns = [
    new RegExp(
      `\\b(?:the\\s+)?(${position})(?:st|nd|rd|th)?\\s+(?:book|novel|volume|installment|instalment|part)\\s+(?:in|of)\\s+(?:the\\s+)?(.{2,80}?)\\s+(?:series|saga|trilogy|duet|collection)\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:book|novel|volume|installment|instalment|part)\\s*#?\\s*(${position})\\s+(?:in|of)\\s+(?:the\\s+)?(.{2,80}?)\\s+(?:series|saga|trilogy|duet|collection)\\b`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const parsedPosition = parseDetectivePositionToken(match[1]);
    const name = match[2]
      ?.replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,:;!?-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || parsedPosition === null || parsedPosition <= 0) continue;

    const canonical = canonicalDetectiveSeries(name);
    const words = canonical.split(' ').filter(Boolean);
    if (!canonical || words.length > 8) continue;

    // Descriptive phrases such as "a dark hockey romance series" are not
    // formal series identities. Require a proper-looking name rather than
    // turning marketing copy into a made-up series.
    if (/^(?:a|an)\s+/i.test(name)) continue;
    if (/\b(?:romance|fantasy|mystery|thriller|fiction|novels?|books?)\b/i.test(name) && words.length >= 3) continue;

    return { name, position: parsedPosition };
  }

  return null;
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
    new RegExp(`\\b(?:book|volume|vol|part)\\s*#?\\s*(${detectivePositionPattern()})\\b`, 'i'),
    new RegExp(`\\b(${detectivePositionPattern()})\\s*(?:st|nd|rd|th)?\\s+(?:book|novel|volume|part)\\b`, 'i'),
    new RegExp(`\\b(${detectivePositionPattern()})\\s+(?:in|of)\\s+(?:the\\s+)?(?:series|saga|collection)\\b`, 'i'),
  ]) {
    const match = context.match(pattern);
    const parsed = match ? parseDetectivePositionToken(match[1]) : null;
    if (parsed !== null && parsed > 0) {
      position = parsed;
      break;
    }
  }

  return { name: wantedSeriesName.trim(), position };
};

export const inferDetectiveSeriesFromTitle = (
  value?: string,
): { name: string; position: number | null } | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const suffix = text.match(/[\[(]([^\])]+)[\])]\s*$/)?.[1]?.trim();
  const candidate = suffix ?? text.split(':').slice(-1)[0]?.trim();
  if (!candidate) return null;

  const match = candidate.match(new RegExp(
    `^(.*?)(?:\\s*,?\\s*)(?:#\\s*|book\\s*#?\\s*|vol(?:ume)?\\.?\\s*#?\\s*|part\\s*#?\\s*)(${detectivePositionPattern()})\\s*$`,
    'i',
  ));
  if (!match) return null;

  const name = match[1].trim().replace(/[,:;\-]+$/g, '');
  if (name.length < 2 || GENERIC_SERIES_WORDS.has(name.toLowerCase())) return null;
  return { name, position: parseDetectivePositionToken(match[2]) };
};

export const buildSeriesDetectionQueries = (book: UserBookRecord): { workQuery: string; identifiers: string[] } => {
  const identifiers = [...new Set(
    book.editions
      .flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])
      .map((value) => typeof value === 'string' ? value.trim() : '')
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
