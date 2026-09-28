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

/**
 * Protect an active loan from an older/partial whole-book sync record.
 *
 * Firestore records from older builds may omit libraryLoan entirely while still
 * carrying borrowed-library ownership. Omission is not proof that the reader
 * cleared the loan. An explicit empty libraryLoan object is treated as a clear,
 * and an ownership change away from borrowed-library is also authoritative.
 */
export function mergeIncomingBookLoanState(
  current: UserBookRecord | undefined,
  incoming: UserBookRecord,
): UserBookRecord {
  if (!current) return incoming;
  if (incoming.ownership !== 'borrowed-library') return incoming;
  if (Object.prototype.hasOwnProperty.call(incoming, 'libraryLoan')) return incoming;
  if (current.ownership !== 'borrowed-library' || !current.libraryLoan) return incoming;
  return { ...incoming, libraryLoan: current.libraryLoan };
}
