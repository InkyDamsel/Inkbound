import type { UserBookRecord } from '../../types';

/**
 * Preserve reader-owned quote data when an older remote record predates the
 * favoriteQuotes field entirely.
 *
 * An explicit remote [] is meaningful: the reader may have deleted all quotes
 * on another device. An omitted field is not a delete instruction and must not
 * erase locally persisted quotes during hydration/delta reconciliation.
 */
export function mergeIncomingBookQuoteState(
  local: UserBookRecord | undefined,
  incoming: UserBookRecord,
): UserBookRecord {
  if (!local) return incoming;
  if (incoming.favoriteQuotes !== undefined) return incoming;
  if (local.favoriteQuotes === undefined) return incoming;
  return {
    ...incoming,
    favoriteQuotes: local.favoriteQuotes,
  };
}
