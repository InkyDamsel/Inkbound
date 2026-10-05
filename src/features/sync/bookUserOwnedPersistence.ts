import type { UserBookRecord } from '../../types';

const timestampMillis = (value?: string) => {
  const millis = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(millis) ? millis : 0;
};

/**
 * Preserve a reader-selected manual cover when an incoming whole-book record
 * predates that manual choice or still carries provider metadata for the same
 * edition.
 *
 * Current builds stamp explicit cover changes. That lets a newer deliberate
 * cover choice from another device replace an older one while stale or legacy
 * records cannot roll the reader's cover backward.
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
  const incomingCover = incomingEdition.coverUrl?.trim();
  if (incomingEdition.externalSource === 'manual' && incomingCover === localEdition.coverUrl.trim()) return incoming;

  const localFreshness = timestampMillis(localEdition.manualCoverUpdatedAt);
  const incomingFreshness = timestampMillis(incomingEdition.manualCoverUpdatedAt);
  const incomingIsNewerExplicitManualCover = incomingEdition.externalSource === 'manual'
    && Boolean(incomingCover)
    && incomingFreshness > 0
    && incomingFreshness >= localFreshness;

  if (incomingIsNewerExplicitManualCover) return incoming;

  const editions = [...incoming.editions];
  editions[incomingEditionIndex] = {
    ...incomingEdition,
    coverUrl: localEdition.coverUrl,
    externalSource: 'manual',
    externalEditionId: localEdition.externalEditionId ?? incomingEdition.externalEditionId,
    manualCoverUpdatedAt: localEdition.manualCoverUpdatedAt,
  };

  return {
    ...incoming,
    activeEditionId: incoming.activeEditionId || local.activeEditionId,
    editions,
  };
}
