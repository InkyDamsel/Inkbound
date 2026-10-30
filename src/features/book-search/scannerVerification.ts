import { coverPromoContextIndexes, isDemotedCoverTitleLine } from './coverTextAnalysis';

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

/** Reject catalog biographies masquerading as the photographed author's novel. */
function isAuthorBiographyTitle(title: string, authors: string[]): boolean {
  const normalizedTitle = words(scannerCoverTitle(title)).join(' ');
  return authors.some((author) => {
    const name = words(author).join(' ');
    return name.length > 0 && (normalizedTitle === name || normalizedTitle === name + ' by ' + name);
  });
}

/** True when the OCR line carrying the catalog surname ALSO prints a different
 * given name (e.g. "JORDAN STEPHANIE GRAY" vs catalog "Lucia Jordan": the
 * surname token "jordan" is really the printed FIRST name). Only consulted
 * when the catalog given name is not found anywhere on the cover, so a mangled
 * given name on its own line is still tolerated. */
function surnameLineContradictsGiven(lines: string[], surname: string, given: string[], allowance = 0): boolean {
  const needed = given.filter((word) => word.length >= 3);
  if (!needed.length) return false;
  return lines.some((line) => {
    const tokens = words(line);
    if (!tokens.some((token) => token === surname
      || (allowance > 0 && Math.abs(token.length - surname.length) <= allowance
        && editDistance(token, surname) <= allowance))) return false;
    const others = tokens.filter((token) => token.length >= 3
      && !(token === surname || (allowance > 0 && editDistance(token, surname) <= allowance)));
    return others.length > 0;
  });
}

export function coverMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const text = words(lines.join(' '));
  const tokens = new Set(text);
  const joined = text.join('');
  const titleWords = words(scannerCoverTitle(title));
  if (isAuthorBiographyTitle(title, authors)) return false;
  if (!titleWords.length) return false;
  // A short/generic word is not enough to identify a work.
  const significant = titleWords.filter((word) => word.length >= 4);
  if (!significant.length) return shortTitleMatchesWork(lines, titleWords, authors);
  const allSignificantPresent = significant.every((word) => tokens.has(word) || joined.includes(word));
  if (!allSignificantPresent) return false;
  // A catalog title that is merely the START of a longer printed word is a
  // different book (DEVOUR vs the photographed DEVOURED).
  if (significant.length === 1 && !tokens.has(significant[0])
    && text.some((token) => token.startsWith(significant[0])
      && token.length - significant[0].length >= 2 && token.length - significant[0].length <= 4)) return false;

  // Multi-word titles must be printed together, not assembled from unrelated
  // cover copy. Author bibliography retrieval can surface sibling works whose
  // title words happen to appear separately in blurbs, series copy, or promo.
  // Require the catalog title to survive as one OCR line or a bounded join of
  // adjacent short title lines. Single significant-word titles retain the
  // existing exact-token behavior.
  const compactTitle = titleWords.join('');
  const compactLineTitles = lines.map((line) => words(line).join(''));
  const coherentTitleRuns = compactLineTitles.flatMap((line, index) => [1, 2, 3]
    .map((count) => compactLineTitles.slice(index, index + count))
    .filter((parts) => parts.length > 0 && parts.length <= 3)
    .map((parts) => parts.join('')));
  const titleVerified = significant.length === 1
    ? allSignificantPresent
    : coherentTitleRuns.some((line) => line.includes(compactTitle));
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
      // ...unless the surname line prints a DIFFERENT given name, which means
      // this is another person (Lucia Jordan vs JORDAN STEPHANIE GRAY).
      if (surnameLineContradictsGiven(lines, surname, given)) return false;
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

const BOOK_NUMBER_WORDS = ['one','two','three','four','five','six','seven','eight','nine','ten'];

/** "BOOK THREE" including common OCR damage ("BOK TIHREE", "BOK HREE").
 * Requires a book token within one edit of "book" and a number word within
 * one edit, so ordinary title words cannot be mistaken for a volume label. */
function isBookNumberLine(line: string): boolean {
  const tokens = words(line);
  if (tokens.length !== 2) return false;
  const [book, number] = tokens;
  if (editDistance(book, 'book') > 1) return false;
  return BOOK_NUMBER_WORDS.some((word) => editDistance(number, word) <= (word.length >= 5 ? 2 : 1)
    && number.length >= 3);
}

export function coverApproximatelyMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const promoContext = coverPromoContextIndexes(lines);
  const titleLineDemoted = (line: string, index: number): boolean =>
    promoContext.has(index) || isDemotedCoverTitleLine(line);

  // A line printed directly above a volume label is series copy
  // ("GODS & MONSTERS" / "BOOK THREE"), not the photographed work title.
  // Blank it for TITLE evidence only (indexes stay aligned); author evidence
  // below still reads every OCR line.
  const rawCompactLines = lines.map((line, index) =>
    titleLineDemoted(line, index)
      || (index + 1 < lines.length && isBookNumberLine(lines[index + 1]) && !isBookNumberLine(line))
      ? ''
      : words(line).join(''));
  const compactLines = [
    // Keep exact four-character OCR lines for distinctive short titles such
    // as NERO. Four-character titles receive zero edit-distance allowance
    // below, so this does not broaden fuzzy recovery.
    ...rawCompactLines.filter((line) => line.length >= 4),
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
  if (isAuthorBiographyTitle(title, authors)) return false;
  // Four-character titles can still be distinctive, but they are too short
  // for fuzzy title recovery. Allow them only when OCR captured the complete
  // title exactly; author evidence below remains independently mandatory.
  if (compactTitle.length < 4) return false;

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
    const surnameSeen = authorCandidates.some((candidate) =>
      Math.abs(candidate.length - surname.length) <= allowance
      && editDistance(candidate, surname) <= allowance);
    if (!surnameSeen) return false;
    // Surname alone is not an identity: when the catalog given name is absent
    // and the surname line prints someone else's given name, reject.
    const given = authorWords.slice(0, -1).filter((word) => word.length >= 3);
    if (!given.length) return true;
    const givenSeen = given.some((name) => authorCandidates.some((candidate) =>
      Math.abs(candidate.length - name.length) <= 1
      && editDistance(candidate, name) <= (name.length >= 5 ? 1 : 0))
      || rawWords.join('').includes(name));
    return givenSeen || !surnameLineContradictsGiven(lines, surname, given, allowance);
  });
  if (!authorVerified) return false;
  // Very short one-word titles are especially vulnerable to OCR fragments
  // masquerading as a different book. Require independent given-name evidence,
  // not merely a surname that resembles a damaged title/author fragment.
  const catalogTitleTokens = words(scannerCoverTitle(title));
  if (catalogTitleTokens.length === 1 && compactTitle.length <= 5) {
    const observed = new Set(rawWords);
    const fullOCR = rawWords.join('');
    const givenNameObserved = authors.some((author) => {
      const name = words(author);
      if (name.length < 2) return false;
      const given = name.slice(0, -1);
      return given.every((part) => {
        if (part.length >= 3) return observed.has(part) || fullOCR.includes(part);
        // Initials must be explicitly printed as initials, not inferred from
        // arbitrary single letters elsewhere in the photograph.
        return lines.some((line) => words(line).some((token) => token === part));
      });
    });
    if (!givenNameObserved) return false;
  }

  const catalogTitleWords = words(scannerCoverTitle(title));
  const weakTitleWords = new Set(['a','an','and','as','at','by','for','from','in','of','on','or','the','to']);
  const significantTitleWords = catalogTitleWords
    .filter((word) => word.length >= 4 && !weakTitleWords.has(word));

  // Joining non-adjacent OCR lines is useful for decorative titles split by
  // native OCR, but it is unsafe for short sibling titles: unrelated cover
  // copy can manufacture the whole title (for example one word from series
  // copy and another from a blurb). For titles with fewer than three
  // distinctive words, approximate proof must come from one photographed OCR
  // line. Longer titles may use the bounded cross-line reconstruction because
  // they carry enough independent title evidence.
  const exactShortTitleLine = compactTitle.length >= 4 && compactTitle.length <= 9
    && rawCompactLines.some((line) => line === compactTitle);
  const catalogAuthorLines = new Set(authors
    .map((author) => words(author).join(''))
    .filter((author) => author.length >= 4));
  const strongerPhotographedTitleExists = significantTitleWords.length < 3
    && !exactShortTitleLine
    && lines.some((line, index) => {
      if (titleLineDemoted(line, index)) return false;
      const compactLine = rawCompactLines[index];
      if (catalogAuthorLines.has(compactLine)) return false;
      const distinctive = rawLineWords[index].filter((word) =>
        word.length >= 4 && !weakTitleWords.has(word));
      return distinctive.length >= 3;
    });
  // If the candidate itself has fewer than three distinctive words while the
  // same photograph contains a different, stronger 3+ word title line, treat
  // the short candidate line as secondary cover copy (series/sibling/promo)
  // rather than primary work identity. This prevents a perfectly OCR'd promo
  // title from outranking the actual photographed title.
  if (strongerPhotographedTitleExists) return false;

  const approximateTitleLines = significantTitleWords.length >= 3
    ? compactLines
    : rawCompactLines.filter((line) => line.length >= 4);
  const compactMatch = approximateTitleLines.some((line) => {
    const distance = editDistance(line, compactTitle);
    const allowance = compactTitle.length >= 10 ? 3 : compactTitle.length >= 7 ? 2 : compactTitle.length >= 5 ? 1 : 0;
    return distance <= allowance;
  });
  if (compactMatch) return true;

  // OCR often drops tiny glue words from large decorative multi-line titles.
  // When a catalog title has at least three distinctive words, allow those
  // identity-bearing words to prove the title independently of "of/the/to".
  // Author proof above remains mandatory, and two-word sibling titles do not
  // qualify for this fallback.
  const ocrTokens = new Set(rawWords);
  const significantWordVerified = (word: string): boolean => {
    if (ocrTokens.has(word)) return true;
    const allowance = word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0;
    return rawWords.some((candidate) =>
      Math.abs(candidate.length - word.length) <= allowance
      && editDistance(candidate, word) <= allowance);
  };

  // A catalog title with only one distinctive word is especially vulnerable
  // to sibling-book promo copy: covers routinely print "author of THE
  // HOUSEMAID" while photographing a completely different Freida McFadden
  // title. Approximate recovery must therefore see that title on primary
  // (non-demoted) cover text, never merely somewhere in the raw OCR stream.
  if (significantTitleWords.length === 1) {
    const titleWord = significantTitleWords[0];
    const allowance = titleWord.length >= 8 ? 2 : titleWord.length >= 5 ? 1 : 0;
    return lines.some((line, index) => {
      if (titleLineDemoted(line, index)) return false;
      const lineWords = words(line);
      // Single-word candidates must be presented as title-shaped evidence.
      // Do not let prose, author lines, or unrelated cover copy donate a word.
      if (lineWords.length !== 1) return false;
      const candidate = lineWords[0];
      return Math.abs(candidate.length - titleWord.length) <= allowance
        && editDistance(candidate, titleWord) <= allowance;
    });
  }

  if (significantTitleWords.length === 2) {
    // A photographed multi-line title can contain a short connector (e.g.
    // KING / OF / GLUTTONY). Require the ENTIRE catalog title, including
    // connector words, in one contiguous OCR run. This is stronger than
    // matching two title words scattered through blurbs or promo copy.
    const compactTitleWords = catalogTitleWords.join('');
    for (let start = 0; start < rawCompactLines.length; start += 1) {
      if (!rawCompactLines[start]) continue;
      let run = '';
      for (let end = start; end < Math.min(rawCompactLines.length, start + 5); end += 1) {
        if (!rawCompactLines[end]) break;
        run += rawCompactLines[end];
        if (run === compactTitleWords) return true;
        if (run.length >= compactTitleWords.length) break;
      }
    }
  }

  if (significantTitleWords.length < 3) {
    // A two-word title split across OCR lines can still be strong identity
    // evidence when native OCR independently captures every title word more
    // than once. Require repetition for EACH distinctive word; this keeps
    // sibling/promo words that appear only once from manufacturing a title.
    if (significantTitleWords.length !== 2) return false;
    return significantTitleWords.every((word) => {
      const exactHits = rawWords.filter((candidate) => candidate === word).length;
      return exactHits >= 2;
    });
  }

  return significantTitleWords.every(significantWordVerified);
}