import { Format } from '../../../types';

export type BookSearchSource = 'inkbound-catalog' | 'google-books' | 'open-library' | 'hardcover' | 'crossref' | 'library-of-congress' | 'internet-archive';

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
  // Provider-scoped stable series identity when exposed by the catalog.
  seriesAuthorityId?: string;
  // Canonical provenance survives provider deduplication. When multiple
  // catalogs describe the same physical/digital edition, hardening may collapse
  // them into one edition record, but evidence consumers still need to know
  // which independent providers corroborated that record.
  corroboratingSources?: BookSearchSource[];
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
}
