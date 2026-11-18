import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import { buildSeriesLibrary, canonicalSeriesIdentity, seriesNamesAreCompatible } from '../src/features/series/seriesLibrary';
import { summarizeSeriesRoster, type SeriesRosterEntry } from '../src/features/series/seriesDetectiveRoster';
// Discovery from search has no owned numbered anchor: probe opening volumes.
const unanchoredPlan = planSeriesDiscoveryQueries({ seriesName: 'Sample Chronicles', author: 'A. Reader', knownPositions: [] });
assert.deepEqual(unanchoredPlan.targetPositions, [1, 2, 3, 4, 5]);
assert.ok(unanchoredPlan.queries.includes('Sample Chronicles book 1 A. Reader'));
assert.ok(unanchoredPlan.queries.includes('"Sample Chronicles"'));
// Custom reading-order labels must still search by exact owned book anchors.
const anchoredPlan = planSeriesDiscoveryQueries({
  seriesName: 'My Reading Order', author: 'Example Author', knownPositions: [3],
  anchorTitles: ['A Touch of Ruin'],
});
assert.ok(anchoredPlan.queries.includes('intitle:"A Touch of Ruin" inauthor:"Example Author"'));
assert.ok(anchoredPlan.targetPositions.includes(1));
assert.ok(anchoredPlan.targetPositions.includes(2));

// A malformed very high position must never allocate a massive gap array.
const distantPlan = planSeriesDiscoveryQueries({ seriesName: 'Sample Chronicles', author: 'A. Reader', knownPositions: [1000000000] });
assert.deepEqual(distantPlan.targetPositions.slice(0, MAX_GAP_QUERY_TARGETS), [1, 2, 3, 4, 5]);
assert.equal(distantPlan.targetPositions.length, MAX_GAP_QUERY_TARGETS + FORWARD_QUERY_TARGETS);
assert.ok(!distantPlan.targetPositions.includes(1000000000));

import { planSeriesDiscoveryQueries, MAX_GAP_QUERY_TARGETS, FORWARD_QUERY_TARGETS } from '../src/features/series/seriesDetectiveQueryPlan';
import { hasExplicitDetectiveSeriesBrand } from '../src/features/series/seriesDetectiveBranding';
import { confirmedGoogleMembershipIds } from '../src/features/series/seriesDetectiveGoogleSeriesIds';
import { parseDetectiveOpenLibrarySeries, plausibleOpenLibrarySeriesName } from '../src/features/series/seriesDetectiveOpenLibraryApi';
import { mergeDetectiveCandidates } from '../src/features/series/seriesDetectiveMerge';
import {
  buildSeriesDetectionQueries,
  canonicalDetectiveAuthor,
  comparableDetectiveTitle,
  detectiveAuthorsCompatible,
  detectiveSeriesNamesCompatible,
  inferDetectiveSeriesFromDescription,
  inferDetectiveSeriesFromTitle,
  inferKnownDetectiveSeriesFromDescription,
  inferKnownDetectiveSeriesFromText,
  plausibleDetectiveSeriesSubtitle,
  scoreDetectiveEvidence,
  selectVerifiedDetectiveEvidence,
} from '../src/features/series/seriesDetectiveEvidence';

const divergent = {
  work: { title: 'Divergent', author: 'Veronica Roth' },
  editions: [
    { id: 'a', isbn13: '9780062024039', isbn10: '0062024035' },
    { id: 'b', isbn13: '9780007420421' },
  ],
} as unknown as UserBookRecord;


// A topical mythological description is not evidence of a specific series.
// Multi-author branded titles remain eligible for corroboration.
const brandedFixture = (title: string, subtitle: string) => ({
  work: { title, subtitle },
  edition: { title, subtitle },
}) as Parameters<typeof hasExplicitDetectiveSeriesBrand>[0];
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Salt & Blood', 'A Hades and Persephone Romance'),
  'Hades x Persephone',
), false);
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Lethal: Wellard Asylum Series', ''),
  'Wellard Asylum',
), true);
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Lethal', 'Wellard Asylum Series'),
  'Wellard Asylum',
), true); // explicit series branding in a full subtitle is valid

assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture("Conceal, Don't Feel: A Twisted Tale", ''),
  'A Twisted Tale',
), true);
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Exposed (Wellard Asylum)', ''),
  'Wellard Asylum',
), true);
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Salt & Blood: A Hades and Persephone Romance', ''),
  'Hades x Persephone',
), false);

// Unverified catalog records must not inflate the verified missing count.
const rosterSummary = summarizeSeriesRoster([
  { kind: 'owned', key: 'owned', candidate: { verification: 'verified' } },
  { kind: 'library-only', key: 'library-only' },
  { kind: 'missing', key: 'verified-missing', candidate: { verification: 'verified' } },
  { kind: 'missing', key: 'review', candidate: { verification: 'review' } },
] as SeriesRosterEntry[]);
assert.deepEqual(rosterSummary, { inLibrary: 2, missing: 1, review: 1, libraryOnly: 1, total: 4 });

// Shared library normalization must agree with Detective evidence on leading articles.
for (const [label, expected] of [
  ['The Selection', 'selection'],
  ['Selection', 'selection'],
  ['A Twisted Tale', 'twisted tale'],
  ['Twisted Tale', 'twisted tale'],
  ['The Unhinged Love Trilogy', 'unhinged love'],
  ['Unhinged Love', 'unhinged love'],
] as const) {
  assert.equal(canonicalSeriesIdentity(label), expected);
  assert.equal(detectiveSeriesNamesCompatible(label, expected), true);
}
assert.equal(seriesNamesAreCompatible('The Selection', 'Selection'), true);
assert.equal(seriesNamesAreCompatible('A Twisted Tale', 'Twisted Tale'), true);
assert.equal(seriesNamesAreCompatible('The Heart Duology', 'The Heart of Darkness'), false);

// Never infer a franchise alias or singular/plural equivalence without bibliographic evidence.
assert.equal(detectiveSeriesNamesCompatible('Disney: A Twisted Tale', 'Twisted Tales'), false);
assert.equal(detectiveSeriesNamesCompatible('Twisted Tales', 'A Twisted Tale'), false);
assert.equal(detectiveSeriesNamesCompatible('Unhinged Love Trilogy', 'Unhinged Love'), true);
assert.equal(detectiveSeriesNamesCompatible('The Heart Duology', 'The Heart'), true);
assert.equal(detectiveSeriesNamesCompatible('The Heart Duology', 'The Heart of Darkness'), false);
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Once Upon a Dream', 'A Twisted Tale'),
  'Twisted Tales',
), false);
assert.equal(hasExplicitDetectiveSeriesBrand(
  brandedFixture('Salt & Blood', 'A Hades and Persephone Romance'),
  'Hades x Persephone',
), false);
assert.equal(
  comparableDetectiveTitle("Conceal, Don't Feel (Disney: A Twisted Tale #6)"),
  comparableDetectiveTitle("Conceal, Don't Feel"),
);

// Work identity must include every known edition identifier, not only activeEditionId.
const queries = buildSeriesDetectionQueries(divergent);
assert.equal(queries.workQuery, 'Divergent Veronica Roth');
assert.deepEqual(new Set(queries.identifiers), new Set(['9780062024039', '0062024035', '9780007420421']));

// Common bibliographic series suffixes.
assert.deepEqual(inferDetectiveSeriesFromTitle('Example (Crown Trials, Book 2)'), {
  name: 'Crown Trials',
  position: 2,
});
assert.deepEqual(
  inferKnownDetectiveSeriesFromText('Example Book: Crown Trials #3', 'Crown Trials Series'),
  { name: 'Crown Trials', position: 3 },
);

// Provider naming variations must collapse to one series identity.
assert.equal(detectiveSeriesNamesCompatible('Hades x Persephone Saga', 'Hades & Persephone'), true);
assert.equal(detectiveSeriesNamesCompatible('The Harry Potter Series', 'Harry Potter'), true);
assert.equal(detectiveSeriesNamesCompatible('Hades x Persephone Saga', 'Adrian X Isolde'), false);
assert.equal(detectiveSeriesNamesCompatible('A Twisted Tale', 'Twisted Tale Series'), true);
assert.equal(detectiveSeriesNamesCompatible('Chronicles of the North', 'Chronicles of North'), false);

// Author normalization must understand "Last, First" without hardcoding an author.
assert.equal(canonicalDetectiveAuthor('Gilmore, Laurie'), 'laurie gilmore');
assert.equal(canonicalDetectiveAuthor('Laurie Gilmore'), 'laurie gilmore');
assert.equal(canonicalDetectiveAuthor('St. Clair, Scarlett'), 'scarlett st clair');
assert.equal(canonicalDetectiveAuthor('Scarlett St. Clair'), 'scarlett st clair');
assert.equal(detectiveAuthorsCompatible('Gilmore, Laurie', 'Laurie Gilmore'), true);
assert.equal(detectiveAuthorsCompatible('Neil Gaiman, Terry Pratchett', 'Neil Gaiman'), true);
assert.equal(detectiveAuthorsCompatible('Neil Gaiman, Terry Pratchett', 'Terry Pratchett'), true);
assert.equal(detectiveAuthorsCompatible('Neil Gaiman, Terry Pratchett', 'Someone Else'), false);

// Explicit publisher copy is bibliographic evidence, including ordinal words.
assert.deepEqual(
  inferKnownDetectiveSeriesFromDescription(
    'The Elite is the second book in The Selection series.',
    'Selection Series',
  ),
  { name: 'Selection Series', position: 2 },
);
assert.deepEqual(
  inferKnownDetectiveSeriesFromDescription(
    'A Touch of Ruin is the second novel in the Hades x Persephone Saga.',
    'Hades & Persephone',
  ),
  { name: 'Hades & Persephone', position: 2 },
);
assert.equal(
  inferKnownDetectiveSeriesFromDescription(
    'A sweeping story about a difficult selection process.',
    'Selection',
  ),
  null,
);

// Non-generic subtitles may provide context when we already know the series.
assert.equal(plausibleDetectiveSeriesSubtitle('A Twisted Tale'), 'A Twisted Tale');
assert.equal(plausibleDetectiveSeriesSubtitle('A Novel'), null);
assert.equal(plausibleDetectiveSeriesSubtitle('Illustrated Edition'), null);

assert.deepEqual(
  inferDetectiveSeriesFromTitle('Example (Crown Trials, Book Two)'),
  { name: 'Crown Trials', position: 2 },
);
assert.deepEqual(
  inferKnownDetectiveSeriesFromDescription(
    'Book Three of the Crown Trials series.',
    'Crown Trials',
  ),
  { name: 'Crown Trials', position: 3 },
);

assert.deepEqual(
  inferDetectiveSeriesFromDescription(
    'From the bestselling author comes the third book in the Vipers series, a dark hockey romance.',
  ),
  { name: 'Vipers', position: 3 },
);

assert.deepEqual(
  inferDetectiveSeriesFromDescription(
    'Book Two of the Crown Trials series.',
  ),
  { name: 'Crown Trials', position: 2 },
);

assert.equal(
  inferDetectiveSeriesFromDescription(
    'The third in a dark hockey romance series from a bestselling author.',
  ),
  null,
);

// Open Library exposes series membership as strings, sometimes with the
// installment number embedded and sometimes as a plain series name.
assert.deepEqual(
  parseDetectiveOpenLibrarySeries(['Hades x Persephone Saga, 2']),
  { name: 'Hades x Persephone Saga', position: 2 },
);
assert.deepEqual(
  parseDetectiveOpenLibrarySeries(['Selection series']),
  { name: 'Selection series', position: null },
);
assert.deepEqual(
  parseDetectiveOpenLibrarySeries(['Dream Harbor #3']),
  { name: 'Dream Harbor', position: 3 },
);
assert.deepEqual(
  parseDetectiveOpenLibrarySeries(['Dream Harbor, Book Three']),
  { name: 'Dream Harbor', position: 3 },
);

// A single provider's exact-ISBN record is not enough when its series label
// lacks bibliographic context. This blocks edition/translation labels from
// becoming canonical series identity merely because the ISBN is exact.
const weakEditionScopedSeries = scoreDetectiveEvidence({
  seriesName: 'Translated Collection -- tome 2',
  position: 2,
  title: 'Example Punishment',
  authors: ['Example Author'],
  isbn13: '9780991132379',
  sourceId: 'open-library',
  recordId: 'open-library:translated',
  providerId: 'open-library',
  providerCount: 1,
  structured: false,
  exactIdentifier: true,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([weakEditionScopedSeries]), null);

// Provider metadata is complementary. Google may know the exact edition
// while Open Library supplies the missing series relationship.
const mergedProviders = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    seriesName: undefined,
    position: null,
    work: {
      key: 'google-books:a-touch-of-ruin::scarlett-st-clair',
      title: 'A Touch of Ruin',
      authors: ['Scarlett St. Clair'],
      genres: ['Fiction'],
      publisherSummary: 'Google summary',
      editions: [{
        source: 'google-books',
        externalEditionId: 'google-ruin',
        title: 'A Touch of Ruin',
        authors: ['Scarlett St. Clair'],
        genres: ['Fiction'],
        publicationYear: 2020,
        format: 'paperback',
        isbn13: '9780991132379',
        pageCount: 448,
        coverUrl: 'https://example.test/google-cover.jpg',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'google-ruin',
      title: 'A Touch of Ruin',
      authors: ['Scarlett St. Clair'],
      genres: ['Fiction'],
      publicationYear: 2020,
      format: 'paperback',
      isbn13: '9780991132379',
      pageCount: 448,
      coverUrl: 'https://example.test/google-cover.jpg',
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    seriesName: 'Hades x Persephone Saga',
    position: 2,
    work: {
      key: 'open-library:/works/OL-ruin',
      title: 'A Touch of Ruin',
      authors: ['Scarlett St. Clair'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: '/books/OL-ruin',
        title: 'A Touch of Ruin',
        authors: ['Scarlett St. Clair'],
        genres: [],
        publicationYear: 2020,
        format: 'paperback',
        isbn13: '9780991132379',
        publisher: 'Bloom Books',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: '/books/OL-ruin',
      title: 'A Touch of Ruin',
      authors: ['Scarlett St. Clair'],
      genres: [],
      publicationYear: 2020,
      format: 'paperback',
      isbn13: '9780991132379',
      publisher: 'Bloom Books',
      specialFeatures: [],
    },
  },
]);

assert.equal(mergedProviders.length, 1);
assert.equal(mergedProviders[0].seriesName, 'Hades x Persephone Saga');
assert.equal(mergedProviders[0].position, 2);
assert.equal(mergedProviders[0].edition.pageCount, 448);
assert.equal(mergedProviders[0].edition.publisher, 'Bloom Books');
assert.equal(mergedProviders[0].edition.coverUrl, 'https://example.test/google-cover.jpg');
assert.equal(mergedProviders[0].work.publisherSummary, 'Google summary');

// Different ISBNs are editions of the same work, not fields to flatten into
// one fake edition. Work/series evidence may merge while editions remain distinct.
const differentEditionMerge = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    seriesName: undefined,
    position: null,
    work: {
      key: 'google-books:the-elite::kiera-cass',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'google-elite-hardcover',
        title: 'The Elite',
        authors: ['Kiera Cass'],
        genres: [],
        publicationYear: 2013,
        format: 'hardcover',
        isbn13: '9780062059963',
        pageCount: 336,
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'google-elite-hardcover',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      publicationYear: 2013,
      format: 'hardcover',
      isbn13: '9780062059963',
      pageCount: 336,
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    seriesName: 'Selection series',
    position: 2,
    work: {
      key: 'open-library:/works/OL-elite',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: '/books/OL-elite-paperback',
        title: 'The Elite',
        authors: ['Kiera Cass'],
        genres: [],
        publicationYear: 2014,
        format: 'paperback',
        isbn13: '9780062059994',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: '/books/OL-elite-paperback',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      publicationYear: 2014,
      format: 'paperback',
      isbn13: '9780062059994',
      specialFeatures: [],
    },
  },
]);

assert.equal(differentEditionMerge.length, 1);
assert.equal(differentEditionMerge[0].seriesName, 'Selection series');
assert.equal(differentEditionMerge[0].position, 2);
assert.equal(differentEditionMerge[0].work.editions.length, 2);

// Hardcover can supply the series relationship when Google is metadata-thin.
const googleHardcoverMerge = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    seriesName: undefined,
    position: null,
    work: {
      key: 'google-books:the-elite::kiera-cass',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'google-elite',
        title: 'The Elite',
        authors: ['Kiera Cass'],
        genres: [],
        publicationYear: 2013,
        format: 'hardcover',
        isbn13: '9780062059963',
        pageCount: 336,
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'google-elite',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      publicationYear: 2013,
      format: 'hardcover',
      isbn13: '9780062059963',
      pageCount: 336,
      specialFeatures: [],
    },
  },
  {
    provider: 'hardcover',
    seriesName: 'The Selection',
    position: 2,
    seriesProvider: 'hardcover',
    seriesStructured: true,
    work: {
      key: 'hardcover:elite',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      editions: [{
        source: 'hardcover',
        externalEditionId: 'hc-elite',
        title: 'The Elite',
        authors: ['Kiera Cass'],
        genres: [],
        publicationYear: 2013,
        format: 'hardcover',
        isbn13: '9780062059963',
        publisher: 'HarperTeen',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'hardcover',
      externalEditionId: 'hc-elite',
      title: 'The Elite',
      authors: ['Kiera Cass'],
      genres: [],
      publicationYear: 2013,
      format: 'hardcover',
      isbn13: '9780062059963',
      publisher: 'HarperTeen',
      specialFeatures: [],
    },
  },
]);

assert.equal(googleHardcoverMerge.length, 1);
assert.equal(googleHardcoverMerge[0].seriesName, 'The Selection');
assert.equal(googleHardcoverMerge[0].position, 2);
assert.equal(googleHardcoverMerge[0].edition.pageCount, 336);
assert.equal(googleHardcoverMerge[0].edition.publisher, 'HarperTeen');

// Provider agreement must survive canonical merging so contextual series
// evidence can distinguish one provider guess from independent corroboration.
assert.deepEqual(
  new Set(mergedProviders[0].providerSources),
  new Set(['google-books', 'open-library']),
);

// Provider-native work IDs can identify alternate titles within the same
// namespace. A shared ISBN across providers is edition evidence, not proof
// that differently titled literary works are the same installment.
const identityFixture = mergedProviders[0];
const sameProviderAlternateTitle = mergeDetectiveCandidates([
  { ...identityFixture, provider: 'google-books', providerSources: ['google-books'],
    work: { ...identityFixture.work, key: 'google-books:work-42', title: 'Original Title' },
    edition: { ...identityFixture.edition, source: 'google-books', externalEditionId: 'edition-a', isbn13: undefined, isbn10: undefined },
    seriesStructured: true },
  { ...identityFixture, provider: 'google-books', providerSources: ['google-books'],
    work: { ...identityFixture.work, key: 'google-books:work-42', title: 'Alternate Title' },
    edition: { ...identityFixture.edition, source: 'google-books', externalEditionId: 'edition-b', isbn13: undefined, isbn10: undefined },
    seriesStructured: true },
]);
assert.equal(sameProviderAlternateTitle.length, 2,
  'A recycled provider work ID must not merge differently titled works');
assert.deepEqual(
  new Set(sameProviderAlternateTitle.map(candidate => candidate.work.title)),
  new Set(['Original Title', 'Alternate Title']),
);

const sharedIsbnAlternateTitle = mergeDetectiveCandidates([
  { ...identityFixture, provider: 'google-books', providerSources: ['google-books'],
    work: { ...identityFixture.work, key: 'google-books:one', title: 'Original Title' },
    edition: { ...identityFixture.edition, source: 'google-books', externalEditionId: 'edition-c', isbn13: '9780991132379' },
    seriesStructured: true },
  { ...identityFixture, provider: 'open-library', providerSources: ['open-library'],
    work: { ...identityFixture.work, key: 'open-library:two', title: 'Alternate Title' },
    edition: { ...identityFixture.edition, source: 'open-library', externalEditionId: 'edition-d', isbn13: '9780991132379' },
    seriesStructured: true },
]);
assert.equal(sharedIsbnAlternateTitle.length, 2,
  'Different titles sharing an ISBN must remain separate works');
assert.deepEqual(
  new Set(sharedIsbnAlternateTitle.map(candidate => candidate.work.title)),
  new Set(['Original Title', 'Alternate Title']),
);

// Shared franchise prefixes are not work identity. Distinct installments by
// the same author must never collapse just because one title starts with the
// other's words.
const sharedPrefixDistinct = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    position: 1,
    seriesName: 'Harry Potter',
    seriesProvider: 'google-books',
    seriesStructured: true,
    work: {
      key: 'hp-1',
      title: "Harry Potter and the Sorcerer's Stone",
      authors: ['J. K. Rowling'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'hp-ed-1',
        title: "Harry Potter and the Sorcerer's Stone",
        authors: ['J. K. Rowling'],
        genres: [],
        publicationYear: 1998,
        format: 'hardcover',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'hp-ed-1',
      title: "Harry Potter and the Sorcerer's Stone",
      authors: ['J. K. Rowling'],
      genres: [],
      publicationYear: 1998,
      format: 'hardcover',
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    position: 2,
    seriesName: 'Harry Potter Series',
    seriesProvider: 'open-library',
    seriesStructured: true,
    work: {
      key: 'hp-2',
      title: 'Harry Potter and the Chamber of Secrets',
      authors: ['J. K. Rowling'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: 'hp-ed-2',
        title: 'Harry Potter and the Chamber of Secrets',
        authors: ['J. K. Rowling'],
        genres: [],
        publicationYear: 1999,
        format: 'hardcover',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: 'hp-ed-2',
      title: 'Harry Potter and the Chamber of Secrets',
      authors: ['J. K. Rowling'],
      genres: [],
      publicationYear: 1999,
      format: 'hardcover',
      specialFeatures: [],
    },
  },
]);
assert.equal(sharedPrefixDistinct.length, 2);

// A provider omitting a colon subtitle is still the same work.
const colonSubtitleMerge = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    position: 1,
    work: {
      key: 'colon-1',
      title: 'The Atlas',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'colon-ed-1',
        title: 'The Atlas',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'hardcover',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'colon-ed-1',
      title: 'The Atlas',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'hardcover',
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    position: 1,
    work: {
      key: 'colon-2',
      title: 'The Atlas: A Novel',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: 'colon-ed-2',
        title: 'The Atlas: A Novel',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'paperback',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: 'colon-ed-2',
      title: 'The Atlas: A Novel',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'paperback',
      specialFeatures: [],
    },
  },
]);
assert.equal(colonSubtitleMerge.length, 1);

// Equal-strength providers that disagree on installment number preserve the
// series identity but do not invent an order.
const conflictingOrder = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    seriesName: 'Example Saga',
    position: 2,
    seriesProvider: 'google-books',
    seriesStructured: true,
    work: {
      key: 'order-example',
      title: 'Order Example',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'order-g',
        title: 'Order Example',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'hardcover',
        isbn13: '9780000000111',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'order-g',
      title: 'Order Example',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'hardcover',
      isbn13: '9780000000111',
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    seriesName: 'Example Saga Series',
    position: 3,
    seriesProvider: 'open-library',
    seriesStructured: true,
    work: {
      key: 'order-example-ol',
      title: 'Order Example',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: 'order-ol',
        title: 'Order Example',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'paperback',
        isbn13: '9780000000111',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: 'order-ol',
      title: 'Order Example',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'paperback',
      isbn13: '9780000000111',
      specialFeatures: [],
    },
  },
]);
assert.equal(conflictingOrder.length, 1);
assert.equal(detectiveSeriesNamesCompatible(conflictingOrder[0].seriesName, 'Example Saga'), true);
assert.equal(conflictingOrder[0].position, null);
assert.equal(conflictingOrder[0].seriesStructured, false, 'Conflicting structured installment numbers must remain review-only');

// Bibliographic suffixes may vary by provider without splitting one work.
const suffixMerge = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    position: null,
    work: {
      key: 'google:example',
      title: 'Example Story',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'g-example',
        title: 'Example Story',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'hardcover',
        isbn13: '9780062059963',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'g-example',
      title: 'Example Story',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'hardcover',
      isbn13: '9780062059963',
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    seriesName: 'Example Saga',
    position: 2,
    seriesProvider: 'open-library',
    seriesStructured: true,
    work: {
      key: 'open:example',
      title: 'Example Story (Example Saga, Book 2)',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: 'ol-example',
        title: 'Example Story (Example Saga, Book 2)',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'paperback',
        isbn13: '9780991132379',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: 'ol-example',
      title: 'Example Story (Example Saga, Book 2)',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'paperback',
      isbn13: '9780991132379',
      specialFeatures: [],
    },
  },
]);
assert.equal(suffixMerge.length, 1);
assert.equal(suffixMerge[0].seriesName, 'Example Saga');
assert.equal(suffixMerge[0].work.editions.length, 2);

// A reused/bad ISBN must never collapse unrelated works by the same author.
const sharedBadIsbn = mergeDetectiveCandidates([
  {
    provider: 'google-books',
    position: null,
    work: {
      key: 'google:first',
      title: 'First Story',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'google-books',
        externalEditionId: 'g-first',
        title: 'First Story',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2020,
        format: 'hardcover',
        isbn13: '9780000000999',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'google-books',
      externalEditionId: 'g-first',
      title: 'First Story',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2020,
      format: 'hardcover',
      isbn13: '9780000000999',
      specialFeatures: [],
    },
  },
  {
    provider: 'open-library',
    seriesName: 'Other Saga',
    position: 3,
    seriesProvider: 'open-library',
    seriesStructured: true,
    work: {
      key: 'open:second',
      title: 'Completely Different Story',
      authors: ['Example Author'],
      genres: [],
      editions: [{
        source: 'open-library',
        externalEditionId: 'ol-second',
        title: 'Completely Different Story',
        authors: ['Example Author'],
        genres: [],
        publicationYear: 2021,
        format: 'paperback',
        isbn13: '9780000000999',
        specialFeatures: [],
      }],
    },
    edition: {
      source: 'open-library',
      externalEditionId: 'ol-second',
      title: 'Completely Different Story',
      authors: ['Example Author'],
      genres: [],
      publicationYear: 2021,
      format: 'paperback',
      isbn13: '9780000000999',
      specialFeatures: [],
    },
  },
]);
assert.equal(sharedBadIsbn.length, 2);

// Provider naming aliases must also collapse in the actual Series library,
 // not only inside Detective evidence comparison.
const aliasBookOne = {
  id: 'hades-1',
  work: {
    title: 'A Touch of Darkness',
    author: 'Scarlett St. Clair',
    seriesName: 'Hades x Persephone Saga',
    seriesOrder: 1,
    publicationYear: 2019,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'hades-ed-1', format: 'paperback' }],
  activeEditionId: 'hades-ed-1',
} as unknown as UserBookRecord;
const aliasBookTwo = {
  id: 'hades-2',
  work: {
    title: 'A Touch of Ruin',
    author: 'Scarlett St. Clair',
    seriesName: 'Hades & Persephone',
    seriesOrder: 2,
    publicationYear: 2020,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'hades-ed-2', format: 'paperback' }],
  activeEditionId: 'hades-ed-2',
} as unknown as UserBookRecord;
const aliasSeries = buildSeriesLibrary([aliasBookOne, aliasBookTwo]);
assert.equal(aliasSeries.length, 1);
assert.equal(aliasSeries[0].books.length, 2);
assert.equal(aliasSeries[0].books[0].position, 1);
assert.equal(aliasSeries[0].books[1].position, 2);

// Canonical publisher/shared-world series must not split just because authors differ.
const multiAuthorOne = {
  id: 'twisted-1',
  work: {
    title: "Conceal, Don't Feel",
    author: 'Jen Calonita',
    seriesName: 'A Twisted Tale',
    seriesOrder: 7,
    publicationYear: 2019,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'twisted-ed-1', format: 'paperback' }],
  activeEditionId: 'twisted-ed-1',
} as unknown as UserBookRecord;
const multiAuthorTwo = {
  id: 'twisted-2',
  work: {
    title: 'As Old as Time',
    author: 'Liz Braswell',
    seriesName: 'A Twisted Tale Series',
    seriesOrder: 3,
    publicationYear: 2016,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'twisted-ed-2', format: 'paperback' }],
  activeEditionId: 'twisted-ed-2',
} as unknown as UserBookRecord;
const multiAuthorSeries = buildSeriesLibrary([multiAuthorOne, multiAuthorTwo]);
assert.equal(multiAuthorSeries.length, 1);
assert.equal(multiAuthorSeries[0].books.length, 2);
assert.equal(multiAuthorSeries[0].author, 'Various authors');

// Shared-world series may span many authors. Numbered, non-conflicting
// metadata should group them without replacing each book's author.
const sharedWorldBooks = [
  ['Lethal', 'A.L. Maruga', 1],
  ['Writhe', 'K.T. Maddan', 2],
  ['Exposed', 'Audrey Rush', 3],
  ['Lonely', 'Harleigh Beck', 4],
  ['Atrocity', 'Nova Kane', 5],
].map(([title, author, position], index) => ({
  id: `shared-world-${index}`,
  work: { title, author, seriesName: 'Wellard Asylum Series', seriesOrder: position, publicationYear: 2024 },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: `shared-world-edition-${index}`, format: 'ebook' }],
  activeEditionId: `shared-world-edition-${index}`,
} as unknown as UserBookRecord));
const sharedWorldSeries = buildSeriesLibrary(sharedWorldBooks);
assert.equal(sharedWorldSeries.length, 1, 'Verified numbered multi-author series should stay together.');
assert.equal(sharedWorldSeries[0].books.length, 5);
assert.equal(sharedWorldSeries[0].author, 'Various authors');
assert.deepEqual(sharedWorldSeries[0].books.map(({ book }) => book.work.author),
  ['A.L. Maruga', 'K.T. Maddan', 'Audrey Rush', 'Harleigh Beck', 'Nova Kane']);

// Same-name series from different authors remain separate when their explicit
// installment positions conflict. This prevents a generic reused series name
// from becoming a cross-author identity by accident.
const collisionOne = {
  id: 'collision-1',
  work: {
    title: 'First Collision Book',
    author: 'Author One',
    seriesName: 'Legacy',
    seriesOrder: 1,
    publicationYear: 2020,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'collision-ed-1', format: 'paperback' }],
  activeEditionId: 'collision-ed-1',
} as unknown as UserBookRecord;
const collisionTwo = {
  id: 'collision-2',
  work: {
    title: 'Other Collision Book',
    author: 'Author Two',
    seriesName: 'Legacy Series',
    seriesOrder: 1,
    publicationYear: 2021,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'collision-ed-2', format: 'paperback' }],
  activeEditionId: 'collision-ed-2',
} as unknown as UserBookRecord;
assert.equal(buildSeriesLibrary([collisionOne, collisionTwo]).length, 2);

const collisionDifferentPositions = buildSeriesLibrary([
  collisionOne,
  {
    ...collisionTwo,
    id: 'collision-3',
    work: { ...collisionTwo.work, seriesOrder: 2 },
  },
]);
assert.equal(collisionDifferentPositions.length, 2);

// A branded title with no installment number is not proof of membership.
assert.equal(inferDetectiveSeriesFromTitle('Disney A Twisted Tale'), null);

// Same work with/without a bibliographic suffix must merge; unrelated works
// sharing an ISBN must remain separate.
// Strong structured exact-work evidence can verify one book.
const strong = scoreDetectiveEvidence({
  seriesName: 'Dream Harbor',
  position: 2,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  sourceId: 'isbn-query',
  recordId: 'google-volume-1',
  providerId: 'google-books',
  structured: true,
  exactIdentifier: true,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([strong])?.seriesName, 'Dream Harbor');

// A single title-inferred record is never enough.
const weak = scoreDetectiveEvidence({
  seriesName: 'Dream Harbor',
  position: 2,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  sourceId: 'title-query',
  recordId: 'google-volume-2',
  providerId: 'google-books',
  structured: false,
  exactIdentifier: false,
  exactTitle: true,
  exactAuthor: true,
});
assert.equal(selectVerifiedDetectiveEvidence([weak]), null);

// Repeating the SAME provider record through another query must not fake corroboration.
const duplicateQueryHit = { ...weak, sourceId: 'second-query' };
assert.equal(selectVerifiedDetectiveEvidence([weak, duplicateQueryHit]), null);

// Two genuinely distinct exact-work records can corroborate title-inferred metadata.
const distinctEdition = { ...weak, sourceId: 'isbn-query', recordId: 'google-volume-3' };
assert.equal(selectVerifiedDetectiveEvidence([weak, distinctEdition]), null);

const secondProvider = {
  ...weak,
  sourceId: 'open-library',
  recordId: 'open-library-volume-1',
  providerId: 'open-library',
};
assert.equal(selectVerifiedDetectiveEvidence([weak, secondProvider])?.seriesName, 'Dream Harbor');

// Wrong-author metadata must not verify an inferred relationship.
const wrongAuthor = scoreDetectiveEvidence({
  ...weak,
  recordId: 'google-volume-4',
  providerId: 'google-books',
  authors: ['Someone Else'],
  exactAuthor: false,
});
assert.equal(selectVerifiedDetectiveEvidence([wrongAuthor]), null);

// Beta #001: the two Karin Slaughter series must retain distinct identities.
assert.equal(detectiveSeriesNamesCompatible('Grant County', 'Will Trent'), false);
assert.equal(detectiveSeriesNamesCompatible('Grant County', 'Grant County Series'), true);
assert.deepEqual(parseDetectiveOpenLibrarySeries(['Grant County (#1)']), {
  name: 'Grant County', position: 1,
});
assert.deepEqual(parseDetectiveOpenLibrarySeries(['Will Trent, Book Three']), {
  name: 'Will Trent', position: 3,
});
// Catalog edition suffixes are stripped only when the requested series agrees.
assert.equal(comparableDetectiveTitle('Tending to the Rot (High Crest Chronicles 1)', 'High Crest Chronicles'), comparableDetectiveTitle('Tending to the Rot'));
assert.notEqual(comparableDetectiveTitle('Tending to the Rot (High Crest Chronicles 1)', 'Grant County'), comparableDetectiveTitle('Tending to the Rot'));

// Multi-series Google volumes must not authorize unrelated sibling series IDs.
const googleMembershipCatalog = { items: [], seriesTitlesById: { correct: 'Grant County', wrong: 'Will Trent' } };
const googleMultiMembership = { volumeInfo: { seriesInfo: { volumeSeries: [
  { seriesId: 'correct', orderNumber: 1 }, { seriesId: 'wrong', orderNumber: 2 },
] } } };
assert.deepEqual(confirmedGoogleMembershipIds(googleMultiMembership, googleMembershipCatalog, 'Grant County', true), ['correct']);
assert.deepEqual(confirmedGoogleMembershipIds(googleMultiMembership, googleMembershipCatalog, 'Unrelated Series', true), []);
const unnamedMulti = { items: [], seriesTitlesById: {} };
assert.deepEqual(confirmedGoogleMembershipIds(googleMultiMembership, unnamedMulti, 'Grant County', true), []);
assert.deepEqual(confirmedGoogleMembershipIds({ volumeInfo: { seriesInfo: { volumeSeries: [
  { seriesId: 'single' }, { seriesId: 'single' },
] } } }, unnamedMulti, 'Grant County', true), ['single']);
assert.deepEqual(confirmedGoogleMembershipIds({ volumeInfo: { seriesInfo: { volumeSeries: [
  { seriesId: 'single' },
] } } }, unnamedMulti, 'Grant County', false), []);

// A reused provider edition ID with contradictory ISBNs must never create
// a synthetic edition containing identifiers from two different books.
const reusedEditionOne = { ...identityFixture.edition, source: 'google-books' as const,
  externalEditionId: 'reused-edition', isbn13: '9780062059963', isbn10: undefined };
const reusedEditionTwo = { ...identityFixture.edition, source: 'google-books' as const,
  externalEditionId: 'reused-edition', isbn13: '9780991132379', isbn10: undefined };
const reusedProviderEditionId = mergeDetectiveCandidates([
  { ...identityFixture, provider: 'google-books', providerSources: ['google-books'],
    work: { ...identityFixture.work, key: 'google-books:reused-id', title: 'Same Work', editions: [reusedEditionOne] },
    edition: reusedEditionOne },
  { ...identityFixture, provider: 'google-books', providerSources: ['google-books'],
    work: { ...identityFixture.work, key: 'google-books:reused-id', title: 'Same Work', editions: [reusedEditionTwo] },
    edition: reusedEditionTwo },
]);
assert.equal(reusedProviderEditionId.length, 1);
assert.equal(reusedProviderEditionId[0].work.editions.length, 2);
assert.deepEqual(new Set(reusedProviderEditionId[0].work.editions.map(edition => edition.isbn13)),
  new Set(['9780062059963', '9780991132379']));

// Open Library publisher collection numbers must not masquerade as literary series.
assert.equal(plausibleOpenLibrarySeriesName('rororo 23230'), false);
assert.equal(plausibleOpenLibrarySeriesName('Sara Linton'), true);
assert.equal(plausibleOpenLibrarySeriesName('The Shining'), true);
assert.equal(parseDetectiveOpenLibrarySeries(['Sara Linton #1'])?.position, 1);

// V2 offline replay: evidence is source-attributed, order-independent, and
// never converts one provider's repeated assertions into corroboration.
const { replayDetectiveEvidence } = await import('../src/features/series/seriesDetectiveReplay');
const replayClaims = [
  { id: 'google:work-1:membership', provider: 'google-books' as const,
    sourceRecordId: 'g1', kind: 'series-membership' as const,
    subjectId: 'work-1', objectId: 'series-1', value: 'Example Series',
    structured: true, sourceField: 'volumeInfo.seriesInfo' },
  { id: 'hardcover:work-1:membership', provider: 'hardcover' as const,
    sourceRecordId: 'h1', kind: 'series-membership' as const,
    subjectId: 'work-1', objectId: 'series-1', value: 'Example Series',
    structured: true, sourceField: 'series.id' },
];
const replayObservations = [
  { provider: 'google-books' as const, operation: 'seed', state: 'ok' as const, recordCount: 1 },
  { provider: 'hardcover' as const, operation: 'seed', state: 'ok' as const, recordCount: 1 },
];
const replayInput = { seedBookId: 'seed-1', observations: replayObservations, claims: replayClaims };
const replayA = replayDetectiveEvidence(replayInput);
const replayB = replayDetectiveEvidence({ ...replayInput,
  claims: [...replayClaims].reverse(), observations: [...replayObservations].reverse() });
assert.deepEqual(replayA, replayB, 'Provider ordering must not change evidence replay');
assert.equal(replayA.decisions[0].status, 'verified');
assert.equal(replayDetectiveEvidence({ ...replayInput, claims: [replayClaims[0]] }).decisions[0].status, 'review');
assert.equal(replayDetectiveEvidence({ ...replayInput, claims: [replayClaims[0],
  { ...replayClaims[0], id: 'google:work-1:duplicate', sourceRecordId: 'g2' }] }).decisions[0].status, 'review');
const conflictingReplay = replayDetectiveEvidence({ ...replayInput, claims: [replayClaims[0],
  { ...replayClaims[1], objectId: 'unrelated-series' }] });
assert.equal(conflictingReplay.decisions[0].status, 'review');
assert.ok(conflictingReplay.decisions[0].reasonCodes.includes('conflicting-evidence'));
const outageReplay = replayDetectiveEvidence({ ...replayInput,
  observations: [{ provider: 'hardcover', operation: 'seed', state: 'unavailable', recordCount: 0 }],
  claims: [replayClaims[0]] });
assert.equal(outageReplay.decisions.length, 1);
assert.equal(outageReplay.decisions[0].status, 'review');
assert.deepEqual(outageReplay.decisions[0].supportingClaimIds, []);
assert.ok(outageReplay.decisions[0].reasonCodes.includes('provider-unavailable'));
assert.deepEqual(outageReplay.quarantinedClaimIds, ['google:work-1:membership']);
assert.equal(replayDetectiveEvidence({ ...replayInput, claims: [] }).decisions.length, 0);

const { classifyDetectiveSeriesLabel } = await import('../src/features/series/seriesDetectiveLabelClassifier');
for (const label of ['rororo 23230', 'rororo ; 23230', 'Fischer Taschenbuch 12345', 'Heyne 43/123', 'Penguin Books Ltd']) {
  assert.equal(classifyDetectiveSeriesLabel(label), 'publisher-collection', label);
}
for (const label of ['Grant County', 'Hades x Persephone', 'A Twisted Tale', 'The Shining']) {
  assert.equal(classifyDetectiveSeriesLabel(label), 'literary-candidate', label);
}
const publisherReplay = replayDetectiveEvidence({ ...replayInput,
  claims: replayClaims.map(claim => ({ ...claim, value: 'rororo 23230' })) });
assert.equal(publisherReplay.decisions[0].status, 'rejected');
assert.ok(publisherReplay.decisions[0].reasonCodes.includes('publisher-collection'));


 
// Production canonical gate: corroborated membership must remain distinct
// from disputed reading order. Never promote a single-provider claim.
import { verifyCanonicalProductionMembership } from '../src/features/series/seriesDetectiveCanonicalAdapter';
import { decideDetectiveMembership } from '../src/features/series/seriesDetectiveDecision';
import { corroborateDetectiveMembership, hasCorroboratedOwnedSeed } from '../src/features/series/seriesDetectiveCorroboration';
import type { DetectiveMergeCandidate } from '../src/features/series/seriesDetectiveMerge';
const nativeSeriesFixture = (
  provider: DetectiveMergeCandidate['provider'],
  title: string,
  isbn13: string,
  position: number,
): DetectiveMergeCandidate => ({
  provider,
  seriesProvider: provider,
  seriesStructured: true,
  seriesName: 'Maple Hills',
  position,
  work: { key: provider + ':' + title, title, authors: ['Hannah Grace'], genres: [], editions: [] },
  edition: {
    source: provider, externalEditionId: provider + ':' + title, title,
    authors: ['Hannah Grace'], genres: [], publicationYear: 2023,
    format: 'ebook', isbn13, specialFeatures: [],
  },
} as DetectiveMergeCandidate);
const structuredSeriesEvidence = [
  nativeSeriesFixture('open-library', 'Icebreaker', '9781668026038', 1),
  nativeSeriesFixture('hardcover', 'Icebreaker', '9781668026038', 1),
  nativeSeriesFixture('open-library', 'Wildfire', '9781668026274', 2),
  nativeSeriesFixture('hardcover', 'Wildfire', '9781668026274', 3),
];
const canonicalWithDisputedOrder = verifyCanonicalProductionMembership(
  structuredSeriesEvidence, structuredSeriesEvidence[2],
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
);
assert.equal(canonicalWithDisputedOrder.verified, false,
  'Conflicting provider reading orders must never be automatically verified');
assert.equal(canonicalWithDisputedOrder.conflicting, true);
assert.equal(canonicalWithDisputedOrder.agreedPosition, null);
const disputedOrder = corroborateDetectiveMembership(
  structuredSeriesEvidence, structuredSeriesEvidence[2], 'Maple Hills',
);
assert.equal(disputedOrder.providers, 2);
assert.equal(disputedOrder.conflictingOrder, true);
assert.equal(disputedOrder.agreedPosition, null);
assert.equal(verifyCanonicalProductionMembership(
  structuredSeriesEvidence.filter(candidate => candidate.provider === 'open-library'),
  structuredSeriesEvidence[2], [{ title: 'Icebreaker', author: 'Hannah Grace' }],
  'Maple Hills',
).verified, false);

const unifiedDecision = decideDetectiveMembership(
  structuredSeriesEvidence, structuredSeriesEvidence[2],
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
);
assert.deepEqual(unifiedDecision, {
  verification: 'review', position: null, conflictingOrder: true,
});
const singleProviderDecision = decideDetectiveMembership(
  structuredSeriesEvidence.filter(candidate => candidate.provider === 'open-library'),
  structuredSeriesEvidence[2], [{ title: 'Icebreaker', author: 'Hannah Grace' }],
  'Maple Hills',
);
assert.equal(singleProviderDecision.verification, 'review');

const agreeingSeriesEvidence = structuredSeriesEvidence.map(candidate =>
  candidate.work.title === 'Wildfire' ? { ...candidate, position: 2 } : candidate);
assert.deepEqual(decideDetectiveMembership(
  agreeingSeriesEvidence, agreeingSeriesEvidence[2],
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
), { verification: 'verified', position: 2, conflictingOrder: false });

 
// Wikidata is an independent provider namespace, not a duplicate vote for
// multiple rows from one P179 statement. The inspector must not mutate data.
import { inspectDetectiveEvidence } from '../src/features/series/seriesDetectiveEvidenceInspector';
const wikidataClaim = {
  ...structuredSeriesEvidence[2],
  provider: 'wikidata' as const,
  seriesProvider: 'wikidata' as const,
  nativeSeriesId: 'Q123456',
  evidenceOrigin: 'wikidata:P179',
};
const wikidataInspection = inspectDetectiveEvidence(
  [structuredSeriesEvidence[0], structuredSeriesEvidence[1], wikidataClaim],
  wikidataClaim,
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
);
assert.equal(wikidataInspection.verification, 'review');
assert.equal(wikidataInspection.providerClaims.length, 1);
assert.equal(wikidataInspection.providerClaims[0].nativeSeriesId, 'Q123456');
assert.ok(wikidataInspection.reasons.some(reason => reason.includes('two structured')));

// A known series must appear as a contiguous phrase in a description.
// Separate occurrences of its component words are not series evidence.
assert.equal(inferKnownDetectiveSeriesFromDescription(
  'Will the detective finally find Trent after the investigation?', 'Will Trent',
), null);
assert.deepEqual(inferKnownDetectiveSeriesFromDescription(
  'The third book in the Will Trent series.', 'Will Trent',
), { name: 'Will Trent', position: 3 });

// Empty provider author placeholders must not authenticate a work merge.
const missingAuthorMerge = mergeDetectiveCandidates([
  { ...identityFixture, work: { ...identityFixture.work, authors: [''] } },
  { ...identityFixture, work: { ...identityFixture.work, authors: ['Scarlett St. Clair'] } },
]);
assert.equal(missingAuthorMerge.length, 2);

// Distinct series titles must not collapse by discarding conjunctions.
assert.equal(detectiveSeriesNamesCompatible('War and Peace', 'War Peace'), false);
assert.equal(detectiveSeriesNamesCompatible('X and Y', 'Y'), false);
assert.equal(detectiveSeriesNamesCompatible('The Maple Hills Series', 'Maple Hills'), true);
assert.equal(detectiveSeriesNamesCompatible('Hades x Persephone Saga', 'Hades & Persephone'), true);

// Conjunction variants must also work in description evidence, not just labels.
assert.deepEqual(inferKnownDetectiveSeriesFromDescription(
  'The second book in the Hades x Persephone Saga.', 'Hades & Persephone',
), { name: 'Hades & Persephone', position: 2 });
assert.equal(inferKnownDetectiveSeriesFromDescription(
  'A history of Warfare and Peacekeeping, book 2.', 'War and Peace',
), null);

// Contradictory high-confidence claims must be review-only, not score-winners.
assert.equal(selectVerifiedDetectiveEvidence([
  strong,
  scoreDetectiveEvidence({ ...strong, position: 3, providerId: 'open-library', recordId: 'ol-conflict' }),
]), null);
assert.equal(selectVerifiedDetectiveEvidence([
  strong,
  scoreDetectiveEvidence({ ...strong, seriesName: 'Another Harbor', providerId: 'open-library', recordId: 'ol-series-conflict' }),
]), null);
// Unknown order does not contradict an otherwise supported known position.
assert.equal(selectVerifiedDetectiveEvidence([
  strong,
  scoreDetectiveEvidence({ ...strong, position: null, providerId: 'open-library', recordId: 'ol-unknown-order' }),
])?.position, 2);

// Conjunction normalization must consume actual whitespace (not literal backslashes).
assert.deepEqual(inferKnownDetectiveSeriesFromDescription(
  'Hades & Persephone is the second book in the saga.', 'Hades x Persephone',
), { name: 'Hades x Persephone', position: null });

// A position for a different series in the same blurb cannot leak into this one.
assert.deepEqual(inferKnownDetectiveSeriesFromDescription(
  'Book 4 in the Other World series. Also recommended for Will Trent readers.', 'Will Trent',
), { name: 'Will Trent', position: null });
assert.deepEqual(inferKnownDetectiveSeriesFromDescription(
  'The third book in the Will Trent series.', 'Will Trent',
), { name: 'Will Trent', position: 3 });

// Matching ISBN-13 with conflicting ISBN-10 is not a safe edition merge.
const isbnConflictBase = {
  ...identityFixture,
  provider: 'google-books' as const,
  work: { ...identityFixture.work, editions: [] },
  edition: { ...identityFixture.edition, source: 'google-books' as const,
    externalEditionId: 'conflict-a', isbn13: '9780991132379', isbn10: '0991132378' },
};
const isbnConflictMerge = mergeDetectiveCandidates([
  { ...isbnConflictBase, work: { ...isbnConflictBase.work,
    editions: [isbnConflictBase.edition] } },
  { ...isbnConflictBase, provider: 'open-library',
    edition: { ...isbnConflictBase.edition, source: 'open-library',
      externalEditionId: 'conflict-b', isbn10: '099113237X' } },
]);
assert.equal(isbnConflictMerge.length, 1);
assert.equal(isbnConflictMerge[0].work.editions.length, 2);

// Blank author placeholders cannot anchor an owned series across providers.
assert.equal(hasCorroboratedOwnedSeed(
  structuredSeriesEvidence, [{ title: 'Icebreaker', author: '' }], 'Maple Hills',
), false);
assert.equal(verifyCanonicalProductionMembership(
  structuredSeriesEvidence, structuredSeriesEvidence[2],
  [{ title: 'Icebreaker', author: '' }], 'Maple Hills',
).verified, false);
assert.equal(hasCorroboratedOwnedSeed(
  structuredSeriesEvidence, [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
), true);

// A catalog's secondary ISBN-10 is still independent edition evidence.
// The canonical gate must not ignore it merely because ISBN-13 is populated.
const secondaryIsbnEvidence = agreeingSeriesEvidence.map(candidate => ({
  ...candidate,
  edition: { ...candidate.edition,
    isbn13: candidate.provider === 'open-library' ? '9781668026038' : undefined,
    isbn10: candidate.provider === 'hardcover' ? '1668026031' : undefined,
  },
}));
// Different ISBN formats are not interchangeable without validated conversion.
assert.equal(verifyCanonicalProductionMembership(
  secondaryIsbnEvidence, secondaryIsbnEvidence[2],
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
).verified, false);
const sharedSecondaryIsbnEvidence = agreeingSeriesEvidence.map(candidate => ({
  ...candidate,
  edition: { ...candidate.edition,
    isbn13: candidate.provider === 'hardcover' ? undefined : candidate.edition.isbn13,
    isbn10: candidate.work.title === 'Icebreaker' ? '1668026031' : '1668026279',
  },
}));
assert.equal(verifyCanonicalProductionMembership(
  sharedSecondaryIsbnEvidence, sharedSecondaryIsbnEvidence[2],
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
).verified, true);

// A blank leading author in one catalog must not conceal a real author.
const blankLeadingAuthorEvidence = agreeingSeriesEvidence.map(candidate => ({
  ...candidate,
  work: { ...candidate.work, authors: candidate.provider === 'hardcover'
    ? ['', 'Hannah Grace'] : ['Hannah Grace'] },
}));
assert.equal(verifyCanonicalProductionMembership(
  blankLeadingAuthorEvidence, blankLeadingAuthorEvidence[2],
  [{ title: 'Icebreaker', author: 'Hannah Grace' }], 'Maple Hills',
).verified, true);

console.log('Inkbound Series Detective recovery regressions passed.');
