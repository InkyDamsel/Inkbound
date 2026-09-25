import type { Format, UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { resolveEffectiveSeriesMetadata } from './seriesLibrary';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  compactDetectiveIsbn,
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromTitle,
  inferKnownDetectiveSeriesFromDescription,
  inferKnownDetectiveSeriesFromText,
  normalizeDetectiveText,
  plausibleDetectiveSeriesSubtitle,
  scoreDetectiveEvidence,
  selectVerifiedDetectiveEvidence,
  type SeriesDetectionEvidence,
} from './seriesDetectiveEvidence';
import {
  searchDetectiveGoogleBooks,
  type DetectiveGoogleCatalog,
  type DetectiveGoogleVolume,
} from './seriesDetectiveGoogleApi';
import {
  searchDetectiveOpenLibraryBook,
  searchDetectiveOpenLibrarySeries,
  type DetectiveOpenLibraryCandidate,
} from './seriesDetectiveOpenLibraryApi';
import {
  mergeDetectiveCandidates,
  type DetectiveMergeCandidate,
} from './seriesDetectiveMerge';

export interface SeriesDetectiveMatch {
  name: string;
  position: number | null;
}

export interface SeriesDetectiveCandidate {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
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

const knownSeriesMetadata = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
  wantedSeriesName: string,
): SeriesDetectiveMatch | null => {
  const structured = seriesMetadata(volume, catalog);
  if (structured && detectiveSeriesNamesCompatible(structured.name, wantedSeriesName)) return structured;

  for (const value of [volume.volumeInfo?.title, volume.volumeInfo?.subtitle]) {
    const inferred = inferKnownDetectiveSeriesFromText(value, wantedSeriesName);
    if (inferred) return inferred;
  }

  const described = inferKnownDetectiveSeriesFromDescription(
    volume.volumeInfo?.description,
    wantedSeriesName,
  );
  if (described) return described;

  const subtitle = plausibleDetectiveSeriesSubtitle(volume.volumeInfo?.subtitle);
  if (subtitle && detectiveSeriesNamesCompatible(subtitle, wantedSeriesName)) {
    return { name: subtitle, position: null };
  }

  return null;
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
    recordId: volume.id,
    structured,
    exactIdentifier,
    exactTitle,
    exactAuthor,
  });
};

const safeDetectiveSearch = async (
  query: string,
  signal?: AbortSignal,
): Promise<DetectiveGoogleCatalog> => {
  try {
    return await searchDetectiveGoogleBooks(query, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective catalog query failed.', error);
    return { items: [], seriesTitlesById: {} };
  }
};

export async function detectSeriesForBook(
  book: UserBookRecord,
  signal?: AbortSignal,
): Promise<SeriesDetectiveMatch | null> {
  const { workQuery, identifiers } = buildSeriesDetectionQueries(book);
  const queries = [workQuery, ...identifiers];
  const [catalogs, openLibraryCandidates] = await Promise.all([
    Promise.all(queries.map(async (query, index) => ({
      sourceId: `google-query-${index}`,
      catalog: await safeDetectiveSearch(query, signal),
    }))),
    searchDetectiveOpenLibraryBook(book.work.title, book.work.author, signal),
  ]);

  const googleEvidence = catalogs.flatMap(({ sourceId, catalog }) =>
    catalog.items
      .map((volume) => evidenceForVolume(volume, catalog, book, sourceId))
      .filter((item): item is SeriesDetectionEvidence => Boolean(item)),
  );

  const libraryIdentifiers = new Set(book.editions.flatMap((edition) =>
    [edition.isbn13, edition.isbn10, edition.isbn].map(compactDetectiveIsbn).filter(Boolean),
  ));
  const wantedTitle = normalizeDetectiveText(book.work.title);
  const wantedAuthor = canonicalDetectiveAuthor(book.work.author);
  const openLibraryEvidence = openLibraryCandidates.map((candidate) => scoreDetectiveEvidence({
    seriesName: candidate.seriesName,
    position: candidate.position,
    title: candidate.work.title,
    authors: candidate.work.authors,
    isbn10: candidate.edition.isbn10,
    isbn13: candidate.edition.isbn13,
    sourceId: 'open-library',
    recordId: `open-library:${candidate.recordId}`,
    structured: true,
    exactIdentifier: [candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => libraryIdentifiers.has(isbn)),
    exactTitle: normalizeDetectiveText(candidate.work.title) === wantedTitle
      || normalizeDetectiveText(candidate.edition.title) === wantedTitle,
    exactAuthor: !wantedAuthor || candidate.work.authors
      .some((author) => canonicalDetectiveAuthor(author) === wantedAuthor),
  }));

  const providerCandidates: DetectiveMergeCandidate[] = [];

  catalogs.forEach(({ catalog }) => {
    catalog.items.forEach((volume) => {
      const candidate = mergeCandidateFromGoogleVolume(volume, catalog, undefined, book.work.author);
      if (!candidate) return;
      const sameTitle = normalizeDetectiveText(candidate.work.title) === wantedTitle
        || normalizeDetectiveText(candidate.edition.title) === wantedTitle;
      if (sameTitle) providerCandidates.push(candidate);
    });
  });

  openLibraryCandidates.forEach((candidate) => {
    providerCandidates.push({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: candidate.seriesName,
      position: candidate.position,
      provider: 'open-library',
    });
  });

  const mergedEvidence = mergeDetectiveCandidates(providerCandidates)
    .filter((candidate): candidate is DetectiveMergeCandidate & { seriesName: string } => Boolean(candidate.seriesName))
    .map((candidate) => scoreDetectiveEvidence({
      seriesName: candidate.seriesName,
      position: candidate.position,
      title: candidate.work.title,
      authors: candidate.work.authors,
      isbn10: candidate.edition.isbn10,
      isbn13: candidate.edition.isbn13,
      sourceId: 'merged-providers',
      recordId: `merged:${normalizeDetectiveText(candidate.work.title)}:${canonicalDetectiveAuthor(candidate.work.authors[0])}`,
      structured: candidate.provider === 'open-library' || Boolean(candidate.seriesName),
      exactIdentifier: [candidate.edition.isbn13, candidate.edition.isbn10]
        .map(compactDetectiveIsbn)
        .filter(Boolean)
        .some((isbn) => libraryIdentifiers.has(isbn)),
      exactTitle: normalizeDetectiveText(candidate.work.title) === wantedTitle
        || normalizeDetectiveText(candidate.edition.title) === wantedTitle,
      exactAuthor: !wantedAuthor || candidate.work.authors
        .some((author) => canonicalDetectiveAuthor(author) === wantedAuthor),
    }));

  const evidence = [...googleEvidence, ...openLibraryEvidence, ...mergedEvidence];
  const match = selectVerifiedDetectiveEvidence(evidence);
  return match ? { name: match.seriesName, position: match.position } : null;
}

const detectiveCoverUrl = (volume: DetectiveGoogleVolume): string | undefined => {
  const links = volume.volumeInfo?.imageLinks;
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return source?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const detectivePublicationYear = (value?: string): number => {
  const match = value?.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
  return match ? Number(match[0]) : 0;
};

const mergeCandidateFromGoogleVolume = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
  wantedSeriesName: string | undefined,
  wantedAuthor: string,
): DetectiveMergeCandidate | null => {
  const metadata = wantedSeriesName
    ? knownSeriesMetadata(volume, catalog, wantedSeriesName)
    : seriesMetadata(volume, catalog);
  const info = volume.volumeInfo;
  const title = info?.title?.trim();
  if (!title) return null;

  const format: Format = volume.saleInfo?.isEbook ? 'ebook' : 'hardcover';
  const authors = info?.authors?.length ? info.authors : ['Unknown author'];
  const canonicalWantedAuthor = canonicalDetectiveAuthor(wantedAuthor);
  const exactAuthor = !canonicalWantedAuthor || authors.some((name) => canonicalDetectiveAuthor(name) === canonicalWantedAuthor);
  const hasStructuredSeries = Boolean(
    (info?.seriesInfo?.volumeSeries ?? []).some((membership) => {
      const id = membership.seriesId?.trim();
      return Boolean(id && catalog.seriesTitlesById[id]);
    }),
  );

  // Metadata-thin Google records are still useful supplements when the author
  // matches. They cannot become a Series Detective result by themselves unless
  // another source supplies compatible series evidence for the same work.
  if (!hasStructuredSeries && !exactAuthor) return null;

  const edition: BookSearchEdition = {
    source: 'google-books',
    externalEditionId: volume.id,
    title,
    subtitle: info?.subtitle,
    authors,
    publisherSummary: info?.description,
    genres: info?.categories ?? [],
    publisher: info?.publisher,
    publicationDate: info?.publishedDate,
    publicationYear: detectivePublicationYear(info?.publishedDate),
    language: info?.language,
    format,
    isbn10: identifier(volume, 'ISBN_10'),
    isbn13: identifier(volume, 'ISBN_13'),
    pageCount: info?.pageCount,
    coverUrl: detectiveCoverUrl(volume),
    binding: volume.saleInfo?.isEbook ? 'Digital' : undefined,
    specialFeatures: [],
  };
  const work: BookSearchWorkGroup = {
    key: `google-books:${normalizeDetectiveText(title)}::${canonicalDetectiveAuthor(authors[0])}`,
    title,
    subtitle: info?.subtitle,
    authors,
    publisherSummary: info?.description,
    genres: info?.categories ?? [],
    editions: [edition],
  };

  return {
    work,
    edition,
    seriesName: metadata?.name,
    position: metadata?.position ?? null,
    provider: 'google-books',
  };
};

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
  signal?: AbortSignal,
): Promise<SeriesDetectiveResult> {
  const knownPositions = libraryBooks.flatMap((book) => {
    const resolved = resolveEffectiveSeriesMetadata(book);
    if (!resolved || !detectiveSeriesNamesCompatible(resolved.name, seriesName)) return [];
    return typeof resolved.position === 'number' && Number.isFinite(resolved.position)
      ? [resolved.position]
      : [];
  });
  const wholePositions = knownPositions.filter((position) => Number.isInteger(position) && position > 0);
  const highest = wholePositions.length ? Math.max(...wholePositions) : 0;
  const knownPositionSet = new Set(wholePositions);
  const internalGaps = highest > 0
    ? Array.from({ length: highest }, (_, index) => index + 1)
      .filter((position) => !knownPositionSet.has(position))
    : [];
  const forwardPositions = highest > 0
    ? Array.from({ length: 5 }, (_, index) => highest + index + 1)
    : [];
  const positionQueries = [...internalGaps, ...forwardPositions]
    .map((position) => `${seriesName} book ${position} ${author}`);
  const queries = [
    `${seriesName} ${author}`,
    seriesName,
    `inauthor:"${author}" ${seriesName}`,
    ...positionQueries,
  ];

  const [catalogs, openLibraryCandidates] = await Promise.all([
    Promise.all(queries.map((query) => safeDetectiveSearch(query, signal))),
    searchDetectiveOpenLibrarySeries(seriesName, author, signal),
  ]);
  const seen = new Map<string, SeriesDetectiveCandidate>();

  const providerCandidates: DetectiveMergeCandidate[] = [];

  catalogs.forEach((catalog) => {
    catalog.items.forEach((volume) => {
      const candidate = mergeCandidateFromGoogleVolume(volume, catalog, seriesName, author);
      if (candidate) providerCandidates.push(candidate);
    });
  });

  openLibraryCandidates.forEach((candidate: DetectiveOpenLibraryCandidate) => {
    providerCandidates.push({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: candidate.seriesName,
      position: candidate.position,
      provider: 'open-library',
    });
  });

  const mergedProviderCandidates = mergeDetectiveCandidates(providerCandidates);

  const addCandidate = (candidate: SeriesDetectiveCandidate) => {
    const titleKey = normalizeDetectiveText(candidate.work.title);
    const isbnKey = compactDetectiveIsbn(candidate.edition.isbn13 ?? candidate.edition.isbn10);
    const key = candidate.position !== null
      ? `position:${candidate.position}`
      : isbnKey
        ? `isbn:${isbnKey}`
        : `title:${titleKey}`;
    const current = seen.get(key);
    if (!current || (!current.edition.isbn13 && candidate.edition.isbn13)) seen.set(key, candidate);
  };

  mergedProviderCandidates.forEach((candidate) => {
    if (!candidate.seriesName || !detectiveSeriesNamesCompatible(candidate.seriesName, seriesName)) return;
    addCandidate({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: candidate.seriesName,
      position: candidate.position,
    });
  });

  const candidates = [...seen.values()].sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.work.title.localeCompare(b.work.title);
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
  const existingWorkIds = new Set(
    libraryBooks
      .map((book) => book.work.externalWorkId?.trim())
      .filter((value): value is string => Boolean(value)),
  );

  const missing = candidates.filter((candidate) => {
    if (candidate.position !== null && existingPositions.has(candidate.position)) return false;
    const candidateAuthor = canonicalDetectiveAuthor(candidate.work.authors[0]);
    if (existingTitles.has(`${normalizeDetectiveText(candidate.work.title)}::${candidateAuthor}`)) return false;
    if (candidate.work.key && existingWorkIds.has(candidate.work.key)) return false;
    return ![candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => existingIsbns.has(isbn));
  });

  return { seriesName, candidates, missing };
}
