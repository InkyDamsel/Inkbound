import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const registryPath = path.join(sourceRoot, 'features', 'sync', 'storageKeys.ts');
const registryRelative = path.relative(root, registryPath).replaceAll('\\', '/');

const registrySource = fs.readFileSync(registryPath, 'utf8');
const registeredKeys = [...new Set(
  [...registrySource.matchAll(/['"]((?:inkbound|bookhaven)_[a-z0-9_]+)['"]/gi)].map((match) => match[1]),
)];

const sourceFiles = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) sourceFiles.push(absolute);
  }
};
walk(sourceRoot);

const violations = [];
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative === registryRelative) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const key of registeredKeys) {
    if (!source.includes(`'${key}'`) && !source.includes(`"${key}"`) && !source.includes(`\`${key}\``)) continue;
    violations.push(`${relative}: hardcodes registered storage key ${key}`);
  }
}

const retiredCollectionKeys = [
  'inkbound_library_custom_lists',
  'inkbound_library_custom_list_members',
];
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative === registryRelative) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const key of retiredCollectionKeys) {
    if (source.includes(key)) violations.push(`${relative}: references retired collection store ${key}`);
  }
}

if (violations.length) {
  console.error('Inkbound source-of-truth verification failed.');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Inkbound source-of-truth storage verification passed (${registeredKeys.length} registered keys).`);
