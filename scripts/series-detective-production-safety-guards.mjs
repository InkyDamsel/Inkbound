import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Source-level guards for legacy production fixes. These are deliberately
 * narrower than behavioral provider replay; they must not be treated as
 * proof that discovery or verification is production-ready.
 */
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ol = read('src/features/series/seriesDetectiveOpenLibraryApi.ts');
const legacy = read('src/features/series/seriesDetective.ts');
const merge = read('src/features/series/seriesDetectiveMerge.ts');
const preview = read('src/components/library/SeriesDetectivePreview.tsx');
const corroboration = read('src/features/series/seriesDetectiveCorroboration.ts');
const canonicalAdapter = read('src/features/series/seriesDetectiveCanonicalAdapter.ts');
const decision = read('src/features/series/seriesDetectiveDecision.ts');
const bookLookup = read('src/components/library/SeriesDetectiveBookLookup.tsx');
const app = read('src/App.tsx');
assert.match(ol, /const hasPositionedEdition = existing\.some/);
assert.match(ol, /const concurrency = 4;/);
assert.match(ol, /const fetchWithDeadline = async/);
assert.match(ol, /const body = await response\.text\(\);/);
assert.match(ol, /if \(!response\.ok\) throw new Error\(`Open Library edition lookup failed/);
assert.match(ol, /setTimeout\(\(\) => controller\.abort\(\), 10000\)/);
assert.match(ol, /fetchWithDeadline\(`\$\{ENDPOINT\}/);
assert.match(ol, /fetchWithDeadline\(`https:\/\/openlibrary\.org/);
assert.doesNotMatch(ol, /Promise\.all\(works\.map\(async \(work, index\)/);
assert.match(ol, /if \(hasSeries && hasPositionedEdition\) return work;/);
assert.doesNotMatch(ol, /if \(hasSeries && existing\.length > 0\) return work;/);
assert.doesNotMatch(legacy, /anchoredSeriesAliases\.has\(/);
assert.doesNotMatch(legacy, /seedGoogleSeriesIds\(volume, catalog, true\);/);
assert.doesNotMatch(legacy, /strongStructured \|\| independentlyCorroborated/);
assert.match(decision, /membership\.providers >= 2/);
assert.match(decision, /!membership\.conflictingOrder && !canonical\.conflicting/);
assert.match(decision, /&& canonical\.verified/);
assert.match(decision, /conflictingOrder: membership\.conflictingOrder \|\| canonical\.conflicting/);
assert.match(decision, /verification: verified \? 'verified' : 'review'/);
assert.match(legacy, /DERIVATIVE_ADAPTATION_PATTERN\.test\(value\)/);
assert.match(legacy, /CATALOG_PLACEHOLDER_PATTERN\.test\(candidate\.work\.title\)/);
// Work identity must govern ownership; ISBN-only matches are unsafe.
assert.match(legacy, /if \(!sameAuthor\) return false;/);
assert.match(legacy, /if \(sameTitle\) return true;/);
assert.match(legacy, /canonicalDetectiveIsbn13\(isbn\)/);
assert.match(legacy, /detectiveWorkTitlesCompatible\(book\.work\.title, title, seriesName\)/);
assert.match(legacy, /seriesStructured: false,/);
assert.ok((legacy.match(/Number\.isSafeInteger\(displayPosition\) && displayPosition > 0/g) ?? []).length >= 2);
assert.match(legacy, /decideDetectiveMembership\(/);
assert.match(legacy, /issuedVerifiedCandidates\.add\(candidate\)/);
assert.match(app, /isIssuedVerifiedDetectiveCandidate\(candidate\)/);
assert.doesNotMatch(bookLookup, /inkbound:series-detective-apply/);
assert.match(decision, /hasCorroboratedOwnedSeed\(/);
// Assert the required guards directly; avoid fragile regex source matching.
assert.ok(corroboration.includes('return owned.some(book => Boolean(book.author?.trim())'));
assert.ok(corroboration.includes('Boolean(comparableDetectiveTitle(book.title))'));
assert.ok(corroboration.includes('new Set(candidates.filter(candidate =>'));
assert.ok(corroboration.includes('candidate.work.authors.some(author => Boolean(author?.trim())'));
assert.match(legacy, /result\.discoveryDiagnostics = \{/);
assert.match(bookLookup, /result\?\.providerReports/);
assert.match(legacy, /discoveryDiagnostics = \{ \.\.\.diagnostics, uniqueWorks: seen\.size \};/);
assert.match(corroboration, /detectiveCandidatesAreSameWork\(candidate, target\)/);
assert.ok(legacy.includes('if (!resolvedSeriesName || !detectiveSeriesNamesCompatible(resolvedSeriesName, seriesName))'));
assert.doesNotMatch(merge, /if \(left\.seriesName && right\.seriesName\s*&& detectiveSeriesNamesCompatible\(left\.seriesName, right\.seriesName\)\) return true;/);
assert.doesNotMatch(preview, /result\?\.discoveryDiagnostics/);
assert.match(preview, /<SeriesDetectiveRoster/);
assert.match(legacy, /!titleKey \|\| !comparableDetectiveTitle\(existing\.work\.title, existing\.seriesName\)/);
assert.match(legacy, /comparableDetectiveTitle\(existing\.work\.title, existing\.seriesName\) === titleKey/);
assert.match(corroboration, /const invalidPosition = matching\.some\(candidate => candidate\.position != null/);
assert.match(corroboration, /conflictingOrder: invalidPosition \|\| positions\.size > 1/);
assert.match(legacy, /const targetKey = isbnMatch && titleKey && authorKey \? isbnMatch\[0\] : key;/);
assert.match(corroboration, /detectiveWorkTitlesCompatible\(candidate\.work\.title, target\.work\.title, seriesName\)/);
assert.match(legacy, /conflictedPositions\.has\(candidate\.position\)[\s\S]*?verification: 'review' as const, position: null/);
assert.match(legacy, /seen\.set\(targetKey, \{ \.\.\.selected, verification: 'review', position: null \}\)/);
assert.match(decision, /position: verified && !membership\.conflictingOrder && !canonical\.conflicting\s*\? canonical\.agreedPosition : null/);
assert.match(canonicalAdapter, /export function verifyCanonicalProductionMembership\(/);
assert.match(decision, /verifyCanonicalProductionMembership\(/);
assert.match(decision, /&& canonical\.verified/);
assert.match(canonicalAdapter, /return \{ verified: false, agreedPosition: null, conflicting: false,/);



console.log('Series Detective production safety source guards passed (not behavioral verification).');
