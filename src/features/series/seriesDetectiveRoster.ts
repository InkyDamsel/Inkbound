import type { Edition, UserBookRecord } from '../../types';
import type {
  SeriesDetectiveCandidate,
  SeriesDetectiveResult,
} from './seriesDetective';

/**
 * One row of the Series Detective roster: a single book in the series, shown
 * with whatever is known about it, whether it is in the library or not.
 *
 * Read-only view model. Nothing here writes to the library; "Add" actions are
 * dispatched by the UI through the canonical add-book path.
 */
export interface SeriesRosterEntry {
  key: string;
  /** owned: in library and matched to a catalog record. missing: catalog only.
   *  library-only: in the library's series but not listed by any catalog. */
  kind: 'owned' | 'missing' | 'library-only';
  position: number | null;
  title: string;
  subtitle?: string;
  authors: string;
  coverUrl?: string;
  year?: number;
  pageCount?: number;
  publisher?: string;
  isbn?: string;
  summary?: string;
  /** Library record, present for owned and library-only rows. */
  book?: UserBookRecord;
  /** Catalog record, present for owned and missing rows. */
  candidate?: SeriesDetectiveCandidate;
}

const PLACEHOLDER_SUMMARY = 'No publisher summary was available for this edition.';

const usableSummary = (value?: string): string | undefined => {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text && text !== PLACEHOLDER_SUMMARY ? text : undefined;
};

const libraryEdition = (book: UserBookRecord): Edition | undefined =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

export type SeriesPositionResolver = (book: UserBookRecord) => { name: string; position: number | null } | null;

const entryFromBook = (
  book: UserBookRecord,
  kind: 'owned' | 'library-only',
  position: number | null,
  candidate?: SeriesDetectiveCandidate,
): SeriesRosterEntry => {
  const edition = libraryEdition(book);
  const catalogEdition = candidate?.edition;
  return {
    key: `${kind}:${book.id}`,
    kind,
    position,
    title: book.work.title,
    subtitle: book.work.subtitle ?? candidate?.work.subtitle,
    authors: book.work.author || candidate?.work.authors.join(', ') || '',
    coverUrl: edition?.coverUrl ?? catalogEdition?.coverUrl,
    year: book.work.publicationYear || catalogEdition?.publicationYear || undefined,
    pageCount: edition?.pageCount ?? catalogEdition?.pageCount,
    publisher: edition?.publisher ?? catalogEdition?.publisher,
    isbn: edition?.isbn13 ?? edition?.isbn10 ?? edition?.isbn ?? catalogEdition?.isbn13 ?? catalogEdition?.isbn10,
    summary: usableSummary(book.work.publisherSummary)
      ?? usableSummary(book.work.summary)
      ?? usableSummary(catalogEdition?.publisherSummary)
      ?? usableSummary(candidate?.work.publisherSummary),
    book,
    candidate,
  };
};

const byPositionThenTitle = (a: SeriesRosterEntry, b: SeriesRosterEntry): number => {
  if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
  if (a.position !== null && b.position === null) return -1;
  if (a.position === null && b.position !== null) return 1;
  return a.title.localeCompare(b.title);
};

/**
 * Builds the full roster for one series.
 *
 * - owned: catalog candidates the library already has (position prefers the
 *   reader's own resolved position, falling back to the catalog's).
 * - missing: catalog candidates not in the library.
 * - library-only: books the reader has in this series that no catalog listed.
 *   They are shown, never dropped: absence from a catalog proves nothing.
 *
 * @param seriesBooks library books that belong to this series (caller scopes
 *        them with the canonical resolver / manual overrides)
 */
export const buildSeriesRoster = (
  result: SeriesDetectiveResult,
  seriesBooks: UserBookRecord[],
  resolvePosition: SeriesPositionResolver,
): SeriesRosterEntry[] => {
  const entries: SeriesRosterEntry[] = [];
  const matchedBookIds = new Set<string>();

  result.owned.forEach(({ candidate, book }) => {
    if (matchedBookIds.has(book.id)) return;
    matchedBookIds.add(book.id);
    const position = resolvePosition(book)?.position ?? candidate.position;
    entries.push(entryFromBook(book, 'owned', position, candidate));
  });

  result.missing.forEach((candidate, index) => {
    const edition = candidate.edition;
    entries.push({
      key: `missing:${candidate.work.key ?? candidate.work.title}:${index}`,
      kind: 'missing',
      position: candidate.position,
      title: candidate.work.title,
      subtitle: candidate.work.subtitle,
      authors: candidate.work.authors.join(', '),
      coverUrl: edition.coverUrl,
      year: edition.publicationYear || undefined,
      pageCount: edition.pageCount,
      publisher: edition.publisher,
      isbn: edition.isbn13 ?? edition.isbn10,
      summary: usableSummary(edition.publisherSummary) ?? usableSummary(candidate.work.publisherSummary),
      candidate,
    });
  });

  seriesBooks.forEach((book) => {
    if (matchedBookIds.has(book.id)) return;
    entries.push(entryFromBook(book, 'library-only', resolvePosition(book)?.position ?? null));
  });

  return entries.sort(byPositionThenTitle);
};

export interface SeriesRosterSummary {
  inLibrary: number;
  missing: number;
  total: number;
}

export const summarizeSeriesRoster = (entries: SeriesRosterEntry[]): SeriesRosterSummary => {
  const missing = entries.filter((entry) => entry.kind === 'missing').length;
  return { inLibrary: entries.length - missing, missing, total: entries.length };
};
