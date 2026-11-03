import type { ImportHistoryEntry } from './importHistory';

/**
 * Merge independent import sessions by event ID. Missing cloud/local entries
 * never authorize deletion. A completed or failed state must never regress to
 * "running" when a slower device catches up.
 */
export function mergeImportHistoryEvents(local: ImportHistoryEntry[], remote: ImportHistoryEntry[]): ImportHistoryEntry[] {
  const rank = (entry: ImportHistoryEntry) => entry.status === 'completed' ? 3
    : entry.status === 'failed' ? 2 : entry.status === 'running' ? 1 : 0;
  const merged = new Map(remote.map((entry) => [entry.id, entry]));
  local.forEach((entry) => {
    const cloud = merged.get(entry.id);
    if (!cloud || rank(entry) > rank(cloud)) { merged.set(entry.id, entry); return; }
    if (rank(entry) < rank(cloud)) return;
    const weight = (item: ImportHistoryEntry) =>
      (item.outcomes?.length ?? 0) * 1000 + item.items.length;
    if (weight(entry) >= weight(cloud)) merged.set(entry.id, entry);
  });
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
