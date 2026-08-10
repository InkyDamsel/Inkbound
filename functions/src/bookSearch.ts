import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const HARDCOVER_API_TOKEN = defineSecret('HARDCOVER_API_TOKEN');
const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';

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
  book?: {
    id?: number | string;
    title?: string;
    subtitle?: string;
    description?: string;
    release_year?: number;
    image?: { url?: string };
  };
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

async function hardcoverGraphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
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
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'Hardcover search failed.');
  if (!payload.data) throw new Error('Hardcover returned an empty response.');
  return payload.data;
}

export const searchHardcoverBooks = onCall({ secrets: [HARDCOVER_API_TOKEN] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use Hardcover enrichment.');
  const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
  if (!query || query.length > 300) throw new HttpsError('invalid-argument', 'A valid book search is required.');

  const token = HARDCOVER_API_TOKEN.value();
  if (!token) throw new HttpsError('failed-precondition', 'Hardcover search is not configured.');

  try {
    const searchData = await hardcoverGraphql<{ search?: { results?: unknown } }>(
      token,
      `query SearchBooks($q: String!) {
        search(query: $q, query_type: "Book", per_page: 15, page: 1) { results }
      }`,
      { q: query },
    );
    const searchResults = parseSearchResults(searchData.search?.results).filter((result) => result.title);
    const ids = searchResults.map((result) => Number(result.id)).filter((id) => Number.isFinite(id));

    let editions: HardcoverEdition[] = [];
    if (ids.length > 0) {
      try {
        const editionData = await hardcoverGraphql<{ editions?: HardcoverEdition[] }>(
          token,
          `query SearchEditions($ids: [Int!]!) {
            editions(where: { book_id: { _in: $ids } }, limit: 80) {
              id book_id title pages isbn_10 isbn_13 release_date edition_format
              image { url }
              publisher { name }
              book { id title subtitle description release_year image { url } }
            }
          }`,
          { ids },
        );
        editions = editionData.editions ?? [];
      } catch {
        // Search results are still useful if edition expansion is unavailable.
      }
    }

    const editionsByBook = new Map<string, HardcoverEdition[]>();
    editions.forEach((edition) => {
      const key = String(edition.book_id ?? edition.book?.id ?? '');
      if (!key) return;
      editionsByBook.set(key, [...(editionsByBook.get(key) ?? []), edition]);
    });

    const groups = searchResults.map((result) => {
      const id = String(result.id ?? result.slug ?? result.title);
      const authors = authorNames(result);
      const matchedEditions = editionsByBook.get(String(result.id ?? '')) ?? [];
      const publisherSummary = result.description
        ?? matchedEditions.map((edition) => edition.book?.description).find((description): description is string => Boolean(description?.trim()));
      const normalizedEditions = matchedEditions.length > 0
        ? matchedEditions.map((edition) => ({
            source: 'hardcover' as const,
            externalEditionId: String(edition.id ?? `${id}-${edition.isbn_13 ?? edition.isbn_10 ?? edition.title ?? 'edition'}`),
            title: edition.title ?? edition.book?.title ?? result.title ?? 'Untitled',
            subtitle: edition.book?.subtitle ?? result.subtitle,
            authors,
            publisherSummary: edition.book?.description ?? publisherSummary,
            genres: [],
            publisher: edition.publisher?.name,
            publicationDate: edition.release_date,
            publicationYear: Number(edition.release_date?.slice(0, 4)) || edition.book?.release_year || result.release_year || new Date().getFullYear(),
            format: normalizeFormat(edition.edition_format),
            isbn10: edition.isbn_10,
            isbn13: edition.isbn_13,
            pageCount: edition.pages ?? result.pages,
            coverUrl: edition.image?.url ?? edition.book?.image?.url ?? result.image_url ?? imageUrl(result.image),
            editionName: edition.title,
            binding: edition.edition_format,
            specialFeatures: [],
          }))
        : [{
            source: 'hardcover' as const,
            externalEditionId: id,
            title: result.title ?? 'Untitled',
            subtitle: result.subtitle,
            authors,
            publisherSummary,
            genres: [],
            publicationYear: result.release_year || new Date().getFullYear(),
            format: 'hardcover' as const,
            pageCount: result.pages,
            coverUrl: result.image_url ?? imageUrl(result.image),
            specialFeatures: [],
          }];

      return {
        key: `hardcover:${id}`,
        title: result.title ?? 'Untitled',
        subtitle: result.subtitle,
        authors,
        publisherSummary,
        genres: [],
        editions: normalizedEditions,
      };
    });

    return { groups, totalItems: groups.length };
  } catch (error) {
    console.error('Hardcover search failed', error);
    throw new HttpsError('unavailable', error instanceof Error ? error.message : 'Hardcover search failed.');
  }
});
