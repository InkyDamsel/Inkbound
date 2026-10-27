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
  const queries: string[] = [];

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

    if (tokens.length < 2 || tokens.length > 5) continue;
    const shortTokenCount = tokens.filter((token) => token.length <= 2).length;
    if (shortTokenCount >= 1 && tokens.length >= 3) {
      const firstLong = tokens.findIndex((token) => token.length > 2);
      const prefixCount = Math.min(2, firstLong < 0 ? 2 : firstLong);
      const split = Math.max(1, prefixCount);
      queries.push(`${tokens.slice(0, split).join(' ')} ${tokens.slice(split).join('')}`.trim());
    } else if (tokens.length === 2) {
      queries.push(cleanLines[index].trim());
    }
  }

  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, maxQueries);
}
