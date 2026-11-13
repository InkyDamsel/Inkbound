import { Format } from '../../../types';

export type BookSearchSource = 'inkbound-catalog' | 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house';

export interface BookSearchEdition {
  source: BookSearchSource;
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
  seriesName?: string;
  seriesOrder?: number;
  format: Format;
  isbn10?: string;
  isbn13?: string;
  asin?: string;
  pageCount?: number;
  coverUrl?: string;
  editionName?: string;
  binding?: string;
  specialFeatures: string[];
}

export interface BookSearchWorkGroup {
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  editions: BookSearchEdition[];
}

export interface BookSearchResponse {
  groups: BookSearchWorkGroup[];
  totalItems: number;
  /** A failed provider must never be presented as an authoritative empty catalog. */
  partial?: boolean;
  warning?: string;
}
