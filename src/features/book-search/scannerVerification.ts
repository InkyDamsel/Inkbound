/** Scanner-only, deterministic OCR verification. Do not alter Search ranking. */
const words = (value: string): string[] =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

export function coverMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const text = words(lines.join(' '));
  const tokens = new Set(text);
  const joined = text.join('');
  const titleWords = words(title);
  if (!titleWords.length) return false;
  // A short/generic word is not enough to identify a work.
  const significant = titleWords.filter((word) => word.length >= 4);
  if (!significant.length) return false;
  const titleVerified = significant.every((word) => tokens.has(word) || joined.includes(word));
  if (!titleVerified) return false;
  return authors.some((author) => {
    const authorWords = words(author);
    if (!authorWords.length) return false;
    const surname = authorWords[authorWords.length - 1];
    if (surname.length < 3) return false;

    // Decorative cover fonts commonly make OCR split a name into fragments
    // (for example "G E I S S I N G E R" or "R E I D"). Title verification
    // already tolerates that by checking the compact OCR stream; author
    // verification must do the same or a correct catalog work is rejected.
    // We still require the complete surname plus the meaningful given name,
    // so compact matching cannot turn a title-only hit into a verified book.
    const surnameVerified = tokens.has(surname) || joined.includes(surname);
    if (!surnameVerified) return false;

    const given = authorWords.slice(0, -1).filter((word) => word.length >= 3);
    if (given.length) {
      return given.every((word) => tokens.has(word) || joined.includes(word));
    }

    // Initialed authors (J. T. Geissinger, M. P. Woodward) are verified by
    // their complete surname once the full distinctive title is also present.
    return authorWords.slice(0, -1).every((word) => word.length <= 2);
  });
}

export function scannerEditionKey(edition: {
  isbn13?: string; isbn10?: string; source: string; externalEditionId: string;
}): string {
  return edition.isbn13 ?? edition.isbn10 ?? `catalog:${edition.source}:${edition.externalEditionId}`;
}

export function isScannerBatchIdentityConsistent(
  key: string,
  editions: Array<{ isbn?: string; isbn13?: string; isbn10?: string; externalSource?: string; externalEditionId?: string }>,
): boolean {
  if (!editions.length) return false;
  return editions.some((edition) =>
    [edition.isbn, edition.isbn13, edition.isbn10].some((isbn) => !!isbn && isbn === key)
    || (!!edition.externalSource && !!edition.externalEditionId
      && key === `catalog:${edition.externalSource}:${edition.externalEditionId}`));
}
