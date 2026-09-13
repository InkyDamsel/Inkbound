import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const violations = [];

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
});

const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
const read = (file) => fs.readFileSync(file, 'utf8');
const files = walk(srcRoot);

const taxonomyPath = 'src/domain/libraryTaxonomy.ts';
const typesPath = 'src/types.ts';
const importMappingAllowlist = new Set([
  'src/features/import/spreadsheetImport.ts',
  'src/features/import/safeReimportMerge.ts',
  'src/features/library/libraryNormalization.ts',
]);

// Reader-facing status selectors must come from the canonical taxonomy. External
// import normalization may mention raw status values because it translates a
// foreign vocabulary into Inkbound's canonical domain.
const hardCodedStatusOption = /<option[^>]+value=["'](?:currently-reading|tbr|finished|paused|dnf|wishlist)["']/;
for (const file of files) {
  const name = rel(file);
  if (name === taxonomyPath || importMappingAllowlist.has(name)) continue;
  const source = read(file);
  if (hardCodedStatusOption.test(source)) {
    violations.push(`${name}: hard-codes reading-status <option> values; render READING_STATUS_OPTIONS from libraryTaxonomy.ts`);
  }
}

// Ownership, format, priority, and reading-material dropdowns must not recreate
// their labels locally. This catches the common failure mode where one screen
// silently exposes a smaller or differently-labelled set than another screen.
const hardCodedOptionGroups = [
  {
    label: 'ownership',
    pattern: /<option[^>]+value=["']owned["'][\s\S]{0,1800}<option[^>]+value=["'](?:borrowed-library|subscription|none)["']/,
    owner: 'OWNERSHIP_OPTIONS',
  },
  {
    label: 'priority',
    pattern: /<option[^>]+value=["']top["'][\s\S]{0,1000}<option[^>]+value=["']low["']/,
    owner: 'PRIORITY_OPTIONS',
  },
  {
    label: 'format',
    pattern: /<option[^>]+value=["']hardcover["'][\s\S]{0,1200}<option[^>]+value=["'](?:ebook|audiobook)["']/,
    owner: 'FORMAT_OPTIONS',
  },
];
for (const file of files) {
  const name = rel(file);
  if (name === taxonomyPath) continue;
  const source = read(file);
  for (const group of hardCodedOptionGroups) {
    if (group.pattern.test(source)) {
      violations.push(`${name}: recreates ${group.label} selector values; render ${group.owner} from libraryTaxonomy.ts`);
    }
  }
}

// The compatibility-only ReadingStatus 'custom' must never be assigned from an
// ownership category. customOwnershipCategoryId belongs to ownership === custom.
for (const file of files) {
  const name = rel(file);
  const source = read(file);
  if (/customOwnershipCategoryId[\s\S]{0,500}status\s*:\s*['"]custom['"]/.test(source)
      || /status\s*:\s*['"]custom['"][\s\S]{0,500}customOwnershipCategoryId/.test(source)) {
    violations.push(`${name}: couples custom ownership metadata to reading status; customOwnershipCategoryId belongs only to ownership === 'custom'`);
  }
}

const types = read(path.join(root, typesPath));
if (!types.includes("ownership === 'custom'")) {
  violations.push(`${typesPath}: must document customOwnershipCategoryId as custom-ownership metadata`);
}

const taxonomy = read(path.join(root, taxonomyPath));
for (const value of ['currently-reading', 'tbr', 'finished', 'paused', 'dnf']) {
  if (!taxonomy.includes(`value: '${value}'`)) {
    violations.push(`${taxonomyPath}: READING_STATUS_OPTIONS must expose ${value}`);
  }
}

// High-risk screens: these are the places users can mutate/filter the same
// library taxonomy. Requiring canonical imports makes omissions fail CI instead
// of becoming another Play Store hotfix.
const requiredCanonicalConsumers = new Map([
  ['src/components/AddBookModal.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS']],
  ['src/components/BatchEditModal.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS']],
  ['src/components/BookDetailsModalCore.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'PRIORITY_OPTIONS']],
  ['src/components/LibraryScreen.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS']],
]);
for (const [name, symbols] of requiredCanonicalConsumers) {
  const full = path.join(root, name);
  if (!fs.existsSync(full)) {
    violations.push(`${name}: canonical taxonomy consumer is missing`);
    continue;
  }
  const source = read(full);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) violations.push(`${name}: must consume canonical ${symbol}`);
  }
}

// Custom ownership is account-owned data. Any selector that exposes the Custom
// ownership value must also have a path to the canonical custom category store.
for (const file of files) {
  const name = rel(file);
  const source = read(file);
  const exposesCustomOwnership = source.includes('OWNERSHIP_OPTIONS') && source.includes("option.value !== 'custom'");
  if (exposesCustomOwnership && !source.includes('readCustomOwnershipCategories') && !name.endsWith('/OwnershipManager.tsx')) {
    violations.push(`${name}: filters the Custom ownership option without consuming the canonical custom ownership categories`);
  }
}

if (violations.length) {
  console.error('Inkbound domain taxonomy verification failed.');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Inkbound domain taxonomy source-of-truth verification passed.');
