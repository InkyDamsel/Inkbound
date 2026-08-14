import type { UserBookRecord } from '../../types';
import {
  readImportHistory,
  writeImportHistory,
  type ImportHistoryEntry,
  type ImportHistoryItem,
} from './importHistory';

function normalizeText(value?: string): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
}

function compactIsbn(value?: string): string {
  return value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
}

function identity(item: ImportHistoryItem): string {
  const isbn = compactIsbn(item.isbn);
  if (isbn) return `isbn:${isbn}`;
  return `book:${normalizeText(item.title)}::${normalizeText(item.author)}`;
}

function sameManifest(left: ImportHistoryEntry, right: ImportHistoryEntry): boolean {
  if (left.sourceName !== right.sourceName || left.items.length !== right.items.length) return false;
  const leftIds = left.items.map(identity).sort();
  const rightIds = right.items.map(identity).sort();
  return leftIds.every((value, index) => value === rightIds[index]);
}

/**
 * Collapses repeated history entries for the same committed export. This repairs
 * the hydration incident where the same 703-book export was run again with fresh
 * record IDs after only part of the library had restored.
 *
 * The oldest entry remains the canonical import. For each book, whichever record
 * ID actually exists in the final library is retained so enrichment progress,
 * covers, and summaries continue to resolve against the correct book.
 */
export function reconcileRepeatedImportHistory(books: UserBookRecord[]): ImportHistoryEntry[] {
  const history = readImportHistory();
  if (history.length < 2) return history;

  const consumed = new Set<string>();
  const bookIds = new Set(books.map((book) => book.id));
  const reconciled: ImportHistoryEntry[] = [];
  let changed = false;

  history.forEach((entry) => {
    if (consumed.has(entry.id)) return;
    const group = history.filter((candidate) => !consumed.has(candidate.id) && sameManifest(entry, candidate));
    group.forEach((candidate) => consumed.add(candidate.id));

    if (group.length === 1) {
      reconciled.push(entry);
      return;
    }

    changed = true;
    const oldest = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const candidates = new Map<string, ImportHistoryItem[]>();
    group.forEach((candidate) => {
      candidate.items.forEach((item) => {
        const key = identity(item);
        candidates.set(key, [...(candidates.get(key) ?? []), item]);
      });
    });

    const mergedItems = oldest.items.map((base) => {
      const options = candidates.get(identity(base)) ?? [base];
      const existing = options.find((item) => bookIds.has(item.targetBookId));
      const chosen = existing ?? options.find((item) => item.importMetadataVerified === true) ?? base;
      return {
        ...chosen,
        importMetadataVerified: options.some((item) => item.importMetadataVerified === true),
      };
    });

    reconciled.push({
      ...oldest,
      importedCount: mergedItems.length,
      duplicateCount: oldest.duplicateCount,
      items: mergedItems,
    });
  });

  reconciled.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (changed) writeImportHistory(reconciled);
  return reconciled;
}
