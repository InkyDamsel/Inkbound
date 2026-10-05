import type { UserBookRecord } from '../../types';

/**
 * Preserve a reader-selected manual cover when an incoming whole-book record
 * predates that manual choice or still carries provider metadata for the same
 * edition.
 *
 * A different incoming manual cover remains authoritative so a deliberate
 * cover change made on another current device can still sync normally.
 */
export function mergeIncomingManualCoverState(
  local: UserBookRecord | undefined,
  incoming: UserBookRecord,
): UserBookRecord {
  if (!local) return incoming;

  const localActiveId = local.activeEditionId;
  const localEdition = local.editions.find((edition) => edition.id === localActiveId) ?? local.editions[0];
  if (!localEdition?.coverUrl?.trim() || localEdition.externalSource !== 'manual') return incoming;

  const incomingEditionIndex = incoming.editions.findIndex((edition) => edition.id === localEdition.id);
  if (incomingEditionIndex < 0) return incoming;

  const incomingEdition = incoming.editions[incomingEditionIndex];
  if (incomingEdition.externalSource === 'manual' && incomingEdition.coverUrl?.trim()) return incoming;

  const editions = [...incoming.editions];
  editions[incomingEditionIndex] = {
    ...incomingEdition,
    coverUrl: localEdition.coverUrl,
    externalSource: 'manual',
    externalEditionId: localEdition.externalEditionId ?? incomingEdition.externalEditionId,
  };

  return {
    ...incoming,
    activeEditionId: incoming.activeEditionId || local.activeEditionId,
    editions,
  };
}
