import { searchHardcover } from './hardcoverApi';
import { searchOpenLibrary } from './openLibraryApi';
import { BookSearchResponse, BookSearchWorkGroup } from '../model/bookSearch';

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; response: BookSearchResponse }>();

const normalizeText = (value?: string): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value: string): string => value.replace(/[^0-9X]/gi, '').toUpperCase();

export const buildGoogleBooksQuery = (value: string): string => {
  const trimmed = value.trim();
  const compact = compactIsbn(trimmed);
  if (/^(?:97[89])?\d{9}[\dX]$/i.test(compact)) return `isbn:${compact}`;
  return trimmed;
};

const groupIdentity = (group: BookSearchWorkGroup): string =>
  `${normalizeText(group.title)}::${normalizeText(group.authors[0])}`;

const sameEdition = (
  a: BookSearchWorkGroup['editions'][number],
  b: BookSearchWorkGroup['editions'][number],
): boolean => {
  if (a.source === b.source && a.externalEditionId === b.externalEditionId) return true;
  if (a.isbn13 && b.isbn13 && compactIsbn(a.isbn13) === compactIsbn(b.isbn13)) return true;
  if (a.isbn10 && b.isbn10 && compactIsbn(a.isbn10) === compactIsbn(b.isbn10)) return true;
  return false;
};

const mergeGroups = (
  primary: BookSearchWorkGroup[],
  supplement: BookSearchWorkGroup[],
): BookSearchWorkGroup[] => {
  const merged = new Map<string, BookSearchWorkGroup>();
  const order: string[] = [];

  const addGroup = (group: BookSearchWorkGroup) => {
    const identity = groupIdentity(group);
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, {
        ...group,
        key: `inkbound:${identity}`,
        genres: [...group.genres],
        editions: [...group.editions],
      });
      order.push(identity);
      return;
    }

    if (!existing.subtitle && group.subtitle) existing.subtitle = group.subtitle;
    if (!existing.publisherSummary && group.publisherSummary) existing.publisherSummary = group.publisherSummary;
    existing.genres = [...new Set([...existing.genres, ...group.genres])].slice(0, 16);
    group.editions.forEach((edition) => {
      if (!existing.editions.some((candidate) => sameEdition(candidate, edition))) {
        existing.editions.push(edition);
      }
    });
  };

  primary.forEach(addGroup);
  supplement.forEach(addGroup);

  return order
    .map((identity) => merged.get(identity))
    .filter((group): group is BookSearchWorkGroup => Boolean(group))
    .slice(0, 50);
};

export async function searchGoogleBooks(query: string, signal?: AbortSignal): Promise<BookSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { groups: [], totalItems: 0 };
  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  const cacheKey = normalizeText(trimmed);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  if (cached) searchCache.delete(cacheKey);

  const [catalog, openLibrary] = await Promise.all([
    searchHardcover(trimmed),
    searchOpenLibrary(buildGoogleBooksQuery(trimmed), signal).catch((error) => {
      console.warn('Open Library search failed.', error);
      return { groups: [], totalItems: 0 };
    }),
  ]);

  if (signal?.aborted) throw new DOMException('Search aborted', 'AbortError');

  const groups = mergeGroups(catalog.groups, openLibrary.groups);
  const response: BookSearchResponse = { groups, totalItems: groups.length };

  // Only cache successful searches. A temporary provider outage or rate limit must
  // never turn into five minutes of fake "no results" for the reader.
  if (groups.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response });
  }

  return response;
}
