// Canonical private-tag identity shared by book editing, import and tag management.
export const tagIdentity = (value: string): string => value.trim().normalize('NFKC').toLocaleLowerCase();

export function uniquePrivateTags(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const name = raw.trim();
    const key = tagIdentity(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
