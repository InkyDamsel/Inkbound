import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { UserBookRecord } from '../../types';
import type { BookSearchResponse } from '../book-search/model/bookSearch';

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

export interface CatalogPromotionStatus {
  promoted: boolean;
  catalogId: string;
  promotedAt: string | null;
}

const normalizeIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() || undefined;

function catalogServiceMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const record = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (message && message.toLowerCase() !== 'internal') return message;
  if (code.endsWith('/unauthenticated')) return 'Sign in again before using the catalog contribution service.';
  if (code.endsWith('/permission-denied')) return 'This account does not have permission to use that catalog action.';
  if (code.endsWith('/resource-exhausted')) return 'Please wait a moment before submitting another catalog contribution.';
  if (code.endsWith('/failed-precondition')) return 'This edition needs a little more identifying information before it can be shared.';
  return fallback;
}

export function buildCatalogContributionFields(book: UserBookRecord): CatalogContributionFields | null {
  const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const title = book.work.title?.trim();
  const author = book.work.author?.trim();
  if (!edition || !title || !author) return null;

  const genericIsbn = normalizeIsbn(edition.isbn);
  const isbn10 = normalizeIsbn(edition.isbn10) ?? (genericIsbn?.length === 10 ? genericIsbn : undefined);
  const isbn13 = normalizeIsbn(edition.isbn13) ?? (genericIsbn?.length === 13 ? genericIsbn : undefined);
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
  try {
    const response = await callable({ sourceBookId: book.id, fields });
    return response.data;
  } catch (error) {
    throw new Error(catalogServiceMessage(error, 'Inkbound could not save this catalog contribution. Please try again after reopening the book.'));
  }
}

export async function getCatalogContributions(status: 'pending' | 'approved' | 'rejected') {
  if (!functions) throw new Error('Catalog review service is unavailable in this Inkbound runtime.');
  const callable = httpsCallable<{ status: string }, { status: string; contributions: CatalogContribution[] }>(functions, 'getMetadataContributions');
  try {
    const response = await callable({ status });
    return response.data.contributions ?? [];
  } catch (error) {
    throw new Error(catalogServiceMessage(error, 'Inkbound could not load the catalog review queue. Please refresh Administration and try again.'));
  }
}

export async function reviewCatalogContribution(input: { contributionId: string; decision: 'approved' | 'rejected'; reviewNote?: string }) {
  if (!functions) throw new Error('Catalog review service is unavailable in this Inkbound runtime.');
  const callable = httpsCallable<typeof input, { success: boolean; status: 'approved' | 'rejected' }>(functions, 'reviewMetadataContribution');
  try {
    const response = await callable(input);
    return response.data;
  } catch (error) {
    throw new Error(catalogServiceMessage(error, 'Inkbound could not update this catalog review. Please refresh Administration and try again.'));
  }
}

export async function promoteCatalogContribution(contributionId: string) {
  if (!functions) throw new Error('Trusted catalog service is unavailable in this Inkbound runtime.');
  const callable = httpsCallable<{ contributionId: string }, { success: boolean; catalogId: string }>(functions, 'promoteMetadataContribution');
  try {
    const response = await callable({ contributionId });
    return response.data;
  } catch (error) {
    throw new Error(catalogServiceMessage(error, 'Inkbound could not promote this approved record to the Trusted Catalog.'));
  }
}

export async function getCatalogPromotionStatuses(contributionIds: string[]) {
  if (!functions || contributionIds.length === 0) return {} as Record<string, CatalogPromotionStatus>;
  const callable = httpsCallable<{ contributionIds: string[] }, { statuses: Record<string, CatalogPromotionStatus> }>(functions, 'getCatalogPromotionStatuses');
  try {
    const response = await callable({ contributionIds: contributionIds.slice(0, 100) });
    return response.data.statuses ?? {};
  } catch (error) {
    throw new Error(catalogServiceMessage(error, 'Inkbound could not load Trusted Catalog promotion status.'));
  }
}

export async function searchInkboundTrustedCatalog(input: { isbn?: string; title?: string; author?: string }): Promise<BookSearchResponse> {
  if (!functions) return { groups: [], totalItems: 0 };
  const callable = httpsCallable<typeof input, BookSearchResponse>(functions, 'searchTrustedCatalog');
  try {
    const response = await callable(input);
    return response.data ?? { groups: [], totalItems: 0 };
  } catch (error) {
    console.warn('Inkbound Trusted Catalog lookup unavailable; continuing with external catalogs.', error);
    return { groups: [], totalItems: 0 };
  }
}
