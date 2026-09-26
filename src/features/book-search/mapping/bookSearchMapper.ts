import {
  Format,
  OwnershipStatus,
  Priority,
  ReadingStatus,
  UserBookRecord,
} from '../../../types';
import { withReadingStatus } from '../../reading/bookReadingState';
import { BookSearchEdition, BookSearchWorkGroup } from '../model/bookSearch';
import { enrichSelectedCatalogEdition, hardenCatalogGroups } from '../catalogHardening';

interface CreateBookFromEditionOptions {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
  format?: Format;
  status?: ReadingStatus;
  ownership?: OwnershipStatus;
  priority?: Priority;
  editionName?: string;
  binding?: string;
  specialFeatures?: string[];
}

const uniqueId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const localDateKey = (value = new Date()): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const providerLabel = (source: BookSearchEdition['source']): string => {
  if (source === 'inkbound-catalog') return 'Inkbound Trusted Catalog';
  if (source === 'open-library') return 'Open Library';
  if (source === 'hardcover') return 'Hardcover';
  return 'Google Books';
};

export function createBookFromSearchEdition({
  work,
  edition,
  format,
  status = 'tbr',
  ownership = 'owned',
  priority = 'medium',
  editionName,
  binding,
  specialFeatures,
}: CreateBookFromEditionOptions): UserBookRecord {
  const hardenedWork = hardenCatalogGroups([work])[0] ?? work;
  const hardenedEdition = enrichSelectedCatalogEdition(hardenedWork, edition);
  const resolvedFormat = format ?? hardenedEdition.format;
  const resolvedEditionName = editionName ?? hardenedEdition.editionName;
  const resolvedBinding = binding ?? hardenedEdition.binding;
  const resolvedSpecialFeatures = specialFeatures ?? hardenedEdition.specialFeatures;
  const bookId = uniqueId('book');
  const workId = uniqueId('work');
  const editionId = uniqueId('edition');
  const publisherSummary = hardenedEdition.publisherSummary ?? hardenedWork.publisherSummary;
  const addedOn = localDateKey();
  const hasKnownPrintTotal = resolvedFormat !== 'audiobook'
    && typeof hardenedEdition.pageCount === 'number'
    && Number.isFinite(hardenedEdition.pageCount)
    && hardenedEdition.pageCount > 0;

  const baseBook: UserBookRecord = {
    id: bookId,
    work: {
      id: workId,
      title: hardenedWork.title,
      subtitle: hardenedWork.subtitle,
      author: hardenedWork.authors.join(', '),
      summary: publisherSummary ?? 'No publisher summary was available for this edition.',
      publisherSummary,
      genres: hardenedEdition.genres.length > 0 ? hardenedEdition.genres : hardenedWork.genres,
      ...(hardenedEdition.seriesName ? { seriesName: hardenedEdition.seriesName } : {}),
      ...(typeof hardenedEdition.seriesOrder === 'number' ? { seriesOrder: hardenedEdition.seriesOrder } : {}),
      publicationYear: hardenedEdition.publicationYear,
      originalLanguage: hardenedEdition.language,
      externalWorkId: hardenedWork.key,
    },
    activeEditionId: editionId,
    editions: [{
      id: editionId,
      format: resolvedFormat,
      isbn: hardenedEdition.isbn13 ?? hardenedEdition.isbn10,
      isbn10: hardenedEdition.isbn10,
      isbn13: hardenedEdition.isbn13,
      asin: hardenedEdition.asin,
      pageCount: hardenedEdition.pageCount,
      publisher: hardenedEdition.publisher,
      publicationDate: hardenedEdition.publicationDate,
      coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]',
      coverUrl: hardenedEdition.coverUrl,
      language: hardenedEdition.language,
      editionName: resolvedEditionName,
      binding: resolvedBinding,
      specialFeatures: resolvedSpecialFeatures.filter(Boolean),
      externalSource: hardenedEdition.source,
      externalEditionId: hardenedEdition.externalEditionId,
    }],
    status: 'tbr',
    ownership,
    progressPages: status === 'finished' && hasKnownPrintTotal ? hardenedEdition.pageCount! : 0,
    progressMinutes: 0,
    progressPercentage: 0,
    favoriteQuotes: [],
    privateTags: [],
    priority,
    moods: [],
    collections: [],
    sourceOfImport: providerLabel(hardenedEdition.source),
    dateAdded: addedOn,
  };

  return withReadingStatus(baseBook, status, addedOn);
}
