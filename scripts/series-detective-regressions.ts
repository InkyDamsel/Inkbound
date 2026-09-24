import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../src/features/book-search/model/bookSearch';
import {
  buildSeriesDetectionQueries,
  hasKnownSeriesContextEvidence,
  inferKnownSeriesFromBibliographicText,
  plausibleSeriesSubtitle,
  scoreSeriesEvidence,
  selectVerifiedSeriesEvidence,
  selectVerifiedSubtitleSeriesEvidence,
} from '../src/features/series/seriesDetectiveEvidence';
import { buildSeriesLibrary, canonicalSeriesIdentity, seriesNamesAreCompatible } from '../src/features/series/seriesLibrary';

const book = {
  id: 'book-1',
  work: {
    title: 'The Cinnamon Bun Book Store',
    author: 'Laurie Gilmore',
  },
  activeEditionId: 'edition-1',
  editions: [{
    id: 'edition-1',
    isbn13: '9780008641580',
    isbn10: '0008641587',
    language: 'en',
  }],
} as unknown as UserBookRecord;

const edition = (
  source: BookSearchEdition['source'],
  overrides: Partial<BookSearchEdition> = {},
): BookSearchEdition => ({
  source,
  externalEditionId: `${source}-1`,
  title: 'The Cinnamon Bun Book Store',
  authors: ['Laurie Gilmore'],
  genres: [],
  publicationYear: 2024,
  language: 'en',
  seriesName: 'Dream Harbor',
  seriesOrder: 2,
  format: 'hardcover',
  isbn13: '9780008641580',
  specialFeatures: [],
  ...overrides,
});

const work = (
  candidateEdition: BookSearchEdition,
  overrides: Partial<BookSearchWorkGroup> = {},
): BookSearchWorkGroup => ({
  key: `work-${candidateEdition.source}`,
  title: candidateEdition.title,
  authors: candidateEdition.authors,
  genres: [],
  editions: [candidateEdition],
  ...overrides,
});

// Series Detective must resolve the canonical work regardless of which edition is active.
const divergentAcrossEditions = {
  id: 'divergent-book',
  work: { title: 'Divergent', author: 'Veronica Roth' },
  activeEditionId: 'edition-b',
  editions: [
    { id: 'edition-a', isbn13: '9780062024039', isbn10: '0062024035' },
    { id: 'edition-b', isbn13: '9780007420421' },
  ],
} as unknown as UserBookRecord;
const divergentQueries = buildSeriesDetectionQueries(divergentAcrossEditions);
assert.equal(divergentQueries.workQuery, 'Divergent Veronica Roth');
assert.deepEqual(new Set(divergentQueries.identifiers), new Set(['9780062024039', '0062024035', '9780007420421']));

const strong = scoreSeriesEvidence(work(edition('open-library')), edition('open-library'), book);
assert.ok(strong);
assert.equal(strong?.structured, true);
assert.equal(strong?.exactIdentifier, true);
assert.equal(selectVerifiedSeriesEvidence([strong!])?.name, 'Dream Harbor');
assert.equal(selectVerifiedSeriesEvidence([strong!])?.position, 2);

const weakGoogleEdition = edition('google-books', {
  seriesName: undefined,
  seriesOrder: undefined,
  title: 'The Cinnamon Bun Book Store (Dream Harbor, Book 2)',
  isbn13: undefined,
  isbn10: undefined,
});
const weakGoogle = scoreSeriesEvidence(work(weakGoogleEdition), weakGoogleEdition, book);
assert.ok(weakGoogle);
assert.equal(weakGoogle?.structured, false);
assert.equal(selectVerifiedSeriesEvidence([weakGoogle!]), null);


const vagueTitleEdition = edition('google-books', {
  seriesName: undefined,
  seriesOrder: undefined,
  title: 'The Cinnamon Bun Book Store (Dream Harbor)',
  isbn13: undefined,
  isbn10: undefined,
});
const vagueTitle = scoreSeriesEvidence(work(vagueTitleEdition), vagueTitleEdition, book);
assert.equal(vagueTitle, null);

const weakOpenLibraryEdition = edition('open-library', {
  seriesName: undefined,
  seriesOrder: undefined,
  title: 'The Cinnamon Bun Book Store (Dream Harbor, Book 2)',
  isbn13: undefined,
  isbn10: undefined,
});
const weakOpenLibrary = scoreSeriesEvidence(work(weakOpenLibraryEdition), weakOpenLibraryEdition, book);
assert.ok(weakOpenLibrary);
assert.equal(selectVerifiedSeriesEvidence([weakGoogle!, weakOpenLibrary!])?.name, 'Dream Harbor');


const standaloneTwistedTaleEdition = edition('google-books', {
  seriesName: undefined,
  seriesOrder: undefined,
  title: 'Disney A Twisted Tale',
  authors: ['Example Author'],
  isbn13: undefined,
  isbn10: undefined,
});
const standaloneTwistedTaleBook = {
  ...book,
  work: { title: 'Disney A Twisted Tale', author: 'Example Author' },
  editions: [{ id: 'edition-standalone', language: 'en' }],
  activeEditionId: 'edition-standalone',
} as unknown as UserBookRecord;
const standaloneTwistedTale = scoreSeriesEvidence(
  work(standaloneTwistedTaleEdition, { title: 'Disney A Twisted Tale', authors: ['Example Author'] }),
  standaloneTwistedTaleEdition,
  standaloneTwistedTaleBook,
);
assert.equal(standaloneTwistedTale, null);

// Known-series discovery must understand bibliographic suffix formats that
// providers commonly expose without structured series fields.
assert.deepEqual(
  inferKnownSeriesFromBibliographicText('Example Book: Crown Trials #2', 'Crown Trials Series'),
  { name: 'Crown Trials', position: 2 },
);
assert.deepEqual(
  inferKnownSeriesFromBibliographicText('Crown Trials Book 3', 'The Crown Trials'),
  { name: 'Crown Trials', position: 3 },
);
assert.equal(
  inferKnownSeriesFromBibliographicText('Unrelated Book: Different Saga #2', 'Crown Trials'),
  null,
);

// Exact non-generic subtitles are strong bibliographic series context once the
// reader is already inside that known series. Generic marketing subtitles are
// still rejected.
assert.equal(plausibleSeriesSubtitle('A Twisted Path'), 'A Twisted Path');
assert.equal(plausibleSeriesSubtitle('A Novel'), null);

const twistedInstallment = work(
  edition('google-books', {
    title: 'As Old as Time',
    subtitle: 'A Twisted Tale',
    authors: ['Liz Braswell'],
    seriesName: undefined,
    seriesOrder: undefined,
  }),
  { title: 'As Old as Time', subtitle: 'A Twisted Tale', authors: ['Liz Braswell'] },
);
assert.equal(hasKnownSeriesContextEvidence(twistedInstallment, twistedInstallment.editions[0], 'A Twisted Tale', 2), true);
assert.equal(hasKnownSeriesContextEvidence(twistedInstallment, twistedInstallment.editions[0], 'A Twisted Tale', 1), false);

const twistedBrandOnly = work(
  edition('google-books', {
    title: 'Disney A Twisted Tale',
    authors: ['Example Author'],
    seriesName: undefined,
    seriesOrder: undefined,
  }),
  { title: 'Disney A Twisted Tale', authors: ['Example Author'] },
);
assert.equal(hasKnownSeriesContextEvidence(twistedBrandOnly, twistedBrandOnly.editions[0], 'A Twisted Tale', 2), false);

const concealBook = {
  ...book,
  work: { title: "Conceal, Don't Feel", author: 'Jen Calonita' },
  activeEditionId: 'conceal-active',
  editions: [{ id: 'conceal-active', language: 'en' }],
} as unknown as UserBookRecord;

const concealGoogle = work(
  edition('google-books', {
    title: "Conceal, Don't Feel",
    subtitle: 'A Twisted Tale',
    authors: ['Jen Calonita'],
    seriesName: undefined,
    seriesOrder: undefined,
    isbn13: undefined,
    isbn10: undefined,
  }),
  { title: "Conceal, Don't Feel", subtitle: 'A Twisted Tale', authors: ['Jen Calonita'] },
);
const concealOpenLibrary = work(
  edition('open-library', {
    title: "Conceal, Don't Feel",
    subtitle: 'A Twisted Tale',
    authors: ['Jen Calonita'],
    seriesName: undefined,
    seriesOrder: undefined,
    isbn13: undefined,
    isbn10: undefined,
  }),
  { title: "Conceal, Don't Feel", subtitle: 'A Twisted Tale', authors: ['Jen Calonita'] },
);
assert.deepEqual(
  selectVerifiedSubtitleSeriesEvidence([concealGoogle, concealOpenLibrary], concealBook),
  { name: 'A Twisted Tale', position: null },
);
assert.equal(
  selectVerifiedSubtitleSeriesEvidence([concealGoogle], concealBook),
  null,
);

const genericSubtitleGoogle = work(
  edition('google-books', {
    title: "Conceal, Don't Feel",
    subtitle: 'A Novel',
    authors: ['Jen Calonita'],
    seriesName: undefined,
    seriesOrder: undefined,
    isbn13: undefined,
    isbn10: undefined,
  }),
  { title: "Conceal, Don't Feel", subtitle: 'A Novel', authors: ['Jen Calonita'] },
);
const genericSubtitleOpenLibrary = work(
  edition('open-library', {
    title: "Conceal, Don't Feel",
    subtitle: 'A Novel',
    authors: ['Jen Calonita'],
    seriesName: undefined,
    seriesOrder: undefined,
    isbn13: undefined,
    isbn10: undefined,
  }),
  { title: "Conceal, Don't Feel", subtitle: 'A Novel', authors: ['Jen Calonita'] },
);
assert.equal(
  selectVerifiedSubtitleSeriesEvidence([genericSubtitleGoogle, genericSubtitleOpenLibrary], concealBook),
  null,
);

const wrongAuthorEdition = edition('hardcover', { authors: ['Someone Else'] });
const wrongAuthor = scoreSeriesEvidence(work(wrongAuthorEdition), wrongAuthorEdition, book);
assert.ok(wrongAuthor);
assert.equal(wrongAuthor?.exactAuthor, false);
assert.equal(selectVerifiedSeriesEvidence([wrongAuthor!]), null);

const formattedAuthorExactIsbnEdition = edition('hardcover', {
  authors: ['Gilmore, Laurie'],
});
const formattedAuthorExactIsbn = scoreSeriesEvidence(
  work(formattedAuthorExactIsbnEdition, { authors: ['Gilmore, Laurie'] }),
  formattedAuthorExactIsbnEdition,
  book,
);
assert.ok(formattedAuthorExactIsbn);
assert.equal(formattedAuthorExactIsbn?.structured, true);
assert.equal(formattedAuthorExactIsbn?.exactIdentifier, true);
assert.equal(formattedAuthorExactIsbn?.exactAuthor, false);
assert.equal(selectVerifiedSeriesEvidence([formattedAuthorExactIsbn!])?.name, 'Dream Harbor');
assert.equal(selectVerifiedSeriesEvidence([formattedAuthorExactIsbn!])?.position, 2);

// Provider naming differences must not split one real series.
assert.equal(canonicalSeriesIdentity('Hades x Persephone Saga'), 'hades persephone');
assert.equal(canonicalSeriesIdentity('Hades & Persephone'), 'hades persephone');
assert.equal(seriesNamesAreCompatible('Hades x Persephone Saga', 'Hades x Persephone'), true);
assert.equal(seriesNamesAreCompatible('Hades x Persephone Saga', 'Hades & Persephone'), true);
assert.equal(seriesNamesAreCompatible('Hades x Persephone Saga', 'Adrian X Isolde'), false);

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

const aliasEvidenceA = scoreSeriesEvidence(
  work(edition('open-library', {
    title: 'A Touch of Darkness',
    authors: ['Scarlett St. Clair'],
    seriesName: 'Hades x Persephone Saga',
    seriesOrder: 1,
    isbn13: '9781728258454',
  }), { title: 'A Touch of Darkness', authors: ['Scarlett St. Clair'] }),
  edition('open-library', {
    title: 'A Touch of Darkness',
    authors: ['Scarlett St. Clair'],
    seriesName: 'Hades x Persephone Saga',
    seriesOrder: 1,
    isbn13: '9781728258454',
  }),
  {
    ...book,
    work: { title: 'A Touch of Darkness', author: 'Scarlett St. Clair' },
    activeEditionId: 'alias-edition',
    editions: [{ id: 'alias-edition', isbn13: '9781728258454', language: 'en' }],
  } as unknown as UserBookRecord,
);
const aliasEvidenceB = scoreSeriesEvidence(
  work(edition('hardcover', {
    title: 'A Touch of Darkness',
    authors: ['Scarlett St. Clair'],
    seriesName: 'Hades & Persephone',
    seriesOrder: 1,
    isbn13: '9781728258454',
  }), { title: 'A Touch of Darkness', authors: ['Scarlett St. Clair'] }),
  edition('hardcover', {
    title: 'A Touch of Darkness',
    authors: ['Scarlett St. Clair'],
    seriesName: 'Hades & Persephone',
    seriesOrder: 1,
    isbn13: '9781728258454',
  }),
  {
    ...book,
    work: { title: 'A Touch of Darkness', author: 'Scarlett St. Clair' },
    activeEditionId: 'alias-edition',
    editions: [{ id: 'alias-edition', isbn13: '9781728258454', language: 'en' }],
  } as unknown as UserBookRecord,
);
assert.ok(aliasEvidenceA && aliasEvidenceB);
assert.ok(selectVerifiedSeriesEvidence([aliasEvidenceA!, aliasEvidenceB!]));

console.log('Inkbound Series Detective regressions passed.');
