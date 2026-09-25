export const BOOK_RATING_VALUES = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;

export const SPICE_LEVEL_VALUES = [0, 1, 2, 3, 4, 5] as const;

export function normalizeBookRating(value?: number | null): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value * 2) / 2;
  return Math.min(5, Math.max(0.5, rounded));
}

export function normalizeSpiceLevel(value?: number | null): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  return Math.min(5, Math.max(0, Math.round(value)));
}

export function bookRatingLabel(value?: number): string {
  const normalized = normalizeBookRating(value);
  return normalized === undefined ? 'Not rated' : `${normalized}/5`;
}

export function spiceLevelLabel(value?: number): string {
  const normalized = normalizeSpiceLevel(value);
  if (normalized === undefined) return 'Not rated';
  if (normalized === 0) return 'No spice';
  return `${normalized}/5 spice`;
}
