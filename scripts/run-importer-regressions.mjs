import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(process.cwd(), '.inkbound-import-regressions-'));
const checks = [
  'scripts/importer-safety-regressions.ts',
  'scripts/importer-history-regressions.ts',
];

const failures = [];
try {
  for (const [index, entryPoint] of checks.entries()) {
    try {
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
        throw new Error(`Exit code ${execution.status ?? 'unknown'}`);
      }
      console.log(`PASS ${entryPoint}`);
    } catch (error) {
      failures.push(`${entryPoint}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`FAIL ${entryPoint}`);
    }
  }
  if (failures.length) {
    console.error(`Importer regressions failed (${failures.length}):\\n${failures.join('\\n')}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
