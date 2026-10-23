/** Scanner-only, deterministic OCR verification. Do not alter Search ranking. */
const words = (value: string): string[] =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

const EDITION_DESCRIPTOR = /\s+(?:(?:deluxe|special|collector'?s|limited|illustrated|anniversary|signed|exclusive|annotated|international|walmart|target)\s+)*(?:edition|version|exclusive(?: art)?)\s*$/i;

export function scannerCoverTitle(title: string): string {
  // Catalogs commonly append subtitles or edition descriptors that are not
  // printed on the front cover. Cover identity is the primary title only.
  let normalized = title.split(/\s*[:—–]\s*|\s+\((?:[^)]*)\)\s*$/u, 1)[0].trim();
  // Descriptors can be stacked (for example "Deluxe Limited Edition").
  // Strip them generically from catalog titles before cover verification.
  for (let pass = 0; pass < 2; pass += 1) normalized = normalized.replace(EDITION_DESCRIPTOR, '').trim();
  return normalized;
}

export function coverMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const text = words(lines.join(' '));
  const tokens = new Set(text);
  const joined = text.join('');
  const titleWords = words(scannerCoverTitle(title));
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
      const givenHits = given.filter((word) => tokens.has(word) || joined.includes(word)).length;
      if (givenHits > 0) return true;

      // A cover can identify a work safely when every significant title word
      // and the author's complete surname are present, even if OCR mangles a
      // short/stylized given name. The surname alone is never sufficient:
      // titleVerified above must already prove the complete distinctive title.
      // This keeps verification generic instead of special-casing authors.
      return significant.length >= 1 && titleVerified;
    }

    // Initialed authors are verified by their complete surname once the full
    // distinctive title is also present.
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
