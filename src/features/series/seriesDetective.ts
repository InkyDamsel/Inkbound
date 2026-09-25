import type { Format, UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchHardcover } from '../book-search/data/hardcoverApi';
import { resolveEffectiveSeriesMetadata } from './seriesLibrary';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  canonicalDetectiveSeries,
  compactDetectiveIsbn,
  comparableDetectiveTitle,
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
  searchDetectiveGoogleBooksPage,
  type DetectiveGoogleCatalog,
  type DetectiveGoogleVolume,
} from './seriesDetectiveGoogleApi';
import {
  searchDetectiveOpenLibraryAuthor,
  searchDetectiveOpenLibraryBook,
  searchDetectiveOpenLibraryContext,
  searchDetectiveOpenLibrarySeries,
  type DetectiveOpenLibraryCandidate,
} from './seriesDetectiveOpenLibraryApi';
import {
  mergeDetectiveCandidates,
  type DetectiveMergeCandidate,
} from './seriesDetectiveMerge';


const knownSeriesMetadataFromCatalogWork = (
  work: BookSearchWorkGroup,
  edition: BookSearchEdition,
  wantedSeriesName: string,
): SeriesDetectiveMatch | null => {
  if (
    edition.seriesName
    && detectiveSeriesNamesCompatible(edition.seriesName, wantedSeriesName)
  ) {
    return {
      name: edition.seriesName,
      position: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : null,
    };
  }

  for (const value of [edition.title, work.title, edition.subtitle, work.subtitle]) {
    const inferred = inferKnownDetectiveSeriesFromText(value, wantedSeriesName)
      ?? inferDetectiveSeriesFromTitle(value);
    if (inferred && detectiveSeriesNamesCompatible(inferred.name, wantedSeriesName)) return inferred;
  }

  for (const description of [edition.publisherSummary, work.publisherSummary]) {
    const inferred = inferKnownDetectiveSeriesFromDescription(description, wantedSeriesName);
    if (inferred) return inferred;
  }

  for (const subtitle of [edition.subtitle, work.subtitle]) {
    const candidate = plausibleDetectiveSeriesSubtitle(subtitle);
    if (candidate && detectiveSeriesNamesCompatible(candidate, wantedSeriesName)) {
      return { name: candidate, position: null };
    }
  }

  return null;
};



const hardcoverContextCandidates = (
  groups: BookSearchWorkGroup[],
  wantedSeriesName: string,
  wantedAuthor: string,
): DetectiveMergeCandidate[] => {
  const wanted = canonicalDetectiveAuthor(wantedAuthor);
  return groups.flatMap((work) => {
    const exactAuthor = !wanted || work.authors.some((author) => canonicalDetectiveAuthor(author) === wanted);

    return work.editions.flatMap((edition) => {
      const metadata = wantedSeriesName
        ? knownSeriesMetadataFromCatalogWork(work, edition, wantedSeriesName)
        : edition.seriesName?.trim()
          ? {
              name: edition.seriesName.trim(),
              position: typeof edition.seriesOrder === 'number' && Number.isFinite(edition.seriesOrder)
                ? edition.seriesOrder
                : null,
            }
          : null;
      const structuredSeriesMatch = Boolean(
        wantedSeriesName
        && edition.seriesName
        && detectiveSeriesNamesCompatible(edition.seriesName, wantedSeriesName),
      );
      if (!exactAuthor && !structuredSeriesMatch) return [];
      return [{
        work,
        edition,
        seriesName: metadata?.name,
        position: metadata?.position ?? null,
        provider: 'hardcover' as const,
        seriesProvider: metadata ? 'hardcover' as const : undefined,
        seriesStructured: Boolean(
          edition.seriesName
          && (!wantedSeriesName || detectiveSeriesNamesCompatible(edition.seriesName, wantedSeriesName)),
        ),
      }];
    });
  });
};

const hasMergedKnownSeriesContext = (
  candidate: DetectiveMergeCandidate,
  wantedSeriesName: string,
): boolean => {
  if ((candidate.providerSources?.length ?? 1) < 2) return false;

  const wanted = canonicalDetectiveSeries(wantedSeriesName);
  if (!wanted) return false;

  const wantedWords = wanted.split(' ').filter(Boolean).length;
  const values = [
    candidate.work.title,
    candidate.work.subtitle,
    candidate.edition.title,
    candidate.edition.subtitle,
  ].filter((value): value is string => Boolean(value?.trim()));

  return values.some((value) => {
    const normalized = canonicalDetectiveSeries(value);
    if (!normalized || !normalized.includes(wanted)) return false;
    const words = normalized.split(' ').filter(Boolean).length;
    const brandOnly = normalized === wanted || (normalized.endsWith(` ${wanted}`) && words <= wantedWords + 1);
    return !brandOnly;
  });
};

const selectCorroboratedSubtitleSeries = (
  candidates: DetectiveMergeCandidate[],
  book: UserBookRecord,
): SeriesDetectiveMatch | null => {
  const wantedTitle = comparableDetectiveTitle(book.work.title);
  const wantedAuthor = canonicalDetectiveAuthor(book.work.author);
  const grouped = new Map<string, { name: string; providers: Set<string> }>();

  for (const candidate of candidates) {
    const exactTitle = comparableDetectiveTitle(candidate.work.title) === wantedTitle
      || comparableDetectiveTitle(candidate.edition.title) === wantedTitle;
    const exactAuthor = !wantedAuthor || candidate.work.authors
      .some((author) => canonicalDetectiveAuthor(author) === wantedAuthor);
    if (!exactTitle || !exactAuthor) continue;

    for (const subtitle of [candidate.edition.subtitle, candidate.work.subtitle]) {
      const name = plausibleDetectiveSeriesSubtitle(subtitle);
      if (!name) continue;
      const key = canonicalDetectiveSeries(name);
      if (!key) continue;
      const current = grouped.get(key) ?? { name, providers: new Set<string>() };
      current.providers.add(candidate.provider);
      grouped.set(key, current);
    }
  }

  const verified = [...grouped.values()]
    .filter((item) => item.providers.size >= 2)
    .sort((a, b) => b.providers.size - a.providers.size || a.name.localeCompare(b.name))[0];

  return verified ? { name: verified.name, position: null } : null;
};

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

  const bibliographic = volume.inkboundBibliographicSeries;
  if (bibliographic?.name?.trim()) {
    return {
      name: bibliographic.name.trim(),
      position: typeof bibliographic.position === 'number' && Number.isFinite(bibliographic.position)
        ? bibliographic.position
        : position,
    };
  }

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
  const exactTitle = comparableDetectiveTitle(volume.volumeInfo?.title) === comparableDetectiveTitle(book.work.title);
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
    providerId: 'google-books',
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

const SERIES_DISCOVERY_MAX_PAGES = 4;

const collectGoogleAuthorCatalogs = async (
  author: string,
  signal?: AbortSignal,
): Promise<DetectiveGoogleCatalog[]> => {
  const catalogs: DetectiveGoogleCatalog[] = [];
  let startIndex = 0;

  for (let page = 0; page < SERIES_DISCOVERY_MAX_PAGES; page += 1) {
    try {
      const result = await searchDetectiveGoogleBooksPage(
        `inauthor:"${author}"`,
        startIndex,
        40,
        signal,
      );
      catalogs.push({ items: result.items, seriesTitlesById: result.seriesTitlesById });
      if (!result.hasMore || result.nextStartIndex <= startIndex) break;
      startIndex = result.nextStartIndex;
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Series Detective paged author discovery failed.', error);
      break;
    }
  }

  return catalogs;
};

export async function detectSeriesForBook(
  book: UserBookRecord,
  signal?: AbortSignal,
): Promise<SeriesDetectiveMatch | null> {
  const { workQuery, identifiers } = buildSeriesDetectionQueries(book);
  const [
    workAndIdentifierCatalogs,
    authorCatalogs,
    openLibraryExact,
    openLibraryAuthor,
    openLibraryContext,
    hardcoverAuthor,
  ] = await Promise.all([
    Promise.all([workQuery, ...identifiers].map(async (query, index) => ({
      sourceId: `google-query-${index}`,
      catalog: await safeDetectiveSearch(query, signal),
    }))),
    collectGoogleAuthorCatalogs(book.work.author, signal),
    searchDetectiveOpenLibraryBook(book.work.title, book.work.author, signal),
    searchDetectiveOpenLibraryAuthor(book.work.author, signal),
    searchDetectiveOpenLibraryContext(book.work.title, book.work.author, signal),
    searchHardcover(book.work.author),
  ]);

  const catalogs = [
    ...workAndIdentifierCatalogs,
    ...authorCatalogs.map((catalog, index) => ({
      sourceId: `google-author-page-${index}`,
      catalog,
    })),
  ];

  const libraryIdentifiers = new Set(book.editions.flatMap((edition) =>
    [edition.isbn13, edition.isbn10, edition.isbn].map(compactDetectiveIsbn).filter(Boolean),
  ));
  const wantedTitle = comparableDetectiveTitle(book.work.title);
  const wantedAuthor = canonicalDetectiveAuthor(book.work.author);

  const googleEvidence = catalogs.flatMap(({ sourceId, catalog }) =>
    catalog.items
      .map((volume) => evidenceForVolume(volume, catalog, book, sourceId))
      .filter((item): item is SeriesDetectionEvidence => Boolean(item)),
  );

  const openLibraryCandidates = [...openLibraryExact, ...openLibraryAuthor];
  const openLibraryEvidence = openLibraryCandidates.map((candidate) => scoreDetectiveEvidence({
    seriesName: candidate.seriesName,
    position: candidate.position,
    title: candidate.work.title,
    authors: candidate.work.authors,
    isbn10: candidate.edition.isbn10,
    isbn13: candidate.edition.isbn13,
    sourceId: 'open-library',
    recordId: `open-library:${candidate.recordId}`,
    providerId: 'open-library',
    structured: true,
    exactIdentifier: [candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => libraryIdentifiers.has(isbn)),
    exactTitle: comparableDetectiveTitle(candidate.work.title) === wantedTitle
      || comparableDetectiveTitle(candidate.edition.title) === wantedTitle,
    exactAuthor: !wantedAuthor || candidate.work.authors
      .some((author) => canonicalDetectiveAuthor(author) === wantedAuthor),
  }));

  const providerCandidates: DetectiveMergeCandidate[] = [];

  catalogs.forEach(({ catalog }) => {
    catalog.items.forEach((volume) => {
      const candidate = mergeCandidateFromGoogleVolume(volume, catalog, undefined, book.work.author);
      if (!candidate) return;

      const sameTitle = comparableDetectiveTitle(candidate.work.title) === wantedTitle
        || comparableDetectiveTitle(candidate.edition.title) === wantedTitle;
      const exactIsbn = [candidate.edition.isbn13, candidate.edition.isbn10]
        .map(compactDetectiveIsbn)
        .filter(Boolean)
        .some((isbn) => libraryIdentifiers.has(isbn));
      if (sameTitle || exactIsbn) providerCandidates.push(candidate);
    });
  });

  openLibraryCandidates.forEach((candidate) => {
    providerCandidates.push({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: candidate.seriesName,
      position: candidate.position,
      provider: 'open-library',
      seriesProvider: 'open-library',
      seriesStructured: true,
    });
  });

  openLibraryContext.forEach((candidate) => {
    providerCandidates.push({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: candidate.seriesName,
      position: candidate.position,
      provider: 'open-library',
      seriesProvider: candidate.seriesName ? 'open-library' : undefined,
      seriesStructured: Boolean(candidate.seriesName),
    });
  });

  providerCandidates.push(...hardcoverContextCandidates(hardcoverAuthor.groups, '', book.work.author));

  const mergedEvidence = mergeDetectiveCandidates(providerCandidates)
    .filter((candidate): candidate is DetectiveMergeCandidate & { seriesName: string } => Boolean(candidate.seriesName))
    .map((candidate) => scoreDetectiveEvidence({
      seriesName: candidate.seriesName,
      position: candidate.position,
      title: candidate.work.title,
      authors: candidate.work.authors,
      isbn10: candidate.edition.isbn10,
      isbn13: candidate.edition.isbn13,
      sourceId: `merged-${candidate.seriesProvider ?? candidate.provider}`,
      recordId: `merged:${normalizeDetectiveText(candidate.work.title)}:${canonicalDetectiveAuthor(candidate.work.authors[0])}`,
      providerId: candidate.seriesProvider ?? candidate.provider,
      providerCount: candidate.providerSources?.length ?? 1,
      structured: candidate.seriesStructured === true,
      exactIdentifier: [candidate.edition.isbn13, candidate.edition.isbn10]
        .map(compactDetectiveIsbn)
        .filter(Boolean)
        .some((isbn) => libraryIdentifiers.has(isbn)),
      exactTitle: comparableDetectiveTitle(candidate.work.title) === wantedTitle
        || comparableDetectiveTitle(candidate.edition.title) === wantedTitle,
      exactAuthor: !wantedAuthor || candidate.work.authors
        .some((author) => canonicalDetectiveAuthor(author) === wantedAuthor),
    }));

  const evidence = [...googleEvidence, ...openLibraryEvidence, ...mergedEvidence];
  const match = selectVerifiedDetectiveEvidence(evidence);
  if (match) return { name: match.seriesName, position: match.position };

  return selectCorroboratedSubtitleSeries(providerCandidates, book);
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
    seriesProvider: metadata ? 'google-books' : undefined,
    seriesStructured: metadata ? hasStructuredSeries : undefined,
  };
};

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
  signal?: AbortSignal,
): Promise<SeriesDetectiveResult> {
  const seriesBooks = libraryBooks.filter((book) => {
    const resolved = resolveEffectiveSeriesMetadata(book);
    return Boolean(resolved && detectiveSeriesNamesCompatible(resolved.name, seriesName));
  });
  const knownPositions = seriesBooks.flatMap((book) => {
    const resolved = resolveEffectiveSeriesMetadata(book);
    return typeof resolved?.position === 'number' && Number.isFinite(resolved.position)
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

  const [
    queryCatalogs,
    googleAuthorCatalogs,
    openLibrarySeriesCandidates,
    openLibraryAuthorCandidates,
    openLibraryContextCandidates,
    hardcoverSeriesAndAuthor,
    hardcoverSeriesOnly,
    hardcoverAuthor,
  ] = await Promise.all([
    Promise.all(queries.map((query) => safeDetectiveSearch(query, signal))),
    collectGoogleAuthorCatalogs(author, signal),
    searchDetectiveOpenLibrarySeries(seriesName, author, signal),
    searchDetectiveOpenLibraryAuthor(author, signal),
    searchDetectiveOpenLibraryContext(seriesName, author, signal),
    searchHardcover(`${seriesName} ${author}`),
    searchHardcover(seriesName),
    searchHardcover(author),
  ]);
  const catalogs = [...queryCatalogs, ...googleAuthorCatalogs];
  const openLibraryCandidates = [...openLibrarySeriesCandidates, ...openLibraryAuthorCandidates];
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
      seriesProvider: 'open-library',
      seriesStructured: true,
    });
  });

  openLibraryContextCandidates.forEach((candidate) => {
    providerCandidates.push({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: candidate.seriesName,
      position: candidate.position,
      provider: 'open-library',
      seriesProvider: candidate.seriesName ? 'open-library' : undefined,
      seriesStructured: Boolean(candidate.seriesName),
    });
  });

  providerCandidates.push(...hardcoverContextCandidates(
    [
      ...hardcoverSeriesAndAuthor.groups,
      ...hardcoverSeriesOnly.groups,
      ...hardcoverAuthor.groups,
    ],
    seriesName,
    author,
  ));

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
    const contextual = !candidate.seriesName && hasMergedKnownSeriesContext(candidate, seriesName);
    const resolvedSeriesName = candidate.seriesName ?? (contextual ? seriesName : undefined);
    if (!resolvedSeriesName || !detectiveSeriesNamesCompatible(resolvedSeriesName, seriesName)) return;

    addCandidate({
      work: candidate.work,
      edition: candidate.edition,
      seriesName: resolvedSeriesName,
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
    `${comparableDetectiveTitle(book.work.title)}::${canonicalDetectiveAuthor(book.work.author)}`,
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
    if (existingTitles.has(`${comparableDetectiveTitle(candidate.work.title)}::${candidateAuthor}`)) return false;
    if (candidate.work.key && existingWorkIds.has(candidate.work.key)) return false;
    return ![candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => existingIsbns.has(isbn));
  });

  return { seriesName, candidates, missing };
}
