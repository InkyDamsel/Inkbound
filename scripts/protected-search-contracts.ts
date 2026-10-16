import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Search is a protected Inkbound workflow. These checks intentionally inspect
// the production wiring so scanner changes cannot silently weaken it.
const modal = readFileSync('src/components/AddBookModal.tsx', 'utf8');
const catalog = readFileSync('src/features/book-search/data/googleBooksApi.ts', 'utf8');

const section = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Search contract section missing: ${start}`);
  return source.slice(from, to);
};

const search = section(modal, 'const handleSearch = async', 'const searchEditionKey =');
assert.match(search, /searchGoogleBooks\(trimmedQuery\)/, 'General search must retain the catalog search path.');
assert.match(search, /searchGoogleBooksAuthorPage\(trimmedQuery, 0\)/, 'Author queries must use the dedicated author lookup.');
assert.match(search, /filterExactAuthorResults\(authorResponse\.groups, trimmedQuery\)/, 'Author results must be filtered by credited author.');
assert.match(search, /exactAuthorResults\.length > 0/, 'Verified author results must take priority.');
assert.match(search, /filterExactAuthorResults\(response\.groups, trimmedQuery\)/, 'Generic keyword matches must not pollute author results.');

const author = section(modal, 'const openAuthorPage = async', 'const loadMoreAuthorBooks = async');
assert.match(author, /filterExactAuthorResults\(response\.groups, authorName\)/, 'Author catalog must filter credited authors.');
assert.match(author, /setAuthorHasMore\(response\.hasMore\)/, 'Author catalog must preserve provider pagination.');

const provider = section(catalog, 'export async function searchGoogleBooksAuthorPage(', 'async function searchGoogleBaseline(');
assert.match(provider, /buildGoogleBooksAuthorQuery\(trimmedAuthor\)/, 'Author catalog must use an author-qualified query.');
assert.match(provider, /googleGroups\.filter\(creditedToAuthor\)/, 'Google author results must be credited to author.');
assert.match(provider, /prh\.groups\.filter\(creditedToAuthor\)/, 'Supplementary author results must be credited to author.');
assert.match(provider, /nextStartIndex = startIndex \+ rawItems\.length/, 'Author paging must advance by provider results, not filtered matches.');

const scanner = section(modal, 'const lookupScannedIsbn = async', 'const recoverScannedBookByTitle = async');
assert.match(scanner, /resolveCatalogIsbn\(isbn\)/, 'Scanner must use ISBN resolution.');
assert.match(scanner, /hasVerifiedAuthor/, 'Scanner must verify author before accepting a scan.');
assert.match(scanner, /setUnresolvedIsbn\(isbn\)/, 'Incomplete scanner results must preserve the ISBN for recovery.');
assert.ok(scanner.indexOf('if (!work.title.trim() || !hasVerifiedAuthor)') < scanner.indexOf('writeScannerDraft(nextBatch)'),
  'Incomplete books must be rejected before scanner draft persistence.');

console.log('Inkbound protected search contracts passed.');
