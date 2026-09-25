import type { UserBookRecord } from '../../types';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  compactDetectiveIsbn,
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromTitle,
  normalizeDetectiveText,
  scoreDetectiveEvidence,
  selectVerifiedDetectiveEvidence,
  type SeriesDetectionEvidence,
} from './seriesDetectiveEvidence';
import {
  searchDetectiveGoogleBooks,
  type DetectiveGoogleCatalog,
  type DetectiveGoogleVolume,
} from './seriesDetectiveGoogleApi';

export interface SeriesDetectiveMatch {
  name: string;
  position: number | null;
}

export interface SeriesDetectiveCandidate {
  externalId: string;
  title: string;
  authors: string[];
  isbn10?: string;
  isbn13?: string;
  seriesName: string;
  position: number | null;
}

export interface SeriesDetectiveResult {
  seriesName: string;
  candidates: SeriesDetectiveCandidate[];
  missing: SeriesDetectiveCandidate[];
}

const identifier = (volume: DetectiveGoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const seriesMetadata = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
): SeriesDetectiveMatch | null => {
  const info = volume.volumeInfo?.seriesInfo;
  const memberships = info?.volumeSeries ?? [];
  const named = memberships.find((membership) => {
    const id = membership.seriesId?.trim();
    return Boolean(id && catalog.seriesTitlesById[id]);
  });
  const membership = named ?? memberships[0];
  const seriesId = named?.seriesId?.trim();
  const name = seriesId ? catalog.seriesTitlesById[seriesId] : undefined;
  const positionCandidate = membership?.orderNumber
    ?? membership?.issue?.find((issue) => typeof issue.issueOrderNumber === 'number')?.issueOrderNumber;
  const displayPosition = Number(info?.bookDisplayNumber?.match(/\d+(?:\.\d+)?/)?.[0]);
  const position = typeof positionCandidate === 'number' && Number.isFinite(positionCandidate)
    ? positionCandidate
    : Number.isFinite(displayPosition) ? displayPosition : null;

  if (name) return { name, position };

  return inferDetectiveSeriesFromTitle(volume.volumeInfo?.title)
    ?? inferDetectiveSeriesFromTitle(volume.volumeInfo?.subtitle);
};

const evidenceForVolume = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
  book: UserBookRecord,
  sourceId: string,
): SeriesDetectionEvidence | null => {
  const metadata = seriesMetadata(volume, catalog);
  if (!metadata) return null;

  const isbn10 = identifier(volume, 'ISBN_10');
  const isbn13 = identifier(volume, 'ISBN_13');
  const libraryIdentifiers = new Set(book.editions.flatMap((edition) =>
    [edition.isbn13, edition.isbn10, edition.isbn].map(compactDetectiveIsbn).filter(Boolean),
  ));
  const exactIdentifier = [isbn13, isbn10]
    .map(compactDetectiveIsbn)
    .filter(Boolean)
    .some((value) => libraryIdentifiers.has(value));
  const exactTitle = normalizeDetectiveText(volume.volumeInfo?.title) === normalizeDetectiveText(book.work.title);
  const wantedAuthor = canonicalDetectiveAuthor(book.work.author);
  const exactAuthor = !wantedAuthor || (volume.volumeInfo?.authors ?? [])
    .some((author) => canonicalDetectiveAuthor(author) === wantedAuthor);
  const structured = Boolean((volume.volumeInfo?.seriesInfo?.volumeSeries ?? []).some((membership) => {
    const id = membership.seriesId?.trim();
    return Boolean(id && catalog.seriesTitlesById[id]);
  }));

  return scoreDetectiveEvidence({
    seriesName: metadata.name,
    position: metadata.position,
    title: volume.volumeInfo?.title ?? book.work.title,
    authors: volume.volumeInfo?.authors ?? [],
    isbn10,
    isbn13,
    sourceId,
    structured,
    exactIdentifier,
    exactTitle,
    exactAuthor,
  });
};

export async function detectSeriesForBook(
  book: UserBookRecord,
  signal?: AbortSignal,
): Promise<SeriesDetectiveMatch | null> {
  const { workQuery, identifiers } = buildSeriesDetectionQueries(book);
  const queries = [workQuery, ...identifiers];
  const catalogs = await Promise.all(queries.map(async (query, index) => ({
    sourceId: `query-${index}`,
    catalog: await searchDetectiveGoogleBooks(query, signal),
  })));

  const evidence = catalogs.flatMap(({ sourceId, catalog }) =>
    catalog.items
      .map((volume) => evidenceForVolume(volume, catalog, book, sourceId))
      .filter((item): item is SeriesDetectionEvidence => Boolean(item)),
  );
  const match = selectVerifiedDetectiveEvidence(evidence);
  return match ? { name: match.seriesName, position: match.position } : null;
}

const candidateFromVolume = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
  wantedSeriesName: string,
): SeriesDetectiveCandidate | null => {
  const metadata = seriesMetadata(volume, catalog);
  if (!metadata || !detectiveSeriesNamesCompatible(metadata.name, wantedSeriesName)) return null;
  const title = volume.volumeInfo?.title?.trim();
  if (!title) return null;
  return {
    externalId: volume.id,
    title,
    authors: volume.volumeInfo?.authors ?? ['Unknown author'],
    isbn10: identifier(volume, 'ISBN_10'),
    isbn13: identifier(volume, 'ISBN_13'),
    seriesName: metadata.name,
    position: metadata.position,
  };
};

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
  signal?: AbortSignal,
): Promise<SeriesDetectiveResult> {
  const knownPositions = libraryBooks.flatMap((book) => {
    if (!detectiveSeriesNamesCompatible(book.work.seriesName, seriesName)) return [];
    return typeof book.work.seriesOrder === 'number' && Number.isFinite(book.work.seriesOrder)
      ? [book.work.seriesOrder]
      : [];
  });
  const highest = knownPositions.length ? Math.max(...knownPositions) : 0;
  const positionQueries = highest > 0
    ? Array.from({ length: 5 }, (_, index) => `${seriesName} book ${highest + index + 1} ${author}`)
    : [];
  const queries = [
    `${seriesName} ${author}`,
    seriesName,
    `inauthor:"${author}" ${seriesName}`,
    ...positionQueries,
  ];

  const catalogs = await Promise.all(queries.map((query) => searchDetectiveGoogleBooks(query, signal)));
  const seen = new Map<string, SeriesDetectiveCandidate>();

  catalogs.forEach((catalog) => {
    catalog.items.forEach((volume) => {
      const candidate = candidateFromVolume(volume, catalog, seriesName);
      if (!candidate) return;
      const key = candidate.position !== null
        ? `position:${candidate.position}`
        : `title:${normalizeDetectiveText(candidate.title)}`;
      const current = seen.get(key);
      if (!current || (!current.isbn13 && candidate.isbn13)) seen.set(key, candidate);
    });
  });

  const candidates = [...seen.values()].sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.title.localeCompare(b.title);
  });

  const existingPositions = new Set(knownPositions);
  const existingTitles = new Set(libraryBooks.map((book) =>
    `${normalizeDetectiveText(book.work.title)}::${canonicalDetectiveAuthor(book.work.author)}`,
  ));
  const existingIsbns = new Set(libraryBooks.flatMap((book) =>
    book.editions.flatMap((edition) =>
      [edition.isbn13, edition.isbn10, edition.isbn].map(compactDetectiveIsbn).filter(Boolean),
    ),
  ));

  const missing = candidates.filter((candidate) => {
    if (candidate.position !== null && existingPositions.has(candidate.position)) return false;
    const candidateAuthor = canonicalDetectiveAuthor(candidate.authors[0]);
    if (existingTitles.has(`${normalizeDetectiveText(candidate.title)}::${candidateAuthor}`)) return false;
    return ![candidate.isbn13, candidate.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => existingIsbns.has(isbn));
  });

  return { seriesName, candidates, missing };
}
