/** Account-owned order is independent of book metadata. Never prune absent IDs. */
export type CustomLibraryOrders = Record<string, string[]>;
export const customLibraryContext = (section: string, tag: string): string =>
  JSON.stringify([section, tag.trim().toLocaleLowerCase()]);
export function orderLibraryIds<T extends { id: string }>(books: T[], saved: string[]): T[] {
  const positions = new Map(saved.map((id, index) => [id, index]));
  return [...books].sort((a, b) => {
    const left = positions.get(a.id);
    const right = positions.get(b.id);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}
/** Move only visible IDs; excluded IDs keep their saved slots. */
export function moveLibraryBook(saved: string[], contextIds: string[], visibleIds: string[], movedId: string, targetId: string): string[] {
  if (movedId === targetId || !visibleIds.includes(movedId) || !visibleIds.includes(targetId)) return saved;
  // The visible sequence is the order the reader actually saw before tapping.
  // A stale saved list may omit newer IDs or contain a different filtered order.
  // Preserve hidden slots without letting them silently undo the requested move.
  const all = [...new Set([...saved, ...contextIds])];
  const visibleSet = new Set(visibleIds);
  const visible = visibleIds.filter((id, index) => visibleSet.has(id) && visibleIds.indexOf(id) === index);
  const from = visible.indexOf(movedId), to = visible.indexOf(targetId);
  if (from < 0 || to < 0) return saved;
  visible.splice(from, 1);
  visible.splice(to, 0, movedId);
  let cursor = 0;
  return all.map(id => visibleIds.includes(id) ? visible[cursor++] : id);
}
