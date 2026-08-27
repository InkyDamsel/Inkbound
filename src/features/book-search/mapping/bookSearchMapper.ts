import {
  Format,
  OwnershipStatus,
  Priority,
  ReadingStatus,
  UserBookRecord,
} from '../../../types';
import { BookSearchEdition, BookSearchWorkGroup } from '../model/bookSearch';

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
  const bookId = uniqueId('book');
  const workId = uniqueId('work');
  const editionId = uniqueId('edition');
  const publisherSummary = edition.publisherSummary ?? work.publisherSummary;
  const addedOn = localDateKey();
  const isFinished = status === 'finished';
  const hasKnownPrintTotal = format !== 'audiobook'
    && typeof edition.pageCount === 'number'
    && Number.isFinite(edition.pageCount)
    && edition.pageCount > 0;

  return {
    id: bookId,
    work: {
      id: workId,
      title: work.title,
      subtitle: work.subtitle,
      author: work.authors.join(', '),
      summary: publisherSummary ?? 'No publisher summary was available for this edition.',
      publisherSummary,
      genres: edition.genres.length > 0 ? edition.genres : work.genres,
      publicationYear: edition.publicationYear,
      originalLanguage: edition.language,
      externalWorkId: work.key,
    },
    activeEditionId: editionId,
    editions: [
      {
        id: editionId,
        format,
        isbn: edition.isbn13 ?? edition.isbn10,
        isbn10: edition.isbn10,
        isbn13: edition.isbn13,
        asin: edition.asin,
        pageCount: edition.pageCount,
        publisher: edition.publisher,
        publicationDate: edition.publicationDate,
        coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]',
        coverUrl: edition.coverUrl,
        language: edition.language,
        editionName,
        binding,
        specialFeatures: specialFeatures.filter(Boolean),
        externalSource: edition.source,
        externalEditionId: edition.externalEditionId,
      },
    ],
    status,
    ownership,
    progressPages: isFinished && hasKnownPrintTotal ? edition.pageCount! : 0,
    progressMinutes: 0,
    progressPercentage: isFinished && hasKnownPrintTotal ? 100 : 0,
    favoriteQuotes: [],
    privateTags: [],
    priority,
    moods: [],
    collections: [],
    sourceOfImport: providerLabel(edition.source),
    dateAdded: addedOn,
    dateStarted: status === 'currently-reading' || isFinished ? addedOn : undefined,
    dateFinished: isFinished ? addedOn : undefined,
  };
}