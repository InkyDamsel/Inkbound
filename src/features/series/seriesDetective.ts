import type { Format, UserBookRecord } from '../../types';
import type { SeriesDetectiveEdition, SeriesDetectiveWorkGroup } from './seriesDetectiveCatalogTypes';
import { searchSeriesDetectiveHardcover } from './seriesDetectiveHardcoverApi';
import { searchSeriesDetectivePenguinRandomHouse } from './seriesDetectivePenguinRandomHouseApi';
import { resolveEffectiveSeriesMetadata } from './seriesLibrary';
import type { SeriesOverrides } from './seriesOverrides';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  canonicalDetectiveSeries,
  detectiveAuthorsCompatible,
  compactDetectiveIsbn,
  canonicalDetectiveIsbn13,
  detectiveWorkTitlesCompatible,
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
  detectiveCandidatesAreSameWork,
  type DetectiveMergeCandidate,
} from './seriesDetectiveMerge';
import { mapWithConcurrency, planSeriesDiscoveryQueries } from './seriesDetectiveQueryPlan';
import { hasExplicitDetectiveSeriesBrand } from './seriesDetectiveBranding';
import { confirmedGoogleMembershipIds } from './seriesDetectiveGoogleSeriesIds';
import { decideDetectiveMembership } from './seriesDetectiveDecision';

import { discoverDetectiveWikidata } from './seriesDetectiveWikidataApi';

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
  const explicitMembership = edition.seriesMemberships?.find((membership) =>
    detectiveSeriesNamesCompatible(membership.name, wantedSeriesName));
  if (explicitMembership) return { name: explicitMembership.name, position: explicitMembership.position ?? null };
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



const safeDetectiveTrim = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

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
        : safeDetectiveTrim(seriesAware.seriesName)
          ? {
              name: safeDetectiveTrim(seriesAware.seriesName),
              position: typeof seriesAware.seriesOrder === 'number' && Number.isFinite(seriesAware.seriesOrder)
                ? seriesAware.seriesOrder
                : null,
            }
          : null;
      const structuredSeriesMatch = Boolean(
        wantedSeriesName && (edition.seriesMemberships?.some((membership) =>
          detectiveSeriesNamesCompatible(membership.name, wantedSeriesName))
          || (seriesAware.seriesName && detectiveSeriesNamesCompatible(seriesAware.seriesName, wantedSeriesName))),
      );
      if (!exactAuthor && !structuredSeriesMatch) return [];
      return [{
        work,
        edition,
        seriesName: metadata?.name,
        position: metadata?.position ?? null,
        provider: 'hardcover' as const,
        seriesProvider: metadata ? 'hardcover' as const : undefined,
        seriesStructured: structuredSeriesMatch || Boolean(!wantedSeriesName && (seriesAware.seriesName || edition.seriesMemberships?.length)),
        nativeSeriesId: edition.seriesMemberships?.find(membership =>
          Boolean(membership.externalSeriesId?.trim())
          && (!wantedSeriesName || detectiveSeriesNamesCompatible(membership.name, wantedSeriesName))
          && (!metadata?.name || detectiveSeriesNamesCompatible(membership.name, metadata.name))
        )?.externalSeriesId,
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
    const seriesName = safeDetectiveTrim(edition.seriesName);
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
// Adaptations and catalog placeholders are not distinct installments of the
// prose series. Keep the check narrowly tied to explicit product labeling:
// "manga" and "graphic novel" by themselves may describe legitimate series.
const DERIVATIVE_ADAPTATION_PATTERN =
  /(?:\(\s*the\s+manga\s*\)|\b(?:manga|graphic\s+novel)\s+adaptation\b|\badapted\s+(?:as|into)\s+(?:a\s+)?(?:manga|graphic\s+novel)\b)/i;
const CATALOG_PLACEHOLDER_PATTERN =
  /^(?:[\p{L}.'-]+\s+){1,5}book\s*#?\s*\d+\s*\([^)]{2,}\)$/iu;

const isDerivativeSeriesProduct = (candidate: DetectiveMergeCandidate): boolean => {
  const values = [
    candidate.work.title,
    candidate.work.subtitle,
    candidate.edition.title,
    candidate.edition.subtitle,
    candidate.edition.editionName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return values.some((value) => DERIVATIVE_SERIES_PRODUCT_PATTERN.test(value)
    || DERIVATIVE_ADAPTATION_PATTERN.test(value))
    || CATALOG_PLACEHOLDER_PATTERN.test(candidate.work.title);
};

// A catalog entry naming the series itself is not evidence of a distinct book.
// Restrict this guard to exact series-name metadata labels; never infer from
// position or fuzzy title similarity, and leave ambiguous works reviewable.
const isSeriesMetadataRecord = (candidate: DetectiveMergeCandidate, seriesName: string): boolean => {
  const title = candidate.work.title.trim();
  const normalized = canonicalDetectiveSeries(title);
  const wanted = canonicalDetectiveSeries(seriesName);
  if (!normalized || !wanted) return false;
  if (!/\b(?:series|saga|books)\s*$/i.test(title)) return false;
  return normalized === wanted;
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
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
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
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
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
  verification?: 'verified' | 'review';
}

// Only candidates emitted by a completed discovery may enter the automatic
// add flow. An event's user-controlled verification string is never evidence.
const issuedVerifiedCandidates = new WeakSet<SeriesDetectiveCandidate>();
export const isIssuedVerifiedDetectiveCandidate = (candidate: SeriesDetectiveCandidate): boolean =>
  Boolean(candidate && candidate.verification === 'verified' && issuedVerifiedCandidates.has(candidate));

export interface SeriesDetectiveOwnedEntry {
  /** Catalog record that was recognised as already being in the library. */
  candidate: SeriesDetectiveCandidate;
  /** The library book it matched. Read-only reference; never mutated here. */
  book: UserBookRecord;
}

export interface SeriesDetectiveProviderReport {
  provider: 'google-books' | 'open-library' | 'hardcover' | 'penguin-random-house' | 'wikidata';
  status: 'ok' | 'partial' | 'unavailable' | 'rate-limited' | 'timed-out';
  errorCode?: string;
  retrievedAt: string;
}

export interface SeriesDetectiveResult {
  seriesName: string;
  candidates: SeriesDetectiveCandidate[];
  missing: SeriesDetectiveCandidate[];
  /** Catalog candidates already in the library (additive; `missing` is unchanged). */
  owned: SeriesDetectiveOwnedEntry[];
  completeness?: 'complete' | 'partial' | 'unavailable' | 'conflict';
  providerReports?: SeriesDetectiveProviderReport[];
  /** Read-only explanation of why discovery did or did not produce a roster. */
  discoveryDiagnostics?: {
    discovered: number;
    merged: number;
    rejectedSeries: number;
    rejectedAuthor: number;
    rejectedEvidence: number;
    admitted: number;
    uniqueWorks: number;
    providerCounts: Record<string, number>;
  };
}

export interface FindMissingSeriesOptions {
  /** Skip the short-lived in-memory catalog cache (used by explicit Retry). */
  forceRefresh?: boolean;
  /** Seed work that initiated discovery, even if it has no saved series. */
  seedBookId?: string;
  /**
   * The reader's manual series corrections. The canonical resolver applies
   * these first, so gap/next-book planning must see them too.
   */
  overrides?: SeriesOverrides;
}

/**
 * The single rule for "is this catalog candidate already in the library".
 * Used for both `missing` and `owned` so the two can never disagree.
 * Matching is by exact comparable title, stored external work key, or ISBN.
 */
export const findLibraryBookForCandidate = (
  candidate: SeriesDetectiveCandidate,
  libraryBooks: UserBookRecord[],
): UserBookRecord | null => {

  return libraryBooks.find((book) => {
    const sameAuthor = candidate.work.authors.some((author) =>
      Boolean(canonicalDetectiveAuthor(author))
      && detectiveAuthorsCompatible(author, book.work.author));
    // An ISBN identifies an edition, not a literary work. Require compatible
    // title and author before considering ANY ownership identifier.
    const sameTitle = detectiveWorkTitlesCompatible(
      candidate.work.title, book.work.title, candidate.seriesName);
    if (!sameAuthor) return false;
    if (sameTitle) return true;
    // Different market titles can describe the SAME edition (Genesis/Undone).
    // Require a checksum-valid ISBN shared with an actual owned edition,
    // a credible matching author, and no contradictory saved series identity.
    // ISBN alone must never establish ownership.
    if (book.work.seriesName?.trim() && candidate.seriesName?.trim()
      && !detectiveSeriesNamesCompatible(book.work.seriesName, candidate.seriesName)) return false;
    // A boxed set may reuse one valid ISBN across distinct novels. For
    // different titles, ISBN overlap is only supporting evidence: require
    // an independently saved series-slot identity anchor as well.
    const sameEstablishedSlot = Boolean(book.work.seriesName?.trim()
      && detectiveSeriesNamesCompatible(book.work.seriesName, candidate.seriesName)
      && typeof book.work.seriesOrder === 'number'
      && Number.isFinite(book.work.seriesOrder)
      && typeof candidate.position === 'number'
      && book.work.seriesOrder === candidate.position);
    if (!sameEstablishedSlot) return false;
    const candidateIsbns = new Set([candidate.edition.isbn13, candidate.edition.isbn10,
      ...candidate.work.editions.flatMap(edition => [edition.isbn13, edition.isbn10])]
      .map(canonicalDetectiveIsbn13).filter((isbn): isbn is string => Boolean(isbn)));
    return candidateIsbns.size > 0 && book.editions.some(edition =>
      [edition.isbn, edition.isbn10, edition.isbn13].some(isbn => {
        const normalized = canonicalDetectiveIsbn13(isbn);
        return normalized !== null && candidateIsbns.has(normalized);
      }));
  }) ?? null;
};

/**
 * Splits catalog candidates into owned / missing against the CURRENT library.
 * UI calls this again whenever the library changes (for example right after
 * "Add Book") so a just-added book moves out of Missing without a new network
 * lookup.
 */
export const classifySeriesCandidates = (
  seriesName: string,
  candidates: SeriesDetectiveCandidate[],
  libraryBooks: UserBookRecord[],
): SeriesDetectiveResult => {
  const owned: SeriesDetectiveOwnedEntry[] = [];
  const missing: SeriesDetectiveCandidate[] = [];
  candidates.forEach((candidate) => {
    const book = findLibraryBookForCandidate(candidate, libraryBooks);
    if (book) owned.push({ candidate, book });
    else missing.push(candidate);
  });
  // No provider in this pipeline supplies a trusted complete-series total.
  // A nonempty roster is partial, never automatically complete.
  return { seriesName, candidates, missing, owned, completeness: candidates.length ? 'partial' : 'unavailable' };
};

const identifier = (volume: DetectiveGoogleVolume, type: 'ISBN_10' | 'ISBN_13'): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((item) => item.type === type)?.identifier;

const seriesMetadata = (
  volume: DetectiveGoogleVolume,
  catalog: DetectiveGoogleCatalog,
): SeriesDetectiveMatch | null => {
  const info = volume.volumeInfo?.seriesInfo;
  const memberships = info?.volumeSeries ?? [];
  const named = memberships.find((membership) => {
    const id = safeDetectiveTrim(membership.seriesId);
    return Boolean(id && catalog.seriesTitlesById[id]);
  });
  const membership = named ?? memberships[0];
  const seriesId = safeDetectiveTrim(named?.seriesId);
  const name = seriesId ? catalog.seriesTitlesById[seriesId] : undefined;
  const positionCandidate = membership?.orderNumber
    ?? membership?.issue?.find((issue) => typeof issue.issueOrderNumber === 'number')?.issueOrderNumber;
  const displayPosition = Number(info?.bookDisplayNumber?.match(/\d+(?:\.\d+)?/)?.[0]);
  const position = typeof positionCandidate === 'number' && Number.isSafeInteger(positionCandidate) && positionCandidate > 0
    ? positionCandidate
    : Number.isSafeInteger(displayPosition) && displayPosition > 0 ? displayPosition : null;

  if (name) return { name, position };

  const bibliographic = volume.inkboundBibliographicSeries;
  if (safeDetectiveTrim(bibliographic?.name)) {
    return {
      name: safeDetectiveTrim(bibliographic.name),
      position: typeof bibliographic.position === 'number' && Number.isFinite(bibliographic.position)
        ? bibliographic.position
        : position,
    };
  }

  return inferDetectiveSeriesFromDescription(volume.volumeInfo?.description)
    ?? inferDetectiveSeriesFromTitle(volume.volumeInfo?.title)
    ?? inferDetectiveSeriesFromTitle(volume.volumeInfo?.subtitle)
    // A plausible bare subtitle is only candidate evidence. evidenceForVolume
    // deliberately does not classify it as structured, so verification still
    // requires independent corroboration rather than accepting one guess.
    ?? (() => {
      const subtitle = plausibleDetectiveSeriesSubtitle(volume.volumeInfo?.subtitle);
      return subtitle ? { name: subtitle, position: null } : null;
    })();
};

const structuredSeriesPosition = (
  volume: DetectiveGoogleVolume,
  confirmedSeriesIds: Set<string>,
): number | null => {
  const info = volume.volumeInfo?.seriesInfo;
  const membership = (info?.volumeSeries ?? []).find((candidate) => {
    const id = safeDetectiveTrim(candidate.seriesId);
    return Boolean(id && confirmedSeriesIds.has(id));
  });
  if (!membership) return null;

  const positionCandidate = membership.orderNumber
    ?? membership.issue?.find((issue) => typeof issue.issueOrderNumber === 'number')?.issueOrderNumber;
  const displayPosition = Number(info?.bookDisplayNumber?.match(/\d+(?:\.\d+)?/)?.[0]);
  return typeof positionCandidate === 'number' && Number.isSafeInteger(positionCandidate) && positionCandidate > 0
    ? positionCandidate
    : Number.isSafeInteger(displayPosition) && displayPosition > 0 ? displayPosition : null;
};

const volumeUsesConfirmedSeriesId = (
  volume: DetectiveGoogleVolume,
  confirmedSeriesIds: Set<string>,
): boolean => (volume.volumeInfo?.seriesInfo?.volumeSeries ?? []).some((membership) => {
  const id = safeDetectiveTrim(membership.seriesId);
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
  // An unrelated native series on the same volume must not validate a
  // bibliographic label for the requested series during evidence scoring.
  const structured = Boolean(
    (volume.volumeInfo?.seriesInfo?.volumeSeries ?? []).some((membership) => {
      const id = safeDetectiveTrim(membership.seriesId);
      const nativeName = id ? catalog.seriesTitlesById[id] : undefined;
      return Boolean(nativeName
        && detectiveSeriesNamesCompatible(nativeName, metadata.name));
    })
    // Scraped bibliographic labels (even explicit-looking ones) are hints,
    // not an authenticated series-ID mapping. Never promote them to proof.
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
  onFailure?: (error: unknown) => void,
): Promise<DetectiveGoogleCatalog> => {
  try {
    return await searchDetectiveGoogleBooks(query, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Series Detective catalog query failed.', error);
    onFailure?.(error);
    return { items: [], seriesTitlesById: {} };
  }
};

const SERIES_DISCOVERY_MAX_PAGES = 4;

const collectGoogleAuthorCatalogs = async (
  author: string,
  signal?: AbortSignal,
  onFailure?: (error: unknown) => void,
): Promise<DetectiveGoogleCatalog[]> => {
  const catalogs: DetectiveGoogleCatalog[] = [];
  if (!author.trim()) return catalogs;
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
      onFailure?.(error);
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
    structured: candidate.seriesStructured === true,
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
      seriesStructured: candidate.seriesStructured === true,
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
      structured: candidate.seriesStructured === true,
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
      discoveryAuthor: safeDetectiveTrim(match.authors.find((author) => safeDetectiveTrim(author))) || undefined,
    };
  }

  return selectCorroboratedSubtitleSeries(providerCandidates, book);
}

const detectiveCoverUrl = (volume: DetectiveGoogleVolume): string | undefined => {
  const links = volume.volumeInfo?.imageLinks;
  const source = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return (typeof source === 'string' ? source : undefined)?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
};

const detectivePublicationYear = (value?: string): number => {
  const match = (typeof value === 'string' ? value : '').match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
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
  const title = safeDetectiveTrim(info?.title);
  if (!title) return null;

  const format: Format = volume.saleInfo?.isEbook ? 'ebook' : 'hardcover';
  const authors = info?.authors?.length ? info.authors : ['Unknown author'];
  const canonicalWantedAuthor = canonicalDetectiveAuthor(wantedAuthor);
  const authorIsUsable = canonicalWantedAuthor && canonicalWantedAuthor !== 'unknown author';
  const exactAuthor = !authorIsUsable || authors.some((name) => detectiveAuthorsCompatible(wantedAuthor, name));
  // A volume may belong to multiple series. Native membership in series A
  // cannot upgrade a scraped label for series B into structured evidence.
  const matchedNativeSeriesId = (info?.seriesInfo?.volumeSeries ?? [])
    .map(membership => safeDetectiveTrim(membership.seriesId))
    .find(id => Boolean(id && catalog.seriesTitlesById[id]
      && metadata?.name
      && detectiveSeriesNamesCompatible(catalog.seriesTitlesById[id], metadata.name)
      && (!wantedSeriesName || detectiveSeriesNamesCompatible(catalog.seriesTitlesById[id], wantedSeriesName))));
  const hasStructuredSeries = Boolean(matchedNativeSeriesId);

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
  const explicitTitleBrand = Boolean(wantedSeriesName && hasExplicitDetectiveSeriesBrand({
    work: { title, subtitle: info?.subtitle, authors } as SeriesDetectiveWorkGroup,
    edition: { title, subtitle: info?.subtitle } as SeriesDetectiveEdition,
    provider: 'google-books',
    position: null,
  }, wantedSeriesName));
  if (
    !hasStructuredSeries
    && !explicitBibliographicSeriesMatch
    && !explicitCompatibleSeries
    && !explicitTitleBrand
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
    // Scraped bibliographic labels, including explicit-looking ones, are
    // discovery hints. Only a resolved native membership may be structured.
    seriesStructured: metadata ? hasStructuredSeries : undefined,
    nativeSeriesId: matchedNativeSeriesId,
  };
};

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
  signal?: AbortSignal,
  seriesBookIds?: string[],
  options: FindMissingSeriesOptions = {},
): Promise<SeriesDetectiveResult> {
  const overrides = options.overrides ?? {};
  const scopedSeriesBookIds = new Set(seriesBookIds ?? []);
  if (options.seedBookId) scopedSeriesBookIds.add(options.seedBookId);
  // An entry point is a hint, not a limit on discovery. Include every owned
  // installment carrying the same verified series identity as additional
  // anchors, even when the library grouped authors into separate clusters.
  const seriesBooks = libraryBooks.filter((book) => {
    const resolved = resolveEffectiveSeriesMetadata(book, overrides);
    return scopedSeriesBookIds.has(book.id)
      || Boolean(resolved && detectiveSeriesNamesCompatible(resolved.name, seriesName));
  });
  const knownPositions = seriesBooks.flatMap((book) => {
    const resolved = resolveEffectiveSeriesMetadata(book, overrides);
    return typeof resolved?.position === 'number' && Number.isFinite(resolved.position)
      ? [resolved.position]
      : [];
  });
  const { queries, targetPositions } = planSeriesDiscoveryQueries({ seriesName, author, knownPositions, anchorTitles: seriesBooks.map((book) => book.work.title) });

  // Discovery does not yet carry reliable availability/completeness signals
  // from every provider. Until it does, do not reuse a roster that may have
  // silently omitted Google Books or Open Library results.
  const providerReports: SeriesDetectiveProviderReport[] = [];
  let discoveryDiagnostics: SeriesDetectiveResult['discoveryDiagnostics'];
  const googleFailures: unknown[] = [];
  const openLibraryFailures: unknown[] = [];
  const recordOpenLibraryFailure = (error: unknown) => { openLibraryFailures.push(error); };
  const discoverCandidates = async (): Promise<SeriesDetectiveCandidate[]> => {
    const [
      queryCatalogs,
      googleAuthorCatalogs,
      openLibrarySeriesCandidates,
      openLibraryAuthorCandidates,
      openLibraryContextCandidates,
      openLibraryCrossAuthorContext,
      hardcoverSeriesAndAuthor,
      hardcoverSeriesOnly,
      hardcoverAuthor,
      prhSeriesAndAuthor,
      prhSeriesOnly,
      prhAuthor,
    ] = await Promise.all([
      // Bounded fan-out: the planner may emit ~25 queries, and firing them all
      // at once alongside the other providers trips Google Books rate limits.
      mapWithConcurrency(queries, 4, (query) => safeDetectiveSearch(query, signal, (error) => googleFailures.push(error))),
      collectGoogleAuthorCatalogs(author, signal, (error) => googleFailures.push(error)),
      searchDetectiveOpenLibrarySeries(seriesName, author, signal, recordOpenLibraryFailure),
      searchDetectiveOpenLibraryAuthor(author, signal, recordOpenLibraryFailure),
      searchDetectiveOpenLibraryContext(seriesName, author, signal, false, recordOpenLibraryFailure),
      searchDetectiveOpenLibraryContext(seriesName, author, signal, true, recordOpenLibraryFailure),
      // Only the series + author query may expand Hardcover's structured
      // series ID. A bare series name can collide across unrelated authors.
      searchSeriesDetectiveHardcover(
        `${seriesName} ${author}`,
        true,
        {
          seriesName,
          anchorTitles: seriesBooks.map((book) => book.work.title),
          anchorAuthor: author,
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
    const retrievedAt = new Date().toISOString();
    const summarizeProvider = (
      provider: SeriesDetectiveProviderReport['provider'],
      results: Array<{ providerStatus?: SeriesDetectiveProviderReport['status']; providerErrorCode?: string }>,
    ) => {
      const failed = results.filter((result) => result.providerStatus !== 'ok');
      providerReports.push({
        provider,
        status: failed.length ? (results.every((result) => result.providerStatus === 'unavailable' || result.providerStatus === 'rate-limited' || result.providerStatus === 'timed-out') ? 'unavailable' : 'partial') : 'ok',
        errorCode: failed.map((result) => result.providerErrorCode).find(Boolean),
        retrievedAt,
      });
    };
    summarizeProvider('hardcover', [hardcoverSeriesAndAuthor, hardcoverSeriesOnly, hardcoverAuthor]);
    summarizeProvider('penguin-random-house', [prhSeriesAndAuthor, prhSeriesOnly, prhAuthor]);
    // Google and Open Library currently swallow some individual lookup errors.
    // Never advertise them as healthy until all failure paths are instrumented.
    const googleRequested = queries.length + (author.trim() ? 1 : 0);
    const googleFailed = googleFailures.length;
    const googleFailureCodes = googleFailures.map((error) =>
      error instanceof Error ? error.message.toLowerCase() : '');
    const googleRateLimited = googleFailureCodes.some((message) =>
      /(?:rate-limited|429|resource-exhausted)/.test(message));
    const googleTimedOut = googleFailureCodes.some((message) =>
      /(?:timed-out|timeout|deadline-exceeded)/.test(message));
    providerReports.push({
      provider: 'google-books',
      status: googleFailed > 0 && googleFailed >= googleRequested
        ? (googleRateLimited ? 'rate-limited' : googleTimedOut ? 'timed-out' : 'unavailable')
        : 'partial',
      errorCode: googleRateLimited ? 'rate-limited'
        : googleTimedOut ? 'timed-out'
        : googleFailed ? 'query-failed' : 'pagination-not-verified',
      retrievedAt,
    });
    providerReports.push({ provider: 'open-library', status: 'partial', errorCode: openLibraryFailures.length ? 'query-failed' : 'pagination-not-verified', retrievedAt });
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
    // Resolve catalog series identities from an owned work, not just the
    // reader's potentially custom series label. An exact title+author anchor
    // must carry an actual Google volumeSeries ID; search text is insufficient.
    const seedGoogleSeriesIds = (
      volume: DetectiveGoogleVolume,
      catalog: DetectiveGoogleCatalog,
      allowSingleUnnamed: boolean,
    ) => {
      confirmedGoogleMembershipIds(volume, catalog, seriesName, allowSingleUnnamed)
        .forEach(id => confirmedGoogleSeriesIds.add(id));
    };
    catalogs.forEach((catalog) => {
      catalog.items.forEach((volume) => {
        const title = safeDetectiveTrim(volume.volumeInfo?.title);
        const authors = volume.volumeInfo?.authors ?? [];
        if (!title || !seriesBooks.some((book) =>
          detectiveWorkTitlesCompatible(book.work.title, title, seriesName)
          && authors.some((name) => Boolean(canonicalDetectiveAuthor(name))
            && Boolean(canonicalDetectiveAuthor(book.work.author))
            && detectiveAuthorsCompatible(book.work.author, name)))) return;
        const verified = mergeCandidateFromGoogleVolume(volume, catalog, seriesName, author);
        // The user's custom label is not evidence that every Google membership
        // on an owned book refers to the same series.
        seedGoogleSeriesIds(volume, catalog, Boolean(verified?.seriesStructured && verified.seriesName
          && detectiveSeriesNamesCompatible(verified.seriesName, seriesName)));
      });
    });
    // Do not allow arbitrary search results to seed a series ID. Only an
    // exact owned-work title/author anchor above can establish the ID;
    // otherwise unrelated search hits could launder their siblings into
    // verified membership.

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
          candidate.nativeSeriesId = (volume.volumeInfo?.seriesInfo?.volumeSeries ?? [])
            .map(membership => safeDetectiveTrim(membership.seriesId))
            .find(id => Boolean(id && confirmedGoogleSeriesIds.has(id)));
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
        seriesProvider: candidate.seriesName ? 'open-library' : undefined,
        // Search hits are not structured series evidence unless the provider
        // supplied actual membership, rather than a query-text association.
        seriesStructured: Boolean(candidate.seriesName),
      });
    });

    [...openLibraryContextCandidates, ...openLibraryCrossAuthorContext].forEach((candidate) => {
      providerCandidates.push({
        work: candidate.work,
        edition: candidate.edition,
        seriesName: candidate.seriesName,
        position: candidate.position,
        provider: 'open-library',
        seriesProvider: candidate.seriesName ? 'open-library' : undefined,
        // Context records can carry an inferred series label; only the
        // explicit Open Library series-field candidates above are structured.
        seriesStructured: false,
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

    // Wikidata is a distinct, structured series graph. Only query series IDs
    // anchored to an owned work; failures must never imply absence.
    // Keep a bounded one-seed lookup instead of multiplying calls by book.
    const wikidataSeed = seriesBooks.find(book => book.work.title && book.work.author);
    if (wikidataSeed) {
      const wikidata = await discoverDetectiveWikidata(
        { title: wikidataSeed.work.title, author: wikidataSeed.work.author }, seriesName, signal,
      );
      providerReports.push({
        provider: 'wikidata',
        status: wikidata.status === 'ok' ? 'ok' : wikidata.status === 'empty' ? 'partial' : 'unavailable',
        errorCode: wikidata.error, retrievedAt,
      });
      providerCandidates.push(...wikidata.candidates);
    }

    // Position is ordering metadata, never work identity. Providers frequently
    // omit or misreport it, so pruning to one candidate per position can delete
    // legitimate sibling works. Merge/dedupe by work identity and ISBN only.
    const mergedProviderCandidates = mergeDetectiveCandidates(providerCandidates)
      .filter((candidate) => !isDerivativeSeriesProduct(candidate));

    const addCandidate = (candidate: SeriesDetectiveCandidate) => {
      const titleKey = comparableDetectiveTitle(candidate.work.title, candidate.seriesName);
      const authorKey = canonicalDetectiveAuthor(candidate.work.authors[0]);
      const candidateIsbns = [candidate.edition.isbn13, candidate.edition.isbn10]
        .map(compactDetectiveIsbn).filter(Boolean);
      const isbnKey = candidateIsbns[0];
      // Series position is ordering metadata, not work identity. Two catalog
      // records claiming the same slot must not cause one distinct work to be
      // silently discarded.
      // An ISBN identifies an edition, not a distinct literary work. Keep
      // editions within the same work rather than offering duplicates as
      // separate missing books. Only use ISBN when title/author are unavailable.
      const key = titleKey && authorKey
        ? `work:${titleKey}::${authorKey}`
        : isbnKey ? `isbn:${isbnKey}` : `unidentified:${seen.size}`;
      // ISBN identifies an edition, not a work. Catalogs sometimes reuse an
      // ISBN across different installments; never discard a distinct title
      // because its edition metadata collides with another candidate.
      const isbnMatch = candidateIsbns.length ? [...seen.entries()].find(([, existing]) =>
        [existing.edition.isbn13, existing.edition.isbn10]
          .map(compactDetectiveIsbn).filter(Boolean)
          .some((isbn) => candidateIsbns.includes(isbn))
        && existing.work.authors.some((existingAuthor) =>
          candidate.work.authors.some((incomingAuthor) =>
            detectiveAuthorsCompatible(existingAuthor, incomingAuthor)))
        && (!titleKey || !comparableDetectiveTitle(existing.work.title, existing.seriesName)
          || comparableDetectiveTitle(existing.work.title, existing.seriesName) === titleKey)) : undefined;
      // A missing title must not overwrite an identified work merely because
      // the provider supplied a colliding ISBN. Keep it reviewable separately.
      const targetKey = isbnMatch && titleKey && authorKey ? isbnMatch[0] : key;
      const current = seen.get(targetKey);
      const conflictingTitles = Boolean(current
        && comparableDetectiveTitle(current.work.title, current.seriesName) !== titleKey);
      const proposed = conflictingTitles ? { ...candidate, verification: 'review' as const, position: null } : candidate;
      if (!current || (current.verification !== 'verified' && proposed.verification === 'verified')
        || (current.verification === proposed.verification && !current.edition.coverUrl && proposed.edition.coverUrl)) {
        seen.set(targetKey, proposed);
      }
      // Disagreement about the title of an identical ISBN must never be
      // silently promoted to verified bulk-add eligibility.
      if (conflictingTitles) {
        const selected = seen.get(targetKey);
        if (selected) seen.set(targetKey, { ...selected, verification: 'review', position: null });
      }
    };

    // Cross-author membership is enabled only when the catalog provides a
    // multi-author family, or when two different authors explicitly brand
    // their books with the requested series name.
    const structuredAuthors = new Set(mergedProviderCandidates
      .filter((candidate) => candidate.seriesStructured
        && candidate.seriesName
        && detectiveSeriesNamesCompatible(candidate.seriesName, seriesName))
      .flatMap((candidate) => candidate.work.authors.map(canonicalDetectiveAuthor).filter(Boolean)));
    const brandedAuthors = new Set(mergedProviderCandidates
      .filter((candidate) => hasExplicitDetectiveSeriesBrand(candidate, seriesName)
        && (!candidate.seriesName || detectiveSeriesNamesCompatible(candidate.seriesName, seriesName)))
      .flatMap((candidate) => candidate.work.authors.map(canonicalDetectiveAuthor).filter(Boolean)));
    // Owned books already assigned to this series are a separate, local
    // bootstrap signal for a shared-world series. Do not count an arbitrary
    // seed book or a placeholder author as proof of a multi-author family.
    const ownedSeriesAuthors = new Set(seriesBooks
      .filter((book) => {
        const resolved = resolveEffectiveSeriesMetadata(book, overrides);
        return Boolean(resolved && detectiveSeriesNamesCompatible(resolved.name, seriesName));
      })
      .map((book) => canonicalDetectiveAuthor(book.work.author))
      .filter(Boolean));
    const verifiedMultiAuthorBrand = ownedSeriesAuthors.size >= 2
      || structuredAuthors.size >= 2 || brandedAuthors.size >= 2;

    const diagnostics = {
      discovered: providerCandidates.length,
      merged: mergedProviderCandidates.length,
      rejectedSeries: 0,
      rejectedAuthor: 0,
      rejectedEvidence: 0,
      admitted: 0,
      providerCounts: Object.fromEntries(
        ['google-books', 'open-library', 'hardcover', 'penguin-random-house', 'wikidata']
          .map((provider) => [provider, providerCandidates.filter((candidate) => candidate.provider === provider).length]),
      ),
    };

    // Keep verification anchored to the requested series and to an actual
    // owned work. A text label by itself cannot establish series identity.
    // Require two independent providers to identify the SAME owned work.
    // A vote for owned book A and a vote for owned book B must not combine
    // into a fictitious corroborated seed.
    mergedProviderCandidates.forEach((candidate) => {
      if (isSeriesMetadataRecord(candidate, seriesName)) {
        diagnostics.rejectedEvidence += 1;
        return;
      }
      // Fail closed at the final actionable-roster boundary. A matching series
      // phrase in a title, subtitle, or description is not proof of membership.
      // The catalog must supply structured membership or independent provider
      // corroboration. This applies equally to single- and multi-author series.
      const explicitBrand = hasExplicitDetectiveSeriesBrand(candidate, seriesName);
      const contextual = !candidate.seriesName
        && (hasMergedKnownSeriesContext(candidate, seriesName)
          || explicitBrand);
      const resolvedSeriesName = candidate.seriesName ?? (contextual ? seriesName : undefined);
      // A seed work may belong to multiple related series. Its membership in
      // another series cannot authorize relabeling all sibling works into the
      // requested roster. Preserve cross-series evidence for future review,
      // but do not promote it to an actionable candidate.
      const anchoredAlias = false;
      if (!resolvedSeriesName || !detectiveSeriesNamesCompatible(resolvedSeriesName, seriesName)) {
        diagnostics.rejectedSeries += 1;
        return;
      }
      const independentlyCorroborated = new Set(candidate.providerSources ?? [candidate.provider]).size >= 2;
      const ownedAuthors = seriesBooks.map((book) => book.work.author).filter(Boolean);
      const matchingAuthor = candidate.work.authors.some((name) =>
        (Boolean(canonicalDetectiveAuthor(author)) && detectiveAuthorsCompatible(author, name))
        || ownedAuthors.some((ownedAuthor) =>
          Boolean(canonicalDetectiveAuthor(ownedAuthor))
          && detectiveAuthorsCompatible(ownedAuthor, name)));
      // Cross-author anthologies are legitimate, but a shared title phrase
      // is not enough to admit a different author's unrelated work.
      const compatibleSeries = detectiveSeriesNamesCompatible(resolvedSeriesName, seriesName);
      const crossAuthorMembership = candidate.seriesStructured && compatibleSeries && verifiedMultiAuthorBrand;
      // A single owned author cannot bootstrap a multi-author family, but
      // explicit structured membership for another author is still useful
      // discovery. Show it for review; never promote it to an automatic add
      // until the multi-author family is independently established.
      const crossAuthorReview = candidate.seriesStructured === true
        && compatibleSeries && !matchingAuthor && !verifiedMultiAuthorBrand;
      if (!matchingAuthor && !crossAuthorMembership && !crossAuthorReview) {
        diagnostics.rejectedAuthor += 1;
        return;
      }
      if (!candidate.seriesStructured && !independentlyCorroborated && !explicitBrand) {
        diagnostics.rejectedEvidence += 1;
        return;
      }
      diagnostics.admitted += 1;
      // Provider overlap alone is not proof of series membership: two search
      // providers may repeat the same title/description branding. Require
      // explicit structured series evidence as well as corroboration before
      // offering bulk addition. Brand-only discoveries remain reviewable.
      // An authoritative structured membership with a real installment number
      // can verify independently; weak/unnumbered metadata still needs corroboration.
      // Aliases and title branding never grant automatic verification.
      // A single provider's numbered membership is discovery evidence, not
      // independent verification. Preserve the candidate for review instead
      // of silently granting bulk-add eligibility.
      const decision = decideDetectiveMembership(
        providerCandidates, candidate,
        seriesBooks.map(book => ({ title: book.work.title, author: book.work.author })),
        seriesName,
      );
      addCandidate({
        work: candidate.work,
        edition: candidate.edition,
        // Present results under the reader's collection without modifying
        // the original catalog evidence or saved reading order.
        seriesName: anchoredAlias ? seriesName : resolvedSeriesName,
        // A single catalog's ordinal is not a verified reading order.
        // Retain unknown order instead of presenting a misleading number.
        position: decision.position,
        verification: crossAuthorReview ? 'review' : decision.verification,

      });
    });

    discoveryDiagnostics = { ...diagnostics, uniqueWorks: seen.size };
    if (import.meta.env.DEV) {
      console.info('[Series Detective] discovery diagnostics', {
        seriesName,
        ...diagnostics,
        uniqueWorks: seen.size,
        multiAuthorBrandVerified: verifiedMultiAuthorBrand,
      });
    }

    // Conflicting claims to the same numbered slot are not proof of identical
    // works. Preserve both records but require individual review of each.
    const byPosition = new Map<number, SeriesDetectiveCandidate[]>();
    for (const candidate of seen.values()) {
      if (candidate.position === null) continue;
      const siblings = byPosition.get(candidate.position) ?? [];
      siblings.push(candidate);
      byPosition.set(candidate.position, siblings);
    }
    const conflictedPositions = new Set([...byPosition.entries()]
      .filter(([, siblings]) => new Set(siblings.map((candidate) =>
        `${comparableDetectiveTitle(candidate.work.title, candidate.seriesName)}::${canonicalDetectiveAuthor(candidate.work.authors[0])}`)).size > 1)
      .map(([position]) => position));
    return [...seen.values()].map((candidate) =>
      candidate.position !== null && conflictedPositions.has(candidate.position)
        ? { ...candidate, verification: 'review' as const, position: null }
        : candidate).sort((a, b) => {
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return a.work.title.localeCompare(b.work.title);
    });
  };

  // Do not cache discovery until every provider exposes reliable health and
  // pagination/completeness signals. Ownership is classified against the live
  // library for each request.
  const candidates = await discoverCandidates();
  candidates.filter(candidate => candidate.verification === 'verified')
    .forEach(candidate => issuedVerifiedCandidates.add(candidate));
  const result = classifySeriesCandidates(seriesName, candidates, libraryBooks);
  // These reports were collected during discovery but never attached to the
  // returned result, leaving production failures invisible to callers.
  result.providerReports = [...providerReports];
  if (discoveryDiagnostics) {
    result.discoveryDiagnostics = {
      ...discoveryDiagnostics,
      providerCounts: { ...discoveryDiagnostics.providerCounts },
    };
  }
  result.completeness = providerReports.length > 0
    && providerReports.every((report) => report.status === 'unavailable')
    ? 'unavailable' : 'partial';
  return result;
}
