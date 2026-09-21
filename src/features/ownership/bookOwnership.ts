import type { OwnershipStatus, UserBookRecord } from '../../types';

/**
 * Canonical explicit ownership transition.
 *
 * Passive normalization/hydration must never erase loan metadata because an older
 * device or legacy record can temporarily disagree about ownership. Only an
 * explicit reader ownership change is allowed to clear library-loan dates.
 */
export function withBookOwnership(
  book: UserBookRecord,
  ownership: OwnershipStatus,
  customOwnershipCategoryId?: string,
): UserBookRecord {
  return {
    ...book,
    ownership,
    customOwnershipCategoryId: ownership === 'custom' ? customOwnershipCategoryId : undefined,
    libraryLoan: ownership === 'borrowed-library' ? book.libraryLoan : undefined,
  };
}
