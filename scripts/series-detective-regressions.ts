import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { UserBookRecord } from '../src/types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../src/features/book-search/model/bookSearch';
import {
  hasKnownSeriesContextEvidence,
  scoreSeriesEvidence,
  selectVerifiedSeriesEvidence,
} from '../src/features/series/seriesDetectiveEvidence';

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

const wrongAuthorEdition = edition('hardcover', { authors: ['Someone Else'] });
const wrongAuthor = scoreSeriesEvidence(work(wrongAuthorEdition), wrongAuthorEdition, book);
assert.ok(wrongAuthor);
assert.equal(wrongAuthor?.exactAuthor, false);
assert.equal(selectVerifiedSeriesEvidence([wrongAuthor!]), null);

// Series discovery must not assume every installment has the same author.
// Structured exact-series metadata may cross authors; title-only inference stays
// author-gated to avoid pulling unrelated same-named books into the series.
const detectiveSource = fs.readFileSync(new URL('../src/features/series/seriesDetective.ts', import.meta.url), 'utf8');
const seriesEvidenceSource = fs.readFileSync(new URL('../src/features/series/seriesDetectiveEvidence.ts', import.meta.url), 'utf8');
assert.match(detectiveSource, /searchHardcover\(seriesName\)/);
assert.match(detectiveSource, /googleSeriesOnlyGroups/);
assert.match(detectiveSource, /missingKnownGaps/);
assert.match(detectiveSource, /positionalDiscovery\.flat\(\)/);
assert.match(detectiveSource, /book \$\{position\}/);
assert.match(seriesEvidenceSource, /providerAgreement >= 2/);
assert.match(detectiveSource, /providerSourcesByWork/);
assert.match(detectiveSource, /existingTitleAuthors = new Set\(libraryBooks/);
assert.match(detectiveSource, /metadata\.evidence === 'title' && !exactAuthorMatch\(work, author\)/);
assert.match(detectiveSource, /metadata\.evidence === 'contextual'/);
assert.doesNotMatch(detectiveSource, /normalize\(metadata\.name\) === normalize\(seriesName\) && normalize\(book\.work\.author\) === normalize\(author\)/);

console.log('Inkbound Series Detective regressions passed.');
