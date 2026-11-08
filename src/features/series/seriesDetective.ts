import type { Format, UserBookRecord } from '../../types';
import type { SeriesDetectiveEdition, SeriesDetectiveWorkGroup } from './seriesDetectiveCatalogTypes';
import { searchSeriesDetectiveHardcover } from './seriesDetectiveHardcoverApi';
import { searchSeriesDetectivePenguinRandomHouse } from './seriesDetectivePenguinRandomHouseApi';
import { resolveEffectiveSeriesMetadata } from './seriesLibrary';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  canonicalDetectiveSeries,
  detectiveAuthorsCompatible,
  compactDetectiveIsbn,
  comparableDetectiveTitle,
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromDescription,
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
  type DetectiveOpenLibraryContextCandidate,
} from './seriesDetectiveOpenLibraryApi';
import {
  mergeDetectiveCandidates,
  type DetectiveMergeCandidate,
} from './seriesDetectiveMerge';

type DetectiveSeriesAwareEdition = SeriesDetectiveEdition & {
  seriesName?: string;
  seriesOrder?: number;
};


const knownSeriesMetadataFromCatalogWork = (
  work: SeriesDetectiveWorkGroup,
  edition: SeriesDetectiveEdition,
  wantedSeriesName: string,
): SeriesDetectiveMatch | null => {
  const seriesAware = edition as DetectiveSeriesAwareEdition;
  if (
    seriesAware.seriesName
    && detectiveSeriesNamesCompatible(seriesAware.seriesName, wantedSeriesName)
  ) {
    return {
      name: seriesAware.seriesName,
      position: typeof seriesAware.seriesOrder === 'number' ? seriesAware.seriesOrder : null,
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
  groups: SeriesDetectiveWorkGroup[],
  wantedSeriesName: string,
  wantedAuthor: string,
): DetectiveMergeCandidate[] => {
  const wanted = canonicalDetectiveAuthor(wantedAuthor);
  return groups.flatMap((work) => {
    const exactAuthor = !wanted || work.authors.some((author) => detectiveAuthorsCompatible(wantedAuthor, author));

    return work.editions.flatMap((edition) => {
      const seriesAware = edition as DetectiveSeriesAwareEdition;
      const metadata = wantedSeriesName
        ? knownSeriesMetadataFromCatalogWork(work, edition, wantedSeriesName)
        : seriesAware.seriesName?.trim()
          ? {
              name: seriesAware.seriesName.trim(),
              position: typeof seriesAware.seriesOrder === 'number' && Number.isFinite(seriesAware.seriesOrder)
                ? seriesAware.seriesOrder
                : null,
            }
          : null;
      const structuredSeriesMatch = Boolean(
        wantedSeriesName
        && seriesAware.seriesName
        && detectiveSeriesNamesCompatible(seriesAware.seriesName, wantedSeriesName),
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
          seriesAware.seriesName
          && (!wantedSeriesName || detectiveSeriesNamesCompatible(seriesAware.seriesName, wantedSeriesName)),
        ),
      }];
    });
  });
};

const prhContextCandidates = (
  groups: SeriesDetectiveWorkGroup[],
  wantedSeriesName: string,
  wantedAuthor: string,
): DetectiveMergeCandidate[] => groups.flatMap((work) =>
  work.editions.flatMap((edition) => {
    const exactAuthor = !canonicalDetectiveAuthor(wantedAuthor)
      || work.authors.some((author) => detectiveAuthorsCompatible(wantedAuthor, author));
    const seriesName = edition.seriesName?.trim();
    const structuredSeriesMatch = Boolean(
      wantedSeriesName
      && seriesName
      && detectiveSeriesNamesCompatible(seriesName, wantedSeriesName),
    );
    if (!exactAuthor && !structuredSeriesMatch) return [];
    return [{
      work,
      edition,
      seriesName,
      position: typeof edition.seriesOrder === 'number' && Number.isFinite(edition.seriesOrder)
        ? edition.seriesOrder
        : null,
      provider: 'penguin-random-house' as const,
      seriesProvider: seriesName ? 'penguin-random-house' as const : undefined,
      seriesStructured: Boolean(seriesName),
    }];
  }),
);

const DERIVATIVE_SERIES_PRODUCT_PATTERN =
  /\b(?:box(?:ed)?\s+set|collection\s+set|series\s+sampler|sampler|coloring\s+book|colouring\s+book|omnibus|anthology|complete\s+.*\s+set|\d+[- ]book\s+(?:box\s+)?set|\d+[- ]book\s+collection)\b/i;

const isDerivativeSeriesProduct = (candidate: DetectiveMergeCandidate): boolean => {
  const values = [
    candidate.work.title,
    candidate.work.subtitle,
    candidate.edition.title,
    candidate.edition.subtitle,
    candidate.edition.editionName,
  ].filter((value): value is string => Boolean(value?.trim()));
  return values.some((value) => DERIVATIVE_SERIES_PRODUCT_PATTERN.test(value));
};

const hasMergedKnownSeriesContext = (
  candidate: DetectiveMergeCandidate,
  wantedSeriesName: string,
): boolean => {
  if ((candidate.providerSources?.length ?? 1) < 2) return false;

  const wanted = canonicalDetectiveSeries(wantedSeriesName);
  if (!wanted) return false;

  const workTitle = canonicalDetectiveSeries(candidate.work.title);
  const wantedWords = wanted.split(' ').filter(Boolean).length;
  const workTitleWords = workTitle.split(' ').filter(Boolean).length;
  const brandOnlyWorkTitle = workTitle === wanted
    || (workTitle.endsWith(` ${wanted}`) && workTitleWords <= wantedWords + 1);
  if (brandOnlyWorkTitle) return false;

  return [
    candidate.work.title,
    candidate.work.subtitle,
    candidate.edition.title,
    candidate.edition.subtitle,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => {
      const normalized = canonicalDetectiveSeries(value);
      return Boolean(
        normalized
        && (normalized.includes(wanted) || detectiveSeriesNamesCompatible(value, wantedSeriesName)),
      );
    });
};

const openLibrarySeriesHasBibliographicContext = (
  candidate: DetectiveOpenLibraryCandidate | DetectiveOpenLibraryContextCandidate,
): boolean => {
  const seriesName = candidate.seriesName?.trim();
  if (!seriesName) return false;

  return [
    candidate.work.title,
    candidate.work.subtitle,
    candidate.edition.title,
    candidate.edition.subtitle,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => {
      const inferred = inferKnownDetectiveSeriesFromText(value, seriesName)
        ?? inferDetectiveSeriesFromTitle(value);
      return Boolean(inferred && detectiveSeriesNamesCompatible(inferred.name, seriesName));
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
      .some((author) => detectiveAuthorsCompatible(book.work.author, author));
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
  discoveryAuthor?: string;
}

export interface SeriesDetectiveCandidate {
  work: SeriesDetectiveWorkGroup;
  edition: SeriesDetectiveEdition;
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

  return inferDetectiveSeriesFromDescription(volume.volumeInfo?.description)
    ?? inferDetectiveSeriesFromTitle(volume.volumeInfo?.title)
    ?? inferDetectiveSeriesFromTitle(volume.volumeInfo?.subtitle);
};

const structuredSeriesPosition = (
  volume: DetectiveGoogleVolume,
  confirmedSeriesIds: Set<string>,
): number | null => {
  const info = volume.volumeInfo?.seriesInfo;
  const membership = (info?.volumeSeries ?? []).find((candidate) => {
    const id = candidate.seriesId?.trim();
    return Boolean(id && confirmedSeriesIds.has(id));
  });
  if (!membership) return null;

  const positionCandidate = membership.orderNumber
    ?? membership.issue?.find((issue) => typeof issue.issueOrderNumber === 'number')?.issueOrderNumber;
  const displayPosition = Number(info?.bookDisplayNumber?.match(/\d+(?:\.\d+)?/)?.[0]);
  return typeof positionCandidate === 'number' && Number.isFinite(positionCandidate)
    ? positionCandidate
    : Number.isFinite(displayPosition) ? displayPosition : null;
};

const volumeUsesConfirmedSeriesId = (
  volume: DetectiveGoogleVolume,
  confirmedSeriesIds: Set<string>,
): boolean => (volume.volumeInfo?.seriesInfo?.volumeSeries ?? []).some((membership) => {
  const id = membership.seriesId?.trim();
  return Boolean(id && confirmedSeriesIds.has(id));
});

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
    .some((author) => detectiveAuthorsCompatible(book.work.author, author));
  const explicitDescriptionSeries = inferDetectiveSeriesFromDescription(volume.volumeInfo?.description);
  // An explicit numbered series in the catalog title is bibliographic evidence,
  // not a free-form subtitle guess. It still requires an exact work/author match.
  const explicitTitleSeries = inferDetectiveSeriesFromTitle(volume.volumeInfo?.title)
    ?? inferDetectiveSeriesFromTitle(volume.volumeInfo?.subtitle);
  const structured = Boolean(
    (volume.volumeInfo?.seriesInfo?.volumeSeries ?? []).some((membership) => {
      const id = membership.seriesId?.trim();
      return Boolean(id && catalog.seriesTitlesById[id]);
    })
    || volume.inkboundBibliographicSeries?.name?.trim()
    || explicitDescriptionSeries
    || (explicitTitleSeries && detectiveSeriesNamesCompatible(explicitTitleSeries.name, metadata.name)),
  );

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
    hardcoverExact,
    hardcoverAuthor,
    prhExact,
    prhAuthor,
  ] = await Promise.all([
    Promise.all([workQuery, ...identifiers].map(async (query, index) => ({
      sourceId: `google-query-${index}`,
      catalog: await safeDetectiveSearch(query, signal),
    }))),
    collectGoogleAuthorCatalogs(book.work.author, signal),
    searchDetectiveOpenLibraryBook(book.work.title, book.work.author, signal),
    searchDetectiveOpenLibraryAuthor(book.work.author, signal),
    searchDetectiveOpenLibraryContext(book.work.title, book.work.author, signal),
    // Seed reconciliation should ask Hardcover for the exact work first.
    // Author-wide search remains a fallback for metadata-thin records.
    searchSeriesDetectiveHardcover(
      `${book.work.title} ${book.work.author}`,
      false,
      { exactTitle: book.work.title },
    ),
    searchSeriesDetectiveHardcover(book.work.author),
    searchSeriesDetectivePenguinRandomHouse(
      `${book.work.title} ${book.work.author}`,
      false,
      { exactTitle: book.work.title },
    ),
    searchSeriesDetectivePenguinRandomHouse(book.work.author),
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
    structured: openLibrarySeriesHasBibliographicContext(candidate),
    exactIdentifier: [candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => libraryIdentifiers.has(isbn)),
    exactTitle: comparableDetectiveTitle(candidate.work.title) === wantedTitle
      || comparableDetectiveTitle(candidate.edition.title) === wantedTitle,
    exactAuthor: !wantedAuthor || candidate.work.authors
      .some((author) => detectiveAuthorsCompatible(book.work.author, author)),
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
      seriesStructured: openLibrarySeriesHasBibliographicContext(candidate),
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
      seriesStructured: openLibrarySeriesHasBibliographicContext(candidate),
    });
  });

  providerCandidates.push(...hardcoverContextCandidates(
    [...hardcoverExact.groups, ...hardcoverAuthor.groups],
    '',
    book.work.author,
  ));
  providerCandidates.push(...prhContextCandidates(
    [...prhExact.groups, ...prhAuthor.groups],
    '',
    book.work.author,
  ));

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
      structured: candidate.seriesStructured === true
        || [candidate.work.title, candidate.edition.title, candidate.work.subtitle, candidate.edition.subtitle]
          .some((value) => {
            const explicit = inferDetectiveSeriesFromTitle(value);
            return Boolean(explicit && detectiveSeriesNamesCompatible(explicit.name, candidate.seriesName));
          }),
      exactIdentifier: [candidate.edition.isbn13, candidate.edition.isbn10]
        .map(compactDetectiveIsbn)
        .filter(Boolean)
        .some((isbn) => libraryIdentifiers.has(isbn)),
      exactTitle: comparableDetectiveTitle(candidate.work.title) === wantedTitle
        || comparableDetectiveTitle(candidate.edition.title) === wantedTitle,
      exactAuthor: !wantedAuthor || candidate.work.authors
        .some((author) => detectiveAuthorsCompatible(book.work.author, author)),
    }));

  const evidence = [...googleEvidence, ...openLibraryEvidence, ...mergedEvidence];
  const match = selectVerifiedDetectiveEvidence(evidence);
  if (match) {
    return {
      name: match.seriesName,
      position: match.position,
      discoveryAuthor: match.authors.find((author) => author?.trim())?.trim(),
    };
  }

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
  const authorIsUsable = canonicalWantedAuthor && canonicalWantedAuthor !== 'unknown author';
  const exactAuthor = !authorIsUsable || authors.some((name) => detectiveAuthorsCompatible(wantedAuthor, name));
  const hasStructuredSeries = Boolean(
    (info?.seriesInfo?.volumeSeries ?? []).some((membership) => {
      const id = membership.seriesId?.trim();
      return Boolean(id && catalog.seriesTitlesById[id]);
    }),
  );

  const bibliographicSeriesMatchesRequested = Boolean(
    wantedSeriesName
    && volume.inkboundBibliographicSeries?.name
    && detectiveSeriesNamesCompatible(volume.inkboundBibliographicSeries.name, wantedSeriesName),
  );
  const explicitBibliographicSeriesMatch = Boolean(
    bibliographicSeriesMatchesRequested
    && volume.inkboundBibliographicSeries?.explicit === true,
  );
  const weakBibliographicSeriesMatch = Boolean(
    bibliographicSeriesMatchesRequested
    && volume.inkboundBibliographicSeries?.explicit === false,
  );

  // A verified match to the requested series is stronger than an author-string
  // mismatch. This matters for shared-world/multi-author series and for harmless
  // catalog spelling differences (for example transposed letters in an author
  // name). Metadata-thin records still require an author match.
  const explicitCompatibleSeries = Boolean(
    metadata?.name
    && wantedSeriesName
    && detectiveSeriesNamesCompatible(metadata.name, wantedSeriesName),
  );
  if (
    !hasStructuredSeries
    && !explicitBibliographicSeriesMatch
    && !explicitCompatibleSeries
    && !exactAuthor
  ) return null;

  // Plain bibliographic series labels are useful discovery evidence, but they
  // are not strong enough to override an author mismatch. This preserves later
  // books in a same-author series without re-admitting unrelated Hades /
  // Persephone retellings from other authors.
  if (weakBibliographicSeriesMatch && !exactAuthor) return null;

  const edition: SeriesDetectiveEdition = {
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
  const work: SeriesDetectiveWorkGroup = {
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
    seriesStructured: metadata
      ? Boolean(
          hasStructuredSeries
          || (volume.inkboundBibliographicSeries?.name?.trim()
            && volume.inkboundBibliographicSeries.explicit === true)
          || inferDetectiveSeriesFromDescription(info?.description)
        )
      : undefined,
  };
};

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
  signal?: AbortSignal,
  seriesBookIds?: string[],
): Promise<SeriesDetectiveResult> {
  const scopedSeriesBookIds = new Set(seriesBookIds ?? []);
  const seriesBooks = scopedSeriesBookIds.size > 0
    ? libraryBooks.filter((book) => scopedSeriesBookIds.has(book.id))
    : libraryBooks.filter((book) => {
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
  const targetPositions = [...internalGaps, ...forwardPositions];
  const positionQueries = targetPositions.flatMap((position) => [
    `"${seriesName}" book ${position}`,
    `${seriesName} book ${position} ${author}`,
  ]);
  const queries = [...new Set([
    `"${seriesName}"`,
    `"${seriesName}" ${author}`,
    `${seriesName} ${author}`,
    seriesName,
    `inauthor:"${author}" "${seriesName}"`,
    ...positionQueries,
  ])];

  const [
    queryCatalogs,
    googleAuthorCatalogs,
    openLibrarySeriesCandidates,
    openLibraryAuthorCandidates,
    openLibraryContextCandidates,
    hardcoverSeriesAndAuthor,
    hardcoverSeriesOnly,
    hardcoverAuthor,
    prhSeriesAndAuthor,
    prhSeriesOnly,
    prhAuthor,
  ] = await Promise.all([
    Promise.all(queries.map((query) => safeDetectiveSearch(query, signal))),
    collectGoogleAuthorCatalogs(author, signal),
    searchDetectiveOpenLibrarySeries(seriesName, author, signal),
    searchDetectiveOpenLibraryAuthor(author, signal),
    searchDetectiveOpenLibraryContext(seriesName, author, signal),
    // Only the series + author query may expand Hardcover's structured
    // series ID. A bare series name can collide across unrelated authors.
    searchSeriesDetectiveHardcover(
      `${seriesName} ${author}`,
      true,
      {
        seriesName,
        anchorTitles: seriesBooks.map((book) => book.work.title),
      },
    ),
    searchSeriesDetectiveHardcover(seriesName),
    searchSeriesDetectiveHardcover(author),
    searchSeriesDetectivePenguinRandomHouse(
      `${seriesName} ${author}`,
      true,
      {
        seriesName,
        anchorTitles: seriesBooks.map((book) => book.work.title),
      },
    ),
    searchSeriesDetectivePenguinRandomHouse(seriesName),
    searchSeriesDetectivePenguinRandomHouse(author),
  ]);
  const catalogs = [...queryCatalogs, ...googleAuthorCatalogs];
  const openLibraryCandidates = [...openLibrarySeriesCandidates, ...openLibraryAuthorCandidates];
  const seen = new Map<string, SeriesDetectiveCandidate>();

  const providerCandidates: DetectiveMergeCandidate[] = [];

  // Google sometimes returns structured volumeSeries IDs while its separate
  // series-title endpoint is incomplete. First establish which IDs belong to
  // the requested series using candidates that already pass Detective's
  // existing verification gates. Then reuse that structured identity for
  // sibling volumes carrying the exact same seriesId.
  const confirmedGoogleSeriesIds = new Set<string>();
  catalogs.forEach((catalog) => {
    catalog.items.forEach((volume) => {
      const verified = mergeCandidateFromGoogleVolume(volume, catalog, seriesName, author);
      if (
        !verified?.seriesName
        || !detectiveSeriesNamesCompatible(verified.seriesName, seriesName)
      ) return;

      (volume.volumeInfo?.seriesInfo?.volumeSeries ?? []).forEach((membership) => {
        const id = membership.seriesId?.trim();
        if (id) confirmedGoogleSeriesIds.add(id);
      });
    });
  });

  catalogs.forEach((catalog) => {
    catalog.items.forEach((volume) => {
      const candidate = mergeCandidateFromGoogleVolume(volume, catalog, seriesName, author);
      if (!candidate) return;

      if (
        !candidate.seriesName
        && confirmedGoogleSeriesIds.size > 0
        && volumeUsesConfirmedSeriesId(volume, confirmedGoogleSeriesIds)
      ) {
        candidate.seriesName = seriesName;
        candidate.position = structuredSeriesPosition(volume, confirmedGoogleSeriesIds);
        candidate.seriesProvider = 'google-books';
        candidate.seriesStructured = true;
      }

      providerCandidates.push(candidate);
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
  providerCandidates.push(...prhContextCandidates(
    [
      ...prhSeriesAndAuthor.groups,
      ...prhSeriesOnly.groups,
      ...prhAuthor.groups,
    ],
    seriesName,
    author,
  ));

  // Position is ordering metadata, never work identity. Providers frequently
  // omit or misreport it, so pruning to one candidate per position can delete
  // legitimate sibling works. Merge/dedupe by work identity and ISBN only.
  const mergedProviderCandidates = mergeDetectiveCandidates(providerCandidates)
    .filter((candidate) => !isDerivativeSeriesProduct(candidate));

  const addCandidate = (candidate: SeriesDetectiveCandidate) => {
    const titleKey = comparableDetectiveTitle(candidate.work.title);
    const authorKey = canonicalDetectiveAuthor(candidate.work.authors[0]);
    const isbnKey = compactDetectiveIsbn(candidate.edition.isbn13 ?? candidate.edition.isbn10);
    // Series position is ordering metadata, not work identity. Two catalog
    // records claiming the same slot must not cause one distinct work to be
    // silently discarded.
    const key = isbnKey
      ? `isbn:${isbnKey}`
      : `work:${titleKey}::${authorKey}`;
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
    const candidateTitle = comparableDetectiveTitle(candidate.work.title);
    const existingWork = libraryBooks.some((book) => {
      const sameTitle = comparableDetectiveTitle(book.work.title) === candidateTitle;
      if (!sameTitle) return false;

      // Once a candidate has passed the requested-series admission gate, exact
      // title identity is enough to recognize it as already owned. This avoids
      // offering the same work again because one catalog says "Keira Cass" and
      // another says "Kiera Cass".
      return true;
    });
    if (existingWork) return false;
    if (candidate.work.key && existingWorkIds.has(candidate.work.key)) return false;
    return ![candidate.edition.isbn13, candidate.edition.isbn10]
      .map(compactDetectiveIsbn)
      .filter(Boolean)
      .some((isbn) => existingIsbns.has(isbn));
  });

  return { seriesName, candidates, missing };
}
