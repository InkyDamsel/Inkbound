import {
  Format,
  OwnershipStatus,
  Priority,
  ReadingStatus,
  UserBookRecord,
} from '../../../types';
import { BookSearchEdition, BookSearchWorkGroup } from '../model/bookSearch';
import { hardenCatalogEdition } from '../catalogHardening';

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
  format = edition.format,
  status = 'tbr',
  ownership = 'owned',
  priority = 'medium',
  editionName = edition.editionName,
  binding = edition.binding,
  specialFeatures = edition.specialFeatures,
}: CreateBookFromEditionOptions): UserBookRecord {
  const hardenedEdition = hardenCatalogEdition(edition);
  const bookId = uniqueId('book');
  const workId = uniqueId('work');
  const editionId = uniqueId('edition');
  const publisherSummary = hardenedEdition.publisherSummary ?? work.publisherSummary;
  const addedOn = localDateKey();
  const isFinished = status === 'finished';
  const hasKnownPrintTotal = format !== 'audiobook'
    && typeof hardenedEdition.pageCount === 'number'
    && Number.isFinite(hardenedEdition.pageCount)
    && hardenedEdition.pageCount > 0;

  return {
    id: bookId,
    work: {
      id: workId,
      title: work.title,
      subtitle: work.subtitle,
      author: work.authors.join(', '),
      summary: publisherSummary ?? 'No publisher summary was available for this hardenedEdition.',
      publisherSummary,
      genres: hardenedEdition.genres.length > 0 ? hardenedEdition.genres : work.genres,
      publicationYear: hardenedEdition.publicationYear,
      originalLanguage: hardenedEdition.language,
      externalWorkId: work.key,
    },
    activeEditionId: editionId,
    editions: [
      {
        id: editionId,
        format,
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
        editionName,
        binding,
        specialFeatures: specialFeatures.filter(Boolean),
        externalSource: hardenedEdition.source,
        externalEditionId: hardenedEdition.externalEditionId,
      },
    ],
    status,
    ownership,
    progressPages: isFinished && hasKnownPrintTotal ? hardenedEdition.pageCount! : 0,
    progressMinutes: 0,
    progressPercentage: isFinished && hasKnownPrintTotal ? 100 : 0,
    favoriteQuotes: [],
    privateTags: [],
    priority,
    moods: [],
    collections: [],
    sourceOfImport: providerLabel(hardenedEdition.source),
    dateAdded: addedOn,
    dateStarted: status === 'currently-reading' || isFinished ? addedOn : undefined,
    dateFinished: isFinished ? addedOn : undefined,
  };
}