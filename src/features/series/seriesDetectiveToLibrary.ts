import type { UserBookRecord } from '../../types';
import { withReadingStatus } from '../reading/bookReadingState';
import type { SeriesDetectiveCandidate } from './seriesDetective';

const uniqueId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const localDateKey = (value = new Date()): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const providerLabel = (source: SeriesDetectiveCandidate['edition']['source']): string => {
  if (source === 'open-library') return 'Open Library';
  if (source === 'hardcover') return 'Hardcover';
  if (source === 'penguin-random-house') return 'Penguin Random House';
  return 'Google Books';
};

export function createBookFromSeriesDetectiveCandidate(
  candidate: SeriesDetectiveCandidate,
): UserBookRecord {
  const { work, edition, seriesName, position } = candidate;
  const bookId = uniqueId('book');
  const workId = uniqueId('work');
  const editionId = uniqueId('edition');
  const addedOn = localDateKey();
  const publisherSummary = edition.publisherSummary ?? work.publisherSummary;

  const baseBook: UserBookRecord = {
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
      seriesName,
      seriesOrder: position ?? undefined,
    },
    activeEditionId: editionId,
    editions: [{
      id: editionId,
      format: edition.format,
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
      editionName: edition.editionName,
      binding: edition.binding,
      specialFeatures: edition.specialFeatures.filter(Boolean),
      externalSource: edition.source,
      externalEditionId: edition.externalEditionId,
    }],
    status: 'tbr',
    ownership: 'none',
    progressPages: 0,
    progressMinutes: 0,
    progressPercentage: 0,
    favoriteQuotes: [],
    privateTags: [],
    priority: 'medium',
    moods: [],
    collections: [],
    sourceOfImport: providerLabel(edition.source),
    dateAdded: addedOn,
  };

  return withReadingStatus(baseBook, 'tbr', addedOn);
}
