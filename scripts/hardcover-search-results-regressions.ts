import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('functions/src/bookSearch.ts', 'utf8');
const start = source.indexOf('const parseSearchResults');
const end = source.indexOf('async function hardcoverGraphql', start);
assert.ok(start >= 0, 'Hardcover result parser must exist.');
assert.ok(end > start, 'Hardcover GraphQL helper must follow the result parser.');
const parser = source.slice(start, end);

assert.match(parser, /hits\?: unknown/, 'Hardcover parser must recognize the Typesense hits object.');
assert.match(parser, /Array\.isArray\(hits\)/, 'Hardcover parser must unwrap hit arrays.');
assert.match(parser, /record\.document/, 'Hardcover parser must unwrap each hit document.');
assert.match(parser, /JSON\.parse\(value\)/, 'Hardcover parser must continue supporting JSON-string payloads.');

console.log('Inkbound Hardcover search result regressions passed.');
