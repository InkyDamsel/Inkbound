import type { Format } from '../../types';

export type SeriesDetectiveSource = 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house';

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
}
