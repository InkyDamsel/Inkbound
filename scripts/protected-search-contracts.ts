import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Search is a protected Inkbound workflow. These checks intentionally inspect
// the production wiring so scanner changes cannot silently weaken it.
const modal = readFileSync('src/components/AddBookModal.tsx', 'utf8');
const catalog = readFileSync('src/features/book-search/data/googleBooksApi.ts', 'utf8');
const serverCatalog = readFileSync('functions/src/bookSearch.ts', 'utf8');

const section = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Search contract section missing: ${start}`);
  return source.slice(from, to);
};

const search = section(modal, 'const handleSearch = async', 'const searchEditionKey =');
assert.match(search, /searchGoogleBooks\(trimmedQuery\)/, 'General search must retain the catalog search path.');
assert.match(search, /searchGoogleBooksAuthorPage\(trimmedQuery, 0\)/, 'Author queries must use the dedicated author lookup.');
assert.match(search, /filterExactAuthorResults\(authorGroups, trimmedQuery\)/, 'Author results must be filtered by credited author.');
assert.match(search, /Promise\.race\(/, 'Author search must not wait indefinitely for an optional author supplement.');
assert.match(search, /setTimeout\(\(\) => resolve\(\[\]\), 4000\)/, 'Author supplement must have a bounded wait.');
assert.ok(search.indexOf('searchGoogleBooksAuthorPage(trimmedQuery, 0)') < search.indexOf('await searchGoogleBooks(trimmedQuery)'), 'Author and general searches must start concurrently.');
assert.match(search, /exactAuthorResults\.length > 0/, 'Verified author results must take priority.');
assert.match(search, /filterExactAuthorResults\(response\.groups, trimmedQuery\)/, 'Generic keyword matches must not pollute author results.');

assert.match(catalog, /PRIMARY_SEARCH_DEADLINE_MS = 12000/, 'Primary Google request must have a deadline.');
assert.match(catalog, /OPTIONAL_CATALOG_DEADLINE_MS = 4000/, 'Optional catalog providers must have a deadline.');
assert.match(catalog, /boundedCatalogRequest\('Google Books'/, 'General search must bound its primary provider.');
assert.match(catalog, /boundedCatalogRequest\('Open Library'/, 'General search must bound Open Library.');
assert.match(catalog, /boundedCatalogRequest\('Hardcover'/, 'General search must bound Hardcover.');
assert.match(catalog, /boundedCatalogRequest\('Penguin Random House'/, 'General search must bound PRH.');
assert.match(catalog, /boundedCatalogRequest\(\s*'Trusted catalog'/, 'Trusted fallback must not block indefinitely.');
assert.match(catalog, /timeout: PRIMARY_SEARCH_DEADLINE_MS/, 'Protected Firebase callable must have a network timeout.');
assert.match(catalog, /const deadline = Date\.now\(\) \+ 2000/, 'Administrative navigation guard must be bounded.');
assert.match(catalog, /boundedCatalogRequest\(\s*'Google Books author page'/, 'Author Google lookup must be bounded.');
for (const provider of ['Open Library author', 'Hardcover author', 'PRH author', 'Trusted catalog author']) {
  assert.ok(catalog.includes("boundedCatalogRequest('" + provider + "'"), provider + ' must be bounded.');
}

const author = section(modal, 'const openAuthorPage = async', 'const loadMoreAuthorBooks = async');
assert.match(author, /filterExactAuthorResults\(response\.groups, authorName\)/, 'Author catalog must filter credited authors.');
assert.match(author, /setAuthorHasMore\(response\.hasMore\)/, 'Author catalog must preserve provider pagination.');

const provider = section(catalog, 'export async function searchGoogleBooksAuthorPage(', 'async function searchGoogleBaseline(');
assert.match(provider, /buildGoogleBooksAuthorQuery\(trimmedAuthor\)/, 'Author catalog must use an author-qualified query.');
assert.match(provider, /googleGroups\.filter\(creditedToAuthor\)/, 'Google author results must be credited to author.');
assert.ok(provider.includes('const supplementCredited = supplements.map((response) => response.groups.filter(creditedToAuthor));'), 'Every supplementary author provider must be filtered by credited author.');
assert.match(provider, /searchHardcoverAuthorWithBackoff\(trimmedAuthor\)/, 'Author catalogs must use the expanded Hardcover bibliography feed.');
assert.match(provider, /nextStartIndex = startIndex \+ rawItems\.length/, 'Author paging must advance by provider results, not filtered matches.');

assert.match(serverCatalog, /HARDCOVER_RATE_LIMIT_COOLDOWN_MS/, 'Hardcover must enforce a shared server cooldown after rate limits.');
assert.match(serverCatalog, /readHardcoverCache\(query, authorBibliography\)/, 'Hardcover must reuse cached catalog responses before upstream calls.');
assert.match(serverCatalog, /writeHardcoverCache\(query, authorBibliography/, 'Hardcover successful catalog responses must be cached.');
const hardcoverBibliography = section(serverCatalog, 'if (authorBibliography) {', '} else {');
assert.match(hardcoverBibliography, /query_type: "Author"/, 'Hardcover bibliography must resolve author candidates through supported search.');
assert.match(hardcoverBibliography, /search\(query: \$q, query_type: "Author".*\) \{ ids \}/s, 'Hardcover author search must consume typed ids instead of result JSON.');
assert.match(hardcoverBibliography, /authors\(where: \{ id: \{ _in: \$ids \} \}/, 'Hardcover bibliography must hydrate candidate author ids.');
assert.match(hardcoverBibliography, /books_count: desc/, 'Hardcover author resolution must prefer the populated author record.');
assert.doesNotMatch(hardcoverBibliography, /_ilike/, 'Hardcover public API does not permit wildcard string operators.');
assert.match(hardcoverBibliography, /contributions: \{ author: \{ id: \{ _eq: \$id \} \} \}/, 'Hardcover bibliography must follow the documented book-author relationship.');
assert.match(hardcoverBibliography, /canonical_id: \{ _is_null: true \}/, 'Hardcover bibliography must exclude duplicate canonical children.');
assert.match(hardcoverBibliography, /limit: 500/, 'Hardcover author bibliography must request a broad work set.');
const hardcoverDetails = section(serverCatalog, 'if (ids.length > 0) {', 'const booksById =');
assert.match(hardcoverDetails, /books\(where: \{ id: \{ _in: \$ids \} \}, limit: 500\)/, 'Hardcover detail expansion must cover prolific-author bibliographies.');
assert.match(hardcoverDetails, /editions\(where: \{ book_id: \{ _in: \$ids \} \}, limit: 1000\)/, 'Hardcover edition expansion must not starve later bibliography works.');

const scanner = section(modal, 'const lookupScannedIsbn = async', 'const recoverScannedBookByTitle = async');
assert.match(scanner, /resolveCatalogIsbn\(isbn\)/, 'Scanner must use ISBN resolution.');
assert.match(scanner, /hasVerifiedAuthor/, 'Scanner must verify author before accepting a scan.');
assert.match(scanner, /setUnresolvedIsbn\(isbn\)/, 'Incomplete scanner results must preserve the ISBN for recovery.');
assert.ok(scanner.indexOf('if (!work.title.trim() || !hasVerifiedAuthor)') < scanner.indexOf('writeScannerDraft(nextBatch)'),
  'Incomplete books must be rejected before scanner draft persistence.');

const enrichment = section(modal, 'const recoverMissingScanAuthor = async', 'const lookupScannedIsbn = async');
assert.match(enrichment, /searchGoogleBooks\(work\.title\)/, 'Missing scanner authors must use the existing title search.');
assert.match(enrichment, /normalizeCatalogText\(candidate\.title\) === title/, 'Author recovery must require exact normalized title.');
assert.match(enrichment, /distinctAuthors\.size !== 1/, 'Ambiguous author matches must not be auto-selected.');
assert.match(enrichment, /return \{ \.\.\.work, authors: candidates\[0\]\.authors \}/, 'Enrichment must only modify work authors, not edition metadata.');
assert.match(scanner, /recoverMissingScanAuthor\(resolved\.work\)/, 'Scanner must run automatic author recovery before validating metadata.');

console.log('Inkbound protected search contracts passed.');
