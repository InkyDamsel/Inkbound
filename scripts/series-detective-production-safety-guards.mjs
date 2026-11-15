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
assert.match(legacy, /seedCorroborated && membershipEvidence\.providers >= 2 && !membershipEvidence\.conflictingOrder/);
assert.match(legacy, /const seedCorroborated = seedMembershipProviders\.size >= 2;/);
assert.match(legacy, /detectiveCandidatesAreSameWork\(source, candidate\)/);
assert.ok(legacy.includes('if (!resolvedSeriesName || !detectiveSeriesNamesCompatible(resolvedSeriesName, seriesName))'));
console.log('Series Detective production safety source guards passed (not behavioral verification).');
