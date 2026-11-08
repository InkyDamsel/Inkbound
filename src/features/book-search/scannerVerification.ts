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

/** A decorative doubled letter may be read once (CROOME -> CROME).
 * Never use this as standalone identity evidence: title and given name must
 * independently match, and only one adjacent duplicate may be omitted. */
const missingDoubledLetter = (printed: string, catalog: string): boolean => {
  if (catalog.length < 5 || printed.length !== catalog.length - 1) return false;
  for (let i = 1; i < catalog.length; i += 1) {
    if (catalog[i] === catalog[i - 1] && catalog.slice(0, i) + catalog.slice(i + 1) === printed) return true;
  }
  return false;
};

const surnameWithDecorativeOcr = (lines: string[], surname: string, given: string[]): boolean => {
  if (!given.length) return false;
  const text = words(lines.join(' '));
  const joined = text.join('');
  if (!given.some((name) => name.length >= 4 && (text.includes(name) || joined.includes(name)))) return false;
  const candidates = [...text, ...lines.map((line) => words(line).join(''))];
  return candidates.some((candidate) => missingDoubledLetter(candidate, surname));
};

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

/** A short catalog title printed as a genre/subtitle must not override a
 * distinctly different full cover title (e.g. THE PICASSO HEIST / A THRILLER).
 * Do not treat series, marketing, or the credited author's name as the title. */
function competingCoverTitle(lines: string[], title: string, authors: string[]): boolean {
  const candidate = words(scannerCoverTitle(title));
  if (candidate.length !== 1) return false;
  // A standalone word can be a legitimate title. Intervene only when the
  // photo explicitly labels that word as a genre ("A THRILLER", "A NOVEL"),
  // not merely because other multiword lines exist on the cover.
  const genreLabel = new Set(['thriller', 'mystery', 'romance', 'fantasy', 'novel', 'memoir', 'suspense']);
  if (!genreLabel.has(candidate[0])) return false;
  const printedAsGenre = lines.some((line) => {
    const tokens = words(line);
    return tokens.length >= 2 && tokens.length <= 4
      && tokens.includes(candidate[0])
      && tokens.some((token) => ['a', 'an', 'novel', 'romance', 'story'].includes(token));
  });
  if (!printedAsGenre) return false;
  const credited = new Set(authors.flatMap(words));
  const titleEvidence = lines.map((line) => {
    if (isDemotedCoverTitleLine(line)) return [];
    const tokens = words(line).filter((token) => token.length >= 4);
    if (tokens.includes(candidate[0]) || tokens.some((token) => credited.has(token))) return [];
    return tokens;
  });
  // Whole title on one OCR line, or two adjacent distinctive fragments
  // (PICASSO / HEIST). Never combine non-adjacent review/author lines.
  return titleEvidence.some((tokens, index) => tokens.length >= 2
    || (tokens.length === 1 && (titleEvidence[index + 1]?.length ?? 0) === 1));
}

// A single title word can also be a catalog author's surname (MOON).
// Never treat that repeated word as independent proof of a different author.
function singleWordTitleAuthorIsIndependent(lines: string[], title: string, authors: string[]): boolean {
  const titleWords = words(scannerCoverTitle(title));
  if (titleWords.length !== 1) return true;
  const titleWord = titleWords[0];
  const tokens = words(lines.join(' '));
  const joined = tokens.join('');
  return authors.some((author) => {
    const parts = words(author);
    if (parts.length < 2) return false;
    const surname = parts[parts.length - 1];
    if (surname === titleWord) return false;
    const given = parts.slice(0, -1);
    if (!given.length) return false;
    // Initialed authors are common on covers (J.T. GEISSINGER).
    // Require each initial to be explicitly present in the OCR; do not
    // manufacture it from unrelated words.
    return given.every((part) => part.length <= 2
      ? tokens.includes(part)
      : tokens.includes(part) || (part.length >= 5 && joined.includes(part)));
  });
}

export function coverMatchesWork(lines: string[], title: string, authors: string[]): boolean {
  const text = words(lines.join(' '));
  const tokens = new Set(text);
  const joined = text.join('');
  const titleWords = words(scannerCoverTitle(title));
  if (isAuthorBiographyTitle(title, authors)) return false;
  if (!titleWords.length) return false;
  if (!singleWordTitleAuthorIsIndependent(lines, title, authors)) return false;
  if (competingCoverTitle(lines, title, authors)) return false;
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
  // Title evidence must be TITLE-SHAPED. A catalog title that merely appears
  // inside review copy, a tagline, series/genre text, or a promo line is not
  // the photographed title (the DEVOURED cover prints "[Bitten is] a romance
  // that sizzles", which previously verified the unrelated sibling "Bitten").
  // A line is title-shaped when it is not demoted cover copy and is no more
  // than two tokens longer than the catalog title; split decorative titles may
  // span up to three adjacent title-shaped lines.
  const titleShapedLine = (line: string): boolean => {
    const count = words(line).length;
    return count > 0 && count <= titleWords.length + 2 && !isDemotedCoverTitleLine(line);
  };
  const titleShapedRuns = lines.flatMap((_line, index) => [1, 2, 3]
    .map((count) => lines.slice(index, index + count))
    .filter((parts) => parts.every(titleShapedLine)
      && parts.reduce((total, part) => total + words(part).length, 0) <= titleWords.length + 3)
    .map((parts) => parts.map((part) => words(part).join('')).join('')));
  if (!titleShapedRuns.some((run) => run.includes(compactTitle) || (significant.length === 1 && run.includes(significant[0])))) {
    return false;
  }
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
    const surnameVerified = tokens.has(surname) || joined.includes(surname)
      || surnameWithDecorativeOcr(lines, surname, authorWords.slice(0, -1));
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
  if (!singleWordTitleAuthorIsIndependent(lines, title, authors)) return false;
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
    // OCR can print a complete author credit without a word boundary
    // (AYANAGRAY). A full given-name + surname match is independent
    // author evidence; do not require the surname as a separate token.
    const fullAuthor = authorWords.join('');
    if (authorWords.length >= 2 && fullAuthor.length >= 8
      && authorCandidates.includes(fullAuthor)) return true;
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
  if (competingCoverTitle(lines, title, authors)) return false;
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
  // Native OCR may read a two-line title as THRESHING / DRY instead of
  // THRESHING / DAY. Accept one damaged short word only when both title
  // words occupy adjacent standalone, non-promotional lines and the full
  // author identity has already been independently verified above.
  const adjacentTwoLineTitle = catalogTitleWords.length === 2
    && significantTitleWords.length >= 1
    && catalogTitleWords[0].length >= 6
    && lines.some((line, index) => {
      if (index + 1 >= lines.length
        || titleLineDemoted(line, index)
        || titleLineDemoted(lines[index + 1], index + 1)) return false;
      const first = words(line);
      const second = words(lines[index + 1]);
      return first.length === 1 && second.length === 1
        && first[0] === catalogTitleWords[0]
        && second[0].length === catalogTitleWords[1].length
        && editDistance(second[0], catalogTitleWords[1]) <= 1;
    });
  if (adjacentTwoLineTitle) return true;

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
      const lineWords = rawLineWords[index];
      // A series descriptor ("A Maple Hills Novel") can contain three long
      // words without being a competing title. OCR often damages the actual
      // one-word title while reading this smaller subtitle cleanly. Do not
      // let an explicitly labeled book/series descriptor veto a catalog
      // title that otherwise passes independent author + fuzzy-title proof.
      const descriptorWords = new Set(['novel', 'series', 'book', 'volume']);
      if (lineWords.length >= 2 && descriptorWords.has(lineWords.at(-1) ?? '')
        && (lineWords[0] === 'a' || lineWords[0] === 'an' || lineWords[0] === 'the')) return false;
      const distinctive = lineWords.filter((word) =>
        word.length >= 4 && !weakTitleWords.has(word));
      return distinctive.length >= 3;
    });
  // Multiple OCR treatments can scatter a decorative two-word title into
  // separate, damaged one-word lines (KNVE / MOGN / MOBN). Recover only
  // when BOTH author names are independently readable and both distinctive
  // title words have standalone, non-promotional evidence. Require repeated
  // evidence for at least one title word: a single coincidental fuzzy word
  // from cover copy must never verify a different book.
  if (significantTitleWords.length === 2 && catalogTitleWords.length >= 2
    && significantTitleWords.every((word) => word.length >= 4)) {
    const authorFullySeen = authors.some((author) => {
      const parts = words(author);
      if (parts.length < 2) return false;
      const seen = (part: string): boolean => {
        const allowance = part.length >= 5 ? 1 : 0;
        return authorCandidates.some((candidate) =>
          Math.abs(candidate.length - part.length) <= allowance
          && editDistance(candidate, part) <= allowance);
      };
      return seen(parts[0]) && seen(parts[parts.length - 1]);
    });
    if (authorFullySeen) {
      const titleFragments = lines.flatMap((line, index) => {
        if (titleLineDemoted(line, index)) return [];
        const tokens = words(line);
        return tokens.length === 1 ? tokens : [];
      });
      const hitCounts = significantTitleWords.map((word) =>
        titleFragments.filter((fragment) =>
          Math.abs(fragment.length - word.length) <= 1
          && editDistance(fragment, word) <= 1).length);
      if (hitCounts.every((count) => count >= 1)
        && hitCounts.some((count) => count >= 2)) return true;
    }
  }

  // A decorative two-word title may leave only the first two letters of
  // its first word, while repeatedly printing the second word and the
  // connecting phrase. This is deliberately stricter than generic fuzzy
  // matching: require the complete printed author, a repeated connector,
  // repeated independently readable second title word, and an isolated
  // prefix of the missing first word. A three-word marketing blurb is not\n  // allowed to veto this stronger multi-pass title evidence. A bare author bibliography result
  // or a single moon-like fragment must never suffice.
  if (significantTitleWords.length === 2 && catalogTitleWords.length >= 4
    && catalogTitleWords[0] === 'the'
    && catalogTitleWords[2] === 'and'
    && catalogTitleWords[3] === 'the') {
    const completeAuthorPrinted = authors.some((author) => {
      const parts = words(author);
      if (parts.length < 2) return false;
      return parts.every((part) => rawLineWords.some((tokens) =>
        tokens.join('') === part));
    });
    const primary = rawLineWords.filter((tokens, index) =>
      !titleLineDemoted(lines[index], index));
    const connectors = primary.filter((tokens) =>
      tokens.join('') === 'andthe').length;
    const firstWord = significantTitleWords[0];
    const secondWord = significantTitleWords[1];
    const firstPrefix = primary.some((tokens) => tokens.length === 1
      && tokens[0].length >= 2 && tokens[0].length <= 3
      && firstWord.startsWith(tokens[0]));
    const secondHits = primary.filter((tokens) => tokens.length === 1
      && Math.abs(tokens[0].length - secondWord.length) <= 1
      && editDistance(tokens[0], secondWord) <= 1).length;
    if (completeAuthorPrinted && connectors >= 2 && firstPrefix
      && secondHits >= 2) return true;
  }

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

  // A two-word title with a printed connector can be split across OCR
  // treatments: SHIELD OF / SPARROWS. The verifier must not require the
  // fragments to remain adjacent after OCR passes are merged. Require the
  // entire credited author to be printed on one line, the first title word
  // plus connector on a primary line, and the second distinctive word on a
  // separate primary line. This does not accept author-only bibliography hits.
  if (significantTitleWords.length === 2 && catalogTitleWords.length === 3
    && weakTitleWords.has(catalogTitleWords[1])) {
    const completeAuthorLine = authors.some((author) => {
      const credit = words(author).join('');
      return credit.length >= 8 && rawLineWords.some((tokens) => tokens.join('') === credit);
    });
    const firstWithConnector = catalogTitleWords.slice(0, 2).join('');
    const firstSeen = rawCompactLines.some((line) => line === firstWithConnector);
    const secondSeen = rawCompactLines.some((line) => line === catalogTitleWords[2]);
    if (completeAuthorLine && firstSeen && secondSeen) return true;
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

  // Decorative multi-word titles may lose the beginning of ONE long word
  // (COOKBOOK -> BOOK). Recover only when two other distinctive title words
  // are independently legible, the surname is exact, and the printed given
  // name is present or visibly truncated. Never treat this as sufficient for
  // a one- or two-word title, or an author-only catalog match.
  if (significantTitleWords.length >= 3) {
    const missing = significantTitleWords.filter((word) => !significantWordVerified(word));
    const strongWords = significantTitleWords.filter(significantWordVerified);
    const authorCredit = authors.some((author) => {
      const parts = words(author);
      if (parts.length < 2) return false;
      const surname = parts[parts.length - 1];
      const given = parts[0];
      return rawWords.includes(surname) && rawWords.some((token) =>
        token === given || (given.length >= 4 && token.length >= 3
          && token.length === given.length - 1 && given.startsWith(token)));
    });
    if (missing.length === 1 && strongWords.length >= 2 && authorCredit) {
      const word = missing[0];
      if (word.length >= 7 && rawLineWords.some((tokens, index) =>
        !promoContext.has(index) && tokens.length === 1
        // Standalone BOOK is normally demoted as a series label. In this
        // narrow three-word-title recovery it can be a clipped title suffix,
        // but never if immediately attached to a volume number.
        && !(index + 1 < lines.length && isBookNumberLine(lines[index + 1]))
        && (tokens[0] === 'book' || !isDemotedCoverTitleLine(lines[index]))
        && tokens[0].length >= 4 && tokens[0].length <= word.length - 3
        && word.endsWith(tokens[0]))) return true;
    }
  }
  return significantTitleWords.every(significantWordVerified);
}