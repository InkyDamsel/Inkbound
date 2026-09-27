import { execFileSync } from 'node:child_process';
import {
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromDescription,
  inferDetectiveSeriesFromTitle,
} from '../src/features/series/seriesDetectiveEvidence';
import {
  mergeDetectiveCandidates,
  type DetectiveMergeCandidate,
} from '../src/features/series/seriesDetectiveMerge';
import type {
  SeriesDetectiveEdition,
  SeriesDetectiveWorkGroup,
} from '../src/features/series/seriesDetectiveCatalogTypes';

const PROJECT_ID = 'inkbound-app';
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY_SEARCH_ENDPOINT = 'https://openlibrary.org/search.json';

type Provider = 'google-books' | 'open-library' | 'hardcover';

interface CaseFixture {
  series: string;
  author: string;
  anchorTitle: string;
}

interface HardcoverBook {
  id?: number | string;
  title?: string;
  subtitle?: string;
  description?: string;
  release_year?: number;
  image?: { url?: string };
  contributions?: Array<{ author?: { name?: string } }>;
}

interface HardcoverSeries {
  id?: number | string;
  name?: string;
  book_series?: Array<{
    position?: number;
    series?: { id?: number | string; name?: string };
    book?: HardcoverBook;
  }>;
}

interface GoogleVolume {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    pageCount?: number;
    categories?: string[];
    publisher?: string;
    language?: string;
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    seriesInfo?: {
      bookDisplayNumber?: string;
      volumeSeries?: Array<{
        orderNumber?: number;
        issue?: Array<{ issueOrderNumber?: number }>;
      }>;
    };
  };
}

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
  series?: string[];
  cover_i?: number;
}

const fixtures: CaseFixture[] = [
  { series: 'Hades x Persephone', author: 'Scarlett St. Clair', anchorTitle: 'A Touch of Darkness' },
  { series: 'A Twisted Tale', author: 'Jen Calonita', anchorTitle: "Conceal, Don't Feel" },
  { series: 'Vipers', author: 'Rina Kent', anchorTitle: 'Tempting Venom' },
];

const readSecret = (name: string): string => {
  try {
    const value = execFileSync(
      'npx',
      ['firebase-tools', 'functions:secrets:access', name, '--project', PROJECT_ID],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!value) throw new Error('empty secret');
    return value;
  } catch {
    throw new Error(
      `Could not read ${name}. Run "firebase login --reauth" and verify the secret exists. No data was changed.`,
    );
  }
};

const normalize = (value?: string): string =>
  value?.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const yearFrom = (value?: string): number => {
  const year = Number(value?.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
};

const googleIsbn = (volume: GoogleVolume, type: string): string | undefined =>
  volume.volumeInfo?.industryIdentifiers?.find((entry) => entry.type === type)?.identifier;

const googlePosition = (volume: GoogleVolume): number | null => {
  const info = volume.volumeInfo?.seriesInfo;
  const structured = info?.volumeSeries?.map((item) =>
    item.orderNumber ?? item.issue?.find((issue) => typeof issue.issueOrderNumber === 'number')?.issueOrderNumber,
  ).find((value) => typeof value === 'number' && Number.isFinite(value));
  if (typeof structured === 'number') return structured;
  const display = Number(info?.bookDisplayNumber?.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(display) ? display : null;
};

const makeCandidate = (
  provider: Provider,
  id: string,
  title: string,
  authors: string[],
  publicationYear: number,
  seriesName: string | undefined,
  position: number | null,
  extras: Partial<SeriesDetectiveEdition> = {},
  summary?: string,
): DetectiveMergeCandidate => {
  const ed: SeriesDetectiveEdition = {
    source: provider,
    externalEditionId: id,
    title,
    authors,
    genres: [],
    publicationYear,
    format: 'hardcover',
    specialFeatures: [],
    ...extras,
  };
  const work: SeriesDetectiveWorkGroup = {
    key: `${provider}:${id}`,
    title,
    authors,
    publisherSummary: summary,
    genres: [],
    editions: [ed],
  };
  return {
    provider,
    work,
    edition: ed,
    seriesName,
    position,
    seriesProvider: seriesName ? provider : undefined,
    seriesStructured: Boolean(seriesName),
  };
};

const googleCandidates = async (
  apiKey: string,
  fixture: CaseFixture,
): Promise<DetectiveMergeCandidate[]> => {
  const queries = [
    `"${fixture.series}"`,
    `"${fixture.series}" ${fixture.author}`,
    `${fixture.series} ${fixture.author}`,
    `${fixture.anchorTitle} ${fixture.author}`,
  ];

  const volumes = new Map<string, GoogleVolume>();
  for (const q of queries) {
    const url = new URL(GOOGLE_BOOKS_ENDPOINT);
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', '40');
    url.searchParams.set('key', apiKey);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Books returned ${response.status} for ${q}`);
    const payload = await response.json() as { items?: GoogleVolume[] };
    for (const item of payload.items ?? []) if (item.id) volumes.set(item.id, item);
  }

  return [...volumes.values()].flatMap((volume) => {
    const info = volume.volumeInfo;
    if (!volume.id || !info?.title) return [];
    const authors = info.authors?.filter(Boolean) ?? ['Unknown author'];
    const explicit =
      inferDetectiveSeriesFromDescription(info.description)
      ?? inferDetectiveSeriesFromTitle(info.title)
      ?? inferDetectiveSeriesFromTitle(info.subtitle);
    return [makeCandidate(
      'google-books',
      volume.id,
      info.title,
      authors,
      yearFrom(info.publishedDate),
      explicit?.name,
      googlePosition(volume) ?? explicit?.position ?? null,
      {
        subtitle: info.subtitle,
        publisherSummary: info.description,
        genres: info.categories ?? [],
        publisher: info.publisher,
        publicationDate: info.publishedDate,
        pageCount: info.pageCount,
        language: info.language,
        isbn10: googleIsbn(volume, 'ISBN_10'),
        isbn13: googleIsbn(volume, 'ISBN_13'),
        coverUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail,
      },
      info.description,
    )];
  });
};

const parseOpenLibrarySeries = (values?: string[]): { name?: string; position: number | null } => {
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (!value) continue;
    const match = value.match(/^(.*?)(?:,|#|\bbook\s+)(\d+(?:\.\d+)?)\s*$/i);
    if (match?.[1]) return { name: match[1].trim(), position: Number(match[2]) };
    return { name: value, position: null };
  }
  return { position: null };
};

const openLibraryCandidates = async (
  fixture: CaseFixture,
): Promise<DetectiveMergeCandidate[]> => {
  const url = new URL(OPEN_LIBRARY_SEARCH_ENDPOINT);
  url.searchParams.set('q', `${fixture.series} ${fixture.author}`);
  url.searchParams.set('limit', '100');
  url.searchParams.set(
    'fields',
    'key,title,author_name,first_publish_year,isbn,publisher,series,cover_i',
  );
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open Library returned ${response.status}`);
  const payload = await response.json() as { docs?: OpenLibraryDoc[] };

  return (payload.docs ?? []).flatMap((doc, index) => {
    if (!doc.title) return [];
    const authors = doc.author_name?.filter(Boolean) ?? ['Unknown author'];
    const series = parseOpenLibrarySeries(doc.series);
    const primaryIsbn = doc.isbn?.find((value) => /^\d{13}$/.test(value.replace(/[^0-9X]/gi, '')))
      ?? doc.isbn?.[0];
    const cleanedIsbn = primaryIsbn?.replace(/[^0-9X]/gi, '');
    return [makeCandidate(
      'open-library',
      doc.key ?? `ol-${index}`,
      doc.title,
      authors,
      doc.first_publish_year ?? new Date().getFullYear(),
      series.name,
      series.position,
      {
        isbn13: cleanedIsbn?.length === 13 ? cleanedIsbn : undefined,
        isbn10: cleanedIsbn?.length === 10 ? cleanedIsbn : undefined,
        publisher: doc.publisher?.[0],
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined,
      },
    )];
  });
};

const hardcoverGraphql = async <T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(HARDCOVER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const body = (await response.text()).trim();
    const safeBody = body.length > 2000 ? body.slice(0, 2000) + '…' : body;
    throw new Error(
      `Hardcover HTTP ${response.status}${safeBody ? ` — response: ${safeBody}` : ''}`,
    );
  }
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join('; '));
  if (!payload.data) throw new Error('Hardcover returned no data');
  return payload.data;
};

const hardcoverCandidates = async (
  token: string,
  fixture: CaseFixture,
): Promise<{ candidates: DetectiveMergeCandidate[]; seriesMatches: number }> => {
  const data = await hardcoverGraphql<{ series?: HardcoverSeries[] }>(
    token,
    `query DetectiveDiagnosticSeries($pattern: String!) {
      series(
        where: {
          name: { _ilike: $pattern }
          books_count: { _gt: 0 }
          canonical_id: { _is_null: true }
        }
      ) {
        id
        name
        book_series(
          distinct_on: position
          order_by: [{ position: asc }, { book: { users_count: desc } }]
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
    { pattern: `%${fixture.series}%` },
  );

  const anchor = normalize(fixture.anchorTitle);
  const compatible = (data.series ?? []).filter((series) =>
    detectiveSeriesNamesCompatible(series.name ?? '', fixture.series)
    && (series.book_series ?? []).some((membership) => normalize(membership.book?.title) === anchor),
  );

  const candidates = compatible.flatMap((series) =>
    (series.book_series ?? []).flatMap((membership) => {
      const book = membership.book;
      if (!book?.id || !book.title) return [];
      const authors = book.contributions
        ?.map((entry) => entry.author?.name?.trim())
        .filter((name): name is string => Boolean(name)) ?? ['Unknown author'];
      return [makeCandidate(
        'hardcover',
        String(book.id),
        book.title,
        authors,
        book.release_year ?? new Date().getFullYear(),
        membership.series?.name ?? series.name,
        typeof membership.position === 'number' ? membership.position : null,
        {
          subtitle: book.subtitle,
          publisherSummary: book.description,
          coverUrl: book.image?.url,
        },
        book.description,
      )];
    }),
  );

  return { candidates, seriesMatches: compatible.length };
};

const printProvider = (name: string, items: DetectiveMergeCandidate[]) => {
  console.log(`\n${name}: ${items.length} candidates`);
  for (const item of items
    .filter((entry) => entry.seriesName)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
    .slice(0, 30)) {
    console.log(
      `  ${item.position ?? '?'} | ${item.work.title} | ${item.work.authors.join(', ')} | ${item.seriesName}`,
    );
  }
};

const runFixture = async (
  fixture: CaseFixture,
  googleKey: string | null,
  hardcoverToken: string,
  includeGoogle: boolean,
) => {
  console.log('\n' + '='.repeat(88));
  console.log(`${fixture.series} — anchor: ${fixture.anchorTitle} — seed author: ${fixture.author}`);
  console.log('='.repeat(88));

  const googlePromise = includeGoogle && googleKey
    ? googleCandidates(googleKey, fixture)
    : Promise.resolve([] as DetectiveMergeCandidate[]);

  const [googleResult, openLibraryResult, hardcoverResult] = await Promise.allSettled([
    googlePromise,
    openLibraryCandidates(fixture),
    hardcoverCandidates(hardcoverToken, fixture),
  ]);

  const google = googleResult.status === 'fulfilled' ? googleResult.value : [];
  const openLibrary = openLibraryResult.status === 'fulfilled' ? openLibraryResult.value : [];
  const hardcover = hardcoverResult.status === 'fulfilled'
    ? hardcoverResult.value
    : { candidates: [], seriesMatches: 0 };

  if (!includeGoogle) {
    console.log('\nGoogle Books: skipped (use --google to include it)');
  } else if (googleResult.status === 'rejected') {
    console.warn(
      '\nGoogle Books: unavailable for this fixture —',
      googleResult.reason instanceof Error ? googleResult.reason.message : googleResult.reason,
    );
  } else {
    printProvider('Google Books', google);
  }

  if (openLibraryResult.status === 'rejected') {
    console.warn(
      '\nOpen Library: unavailable for this fixture —',
      openLibraryResult.reason instanceof Error ? openLibraryResult.reason.message : openLibraryResult.reason,
    );
  } else {
    printProvider('Open Library', openLibrary);
  }

  if (hardcoverResult.status === 'rejected') {
    console.warn(
      '\nHardcover: unavailable for this fixture —',
      hardcoverResult.reason instanceof Error ? hardcoverResult.reason.message : hardcoverResult.reason,
    );
  } else {
    printProvider(`Hardcover (anchored series matches: ${hardcover.seriesMatches})`, hardcover.candidates);
  }

  const merged = mergeDetectiveCandidates([
    ...google,
    ...openLibrary,
    ...hardcover.candidates,
  ]);

  console.log(`\nMERGED: ${merged.length} works`);
  const relevant = merged
    .filter((item) => item.seriesName && detectiveSeriesNamesCompatible(item.seriesName, fixture.series))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  for (const item of relevant) {
    console.log(
      `  ${item.position ?? '?'} | ${item.work.title} | ${item.work.authors.join(', ')} | ${item.seriesName} | providers=${(item.providerSources ?? [item.provider]).join('+')}`,
    );
  }

  console.log(`\nRelevant merged series works: ${relevant.length}`);
  if (hardcover.seriesMatches === 0) {
    console.warn('  WARNING: Hardcover did not return an anchored compatible series.');
  }
  if (relevant.length === 0) {
    console.warn('  WARNING: merged evidence produced no relevant series works.');
  }
};

const main = async () => {
  console.log('Inkbound Series Detective LIVE READ-ONLY diagnostics');
  console.log('No Firebase writes. No Firestore. No deploy. No production functions.');
  console.log('Secrets are read into memory and are never printed or written to disk.\n');

  const args = process.argv.slice(2);
  const includeGoogle = args.includes('--google');
  const requested = args.filter((arg) => !arg.startsWith('--')).join(' ').trim();

  const hardcoverToken = readSecret('HARDCOVER_API_TOKEN');
  const googleKey = includeGoogle ? readSecret('GOOGLE_BOOKS_API_KEY') : null;
  console.log(
    includeGoogle
      ? 'Secrets: Google Books FOUND; Hardcover FOUND'
      : 'Secrets: Hardcover FOUND; Google Books not requested',
  );

  const selected = requested
    ? fixtures.filter((fixture) =>
        normalize(fixture.series).includes(normalize(requested))
        || normalize(fixture.anchorTitle).includes(normalize(requested)))
    : fixtures;

  if (requested && selected.length === 0) {
    throw new Error(
      'Unknown fixture. Use no argument for all fixtures, or one of: Hades x Persephone, A Twisted Tale, Vipers.',
    );
  }

  for (const fixture of selected) {
    await runFixture(fixture, googleKey, hardcoverToken, includeGoogle);
  }

  console.log('\nRead-only diagnostics complete. Nothing was written or deployed.');
};

main().catch((error) => {
  console.error('\nDiagnostic failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
