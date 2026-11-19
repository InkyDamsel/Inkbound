import type { DetectiveGoogleCatalog, DetectiveGoogleVolume } from './seriesDetectiveGoogleApi';
import { detectiveSeriesNamesCompatible } from './seriesDetectiveEvidence';

/** Only confirmed structured membership can seed sibling discovery. */
export const confirmedGoogleMembershipIds = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
  requestedSeries: string,
  allowSingleUnnamed: boolean,
): string[] => {
  const memberships = (volume.volumeInfo?.seriesInfo?.volumeSeries ?? [])
    .map(membership => membership.seriesId?.trim() ?? '')
    .filter(Boolean);
  const uniqueIds = [...new Set(memberships)];
  return uniqueIds.filter(id => {
    const name = catalog.seriesTitlesById[id];
    if (name) return detectiveSeriesNamesCompatible(name, requestedSeries);
    return allowSingleUnnamed && uniqueIds.length === 1;
  });
};
