import {
  Edition,
  Format,
  OwnershipStatus,
  Priority,
  ReadingStatus,
  UserBookRecord,
} from '../../../types';
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
  if (source === 'crossref') return 'Crossref';
  if (source === 'library-of-congress') return 'Library of Congress';
  if (source === 'internet-archive') return 'Internet Archive';
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
  const hardenedWork = hardenCatalogGroups([work])[0] ?? work;
  const hardenedEdition = enrichSelectedCatalogEdition(hardenedWork, edition);
  const bookId = uniqueId('book');
  const workId = uniqueId('work');
  const editionId = uniqueId('edition');
  const publisherSummary = hardenedEdition.publisherSummary ?? hardenedWork.publisherSummary;
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
      title: hardenedWork.title,
      subtitle: hardenedWork.subtitle,
      author: hardenedWork.authors.join(', '),
      summary: publisherSummary ?? 'No publisher summary was available for this edition.',
      publisherSummary,
      genres: hardenedEdition.genres.length > 0 ? hardenedEdition.genres : hardenedWork.genres,
      ...(hardenedEdition.seriesName ? { seriesName: hardenedEdition.seriesName, seriesSource: 'metadata' as const } : {}),
      ...(typeof hardenedEdition.seriesOrder === 'number' ? { seriesOrder: hardenedEdition.seriesOrder } : {}),
      publicationYear: hardenedEdition.publicationYear,
      originalLanguage: hardenedEdition.language,
      externalWorkId: hardenedWork.key,
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

export interface CatalogBookMetadataMergeOptions {
  /** Explicit repair may replace stale series values with verified catalog data. */
  catalogSeriesWins?: boolean;
  /** Exact-edition repair may replace an existing page count with the catalog value. */
  catalogPageCountWins?: boolean;
  /** Explicit repair may move provider identity to the newly verified edition. */
  catalogIdentityWins?: boolean;
  /** Manual editions are reader-owned and must not be rewritten by catalog metadata. */
  preserveActiveEdition?: boolean;
}

const activeUserEdition = (book: UserBookRecord): Edition | undefined =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

const isPlaceholderPublisherSummary = (value?: string): boolean => {
  const normalized = value?.trim().toLocaleLowerCase() ?? '';
  return !normalized
    || normalized === 'summary unavailable.'
    || normalized.startsWith('no publisher description')
    || normalized.startsWith('no publisher summary');
};

/**
 * Canonical catalog -> existing-library merge.
 *
 * Search, imports and Book Details may decide *when* metadata should be applied,
 * but field precedence lives here so those paths cannot silently disagree about
 * covers, page counts, series, edition identity or reader-owned values.
 */
export function mergeCatalogBookMetadata(
  current: UserBookRecord,
  catalogBook: UserBookRecord,
  options: CatalogBookMetadataMergeOptions = {},
): UserBookRecord {
  const currentEdition = activeUserEdition(current);
  const catalogEdition = activeUserEdition(catalogBook);

  let mergedEdition = currentEdition;
  if (currentEdition && catalogEdition && !options.preserveActiveEdition) {
    const catalogPageCount = catalogEdition.pageCount;
    const pageCount = options.catalogPageCountWins && catalogPageCount
      ? catalogPageCount
      : currentEdition.pageCount || catalogPageCount;

    mergedEdition = {
      ...catalogEdition,
      ...currentEdition,
      id: currentEdition.id,
      format: currentEdition.format,
      coverGradient: currentEdition.coverGradient || catalogEdition.coverGradient,
      coverUrl: currentEdition.coverUrl || catalogEdition.coverUrl,
      isbn: currentEdition.isbn || catalogEdition.isbn,
      isbn10: currentEdition.isbn10 || catalogEdition.isbn10,
      isbn13: currentEdition.isbn13 || catalogEdition.isbn13,
      asin: currentEdition.asin || catalogEdition.asin,
      lccn: currentEdition.lccn || catalogEdition.lccn,
      pageCount,
      audiobookDurationMins: currentEdition.audiobookDurationMins || catalogEdition.audiobookDurationMins,
      narrator: currentEdition.narrator || catalogEdition.narrator,
      publisher: currentEdition.publisher || catalogEdition.publisher,
      publicationDate: currentEdition.publicationDate || catalogEdition.publicationDate,
      language: currentEdition.language || catalogEdition.language,
      editionName: currentEdition.editionName || catalogEdition.editionName,
      binding: currentEdition.binding || catalogEdition.binding,
      specialFeatures: currentEdition.specialFeatures?.length
        ? currentEdition.specialFeatures
        : catalogEdition.specialFeatures,
      externalSource: currentEdition.externalSource === 'manual'
        ? currentEdition.externalSource
        : options.catalogIdentityWins
          ? catalogEdition.externalSource || currentEdition.externalSource
          : currentEdition.externalSource || catalogEdition.externalSource,
      externalEditionId: options.catalogIdentityWins
        ? catalogEdition.externalEditionId || currentEdition.externalEditionId
        : currentEdition.externalEditionId || catalogEdition.externalEditionId,
    };
  } else if (!currentEdition && catalogEdition) {
    mergedEdition = catalogEdition;
  }

  const catalogSeriesName = catalogBook.work.seriesName;
  const catalogSeriesOrder = catalogBook.work.seriesOrder;
  const preserveManualSeries = current.work.seriesSource === 'manual';
  const catalogMayReplaceSeries = Boolean(options.catalogSeriesWins && !preserveManualSeries);
  const publisherSummary = current.work.publisherSummary || catalogBook.work.publisherSummary;
  const visibleSummary = current.work.personalSummary
    || (!isPlaceholderPublisherSummary(current.work.summary) ? current.work.summary : undefined)
    || publisherSummary
    || catalogBook.work.summary
    || current.work.summary;

  return {
    ...current,
    work: {
      ...current.work,
      subtitle: current.work.subtitle || catalogBook.work.subtitle,
      summary: visibleSummary,
      publisherSummary,
      genres: current.work.genres?.length ? current.work.genres : catalogBook.work.genres,
      seriesName: catalogMayReplaceSeries
        ? catalogSeriesName ?? current.work.seriesName
        : current.work.seriesName ?? catalogSeriesName,
      seriesOrder: catalogMayReplaceSeries
        ? (typeof catalogSeriesOrder === 'number' ? catalogSeriesOrder : current.work.seriesOrder)
        : (typeof current.work.seriesOrder === 'number' ? current.work.seriesOrder : catalogSeriesOrder),
      seriesLabel: current.work.seriesLabel,
      seriesSource: preserveManualSeries
        ? 'manual'
        : (catalogMayReplaceSeries && catalogSeriesName
          ? 'metadata'
          : current.work.seriesSource ?? (catalogSeriesName ? 'metadata' : undefined)),
      publicationYear: current.work.publicationYear || catalogBook.work.publicationYear,
      originalLanguage: current.work.originalLanguage || catalogBook.work.originalLanguage,
      externalWorkId: options.catalogIdentityWins
        ? catalogBook.work.externalWorkId || current.work.externalWorkId
        : current.work.externalWorkId || catalogBook.work.externalWorkId,
    },
    editions: mergedEdition && currentEdition
      ? current.editions.map((edition) => edition.id === currentEdition.id ? mergedEdition! : edition)
      : current.editions,
  };
}
