import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from './model/bookSearch';

const CURRENT_YEAR = new Date().getFullYear();
const MAX_REASONABLE_PAGE_COUNT = 20000;
const SUPPLEMENT_PATTERN = /\b(?:box\s*set|boxed\s*set|omnibus|study\s*guide|summary(?:\s*&\s*analysis)?|companion|workbook|three\s+classic\s+novels|collection\s+of\s+novels)\b/i;

const compact = (value?: string) => value?.replace(/\s+/g, ' ').trim() ?? '';
const normalizeKey = (value?: string) => compact(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const canonicalAuthorIdentity = (value?: string): string => {
  let author = compact(value);
  if (!author) return '';

  // Catalogs frequently invert names as "Last, First". Normalize that display
  // variation without changing the user-facing author string.
  const commaParts = author.split(',').map((part) => compact(part)).filter(Boolean);
  if (commaParts.length >= 2 && !/\d/.test(commaParts[1])) {
    const trailingSuffix = commaParts
      .slice(2)
      .filter((part) => /^(?:jr|sr|ii|iii|iv|v)\.?$/i.test(part))
      .join(' ');
    author = `${commaParts[1]} ${commaParts[0]}${trailingSuffix ? ` ${trailingSuffix}` : ''}`;
  }

  // Honorifics are not identity. Dates/biographical parentheticals from
  // authority records are not identity either.
  author = author
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(?:dame|sir|dr|mr|mrs|ms)\.?\s+/i, '');

  return normalizeKey(author);
};

const LANGUAGE_ALIASES: Record<string, string> = {
  eng: 'en', english: 'en',
  spa: 'es', spanish: 'es', esp: 'es',
  fra: 'fr', fre: 'fr', french: 'fr',
  deu: 'de', ger: 'de', german: 'de',
  ita: 'it', italian: 'it',
  por: 'pt', portuguese: 'pt',
  nld: 'nl', dut: 'nl', dutch: 'nl',
  rus: 'ru', russian: 'ru',
  jpn: 'ja', japanese: 'ja',
  zho: 'zh', chi: 'zh', chinese: 'zh',
  kor: 'ko', korean: 'ko',
};

export const canonicalLanguageCode = (value?: string): string | undefined => {
  let language = compact(value).toLocaleLowerCase().replace(/_/g, '-');
  if (!language) return undefined;
  language = language.replace(/^\/languages\//, '');
  const base = language.split('-')[0];
  return LANGUAGE_ALIASES[language] ?? LANGUAGE_ALIASES[base] ?? base;
};
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const titleWords = (value?: string): string[] => normalizeKey(value).split(' ').filter(Boolean);

const SEARCH_STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'for', 'in', 'on', 'at', 'by']);
const meaningfulSearchWords = (value?: string): string[] =>
  titleWords(value).filter((word) => word.length > 1 && !SEARCH_STOP_WORDS.has(word));

export const catalogSearchRelevanceScore = (group: BookSearchWorkGroup, query?: string): number => {
  const wanted = normalizeKey(query);
  if (!wanted) return 0;

  const title = normalizeKey(group.title);
  const subtitle = normalizeKey(group.subtitle);
  const authorText = normalizeKey(group.authors.join(' '));
  const queryWords = meaningfulSearchWords(query);
  if (!queryWords.length) return 0;

  if (title === wanted) return 1000;
  if (subtitle && `${title} ${subtitle}` === wanted) return 950;
  if (title.startsWith(`${wanted} `) || wanted.startsWith(`${title} `)) return 850;

  const titleWordsSet = new Set(meaningfulSearchWords(group.title));
  const subtitleWordsSet = new Set(meaningfulSearchWords(group.subtitle));
  const authorWordsSet = new Set(meaningfulSearchWords(group.authors.join(' ')));
  const titleMatches = queryWords.filter((word) => titleWordsSet.has(word)).length;
  const subtitleMatches = queryWords.filter((word) => subtitleWordsSet.has(word)).length;
  const authorMatches = queryWords.filter((word) => authorWordsSet.has(word)).length;
  const titleCoverage = titleMatches / queryWords.length;

  let score = titleMatches * 120 + subtitleMatches * 35 + authorMatches * 25;
  if (titleCoverage === 1) score += 500;
  else if (titleCoverage >= 0.75) score += 300;
  else if (titleCoverage >= 0.5) score += 120;

  if (title.includes(wanted)) score += 250;
  if (authorText === wanted) score += 700;

  return score;
};

const catalogSearchResultIsRelevant = (group: BookSearchWorkGroup, query?: string): boolean => {
  const wanted = normalizeKey(query);
  if (!wanted) return true;

  const queryWords = meaningfulSearchWords(query);
  if (queryWords.length <= 1) return true;

  const titleWordsSet = new Set(meaningfulSearchWords(group.title));
  const subtitleWordsSet = new Set(meaningfulSearchWords(group.subtitle));
  const authorWordsSet = new Set(meaningfulSearchWords(group.authors.join(' ')));

  const matchedTitleWords = queryWords.filter((word) => titleWordsSet.has(word)).length;
  const matchedAcrossRecord = queryWords.filter((word) =>
    titleWordsSet.has(word) || subtitleWordsSet.has(word) || authorWordsSet.has(word),
  ).length;

  // Multi-word searches should not be polluted by records that merely contain
  // one common word. Keep a result only when at least half of the meaningful
  // query terms match, with at least one match in the title itself.
  return matchedTitleWords >= 1 && matchedAcrossRecord >= Math.ceil(queryWords.length / 2);
};


export const catalogTitlesAreCompatible = (left?: string, right?: string): boolean => {  const a = normalizeKey(left);
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
    const key = canonicalAuthorIdentity(author);
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

const cleanLanguage = (value?: string): string | undefined =>
  canonicalLanguageCode(value);

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
  const format = bindingFormat ?? edition.format;
  return {
    ...edition,
    // Binding is edition-level evidence and outranks provider work-level format
    // guesses. This prevents exact paperback/hardcover ISBNs from being saved as
    // ebooks when a catalog provider labels the work generically.
    format,
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
    pageCount: format === 'audiobook' ? undefined : cleanPageCount(edition.pageCount),
    coverUrl: cleanUrl(edition.coverUrl),
    editionName: compact(edition.editionName) || undefined,
    binding,
    specialFeatures: [...new Set(edition.specialFeatures.map(compact).filter(Boolean))].slice(0, 12),
  };
};

const enrichConsistentSameFormatPageCounts = (
  editions: BookSearchEdition[],
): BookSearchEdition[] =>
  editions.map((edition) => {
    if (edition.format === 'audiobook' || edition.pageCount) return edition;

    const editionLanguage = cleanLanguage(edition.language);
    const compatibleCounts = editions
      .filter((candidate) => {
        if (candidate === edition) return false;
        if (candidate.format !== edition.format) return false;
        const candidateLanguage = cleanLanguage(candidate.language);
        if (editionLanguage && candidateLanguage && editionLanguage !== candidateLanguage) return false;
        return Boolean(cleanPageCount(candidate.pageCount));
      })
      .map((candidate) => cleanPageCount(candidate.pageCount))
      .filter((value): value is number => typeof value === 'number');

    const uniqueCounts = [...new Set(compatibleCounts)];
    return uniqueCounts.length === 1
      ? { ...edition, pageCount: uniqueCounts[0] }
      : edition;
  });

export const catalogEditionQualityScore = (edition: BookSearchEdition): number => {
  let score = 0;
  // Provider authority is explicit. Supplemental sources may fill gaps, but
  // they must not displace stronger canonical edition evidence just because
  // they happen to return more optional fields.
  if (edition.source === 'inkbound-catalog') score += 30;
  else if (edition.source === 'google-books') score += 18;
  else if (edition.source === 'hardcover') score += 14;
  else if (edition.source === 'open-library') score += 10;
  else if (edition.source === 'crossref') score += 4;
  else if (edition.source === 'library-of-congress') score += 2;
  else if (edition.source === 'internet-archive') score += 2;
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


export const enrichSelectedCatalogEdition = (
  work: BookSearchWorkGroup,
  selectedEdition: BookSearchEdition,
): BookSearchEdition => {
  const hardenedWork = hardenCatalogGroups([work])[0] ?? work;
  const selected = hardenCatalogEdition(selectedEdition);

  const exactSelected = hardenedWork.editions.find((edition) =>
    edition.source === selected.source
    && edition.externalEditionId === selected.externalEditionId,
  ) ?? selected;

  const selectedIsbns = new Set(
    [exactSelected.isbn13, exactSelected.isbn10]
      .map(compactIsbn)
      .filter(Boolean),
  );

  const exactIdentityMatches = hardenedWork.editions.filter((candidate) =>
    candidate !== exactSelected
    && [candidate.isbn13, candidate.isbn10]
      .map(compactIsbn)
      .filter(Boolean)
      .some((isbn) => selectedIsbns.has(isbn)),
  );

  let enriched = exactIdentityMatches.reduce(
    (current, candidate) => supplementExactIsbnEdition(current, candidate),
    exactSelected,
  );

  const compatibleFormatCandidates = hardenedWork.editions.filter((candidate) => {
    if (candidate === exactSelected) return false;
    if (candidate.format !== exactSelected.format) return false;
    const selectedLanguage = cleanLanguage(exactSelected.language);
    const candidateLanguage = cleanLanguage(candidate.language);
    if (selectedLanguage && candidateLanguage && selectedLanguage !== candidateLanguage) return false;
    return true;
  });

  if (!enriched.pageCount) {
    const pageCounts = [...new Set(
      compatibleFormatCandidates
        .map((candidate) => cleanPageCount(candidate.pageCount))
        .filter((value): value is number => typeof value === 'number'),
    )];
    if (pageCounts.length === 1) enriched = { ...enriched, pageCount: pageCounts[0] };
  }

  if (!enriched.seriesName) {
    const named = compatibleFormatCandidates
      .map((candidate) => candidate.seriesName?.trim())
      .filter((value): value is string => Boolean(value));
    const byKey = new Map<string, string>();
    named.forEach((name) => byKey.set(normalizeKey(name), name));
    if (byKey.size === 1) {
      const [seriesKey, seriesName] = [...byKey.entries()][0];
      const orders = [...new Set(
        compatibleFormatCandidates
          .filter((candidate) => normalizeKey(candidate.seriesName) === seriesKey)
          .map((candidate) => candidate.seriesOrder)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      )];
      enriched = {
        ...enriched,
        seriesName,
        seriesOrder: orders.length === 1 ? orders[0] : enriched.seriesOrder,
      };
    }
  }

  return hardenCatalogEdition(enriched);
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
  `${normalizeKey(group.title)}::${canonicalAuthorIdentity(group.authors[0])}`;

export const inferCatalogAuthorIntent = (
  groups: BookSearchWorkGroup[],
  query?: string,
): string | undefined => {
  const candidate = compact(query);
  const normalizedCandidate = normalizeKey(candidate);
  if (!normalizedCandidate || /\d/.test(candidate) || candidate.split(/\s+/).length > 5) return undefined;

  const exactMatches = groups.filter((group) =>
    cleanAuthors(group.authors).some((author) => canonicalAuthorIdentity(author) === canonicalAuthorIdentity(candidate)),
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
    const primaryAuthorKey = canonicalAuthorIdentity(hardened.authors[0]);
    const authorIsUnknown = primaryAuthorKey === 'unknown author';
    const compatibleIdentity = order.find((candidateKey) => {
      const candidate = merged.get(candidateKey);
      if (!candidate) return false;

      const candidateAuthorKey = canonicalAuthorIdentity(candidate.authors[0]);
      const authorCompatible = authorIsUnknown
        || candidateAuthorKey === 'unknown author'
        || candidateAuthorKey === primaryAuthorKey;
      if (!authorCompatible) return false;

      const titleCompatible = catalogTitlesAreCompatible(candidate.title, hardened.title);
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

    if (canonicalAuthorIdentity(existing.authors[0]) === 'unknown author' && !authorIsUnknown) {
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
      if (seriesByKey.size !== 1) {
        return { ...group, editions: enrichConsistentSameFormatPageCounts(group.editions) };
      }

      const [seriesKey, canonicalSeriesName] = [...seriesByKey.entries()][0];
      const matchingOrders = [...new Set(group.editions
        .filter((edition) => normalizeKey(edition.seriesName) === seriesKey)
        .map((edition) => edition.seriesOrder)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))];
      const canonicalOrder = matchingOrders.length === 1 ? matchingOrders[0] : undefined;

      return {
        ...group,
        editions: enrichConsistentSameFormatPageCounts(
          group.editions.map((edition) => ({
            ...edition,
            seriesName: edition.seriesName || canonicalSeriesName,
            seriesOrder: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : canonicalOrder,
          })),
        ),
      };
    });

  const preferredAuthorValue = options.preferredAuthor || inferCatalogAuthorIntent(hardenedGroups, options.searchQuery);
  const preferredAuthor = canonicalAuthorIdentity(preferredAuthorValue);
  const shouldApplyTitleRelevance = Boolean(options.searchQuery && !preferredAuthor);

  let relevantGroups = shouldApplyTitleRelevance
    ? hardenedGroups.filter((group) => catalogSearchResultIsRelevant(group, options.searchQuery))
    : hardenedGroups;

  // Exact-title matches already receive the strongest relevance score below.
  // Do not prune other relevant results merely because an exact match exists:
  // Add Reading Material is a discovery surface, so ranking must guide the user
  // without turning a good exact hit into an accidental exact-only search.

  return relevantGroups.sort((left, right) => {
    const authorScore = (group: BookSearchWorkGroup) => {
      if (!preferredAuthor) return 0;
      const normalizedAuthors = group.authors.map(canonicalAuthorIdentity);
      const exactIndex = normalizedAuthors.indexOf(preferredAuthor);
      if (exactIndex < 0) return normalizedAuthors.includes('unknown author') ? -80 : -120;
      if (normalizedAuthors.length === 1) return 90;
      return exactIndex === 0 ? 55 : 35;
    };
    const supplementPenalty = (group: BookSearchWorkGroup) => SUPPLEMENT_PATTERN.test(group.title) ? 90 : 0;
    const authorNamedTitlePenalty = (group: BookSearchWorkGroup) =>
      preferredAuthor && normalizeKey(group.title) === preferredAuthor && group.authors.length > 1 ? 70 : 0;
    const score = (group: BookSearchWorkGroup) =>
      (shouldApplyTitleRelevance ? catalogSearchRelevanceScore(group, options.searchQuery) : 0)
      + authorScore(group)
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
