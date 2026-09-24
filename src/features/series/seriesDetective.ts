import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchGoogleBooks, searchGoogleBooksAuthorPage, searchSeriesContextCatalog } from '../book-search/data/googleBooksApi';
import { canonicalAuthorIdentity, canonicalLanguageCode, catalogEditionQualityScore, hardenCatalogGroups } from '../book-search/catalogHardening';
import { inferSeriesHintFromTitle, resolveEffectiveSeriesMetadata, seriesNamesAreCompatible } from './seriesLibrary';
import { hasKnownSeriesContextEvidence, plausibleSeriesSubtitle, scoreSeriesEvidence, selectVerifiedSeriesEvidence, selectVerifiedSubtitleSeriesEvidence, type SeriesEvidence } from './seriesDetectiveEvidence';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = canonicalAuthorIdentity(author);
  return !wanted || group.authors.some((candidate) => canonicalAuthorIdentity(candidate) === wanted);
};

const sameSeries = (edition: BookSearchEdition, seriesName: string) =>
  Boolean(edition.seriesName && seriesNamesAreCompatible(edition.seriesName, seriesName));

export const inferKnownSeriesFromBibliographicText = (
  value: string | undefined,
  wantedSeriesName: string,
): { name: string; position: number | null } | null => {
  const text = value?.trim();
  if (!text) return null;

  const parts = text.split(':');
  const candidate = (parts.length > 1 ? parts[parts.length - 1] : text).trim();
  const match = candidate.match(/^(.*?)(?:\s*,?\s*)(?:#\s*|book\s*#?\s*|vol(?:ume)?\.?\s*#?\s*|part\s*#?\s*)(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;

  const name = match[1].trim().replace(/[,:;\-]+$/g, '');
  if (!seriesNamesAreCompatible(name, wantedSeriesName)) return null;

  const position = Number.parseFloat(match[2]);
  return {
    name,
    position: Number.isFinite(position) && position >= 0 ? position : null,
  };
};

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  canonicalLanguageCode(
    (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language,
  );

const SERIES_DISCOVERY_MAX_PAGES = 4;


const candidateSeriesMetadata = (
  work: BookSearchWorkGroup,
  edition: BookSearchEdition,
  wantedSeriesName: string,
  providerAgreement = 1,
): { name: string; position: number | null; evidence: 'structured' | 'title' | 'contextual' } | null => {
  if (sameSeries(edition, wantedSeriesName)) {
    return {
      name: edition.seriesName!,
      position: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : null,
      evidence: 'structured',
    };
  }

  for (const value of [edition.title, work.title, edition.subtitle, work.subtitle]) {
    const inferred = inferSeriesHintFromTitle(value ?? '')
      ?? inferKnownSeriesFromBibliographicText(value, wantedSeriesName);
    if (inferred && seriesNamesAreCompatible(inferred.name, wantedSeriesName)) {
      return { name: inferred.name, position: inferred.position, evidence: 'title' };
    }
  }

  // A known series can also be exposed by a provider as an exact, non-generic
  // subtitle rather than structured series metadata. In that case the subtitle
  // itself is the bibliographic evidence; do not require a second provider to
  // repeat the same field before accepting the relationship.
  for (const subtitle of [edition.subtitle, work.subtitle]) {
    const candidate = plausibleSeriesSubtitle(subtitle);
    if (candidate && seriesNamesAreCompatible(candidate, wantedSeriesName)) {
      return { name: candidate, position: null, evidence: 'contextual' };
    }
  }

  // Once the reader is already inside a known series, discovery may use a
  // stronger contextual rule than single-book detection: if independent
  // providers agree on the same work and the known series name is explicitly
  // present in its title/subtitle, accept membership without inventing a book
  // number. This helps publisher-branded lines such as A Twisted Tale whose
  // catalogs often omit structured series fields.
  if (hasKnownSeriesContextEvidence(work, edition, wantedSeriesName, providerAgreement)) {
    return { name: wantedSeriesName.trim(), position: null, evidence: 'contextual' };
  }

  return null;
};

const collectPagedGroups = async (
  fetchPage: (startIndex: number) => Promise<{ groups: BookSearchWorkGroup[]; nextStartIndex: number; hasMore: boolean }>,
): Promise<BookSearchWorkGroup[]> => {
  const groups: BookSearchWorkGroup[] = [];
  let startIndex = 0;

  for (let pageNumber = 0; pageNumber < SERIES_DISCOVERY_MAX_PAGES; pageNumber += 1) {
    const page = await fetchPage(startIndex);
    groups.push(...page.groups);
    if (!page.hasMore || page.nextStartIndex <= startIndex) break;
    startIndex = page.nextStartIndex;
  }

  return groups;
};

export interface SeriesDetectiveCandidate {
  work: BookSearchWorkGroup;
  edition: BookSearchEdition;
  seriesName: string;
  position: number | null;
}

export interface SeriesDetectiveResult {
  seriesName: string;
  author: string;
  candidates: SeriesDetectiveCandidate[];
  missing: SeriesDetectiveCandidate[];
}

export const buildSeriesDetectionQueries = (book: UserBookRecord): { workQuery: string; identifiers: string[] } => {
  const identifiers = [...new Set(
    book.editions
      .flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )];

  return {
    workQuery: `${book.work.title} ${book.work.author}`.trim(),
    identifiers,
  };
};

export async function detectSeriesForBook(book: UserBookRecord): Promise<{ name: string; position: number | null } | null> {
  // Series Detective verifies the canonical work, not merely the active
  // edition. ISBN records are edition-specific and can be metadata-thin, so an
  // ISBN lookup must supplement -- never replace -- title+author work evidence.
  const wantedTitle = normalize(book.work.title);
  const { workQuery, identifiers } = buildSeriesDetectionQueries(book);

  const [workCatalog, authorGroups, ...identifierSearches] = await Promise.all([
    searchGoogleBooks(workQuery),
    collectPagedGroups((startIndex) => searchGoogleBooksAuthorPage(book.work.author, startIndex)),
    ...identifiers.map((isbn) => searchGoogleBooks(isbn)),
  ]);

  const groups = hardenCatalogGroups(
    [
      ...workCatalog.groups,
      ...identifierSearches.flatMap((response) => response.groups),
      ...authorGroups,
    ],
    { preferredAuthor: book.work.author },
  );

  const evidence = groups
    .filter((group) =>
      normalize(group.title) === wantedTitle
      || normalize(group.title).includes(wantedTitle)
      || wantedTitle.includes(normalize(group.title)),
    )
    .flatMap((group) => group.editions.map((edition) => scoreSeriesEvidence(group, edition, book)))
    .filter((item): item is SeriesEvidence => Boolean(item));

  const match = selectVerifiedSeriesEvidence(evidence);
  if (match) return { name: match.name, position: match.position };

  const subtitleMatch = selectVerifiedSubtitleSeriesEvidence(groups, book);
  return subtitleMatch ? { name: subtitleMatch.name, position: subtitleMatch.position } : null;
}

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
): Promise<SeriesDetectiveResult> {
  const seriesBooks = libraryBooks.filter((book) => {
    const metadata = resolveEffectiveSeriesMetadata(book);
    return metadata && seriesNamesAreCompatible(metadata.name, seriesName);
  });
  const knownWholePositions = seriesBooks
    .map((book) => resolveEffectiveSeriesMetadata(book)?.position)
    .filter((position): position is number => typeof position === 'number' && Number.isInteger(position) && position > 0);
  const highestKnownPosition = knownWholePositions.length ? Math.max(...knownWholePositions) : 0;
  const knownPositionSet = new Set(knownWholePositions);
  const missingKnownGaps = Array.from({ length: highestKnownPosition }, (_, index) => index + 1)
    .filter((position) => !knownPositionSet.has(position));

  const [seriesAndAuthor, authorGroups, seriesOnly, positionalDiscovery] = await Promise.all([
    searchGoogleBooks(`${seriesName} ${author}`).catch((error) => {
      console.warn('Series Detective series+author discovery failed.', error);
      return { groups: [], totalItems: 0 };
    }),
    collectPagedGroups((startIndex) => searchGoogleBooksAuthorPage(author, startIndex)).catch((error) => {
      console.warn('Series Detective author discovery failed.', error);
      return [];
    }),
    searchGoogleBooks(seriesName).catch((error) => {
      console.warn('Series Detective series-only discovery failed.', error);
      return { groups: [], totalItems: 0 };
    }),
    Promise.all(missingKnownGaps.map(async (position) => {
      const query = `${seriesName} book ${position} ${author}`;
      try {
        const result = await searchGoogleBooks(query);
        return result.groups;
      } catch (error) {
        console.warn(`Series Detective gap discovery failed for position ${position}.`, error);
        return [];
      }
    })),
  ]);

  const rawGroups = [
    ...seriesAndAuthor.groups,
    ...authorGroups,
    ...seriesOnly.groups,
    ...positionalDiscovery.flat(),
  ];

  const seen = new Map<string, SeriesDetectiveCandidate>();
  const candidates: SeriesDetectiveCandidate[] = [];
  const preferredLanguages = new Set(seriesBooks.map(activeEditionLanguage).filter((value): value is string => Boolean(value)));

  const addCandidatesFromRawGroups = (sourceGroups: BookSearchWorkGroup[]) => {
    // Preserve provider agreement before hardening merges exact editions across
    // catalogs. Series confidence must not disappear merely because canonical
    // edition normalization correctly collapsed duplicate ISBN records.
    const providerSourcesByWork = new Map<string, Set<BookSearchEdition['source']>>();
    for (const group of sourceGroups) {
      const identity = `${normalize(group.title)}::${normalize(group.authors[0])}`;
      const sources = providerSourcesByWork.get(identity) ?? new Set<BookSearchEdition['source']>();
      group.editions.forEach((candidate) => sources.add(candidate.source));
      providerSourcesByWork.set(identity, sources);
    }

    const merged = hardenCatalogGroups(sourceGroups, { preferredAuthor: author });
    for (const work of merged) {
      for (const edition of work.editions) {
        const providerAgreement = providerSourcesByWork.get(
          `${normalize(work.title)}::${normalize(work.authors[0])}`,
        )?.size ?? 1;
        const metadata = candidateSeriesMetadata(work, edition, seriesName, providerAgreement);
        if (!metadata) continue;

        // Structured/contextual series evidence may legitimately span authors.
        // Title-inferred evidence remains author-gated to prevent false joins.
        if (metadata.evidence === 'title' && !exactAuthorMatch(work, author)) continue;
        if (metadata.evidence !== 'structured' && metadata.evidence !== 'contextual' && !exactAuthorMatch(work, author)) continue;
        const candidateLanguage = canonicalLanguageCode(edition.language);
        if (preferredLanguages.size > 0 && candidateLanguage && !preferredLanguages.has(candidateLanguage)) continue;

        const candidate: SeriesDetectiveCandidate = {
          work,
          edition,
          seriesName: metadata.name,
          position: metadata.position,
        };
        const key = metadata.position !== null ? `position:${metadata.position}` : `title:${normalize(work.title)}`;
        const current = seen.get(key);
        if (!current || catalogEditionQualityScore(candidate.edition) > catalogEditionQualityScore(current.edition)) {
          seen.set(key, candidate);
        }
      }
    }
  };

  addCandidatesFromRawGroups(rawGroups);

  // Series-context discovery is additive, not a zero-result fallback. Finding
  // one member does not prove the series is complete, especially for shared-
  // author/publisher lines. This path remains isolated from Add Reading Material
  // and every candidate still has to pass the same membership evidence rules.
  const contextualCatalog = await searchSeriesContextCatalog(seriesName).catch((error) => {
    console.warn('Series Detective contextual catalog discovery failed.', error);
    return { groups: [], totalItems: 0 };
  });
  addCandidatesFromRawGroups(contextualCatalog.groups);

  // A library containing only Book 1 has no internal "gap", so the normal
  // missing-gap search never asks the catalog about Books 2+. If all proven
  // discovery paths still found nothing, probe a small bounded window ahead.
  // Candidates must still pass the exact same series-evidence rules below;
  // the position query is discovery only, never proof of membership.
  if (highestKnownPosition > 0) {
    const forwardPositions = Array.from(
      { length: 5 },
      (_, index) => highestKnownPosition + index + 1,
    );
    const forwardDiscovery = await Promise.all(forwardPositions.map(async (position) => {
      const query = `${seriesName} book ${position} ${author}`;
      try {
        const result = await searchGoogleBooks(query);
        return result.groups;
      } catch (error) {
        console.warn(`Series Detective forward discovery failed for position ${position}.`, error);
        return [];
      }
    }));
    addCandidatesFromRawGroups(forwardDiscovery.flat());
  }

  candidates.push(...seen.values());

  const existingPositions = new Set<number>();
  seriesBooks.forEach((book) => {
    const metadata = resolveEffectiveSeriesMetadata(book);
    if (typeof metadata?.position === 'number') existingPositions.add(metadata.position);
  });

  // Missing-series discovery must dedupe against the entire canonical library,
  // not only books already carrying this series label. A reader may already own
  // the work with incomplete series metadata; Detective must repair metadata,
  // never offer a second copy of the same work.
  const existingTitleAuthors = new Set(libraryBooks.map((book) =>
    `${normalize(book.work.title)}::${normalize(book.work.author)}`,
  ));
  const existingWorkIds = new Set(libraryBooks.map((book) => book.work.externalWorkId?.trim()).filter((value): value is string => Boolean(value)));
  const existingIsbns = new Set(libraryBooks.flatMap((book) =>
    book.editions.flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn].map(compactIsbn).filter(Boolean)),
  ));

  const missing = candidates.filter((candidate) => {
    if (candidate.position !== null && existingPositions.has(candidate.position)) return false;
    const candidateIdentity = `${normalize(candidate.work.title)}::${normalize(candidate.work.authors[0])}`;
    if (existingTitleAuthors.has(candidateIdentity)) return false;
    if (candidate.work.key && existingWorkIds.has(candidate.work.key)) return false;
    const candidateIsbns = [candidate.edition.isbn13, candidate.edition.isbn10].map(compactIsbn).filter(Boolean);
    return !candidateIsbns.some((isbn) => existingIsbns.has(isbn));
  }).sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.work.title.localeCompare(b.work.title);
  });

  return {
    seriesName,
    author,
    candidates,
    missing,
  };
}
