import type { UserBookRecord } from '../../types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../book-search/model/bookSearch';
import { searchGoogleBooks, searchGoogleBooksAuthorPage } from '../book-search/data/googleBooksApi';
import { catalogEditionQualityScore, hardenCatalogGroups } from '../book-search/catalogHardening';
import { inferSeriesHintFromTitle, resolveEffectiveSeriesMetadata } from './seriesLibrary';
import { hasKnownSeriesContextEvidence, scoreSeriesEvidence, selectVerifiedSeriesEvidence, type SeriesEvidence } from './seriesDetectiveEvidence';

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

const exactAuthorMatch = (group: BookSearchWorkGroup, author: string) => {
  const wanted = normalize(author);
  return !wanted || group.authors.some((candidate) => normalize(candidate) === wanted);
};

const sameSeries = (edition: BookSearchEdition, seriesName: string) =>
  Boolean(edition.seriesName && normalize(edition.seriesName) === normalize(seriesName));

const activeEditionLanguage = (book: UserBookRecord): string | undefined =>
  (book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0])?.language?.trim().toLocaleLowerCase();

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

  for (const title of [edition.title, work.title]) {
    const inferred = inferSeriesHintFromTitle(title);
    if (inferred && normalize(inferred.name) === normalize(wantedSeriesName)) {
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

export async function detectSeriesForBook(book: UserBookRecord): Promise<{ name: string; position: number | null } | null> {
  // Series Detective is an explicit verification/repair action. Never trust an
  // already-saved series value here: older builds may have persisted incorrect
  // inferred metadata. Re-evaluate the book against current catalog evidence.
  const wantedTitle = normalize(book.work.title);
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  const identifiers = [activeEdition?.isbn13, activeEdition?.isbn10].filter((value): value is string => Boolean(value?.trim()));

  const googleQuery = identifiers[0] || `${book.work.title} ${book.work.author}`;
  const [catalog, authorGroups, ...identifierSearches] = await Promise.all([
    searchGoogleBooks(googleQuery),
    collectPagedGroups((startIndex) => searchGoogleBooksAuthorPage(book.work.author, startIndex)),
    ...identifiers.map((isbn) => searchGoogleBooks(isbn)),
  ]);

  const groups = hardenCatalogGroups(
    [
      ...catalog.groups,
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
  return match ? { name: match.name, position: match.position } : null;
}

export async function findMissingSeriesBooks(
  seriesName: string,
  author: string,
  libraryBooks: UserBookRecord[],
): Promise<SeriesDetectiveResult> {
  const seriesBooks = libraryBooks.filter((book) => {
    const metadata = resolveEffectiveSeriesMetadata(book);
    return metadata && normalize(metadata.name) === normalize(seriesName);
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

  // Preserve provider agreement before hardening merges exact editions across
  // catalogs. Series confidence must not disappear merely because canonical
  // edition normalization correctly collapsed duplicate ISBN records.
  const providerSourcesByWork = new Map<string, Set<BookSearchEdition['source']>>();
  for (const group of rawGroups) {
    const identity = `${normalize(group.title)}::${normalize(group.authors[0])}`;
    const sources = providerSourcesByWork.get(identity) ?? new Set<BookSearchEdition['source']>();
    group.editions.forEach((candidate) => sources.add(candidate.source));
    providerSourcesByWork.set(identity, sources);
  }

  const merged = hardenCatalogGroups(rawGroups, { preferredAuthor: author });
  const seen = new Map<string, SeriesDetectiveCandidate>();
  const candidates: SeriesDetectiveCandidate[] = [];

  const preferredLanguages = new Set(seriesBooks.map(activeEditionLanguage).filter((value): value is string => Boolean(value)));

  for (const work of merged) {
    for (const edition of work.editions) {
      const providerAgreement = providerSourcesByWork.get(
        `${normalize(work.title)}::${normalize(work.authors[0])}`,
      )?.size ?? 1;
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

  return {
    seriesName,
    author,
    candidates,
    missing,
  };
}
