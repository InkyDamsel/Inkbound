import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchGoogleBooks, searchGoogleBooksAuthorPage } from '../book-search/data/googleBooksApi';
import { catalogEditionQualityScore, catalogEditionSources, hardenCatalogGroups } from '../book-search/catalogHardening';
import { inferSeriesHintFromTitle, resolveEffectiveSeriesMetadata, seriesNamesAreCompatible } from './seriesLibrary';
import { buildSeriesDetectionQueries } from './seriesDetectiveQueries';
import { hasKnownSeriesContextEvidence, scoreSeriesEvidence, selectVerifiedSeriesEvidence, selectVerifiedSubtitleSeriesEvidence, type SeriesEvidence } from './seriesDetectiveEvidence';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const sameSeries = (edition: BookSearchEdition, seriesName: string) =>
  Boolean(edition.seriesName && seriesNamesAreCompatible(edition.seriesName, seriesName));

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

const SERIES_DISCOVERY_MAX_PAGES = 4;


const candidateSeriesMetadata = (
  work: BookSearchWorkGroup,
  edition: BookSearchEdition,
  wantedSeriesName: string,
  providerAgreement = 1,
): { name: string; position: number | null; authorityId?: string; evidence: 'structured' | 'title' | 'contextual' } | null => {
  if (sameSeries(edition, wantedSeriesName)) {
    return {
      name: edition.seriesName!,
      position: typeof edition.seriesOrder === 'number' ? edition.seriesOrder : null,
      authorityId: edition.seriesAuthorityId,
      evidence: 'structured',
    };
  }

  for (const title of [edition.title, work.title]) {
    const inferred = inferSeriesHintFromTitle(title);
    if (inferred && seriesNamesAreCompatible(inferred.name, wantedSeriesName)) {
      return { name: inferred.name, position: inferred.position, evidence: 'title' };
    }
  }

  // Once the reader is already inside a known series, discovery may use a
  // stronger contextual rule than single-book detection: if independent
  // providers agree on the same work and the known series name is explicitly
  // present in its title/subtitle, accept membership without inventing a book
  // number. This helps publisher-branded lines such as A Twisted Tale whose
  // catalogs often omit structured series fields.
  if (hasKnownSeriesContextEvidence(work, edition, wantedSeriesName, providerAgreement)) {
    const authorityId = work.editions.find((candidate) =>
      sameSeries(candidate, wantedSeriesName) && candidate.seriesAuthorityId,
    )?.seriesAuthorityId;
    return { name: wantedSeriesName.trim(), position: null, authorityId, evidence: 'contextual' };
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
  seriesAuthorityId?: string;
}

export interface SeriesDetectiveResult {
  seriesName: string;
  author: string;
  candidates: SeriesDetectiveCandidate[];
  missing: SeriesDetectiveCandidate[];
  seriesAuthorityId?: string;
}

export async function detectSeriesForBook(book: UserBookRecord): Promise<{ name: string; position: number | null; seriesAuthorityId?: string } | null> {
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
  if (match) return {
    name: match.name,
    position: match.position,
    seriesAuthorityId: match.edition.seriesAuthorityId,
  };

  const subtitleMatch = selectVerifiedSubtitleSeriesEvidence(groups, book);
  if (!subtitleMatch) return null;
  const seriesAuthorityId = groups
    .flatMap((group) => group.editions)
    .find((edition) =>
      edition.seriesAuthorityId
      && edition.seriesName
      && seriesNamesAreCompatible(edition.seriesName, subtitleMatch.name),
    )?.seriesAuthorityId;
  return { name: subtitleMatch.name, position: subtitleMatch.position, seriesAuthorityId };
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
    searchGoogleBooks(`${seriesName} ${author}`),
    collectPagedGroups((startIndex) => searchGoogleBooksAuthorPage(author, startIndex)),
    searchGoogleBooks(seriesName),
    Promise.all(missingKnownGaps.map(async (position) => {
      const query = `${seriesName} book ${position} ${author}`;
      const result = await searchGoogleBooks(query);
      return result.groups;
    })),
  ]);

  const rawGroups = [
    ...seriesAndAuthor.groups,
    ...authorGroups,
    ...seriesOnly.groups,
    ...positionalDiscovery.flat(),
  ];

  // Canonical hardening preserves provider provenance on merged editions, so
  // Detective can measure corroboration after deduplication without relying on
  // brittle title+author formatting keys.
  const merged = hardenCatalogGroups(rawGroups, { preferredAuthor: author });
  const seen = new Map<string, SeriesDetectiveCandidate>();
  const candidates: SeriesDetectiveCandidate[] = [];

  const preferredLanguages = new Set(seriesBooks.map(activeEditionLanguage).filter((value): value is string => Boolean(value)));

  for (const work of merged) {
    for (const edition of work.editions) {
      const providerAgreement = new Set(
        work.editions.flatMap((candidate) => catalogEditionSources(candidate)),
      ).size;
      const metadata = candidateSeriesMetadata(work, edition, seriesName, providerAgreement);
      if (!metadata) continue;

      // A provider's structured exact series name is stronger evidence than an
      // author match because legitimate series can span multiple authors (for
      // example anthology/shared-world lines). Title-inferred series membership
      // remains author-gated so a generic parenthetical title cannot pull in an
      // unrelated same-named series.
      if (metadata.evidence === 'title' && !exactAuthorMatch(work, author)) continue;
      if (metadata.evidence !== 'structured' && metadata.evidence !== 'contextual' && !exactAuthorMatch(work, author)) continue;
      if (preferredLanguages.size > 0 && edition.language && !preferredLanguages.has(edition.language.toLocaleLowerCase())) continue;

      const candidate: SeriesDetectiveCandidate = {
        work,
        edition,
        seriesName: metadata.name,
        position: metadata.position,
        seriesAuthorityId: metadata.authorityId,
      };
      const key = metadata.position !== null ? `position:${metadata.position}` : `title:${normalize(work.title)}`;
      const current = seen.get(key);
      if (!current || catalogEditionQualityScore(candidate.edition) > catalogEditionQualityScore(current.edition)) {
        seen.set(key, candidate);
      }
    }
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

  const authorityIds = [...new Set(
    candidates
      .map((candidate) => candidate.seriesAuthorityId)
      .filter((value): value is string => Boolean(value)),
  )];

  return {
    seriesName,
    author,
    candidates,
    missing,
    seriesAuthorityId: authorityIds.length === 1 ? authorityIds[0] : undefined,
  };
}
