import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from './model/bookSearch';

const CURRENT_YEAR = new Date().getFullYear();
const MAX_REASONABLE_PAGE_COUNT = 20000;
const SUPPLEMENT_PATTERN = /\b(?:box\s*set|boxed\s*set|omnibus|study\s*guide|summary(?:\s*&\s*analysis)?|companion|workbook|three\s+classic\s+novels|collection\s+of\s+novels)\b/i;

const compact = (value?: string) => value?.replace(/\s+/g, ' ').trim() ?? '';
const normalizeKey = (value?: string) => compact(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const titleWords = (value?: string): string[] => normalizeKey(value).split(' ').filter(Boolean);

const titlesAreCompatibleWorkVariants = (left?: string, right?: string): boolean => {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const shorterWords = titleWords(shorter);
  const longerWords = titleWords(longer);

  // Treat a longer title as the same work only when the shorter side is already
  // specific enough to stand on its own and the extra text is a modest
  // subtitle/series suffix. This avoids collapsing broad parent titles such as
  // "Harry Potter" into every individual Harry Potter novel.
  return shorterWords.length >= 3
    && longer.startsWith(`${shorter} `)
    && longerWords.length - shorterWords.length <= 6;
};

const groupsShareEditionIsbn = (left: BookSearchWorkGroup, right: BookSearchWorkGroup): boolean => {
  const left13 = new Set(left.editions.map((edition) => compactIsbn(edition.isbn13)).filter(Boolean));
  const right13 = new Set(right.editions.map((edition) => compactIsbn(edition.isbn13)).filter(Boolean));
  if ([...left13].some((isbn) => right13.has(isbn))) return true;

  // ISBN-10 is a fallback only when neither side gives us a comparable ISBN-13.
  if (left13.size > 0 && right13.size > 0) return false;
  const left10 = new Set(left.editions.map((edition) => compactIsbn(edition.isbn10)).filter(Boolean));
  const right10 = new Set(right.editions.map((edition) => compactIsbn(edition.isbn10)).filter(Boolean));
  return [...left10].some((isbn) => right10.has(isbn));
};

export const isValidCatalogIsbn10 = (value?: string): boolean => {
  const isbn = compactIsbn(value);
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  const sum = isbn.split('').reduce((total, character, index) => {
    const digit = character === 'X' ? 10 : Number(character);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
};

export const isValidCatalogIsbn13 = (value?: string): boolean => {
  const isbn = compactIsbn(value);
  if (!/^(978|979)\d{10}$/.test(isbn)) return false;
  const digits = isbn.split('').map(Number);
  const weighted = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return digits[12] === (10 - (weighted % 10)) % 10;
};

const titleCaseIfShouting = (value: string): string => {
  const text = compact(value);
  const letters = [...text].filter((character) => /[A-Za-z]/.test(character));
  if (letters.length < 6) return text;
  const uppercaseRatio = letters.filter((character) => character === character.toUpperCase()).length / letters.length;
  if (uppercaseRatio < 0.85) return text;
  return text
    .toLocaleLowerCase()
    .replace(/(^|[\s:–—-])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
};

const cleanAuthors = (authors: string[]): string[] => {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of authors) {
    const author = compact(raw);
    if (!author) continue;
    const key = normalizeKey(author);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(author);
  }
  return cleaned.length ? cleaned : ['Unknown author'];
};

const cleanGenres = (genres: string[]): string[] => {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of genres) {
    const genre = compact(raw);
    const key = normalizeKey(genre);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(genre);
    if (cleaned.length >= 16) break;
  }
  return cleaned;
};

const cleanLanguage = (value?: string): string | undefined => {
  const language = compact(value);
  if (!language) return undefined;
  return language.toLocaleLowerCase().replace(/_/g, '-').slice(0, 24);
};

const formatFromBinding = (binding?: string): BookSearchEdition['format'] | undefined => {
  const normalized = normalizeKey(binding);
  if (!normalized) return undefined;
  if (/\b(?:audio|audiobook|cd|mp3)\b/.test(normalized)) return 'audiobook';
  if (/\b(?:ebook|e book|kindle|digital|epub)\b/.test(normalized)) return 'ebook';
  if (/\b(?:paperback|softcover|soft cover|mass market|trade paper)\b/.test(normalized)) return 'paperback';
  if (/\b(?:hardcover|hardback|hard cover|library binding)\b/.test(normalized)) return 'hardcover';
  return undefined;
};

const cleanPageCount = (value?: number): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_REASONABLE_PAGE_COUNT ? rounded : undefined;
};

const cleanPublicationYear = (value: number): number => {
  if (Number.isInteger(value) && value >= 1450 && value <= CURRENT_YEAR + 2) return value;
  // BookSearchEdition currently requires a year. Keep the provider's numeric
  // contract stable while preventing impossible future/ancient values from
  // winning edition-quality ranking.
  return 0;
};

const cleanUrl = (value?: string): string | undefined => {
  const url = compact(value);
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) return undefined;
  return url.replace(/^http:/i, 'https:');
};

export const hardenCatalogEdition = (edition: BookSearchEdition): BookSearchEdition => {
  const isbn10 = isValidCatalogIsbn10(edition.isbn10) ? compactIsbn(edition.isbn10) : undefined;
  const isbn13 = isValidCatalogIsbn13(edition.isbn13) ? compactIsbn(edition.isbn13) : undefined;
  const binding = compact(edition.binding) || undefined;
  const bindingFormat = formatFromBinding(binding);
  return {
    ...edition,
    // Binding is edition-level evidence and outranks provider work-level format
    // guesses. This prevents exact paperback/hardcover ISBNs from being saved as
    // ebooks when a catalog provider labels the work generically.
    format: bindingFormat ?? edition.format,
    externalEditionId: compact(edition.externalEditionId),
    title: titleCaseIfShouting(edition.title),
    subtitle: compact(edition.subtitle) || undefined,
    authors: cleanAuthors(edition.authors),
    publisherSummary: compact(edition.publisherSummary) || undefined,
    genres: cleanGenres(edition.genres),
    publisher: compact(edition.publisher) || undefined,
    publicationDate: compact(edition.publicationDate) || undefined,
    publicationYear: cleanPublicationYear(edition.publicationYear),
    language: cleanLanguage(edition.language),
    seriesName: compact(edition.seriesName) || undefined,
    seriesOrder: typeof edition.seriesOrder === 'number' && Number.isFinite(edition.seriesOrder) && edition.seriesOrder >= 0 ? edition.seriesOrder : undefined,
    isbn10,
    isbn13,
    asin: compact(edition.asin)?.toUpperCase() || undefined,
    pageCount: cleanPageCount(edition.pageCount),
    coverUrl: cleanUrl(edition.coverUrl),
    editionName: compact(edition.editionName) || undefined,
    binding,
    specialFeatures: [...new Set(edition.specialFeatures.map(compact).filter(Boolean))].slice(0, 12),
  };
};

export const catalogEditionQualityScore = (edition: BookSearchEdition): number => {
  let score = 0;
  if (edition.source === 'inkbound-catalog') score += 30;
  if (isValidCatalogIsbn13(edition.isbn13)) score += 18;
  else if (isValidCatalogIsbn10(edition.isbn10)) score += 12;
  if (edition.coverUrl) score += 12;
  if (edition.pageCount) score += 10;
  if (edition.publisher) score += 6;
  if (edition.publicationDate) score += 5;
  if (edition.publicationYear > 0) score += 4;
  if (edition.language) score += 4;
  if (edition.seriesName) score += 8;
  if (typeof edition.seriesOrder === 'number') score += 6;
  if (edition.publisherSummary) score += 4;
  if (edition.binding) score += 2;
  return score;
};

const exactIsbnAnchorScore = (edition: BookSearchEdition): number => {
  let score = catalogEditionQualityScore(edition);
  // Exact-edition physical evidence outranks a provider's generic work-level
  // guess. Hardcover and curated Inkbound records expose edition binding more
  // reliably; Open Library can now contribute physical_format when present.
  if (edition.binding?.trim()) score += 80;
  if (edition.source === 'inkbound-catalog') score += 60;
  else if (edition.source === 'hardcover') score += 35;
  else if (edition.source === 'open-library') score += 15;
  else if (edition.source === 'google-books') score += 5;
  return score;
};

const exactIsbnPageCountAuthority = (edition: BookSearchEdition): number => {
  if (!edition.pageCount) return 0;
  if (edition.source === 'inkbound-catalog') return 40;
  // Google Books defines pageCount as publisher metadata. Prefer it when
  // multiple providers disagree about the same ISBN.
  if (edition.source === 'google-books') return 30;
  if (edition.source === 'hardcover') return 20;
  if (edition.source === 'open-library') return 10;
  return 0;
};

const chooseExactIsbnPageCount = (
  anchor: BookSearchEdition,
  supplement: BookSearchEdition,
  languageCompatible: boolean,
): number | undefined => {
  if (!languageCompatible) return anchor.pageCount;
  if (!anchor.pageCount) return supplement.pageCount;
  if (!supplement.pageCount) return anchor.pageCount;
  return exactIsbnPageCountAuthority(supplement) > exactIsbnPageCountAuthority(anchor)
    ? supplement.pageCount
    : anchor.pageCount;
};

const supplementExactIsbnEdition = (
  anchor: BookSearchEdition,
  supplement: BookSearchEdition,
): BookSearchEdition => {
  const anchorLanguage = cleanLanguage(anchor.language);
  const supplementLanguage = cleanLanguage(supplement.language);
  const languageCompatible = !anchorLanguage || !supplementLanguage || anchorLanguage === supplementLanguage;

  return {
    ...supplement,
    ...anchor,
    subtitle: anchor.subtitle || supplement.subtitle,
    publisherSummary: anchor.publisherSummary || supplement.publisherSummary,
    genres: cleanGenres([...anchor.genres, ...supplement.genres]),
    publisher: anchor.publisher || supplement.publisher,
    publicationDate: anchor.publicationDate || supplement.publicationDate,
    publicationYear: anchor.publicationYear || supplement.publicationYear,
    language: anchor.language || supplement.language,
    seriesName: anchor.seriesName || supplement.seriesName,
    seriesOrder: typeof anchor.seriesOrder === 'number' ? anchor.seriesOrder : supplement.seriesOrder,
    isbn10: anchor.isbn10 || supplement.isbn10,
    isbn13: anchor.isbn13 || supplement.isbn13,
    asin: anchor.asin || supplement.asin,
    // Edition-specific identity never gets replaced by a richer but
    // contradictory provider record once the exact-ISBN anchor is chosen.
    format: anchor.format,
    pageCount: chooseExactIsbnPageCount(anchor, supplement, languageCompatible),
    coverUrl: anchor.coverUrl || (languageCompatible ? supplement.coverUrl : undefined),
    editionName: anchor.editionName || (languageCompatible ? supplement.editionName : undefined),
    binding: anchor.binding || (languageCompatible ? supplement.binding : undefined),
    specialFeatures: [...new Set([...anchor.specialFeatures, ...supplement.specialFeatures])].slice(0, 12),
  };
};





const sharesExactIsbnIdentity = (left: BookSearchEdition, right: BookSearchEdition): boolean => {
  // ISBN-13 is the strongest identifier. If both records provide one and they
  // disagree, they are different editions even if a provider attached the same
  // ISBN-10 incorrectly. Only fall back to ISBN-10 when an ISBN-13 comparison
  // is not available on both sides.
  if (left.isbn13 && right.isbn13) return left.isbn13 === right.isbn13;
  if (left.isbn10 && right.isbn10) return left.isbn10 === right.isbn10;
  return false;
};

const sameEdition = (left: BookSearchEdition, right: BookSearchEdition): boolean => {
  if (left.source === right.source && left.externalEditionId && left.externalEditionId === right.externalEditionId) return true;
  return sharesExactIsbnIdentity(left, right);
};

export const mergeCatalogEditionData = (left: BookSearchEdition, right: BookSearchEdition): BookSearchEdition => {
  const sharedExactIsbn = sharesExactIsbnIdentity(left, right);
  if (sharedExactIsbn) {
    const anchor = exactIsbnAnchorScore(right) > exactIsbnAnchorScore(left) ? right : left;
    const supplement = anchor === left ? right : left;
    return supplementExactIsbnEdition(anchor, supplement);
  }

  const preferred = catalogEditionQualityScore(right) > catalogEditionQualityScore(left) ? right : left;
  const supplement = preferred === left ? right : left;
  return {
    ...supplement,
    ...preferred,
    subtitle: preferred.subtitle || supplement.subtitle,
    publisherSummary: preferred.publisherSummary || supplement.publisherSummary,
    genres: cleanGenres([...preferred.genres, ...supplement.genres]),
    publisher: preferred.publisher || supplement.publisher,
    publicationDate: preferred.publicationDate || supplement.publicationDate,
    publicationYear: preferred.publicationYear || supplement.publicationYear,
    language: preferred.language || supplement.language,
    seriesName: preferred.seriesName || supplement.seriesName,
    seriesOrder: typeof preferred.seriesOrder === 'number' ? preferred.seriesOrder : supplement.seriesOrder,
    isbn10: preferred.isbn10 || supplement.isbn10,
    isbn13: preferred.isbn13 || supplement.isbn13,
    asin: preferred.asin || supplement.asin,
    pageCount: preferred.pageCount || supplement.pageCount,
    coverUrl: preferred.coverUrl || supplement.coverUrl,
    editionName: preferred.editionName || supplement.editionName,
    binding: preferred.binding || supplement.binding,
    specialFeatures: [...new Set([...preferred.specialFeatures, ...supplement.specialFeatures])].slice(0, 12),
  };
};


export const selectExactIsbnEdition = (
  groups: BookSearchWorkGroup[],
  isbn: string,
): { work: BookSearchWorkGroup; edition: BookSearchEdition } | null => {
  const wanted = compactIsbn(isbn);
  if (!wanted) return null;

  const exact = groups.flatMap((work) =>
    work.editions
      .map(hardenCatalogEdition)
      .filter((edition) => [edition.isbn13, edition.isbn10].map(compactIsbn).includes(wanted))
      .map((edition) => ({ work, edition })),
  );
  if (!exact.length) return null;

  exact.sort((left, right) => exactIsbnAnchorScore(right.edition) - exactIsbnAnchorScore(left.edition));
  const preferred = exact[0];
  const mergedEdition = exact.slice(1).reduce(
    (current, candidate) => supplementExactIsbnEdition(current, candidate.edition),
    preferred.edition,
  );
  return { work: preferred.work, edition: mergedEdition };
};

const workIdentity = (group: BookSearchWorkGroup): string =>
  `${normalizeKey(group.title)}::${normalizeKey(group.authors[0])}`;

export const inferCatalogAuthorIntent = (
  groups: BookSearchWorkGroup[],
  query?: string,
): string | undefined => {
  const candidate = compact(query);
  const normalizedCandidate = normalizeKey(candidate);
  if (!normalizedCandidate || /\d/.test(candidate) || candidate.split(/\s+/).length > 5) return undefined;

  const exactMatches = groups.filter((group) =>
    cleanAuthors(group.authors).some((author) => normalizeKey(author) === normalizedCandidate),
  ).length;

  return exactMatches >= 2 ? candidate : undefined;
};

export const hardenCatalogGroups = (
  groups: BookSearchWorkGroup[],
  options: { preferredAuthor?: string; searchQuery?: string } = {},
): BookSearchWorkGroup[] => {
  const merged = new Map<string, BookSearchWorkGroup>();
  const order: string[] = [];

  for (const raw of groups) {
    const title = titleCaseIfShouting(raw.title);
    if (!title) continue;
    const authors = cleanAuthors(raw.authors);
    const editions = raw.editions.map(hardenCatalogEdition).filter((edition) => edition.externalEditionId && edition.title);
    if (!editions.length) continue;

    const hardened: BookSearchWorkGroup = {
      ...raw,
      title,
      subtitle: compact(raw.subtitle) || undefined,
      authors,
      publisherSummary: compact(raw.publisherSummary) || undefined,
      genres: cleanGenres(raw.genres),
      editions: [],
    };

    for (const edition of editions) {
      const duplicateIndex = hardened.editions.findIndex((candidate) => sameEdition(candidate, edition));
      if (duplicateIndex < 0) hardened.editions.push(edition);
      else hardened.editions[duplicateIndex] = mergeCatalogEditionData(hardened.editions[duplicateIndex], edition);
    }
    hardened.editions.sort((a, b) => catalogEditionQualityScore(b) - catalogEditionQualityScore(a));

    let identity = workIdentity(hardened);
    if (!identity.replace(/[:]/g, '')) continue;

    const titleKey = normalizeKey(hardened.title);
    const primaryAuthorKey = normalizeKey(hardened.authors[0]);
    const authorIsUnknown = primaryAuthorKey === 'unknown author';
    const compatibleIdentity = order.find((candidateKey) => {
      const candidate = merged.get(candidateKey);
      if (!candidate) return false;

      const candidateAuthorKey = normalizeKey(candidate.authors[0]);
      const authorCompatible = authorIsUnknown
        || candidateAuthorKey === 'unknown author'
        || candidateAuthorKey === primaryAuthorKey;
      if (!authorCompatible) return false;

      const titleCompatible = titlesAreCompatibleWorkVariants(candidate.title, hardened.title);
      if (!titleCompatible) return false;

      // ISBN agreement may strengthen a compatible-title match, but it must
      // never collapse unrelated works when a provider attached a bad/shared
      // identifier (for example a box set carrying a constituent book ISBN).
      return true;
    });
    if (compatibleIdentity) identity = compatibleIdentity;

    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, hardened);
      order.push(identity);
      continue;
    }

    if (normalizeKey(existing.authors[0]) === 'unknown author' && !authorIsUnknown) {
      existing.authors = hardened.authors;
    }

    existing.genres = cleanGenres([...existing.genres, ...hardened.genres]);
    existing.publisherSummary ||= hardened.publisherSummary;
    existing.subtitle ||= hardened.subtitle;
    for (const edition of hardened.editions) {
      const duplicateIndex = existing.editions.findIndex((candidate) => sameEdition(candidate, edition));
      if (duplicateIndex < 0) existing.editions.push(edition);
      else existing.editions[duplicateIndex] = mergeCatalogEditionData(existing.editions[duplicateIndex], edition);
    }
    existing.editions.sort((a, b) => catalogEditionQualityScore(b) - catalogEditionQualityScore(a));
  }

  const hardenedGroups = order
    .map((key) => merged.get(key))
    .filter((group): group is BookSearchWorkGroup => Boolean(group))
    .map((group) => {
      // Series membership is work-level metadata even though providers expose
      // it on editions. If every structured provider that names a series agrees,
      // carry that relationship to sibling editions that omitted it so choosing
      // an ebook/paperback does not erase known series data.
      const namedSeries = group.editions
        .map((edition) => edition.seriesName?.trim())
        .filter((value): value is string => Boolean(value));
      const seriesByKey = new Map<string, string>();
      namedSeries.forEach((name) => seriesByKey.set(normalizeKey(name), name));
      if (seriesByKey.size !== 1) return group;

      const [seriesKey, canonicalSeriesName] = [...seriesByKey.entries()][0];
      const matchingOrders = [...new Set(group.editions
        .filter((edition) => normalizeKey(edition.seriesName) === seriesKey)
        .map((edition) => edition.seriesOrder)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))];
      const canonicalOrder = matchingOrders.length === 1 ? matchingOrders[0] : undefined;

      return {
        ...group,
        editions: group.editions.map((edition) => ({
          ...edition,
          seriesName: edition.seriesName || canonicalSeriesName,
          seriesOrder: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : canonicalOrder,
        })),
      };
    });

  const preferredAuthorValue = options.preferredAuthor || inferCatalogAuthorIntent(hardenedGroups, options.searchQuery);
  const preferredAuthor = normalizeKey(preferredAuthorValue);

  return hardenedGroups.sort((left, right) => {
    const authorScore = (group: BookSearchWorkGroup) => {
      if (!preferredAuthor) return 0;
      const normalizedAuthors = group.authors.map(normalizeKey);
      const exactIndex = normalizedAuthors.indexOf(preferredAuthor);
      if (exactIndex < 0) return normalizedAuthors.includes('unknown author') ? -80 : -120;
      if (normalizedAuthors.length === 1) return 90;
      return exactIndex === 0 ? 55 : 35;
    };
    const supplementPenalty = (group: BookSearchWorkGroup) => SUPPLEMENT_PATTERN.test(group.title) ? 90 : 0;
    const authorNamedTitlePenalty = (group: BookSearchWorkGroup) =>
      preferredAuthor && normalizeKey(group.title) === preferredAuthor && group.authors.length > 1 ? 70 : 0;
    const score = (group: BookSearchWorkGroup) =>
      authorScore(group)
      + catalogEditionQualityScore(group.editions[0])
      - supplementPenalty(group)
      - authorNamedTitlePenalty(group);

    return score(right) - score(left);
  });
};

export const hardenCatalogResponse = (
  response: BookSearchResponse,
  options: { preferredAuthor?: string; searchQuery?: string } = {},
): BookSearchResponse => {
  const groups = hardenCatalogGroups(response.groups ?? [], options);
  return { groups, totalItems: response.totalItems };
};
