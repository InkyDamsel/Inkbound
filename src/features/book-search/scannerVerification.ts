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

/** Short titles carry too little evidence for loose token matching. Require the
 * complete title as a whole printed line plus the complete author identity. */
function shortTitleMatchesWork(lines: string[], titleWords: string[], authors: string[]): boolean {
  const compactTitle = titleWords.join('');
  if (compactTitle.length < 2 || titleWords.length > 3 || compactTitle.length > 9) return false;
  if (!lines.some((line) => words(line).join('') === compactTitle)) return false;
  const text = words(lines.join(' '));
  const tokens = new Set(text);
  const joined = text.join('');
  return authors.some((author) => {
    const authorWords = words(author);
    const surname = authorWords[authorWords.length - 1] ?? '';
    if (surname.length < 3 || !(tokens.has(surname) || joined.includes(surname))) return false;
    return authorWords.slice(0, -1).filter((word) => word.length >= 3)
      .every((word) => tokens.has(word) || joined.includes(word));
  });
}

export function coverMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const text = words(lines.join(' '));
  const tokens = new Set(text);
  const joined = text.join('');
  const titleWords = words(scannerCoverTitle(title));
  if (!titleWords.length) return false;
  // A short/generic word is not enough to identify a work.
  const significant = titleWords.filter((word) => word.length >= 4);
  if (!significant.length) return shortTitleMatchesWork(lines, titleWords, authors);
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


const editDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

export function coverApproximatelyMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const rawCompactLines = lines.map((line) => words(line).join(''));
  const compactLines = [
    ...rawCompactLines.filter((line) => line.length >= 5),
    // Decorative cover titles are frequently split across lines. Native OCR
    // merges evidence from several image treatments, so two title fragments
    // from different passes may no longer be adjacent in the merged list.
    ...rawCompactLines.slice(0, -1)
      .flatMap((line, index) => rawCompactLines
        .slice(index + 1)
        .filter((other) => line.length >= 3 && other.length >= 3 && line.length <= 12 && other.length <= 12)
        .map((other) => `${line}${other}`))
      .filter((line) => line.length >= 5),
  ];
  const compactTitle = words(scannerCoverTitle(title)).join('');
  if (compactTitle.length < 5) return false;

  // Approximate recovery requires independent author evidence as well as the
  // fuzzy title. OCR may substitute/drop one or two glyphs in a decorative
  // surname, so compare the complete catalog surname against OCR tokens and
  // adjacent token joins with a tightly bounded edit distance.
  const rawWords = words(lines.join(' '));
  const rawLineWords = lines.map(words);
  const fragmentedLineCandidates = rawLineWords.flatMap((lineWords) => {
    if (lineWords.length < 2 || lineWords.length > 4) return [];
    // Decorative names are often segmented inside a single printed line
    // ("BE THA N"). Rejoin only short fragments from that same OCR line so
    // unrelated title/tagline words cannot manufacture an author identity.
    const shortFragments = lineWords.every((word) => word.length <= 4);
    return shortFragments ? [lineWords.join('')] : [];
  });
  const authorCandidates = [
    ...rawWords,
    ...fragmentedLineCandidates,
    ...rawWords.slice(0, -1).map((word, index) => `${word}${rawWords[index + 1]}`),
    ...rawWords.slice(0, -2).map((word, index) => `${word}${rawWords[index + 1]}${rawWords[index + 2]}`),
  ];
  const authorVerified = authors.some((author) => {
    const authorWords = words(author);
    const surname = authorWords[authorWords.length - 1] ?? '';
    if (surname.length < 3) return false;
    // REID/KING/LAKE must be allowed, but short surnames must match exactly.
    const allowance = surname.length >= 9 ? 2 : surname.length >= 5 ? 1 : 0;
    return authorCandidates.some((candidate) =>
      Math.abs(candidate.length - surname.length) <= allowance
      && editDistance(candidate, surname) <= allowance);
  });
  if (!authorVerified) return false;

  return compactLines.some((line) => {
    const distance = editDistance(line, compactTitle);
    const allowance = compactTitle.length >= 10 ? 3 : compactTitle.length >= 7 ? 2 : 1;
    return distance <= allowance;
  });
}
