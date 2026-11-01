import type { UserBookRecord } from '../../types';

/**
 * Average the explicit ratings on a finished-book subset.
 * Unrated/zero/non-finite values are excluded; fractional star ratings remain intact.
 */
export function getAverageBookRating(books: readonly UserBookRecord[]): number | null {
  const ratings = books
    .map((book) => book.rating)
    .filter((rating): rating is number =>
      typeof rating === 'number' && Number.isFinite(rating) && rating > 0,
    );

  return ratings.length
    ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    : null;
}
