/** Scanner-only, deterministic cover-text helpers. Pure functions: no network,
 * no React. Do not alter Search ranking. */

const wordsOf = (value: string): string[] =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

const AUTHOR_OF = /\b(?:author|authors|creator)\s+of\b/i;
const PROMO_WORDS = /(?:bestsell|best-sell|new york times|usa today|wall street journal|award|winner|international|acclaimed|critically|number one|#\s*\d)/i;
const CONTINUES_LIST = /(?:\band|&|,)\s*$/i;
const STARTS_LIST_ITEM = /^\s*(?:and|&)\b/i;
const STANDALONE_PROMO = /^\s*(?:now an?\b|soon to be an?\b|as seen on\b|an instant\b|a #\s*1\b)/i;

export function stripCoverPromoLines(lines: string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (STANDALONE_PROMO.test(line)) continue;
    const match = AUTHOR_OF.exec(line);
    if (!match) { kept.push(line); continue; }

    const head = line.slice(0, match.index).replace(/[\s,;:\u2013\u2014-]+$/u, '').trim();
    const tail = line.slice(match.index + match[0].length).trim();
    const headWords = wordsOf(head);
    if (headWords.length >= 2 && !PROMO_WORDS.test(head)) kept.push(head);

    if (!tail) {
      let dropped = 0;
      let previousDropped = line;
      while (index + 1 < lines.length && dropped < 3) {
        const next = lines[index + 1];
        const isFirst = dropped === 0;
        if (!isFirst && !CONTINUES_LIST.test(previousDropped) && !STARTS_LIST_ITEM.test(next)) break;
        index += 1; dropped += 1; previousDropped = next;
      }
    }
  }
  return kept;
}

const COVER_PROMO_LINE = /(?:new york times|usa today|wall street journal|bestsell|best-sell|award[- ]winning|award winner|international bestseller|acclaimed author|critically acclaimed)/i;
const COVER_SERIES_LINE = /\b(?:series|saga|trilogy|duology|chronicles|cycle|books?)\s*(?:#|no\.?\s*)?\d*\s*$/i;
const COVER_GENRE_LINE = /^\s*(?:an?\s+)?(?:dark\s+)?(?:mafia|paranormal|contemporary|historical|fantasy|romantic|gothic|sports|holiday|monster|vampire|werewolf|billionaire|small[- ]town|romantic suspense)\s+(?:romance|novel|thriller|fantasy|mystery)\s*$/i;
const COVER_TAGLINE_START = /^(?:her|his|their|she|he|they|when|once|if|every|nothing|no one|one)\b/i;

/** Lines safe to demote from scanner title retrieval. This is deliberately
 * conservative: classification changes query priority only, never identity
 * verification, and ambiguous text remains available as OCR evidence. */
export function isDemotedCoverTitleLine(value: string): boolean {
  const line = value.trim();
  const tokens = wordsOf(line);
  if (!tokens.length) return true;
  if (COVER_PROMO_LINE.test(line)) return true;
  if (COVER_SERIES_LINE.test(line)) return true;
  if (COVER_GENRE_LINE.test(line)) return true;
  // Taglines are normally sentence-like clauses. Do not demote short phrases
  // merely because they begin with a pronoun; real titles can do that too.
  return tokens.length >= 5 && COVER_TAGLINE_START.test(line);
}

export function prioritizeCoverTitleLines(lines: string[]): string[] {
  const strong = lines.filter((line) => !isDemotedCoverTitleLine(line));
  const demoted = lines.filter((line) => isDemotedCoverTitleLine(line));
  return [...strong, ...demoted];
}

const SHORT_TITLE_STOPWORDS = new Set(['the','and','for','of','by','an','to','in','on','at','or','as','a']);

export function shortTitleQueries(cleanLines: string[], maxQueries = 3): string[] {
  const shortLines = cleanLines.filter((line) => {
    const tokens = wordsOf(line);
    return tokens.length === 1 && tokens[0].length >= 2 && tokens[0].length <= 3
      && !SHORT_TITLE_STOPWORDS.has(tokens[0]) && /^[a-z]+$/.test(tokens[0]);
  });
  if (!shortLines.length) return [];

  const nameLike: string[] = [];
  for (let index = 0; index < cleanLines.length; index += 1) {
    const tokens = wordsOf(cleanLines[index]);
    const nextTokens = wordsOf(cleanLines[index + 1] ?? '');
    if (tokens.length >= 2 && tokens.length <= 3) nameLike.push(cleanLines[index]);
    if (tokens.length === 1 && tokens[0].length >= 3 && nextTokens.length === 1 && nextTokens[0].length >= 3) {
      nameLike.push(`${cleanLines[index]} ${cleanLines[index + 1]}`);
    }
  }

  const queries: string[] = [];
  for (const short of shortLines) for (const name of nameLike) {
    if (wordsOf(name).join(' ') === wordsOf(short).join(' ')) continue;
    queries.push(`${short} ${name}`.replace(/\s+/g, ' ').trim());
  }
  return [...new Set(queries)].slice(0, maxQueries);
}


/** Build bounded author retrieval hints from cover OCR. This only improves
 * candidate retrieval; scanner verification still decides book identity. */
export function coverAuthorQueries(cleanLines: string[], maxQueries = 3): string[] {
  const structuralQueries: string[] = [];
  const strongQueries: string[] = [];
  const heuristicQueries: string[] = [];
  const queries: string[] = [];

  // Native OCR repeats the same printed name across image treatments. Use
  // those repeated passes to reconstruct internally spaced name words before
  // pairing them. A complete token such as BETHAN is stronger than BETH AN;
  // for a surname, CRO ME -> CROME is stronger than a one-glyph-damaged
  // alternative such as GR O ME -> GROME. This only creates retrieval hints;
  // photographed title + author verification still decides the work.
  const compactNameWords = cleanLines.flatMap((line) => {
    const tokens = wordsOf(line);
    if (tokens.length === 1 && tokens[0].length >= 4 && tokens[0].length <= 12) {
      return [tokens[0]];
    }
    if (tokens.length >= 2 && tokens.length <= 3
      && tokens.every((token) => token.length >= 1 && token.length <= 4)) {
      const joined = tokens.join('');
      return joined.length >= 4 && joined.length <= 12 ? [joined] : [];
    }
    return [];
  });
  const nameWordCounts = new Map<string, number>();
  for (const value of compactNameWords) {
    nameWordCounts.set(value, (nameWordCounts.get(value) ?? 0) + 1);
  }
  const repeatedNameWords = [...nameWordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([value]) => value);
  const completeNameWords = cleanLines
    .map((line) => wordsOf(line))
    .filter((tokens) => tokens.length === 1 && tokens[0].length >= 4 && tokens[0].length <= 12)
    .map((tokens) => tokens[0]);
  const preferredGivenNames = [...new Set([...completeNameWords, ...repeatedNameWords])];
  const preferredSurnames = [...new Set(repeatedNameWords
    .filter((value) => !preferredGivenNames.slice(0, 1).includes(value)))];

  for (const given of preferredGivenNames.slice(0, 3)) {
    for (const surname of preferredSurnames.slice(0, 5)) {
      if (given === surname) continue;
      // Require the pair to be independently represented by at least two OCR
      // observations overall; this prevents arbitrary one-off cover words from
      // being promoted into strong author identity.
      if ((nameWordCounts.get(given) ?? 0) + (nameWordCounts.get(surname) ?? 0) < 3) continue;
      heuristicQueries.push(`${given} ${surname}`);
    }
  }

  // Native OCR also splits ordinary two-word names across adjacent one-word
  // lines ("SUZANNE" / "COLLINS"). Preserve those pairs before heuristic
  // cross-pass combinations can consume the bounded author-query budget.
  // This is retrieval-only: title + author verification still decides identity.
  for (let index = 0; index < cleanLines.length - 1; index += 1) {
    const current = wordsOf(cleanLines[index]);
    const next = wordsOf(cleanLines[index + 1]);
    if (current.length !== 1 || next.length !== 1) continue;
    const first = current[0];
    const second = next[0];
    if (first.length < 4 || second.length < 4 || first.length > 12 || second.length > 12) continue;
    if (isDemotedCoverTitleLine(cleanLines[index]) || isDemotedCoverTitleLine(cleanLines[index + 1])) continue;
    structuralQueries.push(`${first} ${second}`);
  }

  // A complete 2-4 word cover line is often the strongest author hint.
  // Keep it available even when no initials or OCR fragmentation are present.
  for (const line of cleanLines) {
    const tokens = wordsOf(line);
    if (tokens.length >= 2 && tokens.length <= 4
      && tokens.every((token) => token.length >= 2)
      && !isDemotedCoverTitleLine(line)) {
      queries.push(tokens.join(' '));
    }
  }

  for (let index = 0; index < cleanLines.length; index += 1) {
    const tokens = wordsOf(cleanLines[index]);
    const nextTokens = wordsOf(cleanLines[index + 1] ?? '');

    // Decorative given names may be split inside one printed line while the
    // surname remains on the next line: "BE THA N" / "CROME" -> "bethan crome".
    // Keep this deliberately narrow so prose cannot be collapsed into a name.
    if (tokens.length >= 2 && tokens.length <= 4
      && tokens.every((token) => token.length <= 4)
      && nextTokens.length === 1 && nextTokens[0].length >= 3) {
      queries.push(`${tokens.join('')} ${nextTokens[0]}`);
    }

    // A later OCR pass may recover the given name completely while leaving
    // only the surname fragmented nearby: "BETHAN" / "CRO ME" ->
    // "bethan crome". Keep the window tiny and require a single substantial
    // given-name token plus exactly two short surname fragments. Retrieval
    // only; the photographed work still has to pass full title+author proof.
    if (tokens.length === 1 && tokens[0].length >= 4 && tokens[0].length <= 12) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const nearbyTokens = wordsOf(cleanLines[index + offset] ?? '');
        if (nearbyTokens.length !== 2
          || !nearbyTokens.every((token) => token.length >= 2 && token.length <= 4)) continue;
        structuralQueries.push(`${tokens[0]} ${nearbyTokens.join('')}`);
      }
    }

    // Native OCR can split BOTH printed name words internally. Allow two or
    // three short fragments per printed word because mobile OCR commonly sees
    // "BETH AN" / "CR O ME". Keep the window tiny; verification still proves
    // the catalog identity and prevents these retrieval hints from accepting a
    // wrong work.
    if (tokens.length >= 2 && tokens.length <= 3
      && tokens.every((token) => token.length >= 1 && token.length <= 4)) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const nearbyTokens = wordsOf(cleanLines[index + offset] ?? '');
        if (nearbyTokens.length < 2 || nearbyTokens.length > 3
          || !nearbyTokens.every((token) => token.length >= 1 && token.length <= 4)) continue;
        strongQueries.push(`${tokens.join('')} ${nearbyTokens.join('')}`);
      }
    }

    // Both printed author words can be internally fragmented on adjacent
    // lines ("KATHLE EN" / "GLAS GOW"). Treat that direct structural pair as
    // stronger than wider-window combinations, which can pair title debris
    // with a surname and exhaust the bounded author-query budget first.
    if (tokens.length >= 2 && tokens.length <= 3
      && tokens.every((token) => token.length >= 1 && token.length <= 4)
      && nextTokens.length >= 2 && nextTokens.length <= 3
      && nextTokens.every((token) => token.length >= 1 && token.length <= 4)) {
      structuralQueries.push(`${tokens.join('')} ${nextTokens.join('')}`);
    }

    // Initials are frequently captured on one pass while the surname lands on
    // a nearby pass: "S J" ... "TILLY" -> "s j tilly". This is stronger than
    // treating nearby genre/series copy as an author and gives the fast
    // title+author federation the identity humans can plainly read.
    if (tokens.length === 2 && tokens.every((token) => token.length <= 2)) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const nearbyTokens = wordsOf(cleanLines[index + offset] ?? '');
        if (nearbyTokens.length === 1 && nearbyTokens[0].length >= 4) {
          strongQueries.push(`${tokens.join(' ')} ${nearbyTokens[0]}`);
        }
      }
    }

    // OCR may split initials across adjacent lines while keeping the surname
    // attached to the final initial: "S J" / "J TILLY". Reuse the shared
    // initial and preserve the surname as strong author evidence.
    if (tokens.length === 2 && tokens.every((token) => token.length <= 2)) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const nearbyTokens = wordsOf(cleanLines[index + offset] ?? '');
        if (nearbyTokens.length === 2
          && nearbyTokens[0].length <= 2
          && nearbyTokens[1].length >= 4
          && (nearbyTokens[0] === tokens[1] || nearbyTokens[0] === tokens[0])) {
          strongQueries.push(`${tokens.join(' ')} ${nearbyTokens[1]}`);
        }
      }
    }

    if (tokens.length < 2 || tokens.length > 5) continue;
    const shortTokenCount = tokens.filter((token) => token.length <= 2).length;
    // Initialed author names are already structurally complete after
    // punctuation normalization: "S.J. Tilly" -> ["s","j","tilly"].
    // Preserve the initials instead of collapsing the final initial into the
    // surname ("s jtilly"), which poisons surname-based catalog retrieval.
    const leadingInitials = tokens.slice(0, -1).every((token) => token.length <= 2);
    const surname = tokens.at(-1) ?? '';
    // Initialed names can also have the surname split internally by native OCR:
    // "S J TIL LY" -> "s j tilly". Require at least two leading initial
    // fragments plus exactly two short surname fragments so ordinary prose
    // cannot consume the bounded strong-author budget.
    if (tokens.length === 4
      && tokens[0].length <= 2 && tokens[1].length <= 2
      && tokens[2].length >= 2 && tokens[2].length <= 4
      && tokens[3].length >= 2 && tokens[3].length <= 4) {
      strongQueries.push(`${tokens[0]} ${tokens[1]} ${tokens[2]}${tokens[3]}`);
    }
    // Native OCR can detach the first glyph of a printed given name while
    // leaving the surname intact: "A MBERN NICOLE" -> "ambern nicole".
    // Preserve that surname as a retrieval anchor instead of collapsing the
    // middle fragment into it. Candidate identity still requires verification.
    if (tokens.length === 3 && tokens[0].length <= 2
      && tokens[1].length >= 3 && surname.length >= 3) {
      strongQueries.push(`${tokens[0]}${tokens[1]} ${surname}`);
    } else if (tokens.length >= 3 && leadingInitials && surname.length >= 3) {
      // Initials + surname is much stronger author structure than a generic
      // 2-4 word OCR line. Keep it ahead of noisy prose within the bounded
      // retrieval budget instead of letting earlier cover noise crowd it out.
      strongQueries.push(tokens.join(' '));
    } else if (shortTokenCount >= 1 && tokens.length >= 3) {
      const firstLong = tokens.findIndex((token) => token.length > 2);
      const prefixCount = Math.min(2, firstLong < 0 ? 2 : firstLong);
      const split = Math.max(1, prefixCount);
      queries.push(`${tokens.slice(0, split).join(' ')} ${tokens.slice(split).join('')}`.trim());
    } else if (tokens.length === 2) {
      queries.push(cleanLines[index].trim());
    }
  }

  const normalizeQueries = (values: string[]) => [...new Set(values
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .filter(Boolean))];

  const structural = normalizeQueries(structuralQueries);
  const strong = normalizeQueries(strongQueries);
  const heuristic = normalizeQueries(heuristicQueries);
  const generic = normalizeQueries(queries);

  // The scanner intentionally keeps a tiny author-query budget, but one noisy
  // structural family must not monopolize all three slots. Preserve the
  // strongest direct structural identity first, then reserve space for strong
  // OCR author structure before filling remaining slots. This keeps Dawn's
  // detached-glyph "... nicole" evidence while retaining adjacent split names
  // such as Suzanne Collins and Kathleen Glasgow.
  const prioritized: string[] = [];
  const add = (value?: string) => {
    if (value && !prioritized.includes(value)) prioritized.push(value);
  };
  add(structural[0]);
  add(strong[0]);
  for (const value of [...structural.slice(1), ...strong.slice(1), ...heuristic, ...generic]) {
    add(value);
    if (prioritized.length >= maxQueries) break;
  }
  return prioritized.slice(0, maxQueries);
}


/** Build a few conservative retrieval fragments from a long, damaged,
 * single-token title OCR line. Providers can often recover a catalog work from
 * an intact interior run even when decorative first/last glyphs are wrong.
 * These are retrieval hints only; full cover verification remains mandatory. */
export function damagedTitleFragments(value: string, maxFragments = 3): string[] {
  const tokens = wordsOf(value);
  if (tokens.length !== 1) return [];
  const compact = tokens[0];
  if (compact.length < 8 || compact.length > 16) return [];

  const fragmentLength = Math.min(8, compact.length - 2);
  if (fragmentLength < 6) return [];
  const starts = [
    1,
    Math.max(1, Math.floor((compact.length - fragmentLength) / 2)),
    Math.max(1, compact.length - fragmentLength - 1),
  ];
  return [...new Set(starts
    .map((start) => compact.slice(start, start + fragmentLength))
    .filter((fragment) => fragment.length >= 6))]
    .slice(0, maxFragments);
}


/** Reconstruct title-shaped runs when native OCR splits a decorative title
 * into one-token lines. Stop at lines that look like series/promo/author copy.
 * Retrieval only: catalog candidates must still pass scanner verification. */
export function splitTitleRunQueries(cleanLines: string[], maxQueries = 3): string[] {
  const stop = new Set(['a','an','by']);
  const queries: string[] = [];
  for (let start = 0; start < cleanLines.length; start += 1) {
    const parts: string[] = [];
    for (let index = start; index < cleanLines.length && index < start + 6; index += 1) {
      const line = cleanLines[index];
      const tokens = wordsOf(line);
      if (tokens.length !== 1 || isDemotedCoverTitleLine(line)) break;
      const token = tokens[0];
      if (stop.has(token)) break;
      parts.push(token);
      if (parts.length >= 3) {
        const phrase = parts.join(' ');
        const meaningful = parts.filter((word) => word.length >= 4);
        if (meaningful.length >= 2 && phrase.length >= 8) queries.push(phrase);
      }
    }
  }
  return [...new Set(queries)].sort((left, right) => wordsOf(right).length - wordsOf(left).length).slice(0, maxQueries);
}


/** Build a few retrieval-only anchors from distinctive OCR title words plus
 * an author surname. This is a last-resort candidate lookup for covers where
 * native OCR captured the important words across separate passes/lines but
 * damaged glue words or the author's given name. Identity is never accepted
 * here; scanner verification must still prove the returned title + author. */
export function titleSurnameRecoveryQueries(
  cleanLines: string[],
  authorQueries: string[],
  maxQueries = 4,
): string[] {
  const weak = new Set(['a','an','and','as','at','by','for','from','in','of','on','or','the','to']);
  // Only surnames are safe to exclude from title anchors. OCR recovery hints
  // can contain noisy given-name/title-word combinations; excluding every word
  // from those hints can erase real photographed title evidence such as
  // DAWN / CURSEID / QUEEN before the surname anchor is built.
  const authorSurnames = new Set(authorQueries
    .map((query) => wordsOf(query).at(-1) ?? '')
    .filter(Boolean));
  const authorWords = new Set(authorQueries.flatMap((query) => wordsOf(query)));
  const titleWordCounts = new Map<string, { count: number; firstIndex: number }>();

  cleanLines.forEach((line, lineIndex) => {
    if (isDemotedCoverTitleLine(line)) return;
    const tokens = wordsOf(line);
    // Long prose/name-shaped lines are poor title anchors. The useful case is
    // one or two distinctive words surviving independently across OCR passes.
    if (tokens.length > 2) return;
    for (const token of tokens) {
      if (token.length < 4 || weak.has(token) || authorSurnames.has(token) || authorWords.has(token)) continue;
      const current = titleWordCounts.get(token);
      titleWordCounts.set(token, {
        count: (current?.count ?? 0) + 1,
        firstIndex: current?.firstIndex ?? lineIndex,
      });
    }
  });

  // Native OCR gives us several passes. A real title word that survives more
  // than once is stronger retrieval evidence than a one-off fragment that
  // happened to appear earlier in OCR order. Rank by repeated evidence first,
  // then retain cover order for equally supported words. This prevents noisy
  // early fragments from consuming every bounded title+surname query.
  const distinctive = [...titleWordCounts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].firstIndex - right[1].firstIndex)
    .map(([word]) => word)
    .slice(0, 5);
  const surnames = [...new Set(authorQueries
    .map((query) => wordsOf(query).at(-1) ?? '')
    .filter((surname) => surname.length >= 4))].slice(0, 2);
  if (!distinctive.length || !surnames.length) return [];

  // Keep the widest bounded anchor first. Decorative covers often split a
  // multi-word title into separate OCR lines; four independently surviving
  // title words are still a safer retrieval query than dropping one of them.
  // This remains retrieval-only: the returned work must pass full cover
  // title + author verification before Scanner can accept it.
  const anchors = [
    distinctive.slice(0, 4).join(' '),
    distinctive.slice(0, 3).join(' '),
    distinctive.slice(0, 2).join(' '),
    distinctive[0],
  ].filter((value) => value.length >= 4);
  // Give every recovered surname the strongest title anchor before spending
  // the bounded query budget on weaker title variants. OCR can produce one
  // damaged author reconstruction ahead of the intact surname; title-first
  // expansion could otherwise consume the whole budget before the valid
  // title+surname pair is attempted.
  return [...new Set(anchors.flatMap((title) => surnames.map((surname) => `${title} ${surname}`)))]
    .slice(0, maxQueries);
}
