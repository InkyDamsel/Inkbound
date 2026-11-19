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
  typeof value === 'string' ? value.trim().normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';

export const compactDetectiveIsbn = (value?: string): string =>
  typeof value === 'string' ? value.replace(/[^0-9X]/gi, '').toUpperCase() : '';

/** Validate ISBN checksums and convert both formats to a canonical ISBN-13.
 * ISBNs identify editions, not works. Invalid identifiers must never
 * contribute independent corroboration or suppress conflict detection. */
export const canonicalDetectiveIsbn13 = (value?: string): string | null => {
  const raw = compactDetectiveIsbn(value);
  if (/^\d{13}$/.test(raw)) {
    const sum = [...raw.slice(0, 12)].reduce((total, digit, index) =>
      total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10 === Number(raw[12]) ? raw : null;
  }
  if (!/^\d{9}[\dX]$/.test(raw)) return null;
  const sum10 = [...raw].reduce((total, digit, index) =>
    total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
  if (sum10 % 11 !== 0) return null;
  const stem = '978' + raw.slice(0, 9);
  const sum13 = [...stem].reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return stem + String((10 - (sum13 % 10)) % 10);
};

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

/** Only harmless publisher labels may be omitted from a work title.
 * Series names, adaptations, and numbered volumes are NOT generic subtitles. */
const GENERIC_WORK_SUBTITLES = new Set([
  'a novel', 'novel', 'a novella', 'novella', 'a story', 'a romance novel',
  'a thriller', 'a mystery', 'a fantasy novel',
]);
const UNSAFE_EDITION_TERMS = /\b(?:manga|graphic novel|adaptation|adapted|volume|vol|omnibus|collection|boxed set|box set|illustrated|deluxe|hardcover|paperback)\b/i;

export const detectiveWorkTitlesCompatible = (left?: string, right?: string, seriesName?: string): boolean => {
  const a = comparableDetectiveTitle(left, seriesName);
  const b = comparableDetectiveTitle(right, seriesName);
  if (!a || !b) return false;
  if (a === b) return true;
  const genericVariant = (value?: string): string | null => {
    const raw = typeof value === 'string' ? value.trim() : '';
    const index = raw.indexOf(':');
    if (index < 0) return null;
    const suffix = normalizeDetectiveText(raw.slice(index + 1));
    if (!GENERIC_WORK_SUBTITLES.has(suffix) || UNSAFE_EDITION_TERMS.test(suffix)) return null;
    return comparableDetectiveTitle(raw.slice(0, index), seriesName);
  };
  return genericVariant(left) === b || genericVariant(right) === a;
};

/** Provider placeholders are not evidence of an author's identity. */
const NON_AUTHOR_IDENTITIES = new Set([
  'unknown', 'unknown author', 'author unknown', 'anonymous', 'n a',
  'not available', 'not specified', 'various', 'various authors',
  'multiple authors', 'staff', 'editorial staff',
]);

export const isCredibleDetectiveAuthor = (value?: string): boolean => {
  const identity = normalizeDetectiveText(value);
  return Boolean(identity && !NON_AUTHOR_IDENTITIES.has(identity)
    && !/^(?:unknown|anonymous|various|n\\s*a)\\s+(?:author|authors)$/.test(identity));
};

export const canonicalDetectiveAuthor = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!isCredibleDetectiveAuthor(raw)) return '';

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
  if (!leftIds.size) return false;
  return detectiveAuthorCandidates(right).some((candidate) => leftIds.has(candidate));
};

export const canonicalDetectiveSeries = (value?: string): string => {
  // Treat ampersand and standalone 'x' as conjunction variants while keeping
  // the conjunction itself significant to the series identity.
  const normalizedConjunctions = typeof value === 'string'
    ? value.replace(/\s+[&x]\s+/gi, ' and ') : '';
  const tokens = normalizeDetectiveText(normalizedConjunctions).split(' ').filter(Boolean);
  // Generic structural qualifiers only: never alias a specific franchise or series.
  while (tokens.length > 1 && ['a', 'an', 'the'].includes(tokens[0])) tokens.shift();
  while (
    tokens.length > 1
    && ['series', 'saga', 'novel', 'novels', 'book', 'books', 'collection', 'collections', 'trilogy', 'duology', 'duet', 'quartet', 'quintet', 'sextet', 'septet', 'octet'].includes(tokens[tokens.length - 1])
  ) tokens.pop();
  // Conjunctions can distinguish genuinely different series names. Removing
  // them makes 'War and Peace' collide with 'War Peace'.
  return tokens.join(' ');
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
  // Normalize conjunction aliases in both the catalog text and requested
  // series. Keep the original token boundaries to avoid substring matches.
  const text = normalizeDetectiveText(
    typeof value === 'string' ? value.replace(/\s+[&x]\s+/gi, ' and ') : '',
  );
  const seriesIdentity = canonicalDetectiveSeries(wantedSeriesName);
  if (!text || !seriesIdentity) return null;

  const seriesTokens = seriesIdentity.split(' ').filter(Boolean);
  // A blurb mentioning 'will' and 'trent' separately is not Will Trent evidence.
  const paddedIndex = ` ${text} `.indexOf(` ${seriesIdentity} `);
  if (paddedIndex < 0) return null;

  const qualifierPattern = /\b(?:series|saga|novels?|books?|collection)\b/i;
  if (seriesTokens.length === 1 && !qualifierPattern.test(text)) return null;

  // Ordinals elsewhere in a blurb may describe unrelated books.
  // Only accept a number grammatically attached to this series name.
  const escapedSeries = seriesIdentity.replace(/[^a-z0-9 ]/g, '');
  const ordinal = detectivePositionPattern();
  const anchoredPatterns = [
    new RegExp(`\\b(?:book|volume|vol|part)\\s*#?\\s*(${ordinal})\\s+(?:in|of)\\s+(?:the\\s+)?${escapedSeries}\\b`, 'i'),
    new RegExp(`\\b(${ordinal})\\s+(?:book|novel|volume|part)\\s+(?:in|of)\\s+(?:the\\s+)?${escapedSeries}\\b`, 'i'),
    new RegExp(`\\b${escapedSeries}\\s+(?:(?:series|saga|collection)\\s+)?(?:book|volume|vol|part)\\s*#?\\s*(${ordinal})\\b`, 'i'),
  ];
  let position: number | null = null;
  for (const pattern of anchoredPatterns) {
    const match = text.match(pattern);
    const parsed = match ? parseDetectivePositionToken(match[1]) : null;
    if (parsed !== null && parsed > 0) { position = parsed; break; }
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

  const verifiedGroups = [...groups.values()]
    .map((group) => ({
      best: [...group].sort((a, b) => b.score - a.score)[0],
      distinctProviders: new Set(group.map((item) => item.providerId)).size,
      corroboratingProviders: Math.max(...group.map((item) => item.providerCount ?? 1)),
    }))
    .filter(({ best, distinctProviders, corroboratingProviders }) =>
      (best.structured && best.score >= 170)
      || (!best.structured
        && Math.max(distinctProviders, corroboratingProviders) >= 2
        && best.score >= 100),
    );
  // Never resolve contradictory verified claims by picking the highest score.
  // A missing ordinal is compatible with a known one; two different known
  // ordinals or two different series identities require human review.
  const seriesNames = new Set(verifiedGroups.map(({ best }) => canonicalDetectiveSeries(best.seriesName)));
  const knownPositions = new Set(verifiedGroups.map(({ best }) => best.position)
    .filter((position): position is number => position !== null));
  if (seriesNames.size > 1 || knownPositions.size > 1) return null;

  return verifiedGroups
    .sort((a, b) =>
      b.best.score - a.best.score
      || b.corroboratingProviders - a.corroboratingProviders
      || b.distinctProviders - a.distinctProviders,
    )[0]?.best ?? null;
};
