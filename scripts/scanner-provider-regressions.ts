import assert from 'node:assert/strict';
import { searchOpenLibrary } from '../src/features/book-search/data/openLibraryApi';
import { classifyNativeAppCheckFailure } from '../src/platform/runtimeNativeAppCheck';

// Capture actual Open Library query parameters without a network request.
const originalFetch = globalThis.fetch;
const requested: URL[] = [];
try {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(new URL(String(input)));
    return { ok: true, json: async () => ({ docs: [], numFound: 0 }) } as Response;
  }) as typeof fetch;
  const paramsFor = async (query: string) => {
    requested.length = 0;
    await searchOpenLibrary(query);
    assert.ok(requested[0], 'Open Library should make one request');
    return requested[0].searchParams;
  };
  let params = await paramsFor('intitle:"reign" inauthor:bethan');
  assert.equal(params.get('title'), 'reign');
  assert.equal(params.get('author'), 'bethan');
  assert.equal(params.get('q'), null);
  params = await paramsFor('intitle:reign inauthor:crome');
  assert.equal(params.get('title'), 'reign');
  assert.equal(params.get('author'), 'crome');
  params = await paramsFor('inauthor:Bethan Croome');
  assert.equal(params.get('author'), 'Bethan Croome');
  assert.equal(params.get('title'), null);
  params = await paramsFor('intitle:"Fourth Wing"');
  assert.equal(params.get('title'), 'Fourth Wing');
  params = await paramsFor('reign bethan crome');
  assert.equal(params.get('q'), 'reign bethan crome');
  assert.equal(params.get('title'), null);
} finally {
  globalThis.fetch = originalFetch;
}
// Report only safe failure categories, not raw tokens, URLs or credentials.
assert.equal(classifyNativeAppCheckFailure(new Error('App Check adapter not initialized')), 'not initialized');
assert.equal(classifyNativeAppCheckFailure({ code: 'permission-denied' }), 'attestation / permission denied');
assert.equal(classifyNativeAppCheckFailure({ code: 'resource-exhausted' }), 'rate limit / quota');
assert.equal(classifyNativeAppCheckFailure({ code: 'unavailable' }), 'network / service unavailable');
assert.equal(classifyNativeAppCheckFailure(new Error('token=secret-private-value')), 'unknown native failure');
console.log('Inkbound scanner provider regressions passed.');
