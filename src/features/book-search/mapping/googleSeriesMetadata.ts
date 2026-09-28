export interface GoogleVolumeSeriesMembership {
  seriesId?: string;
  orderNumber?: number;
  issue?: Array<{ issueOrderNumber?: number }>;
}

export interface GoogleVolumeSeriesInfo {
  bookDisplayNumber?: string;
  volumeSeries?: GoogleVolumeSeriesMembership[];
}

export interface ResolvedGoogleSeriesMetadata {
  name?: string;
  order?: number;
}

export interface GoogleBibliographicSeriesInfo {
  name?: string;
  position?: number;
}

const parseDisplayOrder = (value?: string): number | undefined => {
  const parsed = Number(value?.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * Canonical Google Books series resolver.
 *
 * Google exposes the relationship on volumeInfo.seriesInfo. volumeSeries.seriesId
 * identifies the actual series and orderNumber is the canonical sequence.
 * bookDisplayNumber is only a display fallback and shortSeriesBookTitle is not
 * the series name.
 */
export function resolveGoogleSeriesMetadata(
  seriesInfo: GoogleVolumeSeriesInfo | undefined,
  seriesTitlesById: Record<string, string> = {},
  bibliographicSeries?: GoogleBibliographicSeriesInfo,
): ResolvedGoogleSeriesMetadata {
  const memberships = seriesInfo?.volumeSeries ?? [];

  const namedMembership = memberships.find((membership) => {
    const id = membership.seriesId?.trim();
    return Boolean(id && seriesTitlesById[id]?.trim());
  });
  const fallbackMembership = namedMembership ?? memberships[0];
  const seriesId = namedMembership?.seriesId?.trim();
  const name = seriesId ? seriesTitlesById[seriesId]?.trim() || undefined : undefined;

  const orderCandidate = fallbackMembership?.orderNumber
    ?? fallbackMembership?.issue?.find((issue) => typeof issue.issueOrderNumber === 'number')?.issueOrderNumber;
  const order = typeof orderCandidate === 'number' && Number.isFinite(orderCandidate)
    ? orderCandidate
    : parseDisplayOrder(seriesInfo?.bookDisplayNumber);

  if (name) return { name, order };

  const bibliographicName = bibliographicSeries?.name?.trim();
  if (bibliographicName) {
    const bibliographicOrder = typeof bibliographicSeries?.position === 'number'
      && Number.isFinite(bibliographicSeries.position)
      ? bibliographicSeries.position
      : order;
    return { name: bibliographicName, order: bibliographicOrder };
  }

  return { name, order };
}
