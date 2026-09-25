import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];

const releaseScripts = [
  'scripts/verify-source-of-truth.mjs',
  'scripts/verify-cross-platform-parity.mjs',
  'scripts/verify-production-env.mjs',
  'scripts/verify-release-artifacts.mjs',
  'scripts/verify-function-security.mjs',
  'scripts/sync-android-branding.mjs',
  'scripts/verify-android-config.mjs',
  'scripts/verify-android-gradle.mjs',
  'scripts/verify-android-branding.mjs',
  'scripts/verify-android-native-ready.mjs',
];

for (const relative of releaseScripts) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push(`${relative}: release verifier file is missing`);
    continue;
  }
  const checked = spawnSync(process.execPath, ['--check', relative], {
    cwd: root,
    encoding: 'utf8',
  });
  if (checked.status !== 0) {
    failures.push(`${relative}: JavaScript syntax check failed\n${checked.stderr || checked.stdout}`);
  }
}

const packageJson = JSON.parse(read('package.json'));
const releaseVerify = String(packageJson.scripts?.['release:verify'] ?? '');
for (const required of [
  'verify:verifier',
  'test:critical',
  'verify:source-of-truth',
  'verify:parity',
  'build',
  'verify:release-artifacts',
  'verify:function-security',
  'verify:android-config',
  'verify:android-gradle',
  'verify:android-branding',
  'verify:android-native',
  'functions:build',
]) {
  if (!releaseVerify.includes(required)) failures.push(`package.json: release:verify is missing ${required}`);
}

const critical = String(packageJson.scripts?.['test:critical'] ?? '');
for (const required of [
  'critical-reading-regressions.ts',
  'reporting-math-regressions.ts',
  'catalog-hardening-regressions.ts',
  'google-series-regressions.ts',
  'runtime-boundary-regressions.ts',
  'series-detective-regressions.ts',
  'smart-collection-regressions.ts',
]) {
  if (!critical.includes(required)) failures.push(`package.json: test:critical is missing ${required}`);
}

const pureRegressionFiles = [
  'scripts/critical-reading-regressions.ts',
  'scripts/reporting-math-regressions.ts',
  'scripts/catalog-hardening-regressions.ts',
  'scripts/google-series-regressions.ts',
  'scripts/series-detective-regressions.ts',
  'scripts/smart-collection-regressions.ts',
];
for (const relative of pureRegressionFiles) {
  const source = read(relative);
  if (/from\s+['"][^'"]*(?:lib\/firebase|firebase\/)/.test(source)) {
    failures.push(`${relative}: pure regression entrypoint must not import Firebase runtime modules`);
  }
}
const runtimeBoundaryRegression = read('scripts/runtime-boundary-regressions.ts');
if (!/from\s+['"][^'"]*lib\/firebase['"]/.test(runtimeBoundaryRegression)) {
  failures.push('runtime-boundary-regressions.ts: runtime boundary regression must exercise Firebase module initialization');
}

// Series Detective's runtime module imports live catalog providers, which initialize
// Firebase. Node regression tests must exercise pure evidence helpers instead.
const seriesRegression = read('scripts/series-detective-regressions.ts');
if (/from\s+['"][^'"]*features\/series\/seriesDetective['"]/.test(seriesRegression)) {
  failures.push('series-detective-regressions.ts: must not import the runtime Series Detective module; use pure evidence helpers and source-text guards');
}

const sourceTruth = read('scripts/verify-source-of-truth.mjs');
for (const required of [
  'canonicalAuthorIdentity',
  'canonicalLanguageCode',
  'mergeCatalogEditionData',
  'searchOpenLibrarySeriesContext',
  'metadata identity',
  'Detective-only series-context catalog search must never leak into general Add Reading Material search',
  'hydration must merge richer edition metadata without replacing known canonical fields',
]) {
  if (!sourceTruth.includes(required)) {
    failures.push(`verify-source-of-truth.mjs: canonical metadata audit guard is missing (${required})`);
  }
}
for (const stale of [
  'stale library-loan dates must be cleared',
  "merged.push(serverBook)",
]) {
  if (sourceTruth.includes(stale)) failures.push(`verify-source-of-truth.mjs: obsolete assertion remains (${stale})`);
}

for (const identifier of ['packageJson', 'sessionEditor', 'crossDeviceSync', 'oneShotHydration']) {
  const count = (sourceTruth.match(new RegExp(`^const\\s+${identifier}\\s*=`, 'gm')) ?? []).length;
  if (count > 1) failures.push(`verify-source-of-truth.mjs: duplicate top-level declaration ${identifier}`);
}

if (failures.length) {
  console.error('Inkbound verifier integrity check FAILED.\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Inkbound verifier integrity check passed.');
