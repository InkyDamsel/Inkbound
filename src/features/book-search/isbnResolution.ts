import { hardenCatalogGroups } from './catalogHardening';
import type { BookSearchWorkGroup } from './model/bookSearch';

export const compactCatalogIsbn = (value: string): string =>
  value.replace(/[^0-9X]/gi, '').toUpperCase();

const isbn10CheckDigit = (nineDigits: string): string | null => {
  if (!/^\d{9}$/.test(nineDigits)) return null;
  const sum = [...nineDigits].reduce(
    (total, character, index) => total + Number(character) * (10 - index),
    0,
  );
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? 'X' : String(remainder);
};

const isbn13CheckDigit = (twelveDigits: string): string | null => {
  if (!/^\d{12}$/.test(twelveDigits)) return null;
  const weighted = [...twelveDigits].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return String((10 - (weighted % 10)) % 10);
};

export const isValidCatalogIsbn = (value: string): boolean => {
  const isbn = compactCatalogIsbn(value);
  if (/^\d{9}[\dX]$/.test(isbn)) {
    return isbn10CheckDigit(isbn.slice(0, 9)) === isbn[9];
  }
  if (/^\d{13}$/.test(isbn) && /^(978|979)/.test(isbn)) {
    return isbn13CheckDigit(isbn.slice(0, 12)) === isbn[12];
  }
  return false;
};

export const selectCatalogIsbnFromBarcodes = (values: string[]): string | null => {
  const valid = [...new Set(values.map(compactCatalogIsbn).filter(isValidCatalogIsbn))];
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  // A printed ISBN-10 and its 978 ISBN-13 are the same edition identity.
  // Prefer ISBN-13 so provider lookup has the strongest canonical identifier.
  const families = valid.map((isbn) => new Set(equivalentCatalogIsbns(isbn)));
  const firstFamily = families[0];
  if (families.every((family) => [...family].some((isbn) => firstFamily.has(isbn)))) {
    return valid.find((isbn) => isbn.length === 13) ?? valid[0];
  }

  // More than one unrelated valid ISBN is visible. Do not guess which book
  // the user intended to scan.
  return null;
};

export const equivalentCatalogIsbns = (value: string): string[] => {
  const isbn = compactCatalogIsbn(value);
  const results = new Set<string>();
  if (!isValidCatalogIsbn(isbn)) return [];

  if (/^\d{9}[\dX]$/.test(isbn)) {
    results.add(isbn);
    const base13 = `978${isbn.slice(0, 9)}`;
    const check13 = isbn13CheckDigit(base13);
    if (check13) results.add(`${base13}${check13}`);
  } else if (/^978\d{10}$/.test(isbn)) {
    results.add(isbn);
    const base10 = isbn.slice(3, 12);
    const check10 = isbn10CheckDigit(base10);
    if (check10) results.add(`${base10}${check10}`);
  } else if (/^979\d{10}$/.test(isbn)) {
    // 979 ISBN-13 values generally have no ISBN-10 equivalent.
    results.add(isbn);
  }

  return [...results];
};

/** True when two batch keys identify the same printed ISBN. An ISBN-10 and its
 * 978 ISBN-13 are one identity; non-ISBN keys ("catalog:...") compare exactly. */
export const sameCatalogIsbn = (left: string, right: string): boolean => {
  if (left === right) return true;
  const leftFamily = equivalentCatalogIsbns(left);
  if (leftFamily.length === 0) return false;
  const rightFamily = new Set(equivalentCatalogIsbns(right));
  return leftFamily.some((isbn) => rightFamily.has(isbn));
};

/** ISBN lookup must retain exact editions from every provider, even when an
 * earlier provider returned an unrelated or incomplete work. */
export const combineIsbnProviderGroups = (providers: BookSearchWorkGroup[][]): BookSearchWorkGroup[] =>
  hardenCatalogGroups(providers.flat());


export type PrintedIsbnEvidence = { isbn: string; label: string; priority: number };

const repairPrintedIsbnDigit = (char: string, allowIsbn10CheckX = false): string | null => {
  if (/\d/.test(char)) return char;
  const upper = char.toUpperCase();
  if (upper === 'X' && allowIsbn10CheckX) return 'X';
  if (upper === 'I' || upper === 'L') return '1';
  if (upper === 'O' || upper === 'Q' || upper === 'D') return '0';
  if (upper === 'S') return '5';
  if (upper === 'B') return '8';
  if (upper === 'Z') return '2';
  if (upper === 'G') return '6';
  return null;
};

export const extractValidPrintedIsbns = (value: string): string[] => {
  const isbnLabelIndex = value.search(/isbn/i);
  let source = isbnLabelIndex >= 0 ? value.slice(isbnLabelIndex) : value;
  if (isbnLabelIndex >= 0) {
    // Strip ISBN-10 / ISBN-13 as a label only when it is syntactically a
    // format marker. Do not eat real digits from strings such as "ISBN 105-...".
    source = source
      .replace(/^isbn\s*-\s*(?:10|13)\s*[:#]?\s*/i, '')
      .replace(/^isbn\s+(?:10|13)(?=\s+(?:97[89]|[0-9X][\s-]))\s*[:#]?\s*/i, '')
      .replace(/^isbn\s*[:#]?\s*/i, '');
  }
  const compact = source.replace(/[^0-9A-Za-z]/g, '');
  const repairCandidate = (candidate: string): string | null => {
    const mapped = [...candidate].map((char, index) =>
      repairPrintedIsbnDigit(char, candidate.length === 10 && index === 9));
    if (mapped.some((character) => character === null)) return null;
    return mapped.join('');
  };

  // ISBN-13 must win before ISBN-10 is even considered. A 13-digit ISBN can
  // contain a coincidentally checksum-valid 10-digit window (for example
  // 9781682818183 contains 8682818183). Returning that inner window invents
  // an edition identity that was never printed on the page.
  const isbn13s: string[] = [];
  for (let offset = 0; offset + 13 <= compact.length; offset += 1) {
    const isbn = repairCandidate(compact.slice(offset, offset + 13));
    if (isbn && isValidCatalogIsbn(isbn)) isbn13s.push(isbn);
  }
  if (isbn13s.length > 0) return [...new Set(isbn13s)];

  // Only accept ISBN-10 when the OCR evidence itself is ten characters long.
  // Never mine a ten-character ISBN from inside a longer numeric/alphanumeric
  // run after ISBN-13 validation failed.
  if (compact.length === 10) {
    const isbn = repairCandidate(compact);
    if (isbn && isValidCatalogIsbn(isbn)) return [isbn];
  }

  return [];
};

export const collectPrintedIsbnEvidence = (lines: string[]): PrintedIsbnEvidence[] => {
  const evidence: PrintedIsbnEvidence[] = [];
  const retailerPattern = /(?:walmart|target|exclusive|special|limited|collector'?s)\s+(?:edition\s+)?isbn/i;
  const isbnLabelPattern = /isbn/i;
  const addEvidence = (isbn: string, label: string, priority: number) => {
    const existing = evidence.find((item) => item.isbn === isbn);
    if (!existing || priority > existing.priority) {
      if (existing) evidence.splice(evidence.indexOf(existing), 1);
      evidence.push({ isbn, label, priority });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? '';
    const previous = lines[index - 1] ?? '';

    if (isbnLabelPattern.test(line)) {
      // Prefer the publisher's standard ISBN over retailer/exclusive edition
      // identifiers. Retailer ISBNs are useful only as a fallback when the
      // copyright page does not expose a regular ISBN.
      const priority = retailerPattern.test(line) ? 1 : 3;
      const inlineIsbns = extractValidPrintedIsbns(line);
      for (const isbn of inlineIsbns) {
        addEvidence(isbn, line, priority);
      }

      // Only borrow an adjacent OCR line when the label itself contains no
      // ISBN. Otherwise an inline ISBN such as "Walmart Edition ISBN 978..."
      // must not accidentally claim the previous standard ISBN too.
      if (inlineIsbns.length === 0) {
        if (next && !isbnLabelPattern.test(next)) {
          for (const isbn of extractValidPrintedIsbns(next)) {
            addEvidence(isbn, `${line} ${next}`, priority);
          }
        } else if (previous && !isbnLabelPattern.test(previous)) {
          for (const isbn of extractValidPrintedIsbns(previous)) {
            addEvidence(isbn, `${previous} ${line}`, priority);
          }
        }
      }
    }
  }

  // OCR often sees the ISBN-13 digits printed under a barcode but loses the
  // ISBN label. Only use this fallback when no labeled ISBN was recovered.
  // Prefix + checksum validation prevents prices/add-on codes becoming books.
  if (evidence.length === 0) {
    const unlabeledSources = [
      ...lines,
      ...lines.slice(0, -1).map((line, index) => `${line}${lines[index + 1]}`),
    ];
    for (const source of unlabeledSources) {
      const digits = source.replace(/[\s-]/g, '');
      for (let offset = 0; offset + 13 <= digits.length; offset += 1) {
        const candidate = digits.slice(offset, offset + 13);
        if (/^97[89]\d{10}$/.test(candidate) && isValidCatalogIsbn(candidate)) {
          addEvidence(candidate, 'unlabeled printed digits', 1);
        }
      }
    }
  }

  return evidence.sort((left, right) => right.priority - left.priority);
};

export const selectPreferredPrintedIsbn = (evidence: PrintedIsbnEvidence[], unresolvedIsbn?: string | null): string | null => {
  if (evidence.length === 0) return null;

  // Copyright-page evidence can correct a retailer barcode identity. When the
  // page prints both a standard publisher ISBN and a retailer/exclusive ISBN,
  // the standard ISBN is the canonical lookup identity even if the barcode
  // scan previously populated unresolvedIsbn with the retailer ISBN.
  const highestPriority = Math.max(...evidence.map((item) => item.priority));
  const preferred = evidence.filter((item) => item.priority === highestPriority);
  if (preferred.length === 1 && highestPriority >= 3) return preferred[0].isbn;

  // Preserve an already scanned ISBN only when the page did not provide one
  // unambiguous higher-priority standard ISBN.
  if (unresolvedIsbn && evidence.some((item) => item.isbn === unresolvedIsbn)) return unresolvedIsbn;
  return evidence.length === 1 ? evidence[0].isbn : null;
};
