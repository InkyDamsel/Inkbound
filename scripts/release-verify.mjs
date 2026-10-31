import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm' : 'npm';

const checks = [
  { id: 'lint', label: 'TypeScript / lint', script: 'lint' },
  { id: 'custom-library-order', label: 'Custom library ordering regressions', script: 'test:custom-library-order' },
  { id: 'critical-reading', label: 'Critical reading regressions', script: 'test:critical:reading' },
  { id: 'reporting-math', label: 'Reporting math regressions', script: 'test:critical:reporting' },
  { id: 'catalog', label: 'Catalog / ISBN regressions', script: 'test:critical:catalog' },
  { id: 'critical-sync', label: 'Critical sync / persistence regressions', script: 'test:critical:sync' },
  { id: 'source-boundary', label: 'Source-of-truth boundary', script: 'verify:source-boundary' },
  { id: 'domain-taxonomy', label: 'Domain taxonomy', script: 'verify:domain-taxonomy' },
  { id: 'parity', label: 'Web / Android parity', script: 'verify:parity' },
  { id: 'production-env', label: 'Production environment', script: 'verify:production-env' },
  { id: 'build', label: 'Production bundle', script: 'build:bundle', dependsOn: ['production-env'] },
  { id: 'release-artifacts', label: 'Release artifacts', script: 'verify:release-artifacts', dependsOn: ['build'] },
  { id: 'function-security', label: 'Function security', script: 'verify:function-security' },
  { id: 'android-branding-sync', label: 'Android branding sync', script: 'android:branding:sync' },
  { id: 'android-config', label: 'Android configuration', script: 'verify:android-config' },
  { id: 'android-gradle', label: 'Android Gradle configuration', script: 'verify:android-gradle' },
  { id: 'native-projects', label: 'Cross-platform native project wiring', script: 'verify:native-projects' },
  { id: 'android-branding', label: 'Android branding', script: 'verify:android-branding', dependsOn: ['android-branding-sync'] },
  { id: 'functions-build', label: 'Firebase Functions build', script: 'functions:build' },
];

const results = new Map();

const divider = () => console.log('\n' + '='.repeat(78));

console.log('\nINKBOUND RELEASE VERIFICATION');
console.log('Running all independent release checks. Failures will be collected instead of stopping the run.');

for (const check of checks) {
  const failedDependencies = (check.dependsOn ?? []).filter((dependency) => results.get(dependency)?.status !== 'pass');

  divider();
  console.log(`CHECK: ${check.label}`);

  if (failedDependencies.length > 0) {
    const labels = failedDependencies.map((dependency) =>
      checks.find((candidate) => candidate.id === dependency)?.label ?? dependency,
    );
    console.log(`SKIP: prerequisite failed or was skipped: ${labels.join(', ')}`);
    results.set(check.id, {
      status: 'skip',
      reason: `prerequisite failed or was skipped: ${labels.join(', ')}`,
    });
    continue;
  }

  const started = Date.now();
  const child = spawnSync(npmCommand, ['run', check.script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: isWindows,
  });
  const durationSeconds = ((Date.now() - started) / 1000).toFixed(1);

  if (child.error) {
    console.error(`FAIL: could not start ${check.label}: ${child.error.message}`);
    results.set(check.id, { status: 'fail', reason: child.error.message, durationSeconds });
    continue;
  }

  if (child.status === 0) {
    results.set(check.id, { status: 'pass', durationSeconds });
  } else {
    results.set(check.id, {
      status: 'fail',
      reason: `exit code ${child.status ?? 'unknown'}`,
      durationSeconds,
    });
  }
}

divider();
console.log('INKBOUND RELEASE VERIFICATION SUMMARY\n');

const statusLabel = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

for (const check of checks) {
  const result = results.get(check.id);
  const status = result?.status ?? 'skip';
  const duration = result?.durationSeconds ? ` (${result.durationSeconds}s)` : '';
  const reason = result?.reason ? ` — ${result.reason}` : '';
  console.log(`${statusLabel[status].padEnd(5)} ${check.label}${duration}${reason}`);
}

const failures = checks.filter((check) => results.get(check.id)?.status === 'fail');
const skipped = checks.filter((check) => results.get(check.id)?.status === 'skip');

console.log('');
if (failures.length > 0) {
  console.error(`RESULT: FAILED — ${failures.length} blocker${failures.length === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} dependent check${skipped.length === 1 ? '' : 's'} skipped` : ''}.`);
  console.error('Fix the complete blocker set above, then rerun release:verify once.');
  process.exit(1);
}

if (skipped.length > 0) {
  console.error(`RESULT: FAILED — no direct blocker was recorded, but ${skipped.length} check${skipped.length === 1 ? ' was' : 's were'} skipped.`);
  process.exit(1);
}

console.log('RESULT: PASSED — all release checks completed successfully.');
