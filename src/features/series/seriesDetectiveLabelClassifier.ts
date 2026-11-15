/**
 * Classifies series labels conservatively. A publisher collection is not a
 * literary series; classification is evidence metadata, not deletion.
 */
export type DetectiveSeriesLabelKind = 'publisher-collection' | 'literary-candidate' | 'unknown';

export function classifyDetectiveSeriesLabel(raw: string): DetectiveSeriesLabelKind {
  const label = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!label) return 'unknown';
  // Numeric publisher catalog identifiers, including common separators.
  // This is intentionally not a list of publisher-specific book exceptions.
  if (/^\d{3,}(?:[\s./;-]+\d+)*$/u.test(label)) return 'publisher-collection';
  if (/^[\p{L}][\p{L}\s.-]*[\s;:/-]+\d{3,}(?:[\s./;-]+\d+)*$/u.test(label)) {
    return 'publisher-collection';
  }
  // A short imprint name without a numbered installment is not enough.
  if (/^(?:penguin books(?: ltd)?|fischer taschenbuch|rowohlt taschenbuch)$/iu.test(label)) {
    return 'publisher-collection';
  }
  return 'literary-candidate';
}
