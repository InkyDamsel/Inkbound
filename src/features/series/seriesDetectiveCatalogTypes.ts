import type { Format } from '../../types';

export type SeriesDetectiveSource = 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house';

export interface SeriesDetectiveMembership {
  name: string;
  position?: number;
  provider: SeriesDetectiveSource;
  externalSeriesId?: string;
}

export interface SeriesDetectiveEdition {
  source: SeriesDetectiveSource;
  externalEditionId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  publisher?: string;
  publicationDate?: string;
  publicationYear: number;
  language?: string;
  format: Format;
  isbn10?: string;
  isbn13?: string;
  asin?: string;
  pageCount?: number;
  coverUrl?: string;
  editionName?: string;
  binding?: string;
  specialFeatures: string[];
  seriesName?: string;
  seriesOrder?: number;
  /** All catalog memberships; legacy seriesName remains for older providers. */
  seriesMemberships?: SeriesDetectiveMembership[];
}

export interface SeriesDetectiveWorkGroup {
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  editions: SeriesDetectiveEdition[];
}

export interface SeriesDetectiveCatalogResponse {
  groups: SeriesDetectiveWorkGroup[];
  totalItems: number;
  /** Empty results are not proof of an empty bibliography when a provider failed. */
  providerStatus?: 'ok' | 'unavailable';
  providerErrorCode?: string;
}
