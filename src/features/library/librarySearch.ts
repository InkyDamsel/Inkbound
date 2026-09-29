import type { UserBookRecord } from '../../types';

/**
 * Normalizes imported/catalog text for user-facing library search.
 *
 * Imported metadata can contain non-breaking spaces, decomposed accents,
 * typographic punctuation, and repeated whitespace that render identically
 * while failing raw String.includes comparisons.
 */
export const normalizeLibrarySearchText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const bookMatchesLibrarySearch = (
  book: UserBookRecord,
  rawQuery: string,
): boolean => {
  const query = normalizeLibrarySearchText(rawQuery);
  if (!query) return true;

  return [
    book.work.title,
    book.work.author,
    book.work.seriesName ?? '',
    ...(book.privateTags ?? []),
  ].some((value) => normalizeLibrarySearchText(value).includes(query));
};
