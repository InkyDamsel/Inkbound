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

/** ISBN lookup must retain exact editions from every provider, even when an
 * earlier provider returned an unrelated or incomplete work. */
export const combineIsbnProviderGroups = (providers: BookSearchWorkGroup[][]): BookSearchWorkGroup[] =>
  hardenCatalogGroups(providers.flat());


export type PrintedIsbnEvidence = { isbn: string; label: string; priority: number };

const repairPrintedIsbnDigit = (char: string): string | null => {
  if (/\d/.test(char)) return char;
  const upper = char.toUpperCase();
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
  const labelled = isbnLabelIndex >= 0 ? value.slice(isbnLabelIndex).replace(/^.*?isbn\s*/i, '') : value;
  const rawTokens = labelled.match(/[0-9A-Za-z][0-9A-Za-z.\s-]{8,30}[0-9A-Za-z]/g) ?? [];
  const repaired: string[] = [];
  for (const token of rawTokens) {
    const compact = token.replace(/[^0-9A-Za-z]/g, '');
    if (compact.length < 10 || compact.length > 16) continue;
    const mapped = [...compact].map(repairPrintedIsbnDigit);
    if (mapped.some((char) => char === null)) continue;
    const digits = mapped.join('');
    if ((digits.length === 13 || digits.length === 10) && isValidCatalogIsbn(digits)) repaired.push(digits);
  }
  return [...new Set(repaired)];
};

export const collectPrintedIsbnEvidence = (lines: string[]): PrintedIsbnEvidence[] => {
  const evidence: PrintedIsbnEvidence[] = [];
  const retailerPattern = /(?:walmart|target|exclusive|special|limited|collector'?s)\s+(?:edition\s+)?isbn/i;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/isbn/i.test(line)) continue;
    for (const isbn of extractValidPrintedIsbns(line)) {
      evidence.push({ isbn, label: line, priority: retailerPattern.test(line) ? 3 : 2 });
    }
    const window = lines.slice(index, index + 2).join(' ');
    for (const isbn of extractValidPrintedIsbns(window)) {
      if (!evidence.some((item) => item.isbn === isbn)) evidence.push({ isbn, label: window, priority: 1 });
    }
  }
  return [...new Map(
    evidence.sort((left, right) => right.priority - left.priority).map((item) => [item.isbn, item]),
  ).values()];
};

export const selectPreferredPrintedIsbn = (evidence: PrintedIsbnEvidence[], unresolvedIsbn?: string | null): string | null => {
  if (unresolvedIsbn && evidence.some((item) => item.isbn === unresolvedIsbn)) return unresolvedIsbn;
  if (evidence.length === 0) return null;
  const highestPriority = Math.max(...evidence.map((item) => item.priority));
  const preferred = evidence.filter((item) => item.priority === highestPriority);
  if (preferred.length === 1 && highestPriority >= 3) return preferred[0].isbn;
  return evidence.length === 1 ? evidence[0].isbn : null;
};
