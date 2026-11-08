/** Scanner-only, deterministic cover-text helpers. Pure functions: no network,
 * no React. Do not alter Search ranking. */

const wordsOf = (value: string): string[] =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

const AUTHOR_OF = /\b(?:author|authors|creator)\s+of\b/i;
const PROMO_WORDS = /(?:bestsell|best-sell|new york times|usa today|wall street journal|award|winner|international|acclaimed|critically|number one|#\s*\d)/i;
const CONTINUES_LIST = /(?:\band|&|,)\s*$/i;
const STARTS_LIST_ITEM = /^\s*(?:and|&)\b/i;
const STANDALONE_PROMO = /^\s*(?:now an?\b|soon to be an?\b|as seen on\b|an instant\b|a #\s*1\b)/i;

/** Marks OCR lines that belong to an "author of <other title>" promo block,
 * including the common OCR layout where the referenced sibling title is
 * detached onto the next line. This is scanner-only contextual classification:
 * the text remains available for diagnostics, but cannot prove work identity. */
export function coverPromoContextIndexes(lines: string[]): Set<number> {
  const demoted = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = AUTHOR_OF.exec(line);
    if (!match) continue;
    demoted.add(index);

    const tail = line.slice(match.index + match[0].length).trim();
    // "Author of" with no inline title means OCR split the referenced work
    // onto following line(s). Demote only a tight, title-shaped continuation;
    // never consume the actual photographed title farther down the cover.
    if (!tail) {
      for (let offset = 1; offset <= 2 && index + offset < lines.length; offset += 1) {
        const nextIndex = index + offset;
        const next = lines[nextIndex];
        const tokens = wordsOf(next);
        if (!tokens.length || tokens.length > 5) break;
        if (PROMO_WORDS.test(next) || STANDALONE_PROMO.test(next)) {
          demoted.add(nextIndex);
          continue;
        }
        demoted.add(nextIndex);
        break;
      }
    }
  }
  // Endorsement credits often span several OCR lines and the word "author"
  // can be misread. A quoted blurb followed by an em-dash attribution is
  // promotional context, not the photographed work's title or author.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!/^[\\u2014\\u2013-]\\s*[A-Za-z]{3,}\\s+[A-Za-z]{3,}/.test(line)) continue;
    demoted.add(index);
    for (let previous = index - 1, steps = 0; previous >= 0 && steps < 7; previous -= 1, steps += 1) {
      const text = lines[previous].trim();
      if (!text || (text === text.toUpperCase() && !/[\\u201c\\u201d"']/u.test(text) && wordsOf(text).length <= 2)) break;
      demoted.add(previous);
      if (/[\\u201c"]/u.test(text)) break;
    }
    for (let next = index + 1; next < lines.length && next <= index + 3; next += 1) {
      if (!/(?:best\\s*sell|bestsol|bestsoll|suthor|author|new\\s+york|of\\s+\\w+)/i.test(lines[next])) break;
      demoted.add(next);
    }
  }
  return demoted;
}

export function stripCoverPromoLines(lines: string[]): string[] {
  const kept: string[] = [];
  const contextualPromo = coverPromoContextIndexes(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (contextualPromo.has(index)) continue;
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

const COVER_PROMO_LINE = /(?:new york times|new york ti(?:me|es)|usa today|wall street journal|bestsell|best-sell|bestsol|bestsoll|suthor|award[- ]winning|award winner|international bestseller|acclaimed author|critically acclaimed)/i;
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
  // Bestseller-count badges can be badly damaged by decorative OCR:
  // "OVER ONE MILLION COPIES SOLD" -> "OVERONE M ONCoPIES SOLD".
  // A sales-count claim is promotional copy, never title evidence. Require
  // both a copies fragment and SOLD to avoid demoting ordinary titles.
  const compact = tokens.join('');
  if (/cop(?:ies|ys)/.test(compact) && /sold/.test(compact)
    && /(?:over|million)/.test(compact)) return true;
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
export function coverAuthorQueries(cleanLines: string[], maxQueries = 12): string[] {
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
  // Repeated compact words are useful only when OCR observed them in a
  // plausible local name structure. Do not manufacture a global cross-product
  // of every repeated cover word: that makes unrelated title/promo fragments
  // compete with real author identities and turns query ordering into
  // fixture-by-fixture whack-a-mole.
  for (let index = 0; index < cleanLines.length; index += 1) {
    const currentTokens = wordsOf(cleanLines[index]);
    const currentCompact = currentTokens.length >= 2 && currentTokens.length <= 3
      && currentTokens.every((token) => token.length >= 1 && token.length <= 4)
      ? currentTokens.join('')
      : currentTokens.length === 1 ? currentTokens[0] : '';
    if (!currentCompact || (nameWordCounts.get(currentCompact) ?? 0) < 2) continue;

    for (let offset = 1; offset <= 3; offset += 1) {
      const nearbyTokens = wordsOf(cleanLines[index + offset] ?? '');
      const nearbyCompact = nearbyTokens.length >= 2 && nearbyTokens.length <= 3
        && nearbyTokens.every((token) => token.length >= 1 && token.length <= 4)
        ? nearbyTokens.join('')
        : nearbyTokens.length === 1 ? nearbyTokens[0] : '';
      if (!nearbyCompact || nearbyCompact === currentCompact) continue;
      if ((nameWordCounts.get(nearbyCompact) ?? 0) < 2) continue;
      heuristicQueries.push(`${currentCompact} ${nearbyCompact}`);
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

    // A printed given name is often split into a long head and a short tail
    // ("KATHLE EN") directly above an equally split surname ("GLAS GOW").
    // Allow one head up to six characters when the final fragment is short and
    // each recombined word stays a plausible name length. Structural pairs
    // only; title + author verification still decides identity.
    const fragmentedNameWord = (parts: string[]): boolean =>
      parts.length >= 2 && parts.length <= 3
      && parts.every((part) => part.length >= 1 && part.length <= 6)
      && parts.at(-1)!.length <= 4
      && parts.join('').length >= 5 && parts.join('').length <= 12;
    if (fragmentedNameWord(tokens) && fragmentedNameWord(nextTokens)
      && !isDemotedCoverTitleLine(cleanLines[index])
      && !isDemotedCoverTitleLine(cleanLines[index + 1] ?? '')) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const partner = wordsOf(cleanLines[index + offset] ?? '');
        if (!fragmentedNameWord(partner)) continue;
        if (tokens.join('') === partner.join('')) continue;
        structuralQueries.push(`${tokens.join('')} ${partner.join('')}`);
        // A complete given name followed by one stray glyph ("BETHAN R")
        // keeps the name usable: retrieve with the name alone as well.
        if (tokens.length === 2 && tokens[0].length >= 5 && tokens[1].length === 1) {
          structuralQueries.push(`${tokens[0]} ${partner.join('')}`);
        }
      }
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
  // Rank evidence before applying the tiny network-query budget. Native OCR
  // produces several passes, so the same printed author often appears in
  // multiple structural forms. First-come-first-served ordering lets an early
  // accidental pair crowd out a later, independently repeated author name.
  const normalizedEvidenceWords = cleanLines.flatMap((line) => {
    const tokens = wordsOf(line);
    const values = [...tokens];
    // A printed word split by decorative typography is still one OCR
    // observation. Compact only lines made entirely of short fragments so
    // ordinary multi-word prose cannot masquerade as a name word.
    if (tokens.length >= 2 && tokens.length <= 4
      && tokens.every((token) => token.length >= 1 && token.length <= 4)) {
      values.push(tokens.join(''));
    } else if (tokens.length >= 2 && tokens.length <= 3
      && tokens.every((token) => token.length >= 1 && token.length <= 6)
      && tokens.at(-1)!.length <= 4
      && tokens.join('').length >= 5 && tokens.join('').length <= 12) {
      // Long head + short tail ("KATHLE EN") is the same single printed
      // word split by decorative typography.
      values.push(tokens.join(''));
    }
    return values;
  });
  const evidenceCounts = new Map<string, number>();
  for (const value of normalizedEvidenceWords) {
    evidenceCounts.set(value, (evidenceCounts.get(value) ?? 0) + 1);
  }

  const supportForWord = (word: string): number => {
    const exact = evidenceCounts.get(word) ?? 0;
    if (exact > 0) return exact;
    // Repeated OCR passes can differ by a trailing/missing glyph. Prefix
    // agreement is useful only when the evidence itself repeated.
    return [...evidenceCounts.entries()].some(([evidence, count]) =>
      count >= 2
      && Math.min(evidence.length, word.length) >= 4
      && (evidence.startsWith(word) || word.startsWith(evidence)))
      ? 1
      : 0;
  };

  const families = [
    ...structural.map((query) => ({ query, structural: 3 })),
    ...strong.map((query) => ({ query, structural: 2 })),
    ...heuristic.map((query) => ({ query, structural: 1 })),
    ...generic.map((query) => ({ query, structural: 0 })),
  ];
  const bestByQuery = new Map<string, { query: string; structural: number; support: number; complete: number }>();
  for (const candidate of families) {
    const queryWords = wordsOf(candidate.query);
    if (queryWords.length < 2) continue;
    const meaningful = queryWords.filter((word) => word.length >= 3);
    const support = meaningful.reduce((total, word) => total + supportForWord(word), 0);
    const complete = meaningful.filter((word) => supportForWord(word) > 0).length;
    const current = bestByQuery.get(candidate.query);
    const scored = { ...candidate, support, complete };
    if (!current
      || scored.support > current.support
      || (scored.support === current.support && scored.complete > current.complete)
      || (scored.support === current.support && scored.complete === current.complete
        && scored.structural > current.structural)) {
      bestByQuery.set(candidate.query, scored);
    }
  }

  const ranked = [...bestByQuery.values()]
    .sort((left, right) =>
      right.support - left.support
      || right.complete - left.complete
      || right.structural - left.structural
      || wordsOf(right.query).length - wordsOf(left.query).length);

  // Reconstruction output is also consumed by title+surname recovery. Reserve
  // space for structurally recovered surname identities before truncating so a
  // noisy cover cannot erase an intact surname merely because unrelated OCR
  // combinations scored ahead of its full author query.
  const evidenceBacked = ranked
    .filter((candidate) => candidate.support > 0 && candidate.complete > 0)
    .map(({ query }) => query);
  // Preserve directly adjacent, intact two-word name structures before
  // noisy cross-pass pairings consume the author-query budget. OCR often
  // places the author's given name and surname on separate lines, while
  // decorative cover text generates many more speculative combinations.
  // This only retrieves candidates; coverMatchesWork still verifies identity.
  const directNamePairs: string[] = [];
  for (let index = 0; index + 1 < cleanLines.length; index += 1) {
    const first = wordsOf(cleanLines[index]);
    const second = wordsOf(cleanLines[index + 1]);
    if (first.length !== 1 || second.length !== 1) continue;
    if (first[0].length < 4 || second[0].length < 4) continue;
    if (first[0].length > 12 || second[0].length > 12) continue;
    if (isDemotedCoverTitleLine(cleanLines[index])
      || isDemotedCoverTitleLine(cleanLines[index + 1])) continue;
    // Require corroboration from another OCR observation to distinguish a
    // printed author name from two accidental neighboring title fragments.
    if (supportForWord(first[0]) + supportForWord(second[0]) < 3) continue;
    directNamePairs.push(`${first[0]} ${second[0]}`);
  }
  const ordered = [
    ...directNamePairs,
    ...evidenceBacked,
    ...ranked.map(({ query }) => query),
  ];
  return [...new Set(ordered)].slice(0, Math.max(1, maxQueries));
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
  // Words that appear as standalone title-shaped OCR (<=2 tokens, not promo)
  // are ambiguous: they may be title words that merely landed in an author
  // query. A surname seen only inside longer author-shaped lines is stronger
  // author evidence, so it must not be crowded out of the bounded candidate
  // list by title words that were paired into speculative author queries.
  const titlePool = new Set<string>();
  for (const line of cleanLines) {
    if (isDemotedCoverTitleLine(line)) continue;
    const lineTokens = wordsOf(line);
    if (lineTokens.length > 2) continue;
    for (const token of lineTokens) titlePool.add(token);
  }
  const surnameCandidates = [...new Set(authorQueries
    .map((query) => wordsOf(query).at(-1) ?? '')
    .filter((surname) => surname.length >= 4))]
    .map((surname, index) => ({ surname, index, authorOnly: titlePool.has(surname) ? 0 : 1 }))
    .sort((left, right) => right.authorOnly - left.authorOnly || left.index - right.index)
    // Recovery queries are retrieval hints, not identity proof. The
    // caller/verifier remains responsible for accepting a catalog work.
    .map(({ surname }) => surname)
    .slice(0, maxQueries);
  if (!surnameCandidates.length) return [];

  // Keep title and author evidence independent. A speculative author query may
  // contain a real title word, so author hints must never globally subtract
  // words from title evidence. For each surname candidate, exclude only that
  // surname while building its retrieval anchor.
  const strongest: string[] = [];
  const weaker: string[] = [];

  for (const surname of surnameCandidates) {
    const counts = new Map<string, { count: number; firstIndex: number }>();
    cleanLines.forEach((line, lineIndex) => {
      if (isDemotedCoverTitleLine(line)) return;
      const tokens = wordsOf(line);
      if (tokens.length > 2) return;
      // A two-token line ending in a 1-3 character tail ("GLAS GOW",
      // "KATHLE EN") is one printed word split by OCR. Its pieces are debris,
      // not distinctive title words, and repeated passes would otherwise
      // outrank whole title words such as PIECES.
      if (tokens.length === 2 && tokens[1].length <= 3) return;
      for (const token of tokens) {
        if (token.length < 4 || weak.has(token) || token === surname) continue;
        const current = counts.get(token);
        counts.set(token, {
          count: (current?.count ?? 0) + 1,
          firstIndex: current?.firstIndex ?? lineIndex,
        });
      }
    });

    // Words consumed by this reconstructed author identity are poor title
    // evidence. A word that is ALSO standalone title-shaped OCR and was paired
    // with the surname in only one speculative author query (e.g. "pieces
    // glasgow") is more likely a title word than a given name, so keep it.
    const surnameQueries = authorQueries.filter((query) => wordsOf(query).at(-1) === surname);
    const authorWordUse = new Map<string, number>();
    for (const query of surnameQueries) {
      for (const word of new Set(wordsOf(query))) {
        if (word !== surname) authorWordUse.set(word, (authorWordUse.get(word) ?? 0) + 1);
      }
    }
    const authorWordsForSurname = new Set([...authorWordUse.entries()]
      .filter(([word, uses]) => uses >= 2 || !titlePool.has(word))
      .map(([word]) => word));

    // OCR damage variants of the author's own words ("GEASGOW", "ATALEEN")
    // are not title evidence either; drop near-duplicates of the surname and
    // of the reconstructed author words so real title words can surface.
    const nearWord = (author: string, word: string): boolean => {
      if (author === word) return true;
      if (Math.min(author.length, word.length) >= 5
        && (author.endsWith(word) || word.endsWith(author)
          || author.startsWith(word) || word.startsWith(author))) return true;
      if (Math.abs(author.length - word.length) > 1 || Math.min(author.length, word.length) < 5) return false;
      let edits = 0;
      let a = 0; let b = 0;
      while (a < author.length && b < word.length) {
        if (author[a] === word[b]) { a += 1; b += 1; continue; }
        edits += 1;
        if (edits > 1) return false;
        if (author.length > word.length) a += 1;
        else if (author.length < word.length) b += 1;
        else { a += 1; b += 1; }
      }
      return edits + (author.length - a) + (word.length - b) <= 1;
    };
    const nearAuthorWord = (word: string): boolean =>
      [surname, ...authorWordsForSurname].some((author) => nearWord(author, word));

    const distinctive = [...counts.entries()]
      .filter(([word]) => !nearAuthorWord(word))
      // Words already consumed as part of this reconstructed author identity
      // are poor title evidence. Keep title reconstruction independent without
      // globally subtracting words used by OTHER speculative author hints.
      .filter(([word]) => !authorWordsForSurname.has(word))
      .sort((left, right) =>
        right[1].count - left[1].count
        || left[1].firstIndex - right[1].firstIndex)
      .map(([word]) => word)
      // A one-glyph OCR variant of an already-ranked title word ("REIEN"
      // beside "REIGN") is the same evidence, not a second title word.
      .reduce<string[]>((kept, word) =>
        kept.some((existing) => nearWord(existing, word)) ? kept : [...kept, word], [])
      .slice(0, 5);
    if (!distinctive.length) continue;

    const anchors = [
      distinctive.slice(0, 4).join(' '),
      distinctive.slice(0, 3).join(' '),
      distinctive.slice(0, 2).join(' '),
      distinctive[0],
    ].filter((value) => value.length >= 4);
    if (anchors[0]) strongest.push(`${anchors[0]} ${surname}`);
    for (const anchor of anchors.slice(1)) weaker.push(`${anchor} ${surname}`);
  }

  // Every recovered surname gets one strongest title anchor before the bounded
  // budget is spent on weaker variants.
  return [...new Set([...strongest, ...weaker])].slice(0, maxQueries);
}

// ---------------------------------------------------------------------------
// Evidence ranking for scanner retrieval.
//
// coverAuthorQueries() deliberately over-generates author-shaped hints from
// noisy OCR. Live scans showed the REAL author buried behind blurb/genre lines
// ("new york tim", "adark mafia romance"), so the small request budget was
// spent on junk. These helpers only ORDER retrieval hints; catalog results are
// still accepted solely by the photographed title + author verifier.

const COVER_COPY_WORDS = new Set([
  'the','a','an','and','of','that','is','to','in','for','with','from','by','on','at',
  'new','york','times','tim','timee','book','books','author','authors','exclusive','edition',
  'dark','adark','mafia','romance','novel','series','saga','trilogy','duology','thriller','fantasy','mystery',
  'bestselling','bestseller','bestsellers','luminous','exhilarating','sizzles',
]);
const COVER_COPY_COMPACT_END = /(?:romance|series|eries|novel|thriller|fantasy|mystery|saga|trilogy|duology)$/;
const COVER_COPY_PREFIX = /^(?:bestsel|bestsal|bestsol|bastsel|exhilar|exhilir|tim(?:e|es)?$)/;

const isCoverCopyWord = (word: string): boolean =>
  COVER_COPY_WORDS.has(word) || COVER_COPY_PREFIX.test(word);

/** True for printed all-caps typography (titles and author names). Blurbs,
 * taglines and review quotes are normally sentence case. */
/** Tokens with the unambiguous "lone glyph + whole word" shape ("R REIGN")
 * reduced to the word, so OCR debris does not make a title look multi-word. */
const coreTokens = (line: string): string[] => {
  const tokens = wordsOf(line);
  if (tokens.length === 2 && tokens[0].length === 1 && tokens[1].length >= 4) return [tokens[1]];
  if (tokens.length === 2 && tokens[1].length === 1 && tokens[0].length >= 4) return [tokens[0]];
  return tokens;
};

const isAllCapsLine = (line: string): boolean =>
  /[A-Z]{2}/.test(line) && !/[a-z]/.test(line);

const lightEditDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 3) return 4;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[right.length];
};

/** Collapse OCR spelling variants of one printed name/title. */
const sameOcrWord = (left: string, right: string): boolean => {
  if (left === right) return true;
  const shortest = Math.min(left.length, right.length);
  if (shortest < 4) return false;
  return lightEditDistance(left, right) <= (shortest >= 7 ? 2 : 1);
};

/** Order author hints so the real printed author is tried first. Pure ordering:
 * nothing is removed except exact duplicates, so retrieval can still fall
 * through to weaker hints. `titleWords` are words already claimed as title
 * evidence; a hint that merely pairs a title word with a name fragment is
 * ranked below one that does not. */
export function rankAuthorHints(
  cleanLines: string[],
  hints: string[],
  titleWords: string[] = [],
): string[] {
  const capsTokens = cleanLines.filter(isAllCapsLine).map(wordsOf);
  const capsWords = new Set(capsTokens.flatMap((tokens) => [...tokens, tokens.join('')]));
  // A word printed ONLY as its own large line (NERO, REIGN) and never inside a
  // multi-word line is title evidence. A word that also sits beside initials or
  // a given name (S.J. TILLY) is author evidence even when it repeats alone.
  const standaloneWords = new Set(cleanLines
    .filter((line) => isAllCapsLine(line) && coreTokens(line).length === 1)
    .flatMap((line) => coreTokens(line))
    .filter((word) => word.length >= 4));
  const multiWords = new Set(cleanLines
    .filter((line) => coreTokens(line).length >= 2)
    .flatMap((line) => { const tokens = coreTokens(line); return [...tokens, tokens.join('')]; }));
  const titleSet = new Set([
    ...titleWords,
    ...[...standaloneWords].filter((word) => !multiWords.has(word)),
  ]);
  const seen = new Set<string>();
  const scored = hints.flatMap((hint, index) => {
    const words = wordsOf(hint);
    const key = words.join(' ');
    if (!key || seen.has(key)) return [];
    seen.add(key);
    let score = 0;
    if (words.length < 2) score -= 20;
    if (new Set(words).size < words.length) score -= 20;
    if (words.some(isCoverCopyWord)) score -= 12;
    if (COVER_COPY_COMPACT_END.test(words.join(''))) score -= 12;
    // Native OCR splits marketing banners ("THE INSTANT #1 BESTSELLER")
    // into plausible two-word author hints such as "THH INSTAN".
    // Demote those hints even when their words are misspelled. This only
    // changes query order; it never manufactures an author or accepts a work.
    const promoRoots = ['instant', 'bestsell', 'copies', 'million', 'york', 'times'];
    const promoLike = (word: string): boolean => promoRoots.some((root) =>
      word.length >= 4 && (root.startsWith(word) || word.startsWith(root)
        || (word.length >= 5 && lightEditDistance(word, root) <= 2)));
    if (words.some(promoLike)) score -= 24;
    // Broken first/last names can still be the best available OCR evidence.
    // Prefer a compact, non-promotional name pair over banner fragments.
    if (words.length === 2 && words.every((word) => word.length >= 4)
      && !words.some(promoLike) && !words.some(isCoverCopyWord)) score += 3;
    if (words.some((word) => titleSet.has(word))) score -= 8;
    score += words.filter((word) => word.length >= 3 && capsWords.has(word)).length * 2;
    if (capsTokens.some((tokens) => tokens.join(' ') === key)) score += 4;
    if (words.length >= 3 && words.slice(0, -1).every((word) => word.length <= 2)
      && words.at(-1)!.length >= 4) score += 3;
    // A whole name is rarely shorter than ~7 letters; a lone surname fragment
    // pair ("CRO ME") is weaker than a recovered given name + surname.
    if (words.join('').length < 7) score -= 6;
    return [{ hint, index, score }];
  });
  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ hint }) => hint);
}

/** Rank the printed TITLE evidence on a cover. Titles are set in large
 * all-caps type and repeat across OCR passes with small spelling damage
 * (DEVOURED / DEVOURO), while blurbs are sentence case and series/genre lines
 * are demoted. Returns retrieval strings, strongest first, with OCR spelling
 * variants of the strongest cluster following it. */
export function coverTitleEvidenceHints(
  cleanLines: string[],
  authorHints: string[] = [],
  maxHints = 4,
): string[] {
  // A hint that pairs a name fragment with a word printed ONLY as its own big
  // line ("s j nero") is not trustworthy author evidence and must not exclude
  // that word from the title candidates.
  const standaloneOnly = new Set(cleanLines
    .filter((line) => isAllCapsLine(line) && coreTokens(line).length === 1)
    .flatMap((line) => coreTokens(line))
    .filter((word) => word.length >= 4
      && !cleanLines.some((other) => coreTokens(other).length >= 2
        && [...coreTokens(other), coreTokens(other).join('')].includes(word))));
  const trustedAuthorHints = authorHints.slice(0, 4)
    .filter((hint) => !wordsOf(hint).some((word) => standaloneOnly.has(word)));
  const authorWords = new Set(trustedAuthorHints.flatMap((hint) => wordsOf(hint)));
  const authorCompacts = new Set(trustedAuthorHints.map((hint) => wordsOf(hint).join('')));
  // Compare name-shaped OCR lines token by token. A missing initial letter in
  // "EBECCA ROSS" must not let the endorsement become the leading title.
  const matchesAuthorName = (tokens: string[]): boolean =>
    tokens.length >= 2 && trustedAuthorHints.some((hint) => {
      const reference = wordsOf(hint);
      if (reference.length !== tokens.length) return false;
      return tokens.every((token, index) => token === reference[index]
        || (token.length >= 3 && reference[index].length >= 3
          && lightEditDistance(token, reference[index]) <= 2));
    });
  type Cluster = { variants: Map<string, number>; count: number; base: number };
  const clusters: Cluster[] = [];

  for (const line of cleanLines) {
    if (!isAllCapsLine(line) || isDemotedCoverTitleLine(line)) continue;
    let tokens = wordsOf(line);
    // Stray single glyphs at the edges ("R REIGN") are OCR debris.
    // Only the unambiguous two-token shape: a lone glyph beside a whole word.
    // Longer fragment chains ("BETH A N") are damaged names, not titles.
    if (tokens.length === 2 && tokens[0].length === 1 && tokens[1].length >= 4) tokens = [tokens[1]];
    else if (tokens.length === 2 && tokens[1].length === 1 && tokens[0].length >= 4) tokens = [tokens[0]];
    if (tokens.length < 1 || tokens.length > 5) continue;
    const compact = tokens.join('');
    if (compact.length < 4 || compact.length > 32) continue;
    if (COVER_COPY_COMPACT_END.test(compact)) continue;
    if (tokens.some((token) => isCoverCopyWord(token) && !['the', 'a', 'an', 'of', 'and', 'in', 'to', 'on', 'at', 'for', 'with', 'from', 'is', 'that', 'by'].includes(token))
      && tokens.length > 1) continue;
    if (authorCompacts.has(compact) || matchesAuthorName(tokens)) continue;
    if (tokens.every((token) => authorWords.has(token) || token.length <= 2)) continue;
    // A fragmented author surname ("CRO ME") must not become title evidence.
    if ([...authorWords].some((word) => word.length >= 4 && sameOcrWord(word, compact))) continue;

    const text = tokens.join(' ');
    const base = tokens.length === 1 ? 3 : tokens.length <= 3 ? 2 : 0;
    const home = clusters.find((cluster) =>
      [...cluster.variants.keys()].some((variant) => sameOcrWord(variant.replace(/\s+/g, ''), compact)));
    if (home) {
      home.variants.set(text, (home.variants.get(text) ?? 0) + 1);
      home.count += 1;
      home.base = Math.max(home.base, base);
    } else {
      clusters.push({ variants: new Map([[text, 1]]), count: 1, base });
    }
  }

  const ranked = clusters
    .map((cluster) => {
      const variants = [...cluster.variants.entries()]
        .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
        .map(([text]) => text);
      // Prefer the LONGER spelling on ties: OCR drops glyphs far more often
      // than it invents them (DEVOURED beats DEVOUR).
      const longest = [...variants].sort((left, right) => right.length - left.length)[0];
      // Keep the complete spelling in the candidate pool even when a
      // truncated OCR variant occurs more often. Retrieval only: the
      // independent title/author verifier still decides acceptance.
      const top = longest;
      return {
        score: cluster.count * 2 + cluster.base,
        ordered: [top, ...variants.filter((variant) => variant !== top)],
      };
    })
    .sort((left, right) => right.score - left.score);

  const firsts = ranked.map((entry) => entry.ordered[0]);
  const seconds = ranked.flatMap((entry) => entry.ordered.slice(1, 2));
  // When OCR reads a credited author on one line and the photographed title
  // on another, do not let speculative author/title pairings erase the title.
  // Conversely, an intact two-word credited name should not be ranked as
  // two separate one-word titles (STEPHEN / KING / CARRIE).
  // Credited names may have initials (S. J. TILLY), not just two
  // full-length words. Exclude their surnames from title hints only when
  // the complete credited name is independently printed on an OCR line.
  // A speculative author hint alone must never hide a standalone title.
  const creditedWords = new Set(trustedAuthorHints
    .map(wordsOf)
    .filter((tokens) => tokens.length >= 2 && tokens.length <= 4
      && tokens.at(-1)!.length >= 4
      && (cleanLines.some((line) => wordsOf(line).join('') === tokens.join(''))
        // Native OCR may split BOTH name words across separate lines.
        // Require each full word to appear in independent OCR evidence;
        // speculative author pairings alone must not suppress title words.
        || tokens.filter((word) => word.length >= 4).every((word) =>
          cleanLines.some((line) => wordsOf(line).join('') === word))))
    .flatMap((tokens) => tokens.filter((word) => word.length >= 4)));
  const standalone = cleanLines
    .filter((line) => !isDemotedCoverTitleLine(line) && isAllCapsLine(line))
    .map(wordsOf)
    .filter((tokens) => tokens.length === 1 && tokens[0].length >= 4
      && !creditedWords.has(tokens[0]))
    .map((tokens) => tokens[0]);
  // Ranked clusters already choose the longest observed spelling. Keep that
  // ordering ahead of standalone OCR observations, otherwise a frequently
  // truncated spelling (DEVOURE) displaces the complete DEVOURED variant.
  // Standalone observations remain as fallback for title/author role errors.
  const candidates = [...firsts, ...standalone, ...seconds];
  return [...new Set(candidates.filter((candidate) =>
    !creditedWords.has(candidate) || standalone.includes(candidate)))].slice(0, Math.max(1, maxHints));
}

/** Queries that survive a damaged surname or given name: provider relevance
 * search copes far better with a title plus ONE correctly read name word than
 * with a title plus a misspelled full name. Retrieval only. */
export function titleAuthorPartQueries(titles: string[], authorHints: string[], maxQueries = 6): string[] {
  const budget = Math.max(1, maxQueries);
  const selectedTitles = [...new Set(titles)].slice(0, 3);
  const fullAuthors = [...new Set(authorHints.map((hint) => wordsOf(hint).join(' ')))]
    .map(wordsOf).filter((words) => words.length >= 2).slice(0, 2);
  const out: string[] = [];
  const add = (query: string) => {
    if (out.length < budget && !out.includes(query)) out.push(query);
  };
  if (!selectedTitles.length || !fullAuthors.length) return [];

  // Guarantee a full-identity attempt for every observed title before spending
  // the request budget on alternate authors. Leave room for damaged-surname
  // recovery; previously 3 titles x 2 authors exhausted the default six calls.
  for (const title of selectedTitles) add(`${title} ${fullAuthors[0].join(' ')}`);
  const reserve = budget >= 4 ? Math.min(2, budget - out.length) : 0;
  for (const title of selectedTitles) {
    if (out.length >= budget - reserve) break;
    if (fullAuthors[1]) add(`${title} ${fullAuthors[1].join(' ')}`);
  }

  // A partially damaged author name can still retrieve the correct work.
  // This only broadens retrieval; the cover identity verifier stays unchanged.
  for (const title of selectedTitles) {
    for (const words of fullAuthors) {
      const surname = words.at(-1)!;
      const given = words[0];
      if (surname.length >= 4) add(`${title} ${surname}`);
      if (given.length >= 4) add(`${title} ${given}`);
    }
  }
  return out;
}
