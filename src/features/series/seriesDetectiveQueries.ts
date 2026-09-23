import type { UserBookRecord } from '../../types';

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
