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
const storageKeysPath = 'src/features/sync/storageKeys.ts';
const importMappingAllowlist = new Set([
  'src/features/import/spreadsheetImport.ts',
  'src/features/import/safeReimportMerge.ts',
  'src/features/library/libraryNormalization.ts',
]);

// Every registered persistent key has exactly one literal declaration:
// storageKeys.ts. Consumers import the registry instead of spelling the same key
// again. A matching duplicate is still a second authority and is forbidden.
const storageKeysSource = read(path.join(root, storageKeysPath));
const registeredStorageKeyLiterals = [...new Set(
  [...storageKeysSource.matchAll(/['"](inkbound_[a-z0-9_]+)['"]/gi)].map((match) => match[1]),
)];
for (const file of files) {
  const name = rel(file);
  if (name === storageKeysPath) continue;
  const source = read(file);
  for (const key of registeredStorageKeyLiterals) {
    if (source.includes(`'${key}'`) || source.includes(`"${key}"`)) {
      violations.push(`${name}: redefines registered storage key ${key}; import its owner from storageKeys.ts`);
    }
  }
}

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

// Ownership, format, priority, and material selectors must not recreate their
// labels locally. This catches the exact class of bug where one surface exposes a
// smaller/different set than another surface.
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

// customOwnershipCategoryId has exactly one meaning: the selected custom
// ownership value. It must never be used as a second reading-status/category
// system or as a Collections membership store.
for (const file of files) {
  const name = rel(file);
  const source = read(file);
  if (/customOwnershipCategoryId[\s\S]{0,500}status\s*:\s*['"]custom['"]/.test(source)
      || /status\s*:\s*['"]custom['"][\s\S]{0,500}customOwnershipCategoryId/.test(source)) {
    violations.push(`${name}: couples custom ownership metadata to reading status; customOwnershipCategoryId belongs only to ownership === 'custom'`);
  }
  if (/customOwnershipCategoryId[\s\S]{0,500}(?:collection|Library categor)/i.test(source)
      && !name.endsWith('types.ts')
      && name !== 'src/features/library/libraryNormalization.ts') {
    violations.push(`${name}: treats customOwnershipCategoryId as collection/category membership; Collections belong to UserBookRecord.collections`);
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
if (!taxonomy.includes('COMPATIBILITY_READING_STATUS_OPTIONS')) {
  violations.push(`${taxonomyPath}: compatibility-only statuses must remain explicit instead of silently joining reader-assignable status options`);
}

// High-risk screens mutate/filter the same domain values. Make their canonical
// imports a release requirement so omission becomes a failed verification, not a
// Play Store hotfix.
const requiredCanonicalConsumers = new Map([
  ['src/components/AddBookModal.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS', 'readCustomOwnershipCategories', 'withReadingStatus']],
  ['src/components/BatchEditModal.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS', 'readCustomOwnershipCategories']],
  ['src/components/BookDetailsModalCore.tsx', ['READING_STATUS_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS', 'CustomOwnershipBookControl', 'getBookReadingState', 'withReadingStatus']],
  ['src/components/LibraryScreen.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'readCustomOwnershipCategories', 'getCanonicalProgressPercentage']],
  ['src/components/HomeDashboard.tsx', ['getEffectivePagesReadForPeriod', 'getBookReadingState']],
  ['src/components/MonthlyWrappedScreen.tsx', ['getEffectivePagesReadForPeriod']],
  ['src/components/StatisticsScreen.tsx', ['getEffectivePagesReadForPeriod']],
  ['src/components/YearInBooksScreen.tsx', ['getEffectivePagesReadForPeriod']],
  ['src/components/ReadingInsightsScreen.tsx', ['hasTrustworthyFinishedHistory', 'isImportedBook']],
]);
for (const [name, symbols] of requiredCanonicalConsumers) {
  const full = path.join(root, name);
  if (!fs.existsSync(full)) {
    violations.push(`${name}: canonical source-of-truth consumer is missing`);
    continue;
  }
  const source = read(full);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) violations.push(`${name}: must consume canonical ${symbol}`);
  }
}

const addBook = read(path.join(root, 'src/components/AddBookModal.tsx'));
if (/Reading status \/ category|Custom categories/.test(addBook)) {
  violations.push('AddBookModal.tsx: custom ownership categories must not be presented as reading statuses/categories');
}
if (!addBook.includes("ownership: 'custom'") && !addBook.includes('customOwnership')) {
  violations.push('AddBookModal.tsx: manual add must preserve custom ownership through the canonical ownership field');
}

const batchEdit = read(path.join(root, 'src/components/BatchEditModal.tsx'));
if (!batchEdit.includes('customOwnershipCategories') || !batchEdit.includes('customOwnershipCategoryId')) {
  violations.push('BatchEditModal.tsx: custom ownership must be offered from the canonical custom ownership store');
}

const libraryScreen = read(path.join(root, 'src/components/LibraryScreen.tsx'));
if (!libraryScreen.includes("ownershipFilter.startsWith('custom:')")) {
  violations.push('LibraryScreen.tsx: custom ownership values must be filterable through the Ownership filter');
}
if (/activeCategory\.startsWith\(['"]custom:/.test(libraryScreen)) {
  violations.push('LibraryScreen.tsx: custom ownership must not masquerade as a reading-status/library-category filter');
}

const normalization = read(path.join(root, 'src/features/library/libraryNormalization.ts'));
if (!normalization.includes("normalized.status === 'wishlist'") || !normalization.includes("normalized.status === 'custom'")) {
  violations.push('libraryNormalization.ts: must own legacy wishlist/custom reading-status migration before UI consumption');
}
if (!normalization.includes("normalized.ownership !== 'custom' && normalized.customOwnershipCategoryId")) {
  violations.push('libraryNormalization.ts: must clear stale custom ownership ids when ownership is not custom');
}

const bookDetails = read(path.join(root, 'src/components/BookDetailsModalCore.tsx'));
if (/querySelector\([\s\S]*option\[value=/.test(bookDetails)) {
  violations.push('BookDetailsModalCore.tsx: must not hide/replace a competing selector through DOM inspection');
}

// Any derived component that displays/sorts raw stored progress must consume the
// canonical reading-state resolver. Mutation owners/import translators are
// intentionally excluded because they write/reconcile the canonical record.
for (const file of files.filter((file) => rel(file).startsWith('src/components/'))) {
  const name = rel(file);
  const source = read(file);
  if (!/\.progressPercentage\b/.test(source)) continue;
  const canonical = source.includes('getCanonicalProgressPercentage')
    || source.includes('getBookReadingState')
    || source.includes('getAverageBookProgress');
  const mutationEditor = name === 'src/components/BookDetailsModalCore.tsx';
  if (!canonical && !mutationEditor) {
    violations.push(`${name}: reads raw progressPercentage without the canonical reading-state resolver`);
  }
}

// Pages shown as historical/reporting totals have a single owner. Session-only
// features such as achievements/challenges/reading activity may intentionally
// use getSessionPagesRead because their labels explicitly describe tracked
// Inkbound activity; broad report surfaces may not recompute the metric.
const canonicalPageReportConsumers = [
  'src/components/HomeDashboard.tsx',
  'src/components/MonthlyWrappedScreen.tsx',
  'src/components/StatisticsScreen.tsx',
  'src/components/YearInBooksScreen.tsx',
];
for (const name of canonicalPageReportConsumers) {
  const source = read(path.join(root, name));
  if (!source.includes('getEffectivePagesReadForPeriod')) {
    violations.push(`${name}: historical page totals must use readingPageTotals.ts`);
  }
}

// The canonical trustworthy-finish rule lives in inkboundActivity.ts. Screens
// may consume it, but they may not silently redefine it with slightly different
// import/date semantics.
for (const file of files.filter((file) => rel(file).startsWith('src/components/'))) {
  const name = rel(file);
  const source = read(file);
  if (name !== 'src/features/reading/inkboundActivity.ts'
      && /(?:const|function)\s+hasTrustworthyFinishedHistory\b/.test(source)) {
    violations.push(`${name}: redefines hasTrustworthyFinishedHistory; import it from inkboundActivity.ts`);
  }
}

// Custom ownership is account-owned data. Any selector that removes the generic
// Custom placeholder must also consume the canonical category store.
for (const file of files) {
  const name = rel(file);
  const source = read(file);
  const exposesCustomOwnership = source.includes('OWNERSHIP_OPTIONS') && source.includes("option.value !== 'custom'");
  if (exposesCustomOwnership && !source.includes('readCustomOwnershipCategories') && !name.endsWith('/OwnershipManager.tsx')) {
    violations.push(`${name}: filters the Custom ownership option without consuming the canonical custom ownership categories`);
  }
}

// No UI component gets to invent a second local persistence key for domain data.
// UI-only preferences may own local keys, but books/sessions/profile/goals/
// ownership/collections must use the registered owner.
for (const file of files.filter((file) => rel(file).startsWith('src/components/'))) {
  const name = rel(file);
  const source = read(file);
  const suspiciousKey = /const\s+[A-Z0-9_]*(?:BOOK|SESSION|PROFILE|GOAL|OWNERSHIP|COLLECTION)[A-Z0-9_]*_KEY\s*=\s*['"]inkbound_/;
  if (suspiciousKey.test(source)) {
    violations.push(`${name}: declares a domain persistence key locally; consume storageKeys.ts or the owning feature constant`);
  }
}

if (violations.length) {
  console.error('Inkbound domain/source-of-truth verification failed.');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Inkbound domain/source-of-truth verification passed.');
