import assert from 'node:assert/strict';
import { CatalogRequestTimeout, requireCatalogResponse } from '../src/features/book-search/data/catalogRequestDeadline';

async function verify() {
  const valid = { groups: [{ key: 'stephen-king' }], totalItems: 1 };
  assert.deepEqual(await requireCatalogResponse('Google Books', Promise.resolve(valid), 50), valid,
    'A successful provider response must be returned intact.');

  const rejected = new Error('functions/permission-denied: App Check failed');
  await assert.rejects(
    requireCatalogResponse('Google Books', Promise.reject(rejected), 50),
    (error: unknown) => error === rejected,
    'A protected-call rejection must retain its original error.',
  );

  await assert.rejects(
    requireCatalogResponse('Google Books', new Promise<never>(() => {}), 5),
    (error: unknown) => error instanceof CatalogRequestTimeout && error.message.includes('Google Books'),
    'A timeout must reject, not fabricate a successful empty catalog.',
  );

  let resolveLate!: (value: number) => void;
  const late = new Promise<number>((resolve) => { resolveLate = resolve; });
  const pending = requireCatalogResponse('Author page', late, 5);
  await assert.rejects(pending, CatalogRequestTimeout,
    'A failed author page must not silently terminate pagination.');
  resolveLate(40);
  await Promise.resolve();

  console.log('Catalog deadline behavioral regressions passed.');
}

void verify().catch((error) => { console.error(error); process.exitCode = 1; });
