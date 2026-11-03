import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(process.cwd(), '.inkbound-import-regressions-'));
const checks = [
  'scripts/importer-safety-regressions.ts',
  'scripts/importer-history-regressions.ts',
];

try {
  for (const [index, entryPoint] of checks.entries()) {
    const outfile = join(dir, `importer-${index}.mjs`);
    await build({
      entryPoints: [resolve(entryPoint)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      packages: 'external',
      define: { 'import.meta.env': '{ "DEV": false, "MODE": "test" }' },
      logLevel: 'warning',
    });
    const execution = spawnSync(process.execPath, [outfile], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    if (execution.error) throw execution.error;
    if (execution.status !== 0) {
      throw new Error(`${entryPoint} failed with exit code ${execution.status ?? 'unknown'}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
