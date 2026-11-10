import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const GOOGLE_BOOKS_API_KEY = defineSecret('GOOGLE_BOOKS_API_KEY');
const PENGUIN_RANDOM_HOUSE_API_KEY = defineSecret('PENGUIN_RANDOM_HOUSE_API_KEY');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const PRH_ENDPOINT = 'https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US';
const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

interface GoogleBibliographicSeriesInfo {
  name: string;
  position?: number;
  explicit?: boolean;
}

const GOOGLE_DETECTIVE_DETAIL_LIMIT = 14;
const GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_MAX = 1000;
const googleBibliographicSeriesCache = new Map<
  string,
  { expiresAt: number; value: GoogleBibliographicSeriesInfo | null }
>();

const decodeGoogleBooksHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');

const stripGoogleBooksHtml = (value: string): string =>
  decodeGoogleBooksHtml(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

const readGoogleBibliographicSeriesCache = (
  volumeId: string,
): GoogleBibliographicSeriesInfo | null | undefined => {
  const cached = googleBibliographicSeriesCache.get(volumeId);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    googleBibliographicSeriesCache.delete(volumeId);
    return undefined;
  }
  return cached.value;
};

const writeGoogleBibliographicSeriesCache = (
  volumeId: string,
  value: GoogleBibliographicSeriesInfo | null,
) => {
  googleBibliographicSeriesCache.set(volumeId, {
    expiresAt: Date.now() + GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_TTL_MS,
    value,
  });
  while (googleBibliographicSeriesCache.size > GOOGLE_BIBLIOGRAPHIC_SERIES_CACHE_MAX) {
    const oldestKey = googleBibliographicSeriesCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    googleBibliographicSeriesCache.delete(oldestKey);
  }
};

const parseGoogleBooksBibliographicSeries = (
  html: string,
  authors: string[],
): GoogleBibliographicSeriesInfo | null => {
  const titleCell = html.match(/<td[^>]*>\s*Title\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if (!titleCell) return null;

  const lines = stripGoogleBooksHtml(titleCell)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const normalizedAuthors = authors
    .map((author) => author.trim().toLocaleLowerCase())
    .filter(Boolean);

  for (const rawLine of lines.slice(1)) {
    let line = rawLine.trim();
    const lower = line.toLocaleLowerCase();
    for (const author of normalizedAuthors) {
      const suffix = ', ' + author;
      if (lower.endsWith(suffix)) line = line.slice(0, -suffix.length).trim();
    }

    const numberedOfSeries = line.match(
      /^(?:Book|Volume|Vol\.?|Part)\s+(\d+(?:\.\d+)?)\s+of\s+(.+)$/i,
    );
    if (numberedOfSeries) {
      const position = Number(numberedOfSeries[1]);
      const name = numberedOfSeries[2].trim();
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}), explicit: true };
    }

    const seriesThenNumbered = line.match(
      /^(.+?)(?:,|\s+-)?\s*(?:Book|Volume|Vol\.?|Part)\s+(\d+(?:\.\d+)?)$/i,
    );
    if (seriesThenNumbered) {
      const name = seriesThenNumbered[1].trim();
      const position = Number(seriesThenNumbered[2]);
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}), explicit: true };
    }

    const seriesThenNumber = line.match(/^(.+?)\s+#\s*(\d+(?:\.\d+)?)$/i);
    if (seriesThenNumber) {
      const name = seriesThenNumber[1].trim();
      const position = Number(seriesThenNumber[2]);
      if (name) return { name, ...(Number.isFinite(position) ? { position } : {}), explicit: true };
    }

    // Preserve a plain bibliographic series label as weak evidence only.
    // The client admission gate must corroborate it against the requested
    // series and author before it can be surfaced.
    if (
      line.length >= 3
      && line.length <= 100
      && !/^(?:edition|volume|part|translated|illustrated|revised)\b/i.test(line)
    ) {
      return { name: line, explicit: false };
    }
  }

  return null;
};

async function fetchGoogleBooksBibliographicSeries(
  volumeId: string,
  authors: string[],
): Promise<GoogleBibliographicSeriesInfo | null> {
  const cached = readGoogleBibliographicSeriesCache(volumeId);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(
      'https://books.google.com/books?id=' + encodeURIComponent(volumeId),
    );
    if (!response.ok) {
      writeGoogleBibliographicSeriesCache(volumeId, null);
      return null;
    }
    const value = parseGoogleBooksBibliographicSeries(await response.text(), authors);
    writeGoogleBibliographicSeriesCache(volumeId, value);
    return value;
  } catch (error) {
    console.warn('Series Detective Google bibliographic lookup unavailable.', error);
    return null;
  }
}



interface SearchResult {
  id?: number | string;
  title?: string;
  subtitle?: string;
  author_names?: string[];
  authors?: Array<{ name?: string }> | string[];
  image?: { url?: string } | string;
  image_url?: string;
  pages?: number;
  release_year?: number;
  description?: string;
  slug?: string;
}

interface HardcoverSeriesMembership {
  position?: number;
  series?: { id?: number | string; name?: string };
  book?: HardcoverBook;
}

interface HardcoverBook {
  id?: number | string;
  title?: string;
  subtitle?: string;
  description?: string;
  release_year?: number;
  image?: { url?: string };
  contributions?: Array<{ author?: { name?: string } }>;
  book_series?: HardcoverSeriesMembership[];
}

interface HardcoverSeries {
  id?: number | string;
  name?: string;
  book_series?: HardcoverSeriesMembership[];
}

interface HardcoverEdition {
  id?: number | string;
  book_id?: number | string;
  title?: string;
  pages?: number;
  isbn_10?: string;
  isbn_13?: string;
  release_date?: string;
  edition_format?: string;
  image?: { url?: string };
  publisher?: { name?: string };
  book?: HardcoverBook;
}

interface NormalizedHardcoverEdition {
  source: 'hardcover' | 'penguin-random-house';
  externalEditionId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  publisher?: string;
  publicationDate?: string;
  publicationYear: number;
  language?: string;
  format: 'hardcover' | 'paperback' | 'ebook' | 'audiobook';
  isbn10?: string;
  isbn13?: string;
  asin?: string;
  pageCount?: number;
  coverUrl?: string;
  editionName?: string;
  binding?: string;
  specialFeatures: string[];
  seriesName?: string;
  seriesOrder?: number;
}

interface NormalizedHardcoverGroup {
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisherSummary?: string;
  genres: string[];
  editions: NormalizedHardcoverEdition[];
}

const normalizeFormat = (value?: string): 'hardcover' | 'paperback' | 'ebook' | 'audiobook' => {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('audio')) return 'audiobook';
  if (normalized.includes('ebook') || normalized.includes('digital') || normalized.includes('kindle')) return 'ebook';
  if (normalized.includes('paper')) return 'paperback';
  return 'hardcover';
};

const imageUrl = (value?: SearchResult['image']): string | undefined =>
  typeof value === 'string' ? value : value?.url;

const authorNames = (result: SearchResult): string[] => {
  if (result.author_names?.length) return result.author_names.filter(Boolean);
  if (Array.isArray(result.authors)) {
    return result.authors
      .map((author) => typeof author === 'string' ? author : author?.name ?? '')
      .filter(Boolean);
  }
  return ['Unknown author'];
};

const normalizeHardcoverText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const normalizeHardcoverSeries = (value?: string): string => {
  const tokens = normalizeHardcoverText(value).split(' ').filter(Boolean);
  while (tokens.length > 1 && ['a', 'an', 'the'].includes(tokens[0])) tokens.shift();
  while (
    tokens.length > 1
    && ['series', 'saga', 'novel', 'novels', 'book', 'books', 'collection', 'collections'].includes(tokens[tokens.length - 1])
  ) tokens.pop();
  return tokens.filter((token) => token !== 'x' && token !== 'and').join(' ');
};

// Hardcover stores "Hades x Persephone", "Hades & Persephone" and "The
// Selection Series" as different strings. A raw %name% ILIKE only finds the
// exact spelling, so match on the significant tokens in order instead. The
// strict normalized-equality check below still decides which series is used.
const hardcoverSeriesPattern = (value: string): string => {
  const tokens = normalizeHardcoverSeries(value).split(' ').filter(Boolean);
  return tokens.length ? `%${tokens.join('%')}%` : `%${value.trim()}%`;
};

// Anchor titles come from the reader's own library, where a title may carry a
// subtitle or edition suffix that Hardcover omits (or vice versa).
const hardcoverTitleMatchesAnchor = (anchors: string[], title?: string): boolean => {
  const normalized = normalizeHardcoverText(title);
  if (!normalized) return false;
  return anchors.some((anchor) =>
    anchor === normalized
    || normalized.startsWith(`${anchor} `)
    || anchor.startsWith(`${normalized} `),
  );
};

const hardcoverBookAuthors = (book?: HardcoverBook, fallback: string[] = []): string[] => {
  const authors = book?.contributions
    ?.map((contribution) => contribution.author?.name?.trim())
    .filter((name): name is string => Boolean(name)) ?? [];
  return authors.length ? authors : fallback.length ? fallback : ['Unknown author'];
};

const hardcoverTitlesMatch = (left?: string, right?: string): boolean => {
  const a = normalizeHardcoverText(left);
  const b = normalizeHardcoverText(right);
  return Boolean(a && b && a === b);
};

const parseSearchResults = (value: unknown): SearchResult[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (record.document && typeof record.document === 'object') return [record.document as SearchResult];
      return [item as SearchResult];
    });
  }
  if (typeof value === 'string') {
    try {
      return parseSearchResults(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
};

async function hardcoverGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(HARDCOVER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Hardcover returned ${response.status}.`);
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'Hardcover Detective search failed.');
  if (!payload.data) throw new Error('Hardcover returned an empty Detective response.');
  return payload.data;
}

async function detectiveHardcoverCatalog(
  query: string,
  expandSeries = false,
  options: {
    exactTitle?: string;
    seriesName?: string;
    anchorTitles?: string[];
    anchorAuthor?: string;
  } = {},
) {
  const token = HARDCOVER_API_TOKEN.value();
  if (!token) throw new HttpsError('failed-precondition', 'Series Detective Hardcover search is not configured.');

  const searchData = await hardcoverGraphql<{ search?: { results?: unknown } }>(
    token,
    `query SeriesDetectiveSearch($q: String!) {
      search(query: $q, query_type: "Book", per_page: 40, page: 1) { results }
    }`,
    { q: query },
  );

  const searchResults = parseSearchResults(searchData.search?.results).filter((result) => result.title);
  const ids = searchResults.map((result) => Number(result.id)).filter((id) => Number.isFinite(id));

  let editions: HardcoverEdition[] = [];
  let books: HardcoverBook[] = [];

  // Search is useful for discovery, but seed reconciliation should not depend
  // on ranking. When Inkbound already knows the title, ask Hardcover's catalog
  // directly for that title and read its structured book_series relationship.
  if (options.exactTitle?.trim()) {
    try {
      const exactTitle = options.exactTitle.trim();
      const direct = await hardcoverGraphql<{ books?: HardcoverBook[] }>(
        token,
        `query SeriesDetectiveExactBook($titlePattern: String!) {
          books(
            where: {
              title: { _ilike: $titlePattern }
              canonical_id: { _is_null: true }
            }
            limit: 40
          ) {
            id title subtitle description release_year image { url }
            contributions { author { name } }
            book_series { position series { id name } }
          }
        }`,
        { titlePattern: exactTitle },
      );
      const exactBooks = (direct.books ?? []).filter((book) => hardcoverTitlesMatch(book.title, exactTitle));
      for (const book of exactBooks) {
        const id = String(book.id ?? '');
        if (!id) continue;
        const index = books.findIndex((candidate) => String(candidate.id ?? '') === id);
        if (index >= 0) books[index] = { ...books[index], ...book };
        else books.push(book);
      }
      exactBooks
        .map((book) => Number(book.id))
        .filter((id) => Number.isFinite(id))
        .forEach((id) => {
          if (!ids.includes(id)) ids.push(id);
        });
    } catch (error) {
      console.warn('Series Detective Hardcover exact-title lookup unavailable.', error);
    }
  }
  if (ids.length > 0) {
    const detailData = await hardcoverGraphql<{ editions?: HardcoverEdition[]; books?: HardcoverBook[] }>(
      token,
      `query SeriesDetectiveDetails($ids: [Int!]!) {
        books(where: { id: { _in: $ids } }, limit: 160) {
          id title subtitle description release_year image { url }
          contributions { author { name } }
          book_series { position series { id name } }
        }
        editions(where: { book_id: { _in: $ids } }, limit: 240) {
          id book_id title pages isbn_10 isbn_13 release_date edition_format
          image { url }
          publisher { name }
          book {
            id title subtitle description release_year image { url }
            contributions { author { name } }
            book_series { position series { id name } }
          }
        }
      }`,
      { ids },
    );
    editions = detailData.editions ?? [];
    const detailedBooks = detailData.books ?? [];
    detailedBooks.forEach((book) => {
      const key = String(book.id ?? '');
      if (!key) return;
      const index = books.findIndex((candidate) => String(candidate.id ?? '') === key);
      if (index >= 0) books[index] = { ...books[index], ...book };
      else books.push(book);
    });
  }

  if (expandSeries && options.seriesName?.trim()) {
    try {
      const requestedSeries = options.seriesName.trim();
      const anchors = (options.anchorTitles ?? [])
        .map(normalizeHardcoverText)
        .filter(Boolean);

      const seriesData = await hardcoverGraphql<{ series?: HardcoverSeries[] }>(
        token,
        `query SeriesDetectiveDirectSeries($seriesPattern: String!) {
          series(
            where: {
              name: { _ilike: $seriesPattern }
              books_count: { _gt: 0 }
              canonical_id: { _is_null: true }
            }
            order_by: { books_count: desc }
            limit: 40
          ) {
            id
            name
            book_series(
              limit: 250
              order_by: [{ position: asc_nulls_last }, { book: { users_count: desc } }]
              where: {
                book: {
                  canonical_id: { _is_null: true }
                  is_partial_book: { _eq: false }
                }
                compilation: { _eq: false }
              }
            ) {
              position
              series { id name }
              book {
                id title subtitle description release_year image { url }
                contributions { author { name } }
              }
            }
          }
        }`,
        { seriesPattern: hardcoverSeriesPattern(requestedSeries) },
      );

      const requestedSeriesIdentity = normalizeHardcoverSeries(requestedSeries);
      const sameNameSeries = (seriesData.series ?? []).filter((series) =>
        Boolean(requestedSeriesIdentity)
        && normalizeHardcoverSeries(series.name) === requestedSeriesIdentity,
      );
      // Establish the owned title/author anchor before considering any other
      // record. Same-name catalog series are not inherently the same series.
      const anchoredSeries = sameNameSeries.filter((series) =>
        anchors.length > 0 && (series.book_series ?? []).some((membership) =>
          hardcoverTitleMatchesAnchor(anchors, membership.book?.title)
          && (!options.anchorAuthor?.trim() || hardcoverBookAuthors(membership.book)
            .some((name) => normalizeHardcoverText(name) === normalizeHardcoverText(options.anchorAuthor))),
        ),
      );
      const familyBooks = sameNameSeries.flatMap((series) =>
        (series.book_series ?? []).map((membership) => membership.book).filter(
          (book): book is HardcoverBook => Boolean(book?.id),
        ),
      );
      const familyBookIds = new Set(familyBooks.map((book) => String(book.id)));
      const familyAuthors = new Set(familyBooks.flatMap((book) =>
        hardcoverBookAuthors(book).map(normalizeHardcoverText).filter(Boolean),
      ));
      // Shared-world series can be split into one Hardcover series record per
      // contributing author. Only expand beyond the anchored record when the
      // same-name family demonstrates multiple works and multiple authors.
      const sharedWorldFamily = anchoredSeries.length > 0
        && familyBookIds.size >= 3
        && familyAuthors.size >= 2;
      const matchingSeries = sharedWorldFamily ? sameNameSeries : anchoredSeries;

      const memberships = matchingSeries.flatMap((series) => series.book_series ?? []);
      const directSeriesBooks: HardcoverBook[] = memberships.flatMap((membership) => {
        const book = membership.book;
        if (!book?.id) return [];
        const parentSeries = matchingSeries.find((candidate) =>
          candidate.book_series?.includes(membership));
        const directBook: HardcoverBook = {
          ...book,
          book_series: [{
            position: membership.position,
            series: membership.series ?? {
              id: parentSeries?.id,
              name: parentSeries?.name,
            },
          }],
        };
        return [directBook];
      });

      directSeriesBooks.forEach((book) => {
        const key = String(book.id ?? '');
        const index = books.findIndex((candidate) => String(candidate.id ?? '') === key);
        if (index >= 0) {
          const existingMemberships = books[index].book_series ?? [];
          books[index] = {
            ...books[index],
            ...book,
            book_series: [...existingMemberships, ...(book.book_series ?? [])],
          };
        } else {
          books.push(book);
        }
      });

      const directIds = [...new Set(directSeriesBooks
        .map((book) => Number(book.id))
        .filter((id) => Number.isFinite(id)))];

      if (directIds.length > 0) {
        const directEditionData = await hardcoverGraphql<{ editions?: HardcoverEdition[] }>(
          token,
          `query SeriesDetectiveDirectSeriesEditions($ids: [Int!]!) {
            editions(where: { book_id: { _in: $ids } }, limit: 600) {
              id book_id title pages isbn_10 isbn_13 release_date edition_format
              image { url }
              publisher { name }
              book { id title subtitle description release_year image { url } contributions { author { name } } }
            }
          }`,
          { ids: directIds },
        );
        const knownEditionIds = new Set(editions.map((edition) => String(edition.id ?? '')).filter(Boolean));
        for (const edition of directEditionData.editions ?? []) {
          const id = String(edition.id ?? '');
          if (id && knownEditionIds.has(id)) continue;
          editions.push(edition);
          if (id) knownEditionIds.add(id);
        }
      }
    } catch (error) {
      console.warn('Series Detective Hardcover direct series lookup unavailable.', error);
    }
  }

  if (expandSeries && books.length > 0 && !options.seriesName?.trim()) {
    const seriesIds = [...new Set(books.flatMap((book) =>
      (book.book_series ?? [])
        .map((membership) => membership.series?.id)
        .filter((id): id is string | number => id !== undefined && id !== null),
    ))];

    if (seriesIds.length > 0) {
      try {
        const membershipData = await hardcoverGraphql<{
          book_series?: HardcoverSeriesMembership[];
        }>(
          token,
          `query SeriesDetectiveExpandSeries($seriesIds: [Int!]!) {
            book_series(
              where: { series_id: { _in: $seriesIds } }
              order_by: { position: asc }
              limit: 400
            ) {
              position
              series { id name }
              book { id title subtitle description release_year image { url } }
            }
          }`,
          { seriesIds: seriesIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)) },
        );

        const memberships = membershipData.book_series ?? [];
        const expandedBooks = memberships
          .map((membership) => membership.book)
          .filter((book): book is HardcoverBook => Boolean(book?.id));

        const expandedIds = [...new Set(expandedBooks
          .map((book) => Number(book.id))
          .filter((id) => Number.isFinite(id)))];

        if (expandedIds.length > 0) {
          const expandedEditionData = await hardcoverGraphql<{ editions?: HardcoverEdition[] }>(
            token,
            `query SeriesDetectiveExpandedEditions($ids: [Int!]!) {
              editions(where: { book_id: { _in: $ids } }, limit: 600) {
                id book_id title pages isbn_10 isbn_13 release_date edition_format
                image { url }
                publisher { name }
                book { id title subtitle description release_year image { url } }
              }
            }`,
            { ids: expandedIds },
          );

          const membershipByBookId = new Map<string, HardcoverSeriesMembership[]>();
          memberships.forEach((membership) => {
            const key = String(membership.book?.id ?? '');
            if (!key) return;
            membershipByBookId.set(key, [...(membershipByBookId.get(key) ?? []), membership]);
          });

          expandedBooks.forEach((book) => {
            const key = String(book.id ?? '');
            const membershipsForBook = membershipByBookId.get(key) ?? [];
            const existing = books.find((candidate) => String(candidate.id ?? '') === key);
            const mergedMemberships = [
              ...(existing?.book_series ?? []),
              ...membershipsForBook.map((membership) => ({
                position: membership.position,
                series: membership.series,
              })),
            ];
            const nextBook = { ...existing, ...book, book_series: mergedMemberships };
            const index = books.findIndex((candidate) => String(candidate.id ?? '') === key);
            if (index >= 0) books[index] = nextBook;
            else books.push(nextBook);
          });

          const knownEditionIds = new Set(editions.map((edition) => String(edition.id ?? '')).filter(Boolean));
          for (const edition of expandedEditionData.editions ?? []) {
            const id = String(edition.id ?? '');
            if (id && knownEditionIds.has(id)) continue;
            editions.push(edition);
            if (id) knownEditionIds.add(id);
          }
        }
      } catch (error) {
        console.warn('Series Detective Hardcover series expansion unavailable.', error);
      }
    }
  }

  const booksById = new Map<string, HardcoverBook>();
  books.forEach((book) => {
    const key = String(book.id ?? '');
    if (key) booksById.set(key, book);
  });

  const editionsByBook = new Map<string, HardcoverEdition[]>();
  editions.forEach((edition) => {
    const key = String(edition.book_id ?? edition.book?.id ?? '');
    if (!key) return;
    editionsByBook.set(key, [...(editionsByBook.get(key) ?? []), edition]);
  });

  const groups: NormalizedHardcoverGroup[] = searchResults.map((result) => {
    const id = String(result.id ?? result.slug ?? result.title);
    const matchedEditions = editionsByBook.get(String(result.id ?? '')) ?? [];
    const matchedBook = booksById.get(String(result.id ?? ''));
    const authors = hardcoverBookAuthors(matchedBook, authorNames(result));
    const publisherSummary = matchedBook?.description
      ?? result.description
      ?? matchedEditions.map((edition) => edition.book?.description)
        .find((description): description is string => Boolean(description?.trim()));

    const requestedMembership = (memberships?: HardcoverSeriesMembership[]) =>
      memberships?.find((membership) => options.seriesName && normalizeHardcoverSeries(membership.series?.name) === normalizeHardcoverSeries(options.seriesName))
      ?? memberships?.find((membership) => membership.series?.name?.trim());
    const bookMembership = requestedMembership(matchedBook?.book_series);
    const normalizedEditions: NormalizedHardcoverEdition[] = matchedEditions.length > 0
      ? matchedEditions.map((edition) => {
          const membership = requestedMembership(edition.book?.book_series) ?? bookMembership;
          return {
            source: 'hardcover' as const,
            externalEditionId: String(edition.id ?? `${id}-${edition.isbn_13 ?? edition.isbn_10 ?? edition.title ?? 'edition'}`),
            title: edition.title ?? edition.book?.title ?? matchedBook?.title ?? result.title ?? 'Untitled',
            subtitle: edition.book?.subtitle ?? matchedBook?.subtitle ?? result.subtitle,
            authors,
            publisherSummary: matchedBook?.description ?? edition.book?.description ?? publisherSummary,
            genres: [] as string[],
            publisher: edition.publisher?.name,
            publicationDate: edition.release_date,
            publicationYear: Number(edition.release_date?.slice(0, 4)) || edition.book?.release_year || matchedBook?.release_year || result.release_year || new Date().getFullYear(),
            format: normalizeFormat(edition.edition_format),
            isbn10: edition.isbn_10,
            isbn13: edition.isbn_13,
            pageCount: edition.pages ?? result.pages,
            coverUrl: edition.image?.url ?? edition.book?.image?.url ?? matchedBook?.image?.url ?? result.image_url ?? imageUrl(result.image),
            editionName: edition.title,
            binding: edition.edition_format,
            specialFeatures: [] as string[],
            seriesName: membership?.series?.name?.trim(),
            seriesOrder: typeof membership?.position === 'number' ? membership.position : undefined,
          };
        })
      : [{
          source: 'hardcover' as const,
          externalEditionId: id,
          title: matchedBook?.title ?? result.title ?? 'Untitled',
          subtitle: matchedBook?.subtitle ?? result.subtitle,
          authors,
          publisherSummary,
          genres: [] as string[],
          publicationYear: matchedBook?.release_year || result.release_year || new Date().getFullYear(),
          format: 'hardcover' as const,
          pageCount: result.pages,
          coverUrl: matchedBook?.image?.url ?? result.image_url ?? imageUrl(result.image),
          specialFeatures: [] as string[],
          seriesName: bookMembership?.series?.name?.trim(),
          seriesOrder: typeof bookMembership?.position === 'number' ? bookMembership.position : undefined,
        }];

    return {
      key: `hardcover:${id}`,
      title: matchedBook?.title ?? result.title ?? 'Untitled',
      subtitle: matchedBook?.subtitle ?? result.subtitle,
      authors,
      publisherSummary,
      genres: [] as string[],
      editions: normalizedEditions,
    };
  });

  const searchResultBookIds = new Set(searchResults.map((result) => String(result.id ?? '')).filter(Boolean));
  books.forEach((book) => {
    const id = String(book.id ?? '');
    if (!id || searchResultBookIds.has(id)) return;

    const memberships = book.book_series ?? [];
    const membership = memberships.find((item) => item.series?.name?.trim());
    if (!membership?.series?.name?.trim()) return;

    const matchedEditions = editionsByBook.get(id) ?? [];
    const authors = hardcoverBookAuthors(book);
    const normalizedEditions: NormalizedHardcoverEdition[] = matchedEditions.length > 0
      ? matchedEditions.map((edition) => ({
          source: 'hardcover' as const,
          externalEditionId: String(edition.id ?? `${id}-${edition.isbn_13 ?? edition.isbn_10 ?? edition.title ?? 'edition'}`),
          title: edition.title ?? book.title ?? 'Untitled',
          subtitle: edition.book?.subtitle ?? book.subtitle,
          authors,
          publisherSummary: edition.book?.description ?? book.description,
          genres: [] as string[],
          publisher: edition.publisher?.name,
          publicationDate: edition.release_date,
          publicationYear: Number(edition.release_date?.slice(0, 4)) || edition.book?.release_year || book.release_year || new Date().getFullYear(),
          format: normalizeFormat(edition.edition_format),
          isbn10: edition.isbn_10,
          isbn13: edition.isbn_13,
          pageCount: edition.pages,
          coverUrl: edition.image?.url ?? edition.book?.image?.url ?? book.image?.url,
          editionName: edition.title,
          binding: edition.edition_format,
          specialFeatures: [] as string[],
          seriesName: membership.series?.name?.trim(),
          seriesOrder: typeof membership.position === 'number' ? membership.position : undefined,
        }))
      : [{
          source: 'hardcover' as const,
          externalEditionId: id,
          title: book.title ?? 'Untitled',
          subtitle: book.subtitle,
          authors,
          publisherSummary: book.description,
          genres: [] as string[],
          publicationYear: book.release_year || new Date().getFullYear(),
          format: 'hardcover' as const,
          coverUrl: book.image?.url,
          specialFeatures: [] as string[],
          seriesName: membership.series?.name?.trim(),
          seriesOrder: typeof membership.position === 'number' ? membership.position : undefined,
        }];

    groups.push({
      key: `hardcover:${id}`,
      title: book.title ?? 'Untitled',
      subtitle: book.subtitle,
      authors,
      publisherSummary: book.description,
      genres: [] as string[],
      editions: normalizedEditions,
    });
  });

  return { groups, totalItems: groups.length };
}

export const searchSeriesDetectiveHardcover = onCall(
  { secrets: [HARDCOVER_API_TOKEN], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Series Detective.');
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    const expandSeries = request.data?.expandSeries === true;
    const exactTitle = typeof request.data?.exactTitle === 'string' ? request.data.exactTitle.trim() : '';
    const seriesName = typeof request.data?.seriesName === 'string' ? request.data.seriesName.trim() : '';
    const anchorAuthor = typeof request.data?.anchorAuthor === 'string' ? request.data.anchorAuthor.trim().slice(0, 160) : '';
    const anchorTitles = Array.isArray(request.data?.anchorTitles)
      ? request.data.anchorTitles
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => value.trim())
        .filter(Boolean)
        .slice(0, 12)
      : [];
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid Series Detective query is required.');

    try {
      return await detectiveHardcoverCatalog(query, expandSeries, {
        exactTitle: exactTitle || undefined,
        seriesName: seriesName || undefined,
        anchorTitles,
        anchorAuthor: anchorAuthor || undefined,
      });
    } catch (error) {
      console.warn('Series Detective Hardcover catalog unavailable.', error);
      return { groups: [], totalItems: 0 };
    }
  },
);


interface DetectiveGoogleVolume {
  id?: string;
  inkboundBibliographicSeries?: GoogleBibliographicSeriesInfo;
  volumeInfo?: {
    authors?: string[];
    seriesInfo?: {
      volumeSeries?: Array<{ seriesId?: string }>;
    };
  };
}

async function detectiveGoogleCatalog(
  query: string,
  startIndex: number,
  maxResults: number,
) {
  const apiKey = GOOGLE_BOOKS_API_KEY.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Series Detective Google Books is not configured.');

  const params = new URLSearchParams({
    q: query,
    printType: 'books',
    projection: 'full',
    orderBy: 'relevance',
    startIndex: String(Math.max(0, startIndex)),
    maxResults: String(Math.max(1, Math.min(40, maxResults))),
  });
  if (apiKey) params.set('key', apiKey);

  const runRequest = async (): Promise<Response> => {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`);
      if (response.status !== 429 && response.status !== 503) break;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    return response!;
  };

  let response = await runRequest();
  if (!response.ok && apiKey && [400, 401, 403].includes(response.status)) {
    params.delete('key');
    response = await runRequest();
  }
  if (!response.ok) throw new Error(`Google Books returned ${response.status} to Series Detective.`);
  const payload = await response.json() as { totalItems?: number; items?: DetectiveGoogleVolume[] };
  const rawItems = payload.items ?? [];
  const items = await Promise.all(rawItems.map(async (volume, index) => {
    const id = volume.id?.trim();
    if (!id || index >= GOOGLE_DETECTIVE_DETAIL_LIMIT) return volume;

    const authors = Array.isArray(volume.volumeInfo?.authors)
      ? volume.volumeInfo.authors.filter((author): author is string => typeof author === 'string')
      : [];
    const bibliographicSeries = await fetchGoogleBooksBibliographicSeries(id, authors);
    return bibliographicSeries
      ? { ...volume, inkboundBibliographicSeries: bibliographicSeries }
      : volume;
  }));

  const seriesIds = [...new Set(items.flatMap((volume) =>
    volume.volumeInfo?.seriesInfo?.volumeSeries
      ?.map((membership) => membership.seriesId?.trim())
      .filter((value): value is string => Boolean(value)) ?? [],
  ))];
  const seriesMetadataById: Record<string, string> = {};

  if (seriesIds.length > 0) {
    try {
      const seriesParams = new URLSearchParams({ key: apiKey });
      seriesIds.forEach((id) => seriesParams.append('series_id', id));
      const seriesResponse = await fetch(
        `https://www.googleapis.com/books/v1/series/get?${seriesParams.toString()}`,
      );
      if (seriesResponse.ok) {
        const seriesPayload = await seriesResponse.json() as {
          series?: Array<{ seriesId?: string; title?: string }>;
        };
        (seriesPayload.series ?? []).forEach((series) => {
          const id = series.seriesId?.trim();
          const title = series.title?.trim();
          if (id && title) seriesMetadataById[id] = title;
        });
      }
    } catch (error) {
      console.warn('Series Detective Google series-title expansion unavailable.', error);
    }
  }

  return {
    totalItems: typeof payload.totalItems === 'number' ? payload.totalItems : items.length,
    items,
    seriesMetadataById,
  };
}


interface PrhSearchRecord {
  workId?: number | string;
  isbn?: number | string;
  title?: string;
  subtitle?: string;
  author?: string;
  coverUrl?: string;
  seriesCode?: string;
  seriesName?: string;
  seriesNumber?: number | string;
}

interface PrhTitleRecord extends PrhSearchRecord {
  isbnHyphenated?: string;
  onsale?: string;
  format?: { code?: string; description?: string };
  pages?: number;
  pageCount?: number;
  publisher?: string;
  imprint?: string | { name?: string };
  language?: string;
}

interface PrhSeriesRecord {
  seriesCode?: string;
  seriesName?: string;
}

const prhNormalize = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const prhRecordArrays = (value: unknown): Record<string, unknown>[] => {
  if (!value || typeof value !== 'object') return [];
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object') found.push(item as Record<string, unknown>);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) visit(child);
    }
  };
  visit(value);
  return found;
};

const prhFetchJson = async (path: string, params: Record<string, string | number | boolean | undefined> = {}) => {
  const apiKey = PENGUIN_RANDOM_HOUSE_API_KEY.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Series Detective Penguin Random House is not configured.');
  const url = new URL(`${PRH_ENDPOINT}${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Penguin Random House returned ${response.status}.`);
  return response.json() as Promise<unknown>;
};

const prhFormat = (value?: string): 'hardcover' | 'paperback' | 'ebook' | 'audiobook' => {
  const normalized = value?.toLocaleLowerCase() ?? '';
  if (normalized.includes('audio')) return 'audiobook';
  if (normalized.includes('ebook') || normalized.includes('digital')) return 'ebook';
  if (normalized.includes('paper')) return 'paperback';
  return 'hardcover';
};

const prhAuthorList = (record: PrhSearchRecord): string[] =>
  record.author?.split(/\s*(?:;|\band\b)\s*/i).map((value) => value.trim()).filter(Boolean)
  ?? ['Unknown author'];

const prhExtractSearchRecords = (payload: unknown): PrhSearchRecord[] =>
  prhRecordArrays(payload).flatMap((record) => {
    const title = typeof record.title === 'string' ? record.title : undefined;
    const workId = typeof record.workId === 'string' || typeof record.workId === 'number' ? record.workId : undefined;
    const seriesCode = typeof record.seriesCode === 'string' ? record.seriesCode : undefined;
    const seriesName = typeof record.seriesName === 'string' ? record.seriesName : undefined;
    if (!title && !workId && !seriesCode && !seriesName) return [];
    return [{
      workId,
      isbn: typeof record.isbn === 'string' || typeof record.isbn === 'number' ? record.isbn : undefined,
      title,
      subtitle: typeof record.subtitle === 'string' ? record.subtitle : undefined,
      author: typeof record.author === 'string' ? record.author : undefined,
      coverUrl: typeof record.coverUrl === 'string' ? record.coverUrl : undefined,
      seriesCode,
      seriesName,
      seriesNumber: typeof record.seriesNumber === 'string' || typeof record.seriesNumber === 'number'
        ? record.seriesNumber
        : undefined,
    }];
  });

const prhExtractTitles = (payload: unknown): PrhTitleRecord[] =>
  prhRecordArrays(payload).flatMap((record) => {
    const isbn = typeof record.isbn === 'string' || typeof record.isbn === 'number' ? record.isbn : undefined;
    const title = typeof record.title === 'string' ? record.title : undefined;
    if (!isbn || !title) return [];
    const formatObject = record.format && typeof record.format === 'object'
      ? record.format as Record<string, unknown>
      : undefined;
    const imprintObject = record.imprint && typeof record.imprint === 'object'
      ? record.imprint as Record<string, unknown>
      : undefined;
    return [{
      workId: typeof record.workId === 'string' || typeof record.workId === 'number' ? record.workId : undefined,
      isbn,
      title,
      subtitle: typeof record.subtitle === 'string' ? record.subtitle : undefined,
      author: typeof record.author === 'string' ? record.author : undefined,
      coverUrl: typeof record.coverUrl === 'string' ? record.coverUrl : undefined,
      onsale: typeof record.onsale === 'string' ? record.onsale : undefined,
      format: formatObject ? {
        code: typeof formatObject.code === 'string' ? formatObject.code : undefined,
        description: typeof formatObject.description === 'string' ? formatObject.description : undefined,
      } : undefined,
      pages: typeof record.pages === 'number' ? record.pages : undefined,
      pageCount: typeof record.pageCount === 'number' ? record.pageCount : undefined,
      publisher: typeof record.publisher === 'string' ? record.publisher : undefined,
      imprint: typeof record.imprint === 'string'
        ? record.imprint
        : imprintObject && typeof imprintObject.name === 'string' ? { name: imprintObject.name } : undefined,
      language: typeof record.language === 'string' ? record.language : undefined,
      seriesCode: typeof record.seriesCode === 'string' ? record.seriesCode : undefined,
      seriesName: typeof record.seriesName === 'string' ? record.seriesName : undefined,
      seriesNumber: typeof record.seriesNumber === 'string' || typeof record.seriesNumber === 'number'
        ? record.seriesNumber
        : undefined,
    }];
  });

const prhExtractSeries = (payload: unknown): PrhSeriesRecord[] =>
  prhRecordArrays(payload).flatMap((record) => {
    const seriesCode = typeof record.seriesCode === 'string' ? record.seriesCode : undefined;
    const seriesName = typeof record.seriesName === 'string' ? record.seriesName : undefined;
    return seriesCode || seriesName ? [{ seriesCode, seriesName }] : [];
  });

const prhSeriesPosition = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

async function detectivePrhCatalog(
  query: string,
  expandSeries = false,
  options: {
    exactTitle?: string;
    seriesName?: string;
    anchorTitles?: string[];
  } = {},
) {
  const compactIsbn = query.replace(/[^0-9X]/gi, '').toUpperCase();
  if (/^(?:978|979)\d{10}$/.test(compactIsbn)) {
    try {
      const titlePayload = await prhFetchJson(`/titles/${encodeURIComponent(compactIsbn)}`);
      const exactTitles = [
        ...prhExtractTitles(titlePayload),
        ...prhExtractTitles([titlePayload]),
      ].filter((title, index, all) =>
        String(title.isbn ?? '').replace(/[^0-9X]/gi, '').toUpperCase() === compactIsbn
        && all.findIndex((candidate) =>
          String(candidate.isbn ?? '').replace(/[^0-9X]/gi, '').toUpperCase() === compactIsbn
          && candidate.title === title.title
        ) === index);
      if (exactTitles.length > 0) {
        const title = exactTitles[0];
        const isbn = String(title.isbn ?? '').replace(/[^0-9X]/gi, '');
        const publicationYear = Number(title.onsale?.slice(0, 4));
        const imprint = typeof title.imprint === 'string' ? title.imprint : title.imprint?.name;
        const authors = prhAuthorList(title);
        return {
          groups: [{
            key: `penguin-random-house:${isbn}`,
            title: title.title ?? 'Untitled',
            subtitle: title.subtitle,
            authors,
            genres: [] as string[],
            editions: [{
              source: 'penguin-random-house' as const,
              externalEditionId: isbn,
              title: title.title ?? 'Untitled',
              subtitle: title.subtitle,
              authors,
              genres: [] as string[],
              publisher: title.publisher ?? imprint,
              publicationDate: title.onsale,
              publicationYear: Number.isFinite(publicationYear) && publicationYear > 0
                ? publicationYear
                : new Date().getFullYear(),
              language: title.language,
              format: prhFormat(title.format?.description ?? title.format?.code),
              isbn13: isbn.length === 13 ? isbn : undefined,
              isbn10: isbn.length === 10 ? isbn : undefined,
              pageCount: title.pageCount ?? title.pages,
              coverUrl: title.coverUrl ?? (isbn ? `https://images.randomhouse.com/cover/${isbn}` : undefined),
              editionName: title.format?.description,
              binding: title.format?.description,
              specialFeatures: [] as string[],
              seriesName: title.seriesName?.trim(),
              seriesOrder: prhSeriesPosition(title.seriesNumber),
            }],
          }],
          totalItems: 1,
        };
      }
    } catch (error) {
      console.warn('Penguin Random House exact-ISBN lookup unavailable; falling back to work search.', error);
    }
  }

  const searchPayload = await prhFetchJson('/search/views/search-display', {
    q: query,
    docType: 'work',
    rows: 40,
  });
  const searchRecords = prhExtractSearchRecords(searchPayload);
  const workRecords = new Map<string, PrhSearchRecord>();
  for (const record of searchRecords) {
    const key = String(record.workId ?? record.isbn ?? record.title ?? '');
    if (key) workRecords.set(key, record);
  }

  if (expandSeries && options.seriesName?.trim()) {
    try {
      const seriesPayload = await prhFetchJson('/search/views/search-display', {
        q: options.seriesName.trim(),
        docType: 'series',
        rows: 20,
      });
      const wanted = prhNormalize(options.seriesName);
      const seriesMatches = prhExtractSeries(seriesPayload)
        .filter((series) => series.seriesCode && prhNormalize(series.seriesName) === wanted)
        .slice(0, 3);

      for (const series of seriesMatches) {
        const worksPayload = await prhFetchJson(
          `/series/${encodeURIComponent(series.seriesCode!)}/works`,
          { sort: 'seriesNumber', rows: 100 },
        );
        for (const record of prhExtractSearchRecords(worksPayload)) {
          if (!record.seriesName) record.seriesName = series.seriesName;
          if (!record.seriesCode) record.seriesCode = series.seriesCode;
          const key = String(record.workId ?? record.isbn ?? record.title ?? '');
          if (key) workRecords.set(key, record);
        }
      }
    } catch (error) {
      console.warn('Series Detective PRH series expansion unavailable.', error);
    }
  }

  const records = [...workRecords.values()].slice(0, 80);
  const groups = await Promise.all(records.map(async (record, index) => {
    const workId = String(record.workId ?? '');
    let titles: PrhTitleRecord[] = [];
    let linkedSeries: PrhSeriesRecord[] = [];
    if (workId) {
      const [titlesResult, seriesResult] = await Promise.allSettled([
        prhFetchJson(`/works/${encodeURIComponent(workId)}/titles`, { rows: 30 }),
        prhFetchJson(`/works/${encodeURIComponent(workId)}/series`, { rows: 20 }),
      ]);
      if (titlesResult.status === 'fulfilled') titles = prhExtractTitles(titlesResult.value);
      if (seriesResult.status === 'fulfilled') linkedSeries = prhExtractSeries(seriesResult.value);
    }

    const authors = prhAuthorList(record);
    const primarySeries = linkedSeries.find((series) => series.seriesName?.trim())
      ?? (record.seriesName ? { seriesName: record.seriesName, seriesCode: record.seriesCode } : undefined);
    const normalizedEditions: NormalizedHardcoverEdition[] = (titles.length ? titles : [{
      isbn: record.isbn,
      title: record.title ?? 'Untitled',
      subtitle: record.subtitle,
      author: record.author,
      coverUrl: record.coverUrl,
      seriesCode: record.seriesCode,
      seriesName: record.seriesName,
      seriesNumber: record.seriesNumber,
    }]).map((title, titleIndex) => {
      const isbn = String(title.isbn ?? '').replace(/[^0-9X]/gi, '');
      const position = prhSeriesPosition(title.seriesNumber ?? record.seriesNumber);
      const seriesName = title.seriesName?.trim() ?? primarySeries?.seriesName?.trim();
      const publicationYear = Number(title.onsale?.slice(0, 4));
      const imprint = typeof title.imprint === 'string' ? title.imprint : title.imprint?.name;
      return {
        source: 'penguin-random-house' as const,
        externalEditionId: String(title.isbn ?? `prh-${workId || index}-${titleIndex}`),
        title: title.title ?? record.title ?? 'Untitled',
        subtitle: title.subtitle ?? record.subtitle,
        authors: title.author ? prhAuthorList(title) : authors,
        genres: [] as string[],
        publisher: title.publisher ?? imprint,
        publicationDate: title.onsale,
        publicationYear: Number.isFinite(publicationYear) && publicationYear > 0
          ? publicationYear
          : new Date().getFullYear(),
        language: title.language,
        format: prhFormat(title.format?.description ?? title.format?.code),
        isbn10: isbn.length === 10 ? isbn : undefined,
        isbn13: isbn.length === 13 ? isbn : undefined,
        pageCount: title.pageCount ?? title.pages,
        coverUrl: title.coverUrl ?? record.coverUrl ?? (isbn ? `https://images.randomhouse.com/cover/${isbn}` : undefined),
        editionName: title.format?.description,
        binding: title.format?.description,
        specialFeatures: [] as string[],
        seriesName,
        seriesOrder: position,
      };
    });

    return {
      key: `penguin-random-house:${workId || record.isbn || index}`,
      title: record.title ?? normalizedEditions[0]?.title ?? 'Untitled',
      subtitle: record.subtitle ?? normalizedEditions[0]?.subtitle,
      authors: normalizedEditions[0]?.authors ?? authors,
      genres: [] as string[],
      editions: normalizedEditions,
    };
  }));

  return { groups, totalItems: groups.length };
}


const prhExtractAuthorCandidates = (payload: unknown): Array<{ authorId: string; name: string }> =>
  prhRecordArrays(payload).flatMap((record) => {
    const rawId = record.authorId ?? record.authorID ?? record.author_id ?? record.id ?? record.ID;
    const rawName = record.author ?? record.authorName ?? record.authorDisplay ?? record.displayName
      ?? record.name ?? record.Name ?? record.fullName ?? record.full_name;
    if ((typeof rawId !== 'string' && typeof rawId !== 'number') || typeof rawName !== 'string') return [];
    return [{ authorId: String(rawId), name: rawName.trim() }];
  });

async function detectivePrhAuthorCatalog(authorName: string) {
  const searchPayload = await prhFetchJson('/search', {
    q: authorName,
    docType: 'author',
    rows: 100,
    exactMatchWeighting: 20,
  });
  const wanted = prhNormalize(authorName);
  const author = prhExtractAuthorCandidates(searchPayload)
    .find((candidate) => prhNormalize(candidate.name) === wanted);
  if (!author) return { groups: [], totalItems: 0 };

  const titlesPayload = await prhFetchJson(
    `/authors/${encodeURIComponent(author.authorId)}/titles`,
    { rows: 0, returnEmptyLists: true },
  );
  const titles = prhExtractTitles(titlesPayload);
  const byWork = new Map<string, PrhTitleRecord[]>();
  titles.forEach((title, index) => {
    const key = String(title.workId ?? title.title ?? title.isbn ?? index);
    byWork.set(key, [...(byWork.get(key) ?? []), title]);
  });

  const groups = [...byWork.entries()].flatMap(([workKey, workTitles]) => {
    const first = workTitles[0];
    if (!first?.title) return [];
    const editions = workTitles.map((title, index) => {
      const isbn = String(title.isbn ?? '').replace(/[^0-9X]/gi, '');
      const publicationYear = Number(title.onsale?.slice(0, 4));
      const imprint = typeof title.imprint === 'string' ? title.imprint : title.imprint?.name;
      return {
        source: 'penguin-random-house' as const,
        externalEditionId: String(title.isbn ?? `${workKey}-${index}`),
        title: title.title ?? first.title!,
        subtitle: title.subtitle,
        authors: [author.name],
        genres: [] as string[],
        publisher: title.publisher ?? imprint,
        publicationDate: title.onsale,
        publicationYear: Number.isFinite(publicationYear) && publicationYear > 0 ? publicationYear : new Date().getFullYear(),
        language: title.language,
        format: prhFormat(title.format?.description ?? title.format?.code),
        isbn10: isbn.length === 10 ? isbn : undefined,
        isbn13: isbn.length === 13 ? isbn : undefined,
        pageCount: title.pageCount ?? title.pages,
        coverUrl: title.coverUrl ?? (isbn ? `https://images.randomhouse.com/cover/${isbn}` : undefined),
        editionName: title.format?.description,
        binding: title.format?.description,
        specialFeatures: [] as string[],
        seriesName: title.seriesName?.trim(),
        seriesOrder: prhSeriesPosition(title.seriesNumber),
      };
    });
    return [{
      key: `penguin-random-house:author:${workKey}`,
      title: first.title,
      subtitle: first.subtitle,
      authors: [author.name],
      genres: [] as string[],
      editions,
    }];
  });

  return { groups, totalItems: groups.length };
}

export const searchSeriesDetectivePenguinRandomHouse = onCall(
  { secrets: [PENGUIN_RANDOM_HOUSE_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Series Detective.');
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    const expandSeries = request.data?.expandSeries === true;
    const authorBibliography = request.data?.authorBibliography === true;
    const exactTitle = typeof request.data?.exactTitle === 'string' ? request.data.exactTitle.trim() : '';
    const seriesName = typeof request.data?.seriesName === 'string' ? request.data.seriesName.trim() : '';
    const anchorTitles = Array.isArray(request.data?.anchorTitles)
      ? request.data.anchorTitles
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => value.trim())
        .filter(Boolean)
        .slice(0, 12)
      : [];
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid Series Detective query is required.');

    try {
      if (authorBibliography) return await detectivePrhAuthorCatalog(query);
      return await detectivePrhCatalog(query, expandSeries, {
        exactTitle: exactTitle || undefined,
        seriesName: seriesName || undefined,
        anchorTitles,
      });
    } catch (error) {
      console.warn('Series Detective Penguin Random House catalog unavailable.', error);
      return { groups: [], totalItems: 0 };
    }
  },
);


export const searchSeriesDetectiveGoogleBooks = onCall(
  { secrets: [GOOGLE_BOOKS_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Series Detective.');
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    const startIndex = Number(request.data?.startIndex ?? 0);
    const maxResults = Number(request.data?.maxResults ?? 40);
    if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid Series Detective query is required.');

    try {
      return await detectiveGoogleCatalog(query, startIndex, maxResults);
    } catch (error) {
      console.warn('Series Detective Google Books catalog unavailable.', error);
      return { totalItems: 0, items: [], seriesMetadataById: {} };
    }
  },
);
