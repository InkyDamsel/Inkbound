import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { UserBookRecord } from '../../types';

export interface CatalogContributionFields {
  title: string;
  subtitle?: string;
  author: string;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesNumber?: number;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  format?: string;
  externalEditionId?: string;
}

export interface CatalogContribution {
  id: string;
  catalogKey: string;
  fields: CatalogContributionFields;
  source: string;
  status: 'pending' | 'approved' | 'rejected';
  contributorHash: string;
  createdAt: string | null;
  updatedAt: string | null;
  reviewedAt: string | null;
  reviewedByEmail: string;
  reviewNote: string;
}

export function buildCatalogContributionFields(book: UserBookRecord): CatalogContributionFields | null {
  const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const title = book.work.title?.trim();
  const author = book.work.author?.trim();
  if (!edition || !title || !author) return null;

  const isbn10 = edition.isbn10?.trim();
  const isbn13 = edition.isbn13?.trim();
  const publisher = edition.publisher?.trim();
  const publicationDate = edition.publicationDate?.trim();
  const externalEditionId = edition.externalEditionId?.trim();
  if (!isbn10 && !isbn13 && !externalEditionId && !(publisher && publicationDate)) return null;

  return {
    title,
    ...(book.work.subtitle?.trim() ? { subtitle: book.work.subtitle.trim() } : {}),
    author,
    ...(isbn10 ? { isbn10 } : {}),
    ...(isbn13 ? { isbn13 } : {}),
    ...(book.work.seriesName?.trim() ? { seriesName: book.work.seriesName.trim() } : {}),
    ...(typeof book.work.seriesOrder === 'number' && Number.isFinite(book.work.seriesOrder) ? { seriesNumber: book.work.seriesOrder } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publicationDate ? { publicationDate } : {}),
    ...(typeof edition.pageCount === 'number' && edition.pageCount > 0 ? { pageCount: edition.pageCount } : {}),
    ...(edition.language?.trim() ? { language: edition.language.trim() } : {}),
    ...(edition.format ? { format: edition.format } : {}),
    ...(externalEditionId ? { externalEditionId } : {}),
  };
}

export async function submitCatalogContribution(book: UserBookRecord) {
  if (!functions) throw new Error('Catalog contribution service is unavailable in this Inkbound runtime.');
  const fields = buildCatalogContributionFields(book);
  if (!fields) throw new Error('Add an ISBN, an edition identifier, or both publisher and publication date before sharing catalog details.');
  const callable = httpsCallable<{ sourceBookId: string; fields: CatalogContributionFields }, { success: boolean; contributionId: string; status: 'pending' }>(functions, 'submitMetadataContribution');
  const response = await callable({ sourceBookId: book.id, fields });
  return response.data;
}

export async function getCatalogContributions(status: 'pending' | 'approved' | 'rejected') {
  if (!functions) throw new Error('Catalog review service is unavailable in this Inkbound runtime.');
  const callable = httpsCallable<{ status: string }, { status: string; contributions: CatalogContribution[] }>(functions, 'getMetadataContributions');
  const response = await callable({ status });
  return response.data.contributions ?? [];
}

export async function reviewCatalogContribution(input: { contributionId: string; decision: 'approved' | 'rejected'; reviewNote?: string }) {
  if (!functions) throw new Error('Catalog review service is unavailable in this Inkbound runtime.');
  const callable = httpsCallable<typeof input, { success: boolean; status: 'approved' | 'rejected' }>(functions, 'reviewMetadataContribution');
  const response = await callable(input);
  return response.data;
}
