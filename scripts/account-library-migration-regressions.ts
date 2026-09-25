import assert from 'node:assert/strict';
import {
  canReportCloudLibraryHealthy,
  missingLocalRecordIds,
  needsAccountLibraryMigration,
} from '../src/features/sync/accountLibraryMigration';

assert.equal(
  needsAccountLibraryMigration({
    localBookCount: 243,
    cloudBookCount: 0,
    migrationVerified: false,
  }),
  true,
  'A non-empty local library with an empty cloud copy must require migration.',
);

assert.equal(
  canReportCloudLibraryHealthy({
    localBookCount: 243,
    cloudBookCount: 0,
    migrationVerified: false,
  }),
  false,
  '"0 books checked" must never be considered healthy when 243 local books exist.',
);

assert.equal(
  canReportCloudLibraryHealthy({
    localBookCount: 243,
    cloudBookCount: 243,
    migrationVerified: false,
  }),
  false,
  'Matching counts are not enough until migration read-back verification is complete.',
);

assert.equal(
  canReportCloudLibraryHealthy({
    localBookCount: 243,
    cloudBookCount: 243,
    migrationVerified: true,
  }),
  true,
  'A verified round-trip migration may report healthy.',
);

assert.equal(
  canReportCloudLibraryHealthy({
    localBookCount: 243,
    cloudBookCount: 242,
    migrationVerified: true,
  }),
  false,
  'A partial cloud library must not report healthy even after an earlier migration completed.',
);

assert.equal(
  canReportCloudLibraryHealthy({
    localBookCount: 0,
    cloudBookCount: 0,
    migrationVerified: false,
  }),
  true,
  'A genuinely empty local and cloud library is a valid empty state.',
);

assert.deepEqual(
  missingLocalRecordIds(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    new Set(['a', 'c']),
  ),
  ['b'],
  'Migration planning must identify local records absent from cloud.',
);

console.log('Inkbound account-library migration regressions passed.');
