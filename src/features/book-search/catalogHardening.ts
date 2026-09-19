import type { BookSearchEdition, BookSearchResponse, BookSearchWorkGroup } from './model/bookSearch';

const CURRENT_YEAR = new Date().getFullYear();
const MAX_REASONABLE_PAGE_COUNT = 20000;
const SUPPLEMENT_PATTERN = /\b(?:box\s*set|boxed\s*set|omnibus|study\s*guide|summary(?:\s*&\s*analysis)?|companion|workbook|three\s+classic\s+novels|collection\s+of\s+novels)\b/i;

const compact = (value?: string) => value?.replace(/\s+/g, ' ').trim() ?? '';
const normalizeKey = (value?: string) => compact(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

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
  return {
    ...edition,
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
    isbn10,
    isbn13,
    asin: compact(edition.asin)?.toUpperCase() || undefined,
    pageCount: cleanPageCount(edition.pageCount),
    coverUrl: cleanUrl(edition.coverUrl),
    editionName: compact(edition.editionName) || undefined,
    binding: compact(edition.binding) || undefined,
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
  if (edition.publisherSummary) score += 4;
  if (edition.binding) score += 2;
  return score;
};

const sameEdition = (left: BookSearchEdition, right: BookSearchEdition): boolean => {
  if (left.source === right.source && left.externalEditionId && left.externalEditionId === right.externalEditionId) return true;
  if (left.isbn13 && right.isbn13 && left.isbn13 === right.isbn13) return true;
  if (left.isbn10 && right.isbn10 && left.isbn10 === right.isbn10) return true;
  return false;
};

const mergeEditionData = (left: BookSearchEdition, right: BookSearchEdition): BookSearchEdition => {
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

const workIdentity = (group: BookSearchWorkGroup): string =>
  `${normalizeKey(group.title)}::${normalizeKey(group.authors[0])}`;

export const hardenCatalogGroups = (
  groups: BookSearchWorkGroup[],
  options: { preferredAuthor?: string } = {},
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
      else hardened.editions[duplicateIndex] = mergeEditionData(hardened.editions[duplicateIndex], edition);
    }
    hardened.editions.sort((a, b) => catalogEditionQualityScore(b) - catalogEditionQualityScore(a));

    const identity = workIdentity(hardened);
    if (!identity.replace(/[:]/g, '')) continue;
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, hardened);
      order.push(identity);
      continue;
    }

    existing.genres = cleanGenres([...existing.genres, ...hardened.genres]);
    existing.publisherSummary ||= hardened.publisherSummary;
    existing.subtitle ||= hardened.subtitle;
    for (const edition of hardened.editions) {
      const duplicateIndex = existing.editions.findIndex((candidate) => sameEdition(candidate, edition));
      if (duplicateIndex < 0) existing.editions.push(edition);
      else existing.editions[duplicateIndex] = mergeEditionData(existing.editions[duplicateIndex], edition);
    }
    existing.editions.sort((a, b) => catalogEditionQualityScore(b) - catalogEditionQualityScore(a));
  }

  const preferredAuthor = normalizeKey(options.preferredAuthor);
  return order
    .map((key) => merged.get(key))
    .filter((group): group is BookSearchWorkGroup => Boolean(group))
    .sort((left, right) => {
      const authorBoost = (group: BookSearchWorkGroup) =>
        preferredAuthor && group.authors.some((author) => normalizeKey(author) === preferredAuthor) ? 40 : 0;
      const supplementPenalty = (group: BookSearchWorkGroup) => SUPPLEMENT_PATTERN.test(group.title) ? 25 : 0;
      const leftScore = authorBoost(left) + catalogEditionQualityScore(left.editions[0]) - supplementPenalty(left);
      const rightScore = authorBoost(right) + catalogEditionQualityScore(right.editions[0]) - supplementPenalty(right);
      return rightScore - leftScore;
    });
};

export const hardenCatalogResponse = (
  response: BookSearchResponse,
  options: { preferredAuthor?: string } = {},
): BookSearchResponse => {
  const groups = hardenCatalogGroups(response.groups ?? [], options);
  return { groups, totalItems: response.totalItems };
};
