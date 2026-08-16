import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const functionsSource = path.join(root, 'functions', 'src');
const failures = [];
let callableCount = 0;

function visit(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      return;
    }
    if (!entry.name.endsWith('.ts')) return;

    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.includes('onCall(')) return;
      if (line.trim().startsWith('import ')) return;
      callableCount += 1;
      if (!line.includes('enforceAppCheck')) {
        failures.push(`${path.relative(root, fullPath)}:${index + 1} callable must explicitly configure enforceAppCheck`);
      }
    });
  });
}

visit(functionsSource);

if (callableCount === 0) {
  failures.push('No Firebase callable functions were found; security verification cannot confirm the callable boundary.');
}

if (failures.length > 0) {
  console.error('Inkbound function security verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Inkbound function security verified (${callableCount} App Check-configured callables).`);
