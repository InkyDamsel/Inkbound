export type LibrarySectionSortMode = 'az' | 'za' | 'newest' | 'oldest';

export const LIBRARY_SECTION_SORT_OPTIONS: ReadonlyArray<{
  value: LibrarySectionSortMode;
  label: string;
}> = [
  { value: 'az', label: 'A–Z' },
  { value: 'za', label: 'Z–A' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export const compareLibraryLabels = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export const compareLibraryDates = (a?: string, b?: string) => {
  const aTime = a ? Date.parse(a) : 0;
  const bTime = b ? Date.parse(b) : 0;
  return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
};
