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
  [...storageKeysSource.matchAll(/['\"](inkbound_[a-z0-9_]+)['\"]/gi)].map((match) => match[1]),
)];
for (const file of files) {
  const name = rel(file);
  if (name === storageKeysPath) continue;
  const source = read(file);
  for (const key of registeredStorageKeyLiterals) {
    if (source.includes(`'${key}'`) || source.includes(`\"${key}\"`)) {
      violations.push(`${name}: redefines registered storage key ${key}; import its owner from storageKeys.ts`);
    }
  }
}

// Reader-facing status selectors must come from the canonical taxonomy. External
// import normalization may mention raw status values because it translates a
// foreign vocabulary into Inkbound's canonical domain.
const hardCodedStatusOption = /<option[^>]+value=[\"'](?:currently-reading|tbr|finished|paused|dnf|wishlist)[\"']/;
for (const file of files) {
  const name = rel(file);
  if (name === taxonomyPath || importMappingAllowlist.has(name)) continue;
  const source = read(file);
  if (hardCodedStatusOption.test(source)) {
    violations.push(`${name}: hard-codes reading-status <option> values; render READING_STATUS_OPTIONS from libraryTaxonomy.ts`);
  }
}

const hardCodedOptionGroups = [
  {
    label: 'ownership',
    pattern: /<option[^>]+value=[\"']owned[\"'][\s\S]{0,1800}<option[^>]+value=[\"'](?:borrowed-library|subscription|none)[\"']/,
    owner: 'OWNERSHIP_OPTIONS',
  },
  {
    label: 'priority',
    pattern: /<option[^>]+value=[\"']top[\"'][\s\S]{0,1000}<option[^>]+value=[\"']low[\"']/,
    owner: 'PRIORITY_OPTIONS',
  },
  {
    label: 'format',
    pattern: /<option[^>]+value=[\"']hardcover[\"'][\s\S]{0,1200}<option[^>]+value=[\"'](?:ebook|audiobook)[\"']/,
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
// ownership value. Detect semantic coupling, not harmless nearby UI words such
// as "Custom categories" in an ownership picker.
for (const file of files) {
  const name = rel(file);
  const source = read(file);
  if (/customOwnershipCategoryId\s*:[^\n]{0,120}[\s\S]{0,180}status\s*:\s*['\"]custom['\"]/.test(source)
      || /status\s*:\s*['\"]custom['\"][\s\S]{0,180}customOwnershipCategoryId\s*:/.test(source)) {
    violations.push(`${name}: couples custom ownership metadata to reading status; customOwnershipCategoryId belongs only to ownership === 'custom'`);
  }
  if (/collections\s*:[^\n]{0,240}customOwnershipCategoryId|customOwnershipCategoryId[^\n]{0,240}collections\s*:/i.test(source)
      && !name.endsWith('types.ts')
      && name !== 'src/features/library/libraryNormalization.ts') {
    violations.push(`${name}: treats customOwnershipCategoryId as collection membership; Collections belong to UserBookRecord.collections`);
  }
}

const types = read(path.join(root, typesPath));
if (!types.includes("ownership === 'custom'")) {
  violations.push(`${typesPath}: must document customOwnershipCategoryId as custom-ownership metadata`);
}

const taxonomy = read(path.join(root, taxonomyPath));
for (const value of ['currently-reading', 'tbr', 'finished', 'paused', 'dnf']) {
  if (!taxonomy.includes(`value: '${value}'`)) violations.push(`${taxonomyPath}: READING_STATUS_OPTIONS must expose ${value}`);
}
if (!taxonomy.includes('COMPATIBILITY_READING_STATUS_OPTIONS')) {
  violations.push(`${taxonomyPath}: compatibility-only statuses must remain explicit instead of silently joining reader-assignable status options`);
}

const requiredCanonicalConsumers = new Map([
  ['src/components/AddBookModal.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS', 'readCustomOwnershipCategories', 'withReadingStatus']],
  ['src/components/BatchEditModal.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS', 'readCustomOwnershipCategories']],
  ['src/components/BookDetailsModalCore.tsx', ['READING_STATUS_OPTIONS', 'FORMAT_OPTIONS', 'PRIORITY_OPTIONS', 'CustomOwnershipBookControl', 'getBookReadingState', 'withReadingStatus']],
  ['src/components/LibraryScreen.tsx', ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'FORMAT_OPTIONS', 'readCustomOwnershipCategories', 'getCanonicalProgressPercentage']],
  ['src/components/HomeDashboard.tsx', ['getEffectivePagesReadForPeriod', 'getBookReadingState', 'hasTrustworthyFinishedHistory']],
  ['src/components/MonthlyWrappedScreen.tsx', ['getEffectivePagesReadForPeriod', 'hasTrustworthyFinishedHistory']],
  ['src/components/StatisticsScreen.tsx', ['getEffectivePagesReadForPeriod', 'hasTrustworthyFinishedHistory']],
  ['src/components/YearInBooksScreen.tsx', ['getEffectivePagesReadForPeriod', 'hasTrustworthyFinishedHistory']],
  ['src/components/ReadingInsightsScreen.tsx', ['hasTrustworthyFinishedHistory', 'isImportedBook']],
  ['src/components/ReaderPersonalityScreen.tsx', ['hasTrustworthyFinishedHistory', 'isImportedBook', 'isInkboundFinishedBook']],
  ['src/components/BookshelfThroughTimeScreen.tsx', ['getTrustworthyFinishedBooks', 'readingMonthKey', 'canonicalReadingDateKey']],
  ['src/components/ReadingTimelineScreen.tsx', ['hasTrustworthyFinishedHistory', 'isImportedBook']],
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
if (/Reading status \/ category/.test(addBook)) {
  violations.push('AddBookModal.tsx: ownership categories must not be presented as reading statuses/categories');
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
if (/activeCategory\.startsWith\(['\"]custom:/.test(libraryScreen)) {
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

// Raw stored progress is fine while constructing a mutation payload. It is not
// fine when displayed/sorted/aggregated without the canonical reading resolver.
for (const file of files.filter((file) => rel(file).startsWith('src/components/'))) {
  const name = rel(file);
  const source = read(file);
  if (!/\.progressPercentage\b/.test(source)) continue;
  const canonical = source.includes('getCanonicalProgressPercentage')
    || source.includes('getBookReadingState')
    || source.includes('getAverageBookProgress');
  const mutationOnly = !/[>{]\s*(?:book|item)\.progressPercentage|progressPercentage\s*\}%|sort\([^)]*progressPercentage|reduce\([^)]*progressPercentage/.test(source);
  const mutationEditor = name === 'src/components/BookDetailsModalCore.tsx';
  if (!canonical && !mutationEditor && !mutationOnly) {
    violations.push(`${name}: reads raw progressPercentage for derived UI without the canonical reading-state resolver`);
  }
}

const canonicalPageReportConsumers = [
  'src/components/HomeDashboard.tsx',
  'src/components/MonthlyWrappedScreen.tsx',
  'src/components/StatisticsScreen.tsx',
  'src/components/YearInBooksScreen.tsx',
];
for (const name of canonicalPageReportConsumers) {
  const source = read(path.join(root, name));
  if (!source.includes('getEffectivePagesReadForPeriod')) violations.push(`${name}: historical page totals must use readingPageTotals.ts`);
}

for (const file of files.filter((file) => rel(file).startsWith('src/components/'))) {
  const name = rel(file);
  const source = read(file);
  if (/(?:const|function)\s+isImportedBook\b/.test(source)) violations.push(`${name}: redefines isImportedBook; import it from inkboundActivity.ts`);
  if (/(?:const|function)\s+hasTrustworthyFinishedHistory\b/.test(source)
      || /(?:const|function)\s+hasTrustworthyFinishedDate\b/.test(source)) {
    violations.push(`${name}: redefines trustworthy finished-history semantics; import hasTrustworthyFinishedHistory from inkboundActivity.ts`);
  }
}

for (const name of [
  'src/components/HomeDashboard.tsx',
  'src/components/MonthlyWrappedScreen.tsx',
  'src/components/StatisticsScreen.tsx',
  'src/components/YearInBooksScreen.tsx',
  'src/components/BookshelfThroughTimeScreen.tsx',
]) {
  const source = read(path.join(root, name));
  if (/books\.filter\(\s*\(?\s*book\s*\)?\s*=>\s*book\.status\s*===\s*['\"]finished['\"]/.test(source)
      && !source.includes('hasTrustworthyFinishedHistory')
      && !source.includes('getTrustworthyFinishedBooks')) {
    violations.push(`${name}: dated historical Finished counts must use the canonical trustworthy-history resolver`);
  }
}

for (const file of files) {
  const name = rel(file);
  const source = read(file);
  const exposesCustomOwnership = source.includes('OWNERSHIP_OPTIONS') && source.includes("option.value !== 'custom'");
  if (exposesCustomOwnership && !source.includes('readCustomOwnershipCategories') && !name.endsWith('/OwnershipManager.tsx')) {
    violations.push(`${name}: filters the Custom ownership option without consuming the canonical custom ownership categories`);
  }
}

// Only true account/domain stores are forbidden here. UI-only selection/filter/
// draft/view preference keys intentionally remain local to their owning screen.
for (const file of files.filter((file) => rel(file).startsWith('src/components/'))) {
  const name = rel(file);
  const source = read(file);
  const suspiciousKey = /const\s+[A-Z0-9_]*(?:BOOKS?|SESSIONS?|PROFILE|ANNUAL_GOAL|DAILY_GOAL|OWNERSHIP_CATEGORIES|COLLECTION_DEFINITIONS|MEMORIES|CAPSULES|DRAGON)[A-Z0-9_]*_KEY\s*=\s*['\"]inkbound_/;
  if (suspiciousKey.test(source)) {
    violations.push(`${name}: declares an account/domain persistence key locally; consume storageKeys.ts or the owning feature constant`);
  }
}

if (violations.length) {
  console.error('Inkbound domain/source-of-truth verification failed.');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Inkbound domain/source-of-truth verification passed.');
