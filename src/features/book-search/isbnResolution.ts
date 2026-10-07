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

export const equivalentCatalogIsbns = (value: string): string[] => {
  const isbn = compactCatalogIsbn(value);
  const results = new Set<string>();

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
