import { Format } from '../../../types';

export interface BookSearchEdition {
  source: 'google-books';
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
