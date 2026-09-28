import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import type { BookSearchEdition, BookSearchWorkGroup } from '../src/features/book-search/model/bookSearch';
import {
  hasKnownSeriesContextEvidence,
  scoreSeriesEvidence,
  selectVerifiedSeriesEvidence,
  selectVerifiedSubtitleSeriesEvidence,
} from '../src/features/series/seriesDetectiveEvidence';
import { buildSeriesLibrary, canonicalSeriesIdentity, seriesNamesAreCompatible } from '../src/features/series/seriesLibrary';
import { migrateSeriesOverridesToCanonicalBooks } from '../src/features/series/seriesOverrides';
import { buildSeriesDetectionQueries } from '../src/features/series/seriesDetective';

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

// Title suffixes may inform repair but must never create unpersisted series membership.
const suffixOnlyBook = {
  id: 'suffix-only',
  work: {
    title: 'Example Story (Imaginary Saga #2)',
    author: 'Example Author',
    publicationYear: 2024,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'suffix-edition', format: 'paperback' }],
  activeEditionId: 'suffix-edition',
} as unknown as UserBookRecord;
assert.equal(buildSeriesLibrary([suffixOnlyBook]).length, 0);

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


// Legacy series migration cannot overwrite newer canonical manual intent.
{
  const canonicalManual = {
    ...suffixOnlyBook,
    id: 'canonical-manual',
    work: {
      ...suffixOnlyBook.work,
      seriesName: 'Current Reader Series',
      seriesOrder: 4,
      seriesLabel: 'Current Label',
      seriesSource: 'manual' as const,
    },
  } as UserBookRecord;
  const preserved = migrateSeriesOverridesToCanonicalBooks(
    [canonicalManual],
    {
      'old-series': {
        id: 'old-series',
        name: 'Old Synced Series',
        author: 'Example Author',
        books: [{ bookId: 'canonical-manual', position: 1, label: 'Old Label' }],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      },
    },
  );
  assert.equal(preserved.books[0].work.seriesName, 'Current Reader Series');
  assert.equal(preserved.books[0].work.seriesOrder, 4);
  assert.equal(preserved.books[0].work.seriesLabel, 'Current Label');
  assert.equal(preserved.books[0].work.seriesSource, 'manual');
  assert.deepEqual(preserved.migratedBookIds, ['canonical-manual']);
}

// Legacy manual series organization is migration-only. Once folded into the
// canonical book, every consumer must see the same name/order/label/source.
const legacySeriesBook = {
  id: 'legacy-series-book',
  work: {
    title: 'Example Legacy Book',
    author: 'Example Author',
    genres: [],
    publicationYear: 2020,
  },
  ownership: 'owned',
  status: 'tbr',
  editions: [{ id: 'legacy-edition', format: 'paperback' }],
  activeEditionId: 'legacy-edition',
} as unknown as UserBookRecord;
const legacySeriesUnrelated = {
  ...legacySeriesBook,
  id: 'unrelated-book',
  work: { ...legacySeriesBook.work, title: 'Standalone Example' },
} as UserBookRecord;
const migratedLegacySeries = migrateSeriesOverridesToCanonicalBooks(
  [legacySeriesBook, legacySeriesUnrelated],
  {
    'legacy-manual-series': {
      id: 'legacy-manual-series',
      name: 'Reader Corrected Series',
      author: 'Example Author',
      books: [{ bookId: 'legacy-series-book', position: 2.5, label: 'Novella' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  },
);
assert.deepEqual(migratedLegacySeries.migratedBookIds, ['legacy-series-book']);
const migratedBook = migratedLegacySeries.books.find((item) => item.id === 'legacy-series-book')!;
assert.equal(migratedBook.work.seriesName, 'Reader Corrected Series');
assert.equal(migratedBook.work.seriesOrder, 2.5);
assert.equal(migratedBook.work.seriesLabel, 'Novella');
assert.equal(migratedBook.work.seriesSource, 'manual');
assert.equal(migratedLegacySeries.books.find((item) => item.id === 'unrelated-book')?.work.seriesName, undefined);
const migratedSeriesLibrary = buildSeriesLibrary(migratedLegacySeries.books);
assert.equal(migratedSeriesLibrary.length, 1);
assert.equal(migratedSeriesLibrary[0].name, 'Reader Corrected Series');
assert.equal(migratedSeriesLibrary[0].isManual, true);
assert.equal(migratedSeriesLibrary[0].books[0].displayPosition, 'Novella');
