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
    progressPages: 0,
    progressMinutes: 0,
    progressPercentage: status === 'finished' ? 100 : 0,
    favoriteQuotes: [],
    privateTags: [],
    priority,
    moods: [],
    collections: [],
    sourceOfImport: 'Google Books',
    dateAdded: new Date().toISOString().split('T')[0],
    dateFinished: status === 'finished' ? new Date().toISOString().split('T')[0] : undefined,
  };
}
