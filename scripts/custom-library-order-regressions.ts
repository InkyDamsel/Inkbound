import assert from 'node:assert/strict';
import { customLibraryContext, moveLibraryBook, orderLibraryIds } from '../src/features/library/customLibraryOrder';

const books = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, dateAdded: 'unchanged' }));
const snapshot = JSON.stringify(books);
const context = customLibraryContext('books', 'VIP TBR');
assert.equal(context, customLibraryContext('books', 'vip tbr'));
assert.notEqual(context, customLibraryContext('books', 'other'));
assert.deepEqual(orderLibraryIds(books, []).map(book => book.id), ['a','b','c','d']);
let saved = moveLibraryBook([], books.map(book => book.id), books.map(book => book.id), 'c', 'a');
assert.deepEqual(orderLibraryIds(books, saved).map(book => book.id), ['c','a','b','d']);
assert.deepEqual(orderLibraryIds(books, saved).map(book => book.id), ['c','a','b','d'], 'reload uses the same saved data');
assert.deepEqual([...books].sort((a,b) => a.title.localeCompare(b.title)).map(book => book.id), ['a','b','c','d'], 'other sort independent');
assert.deepEqual(orderLibraryIds(books, saved).map(book => book.id), ['c','a','b','d'], 'switching back restores custom order');
assert.deepEqual(orderLibraryIds(books.filter(book => book.id !== 'a'), saved).map(book => book.id), ['c','b','d']);
assert.deepEqual(orderLibraryIds([...books, {id:'e',title:'e',dateAdded:'unchanged'}], saved).map(book => book.id), ['c','a','b','d','e']);
saved = moveLibraryBook(saved, ['a','b','c','d','e'], ['c','b','d','e'], 'd', 'c');
assert.deepEqual(orderLibraryIds(books, saved).map(book => book.id), ['d','a','c','b']);
// A stale account order must not reverse a move made against the rendered list.
const stale = ['b', 'a', 'c', 'd'];
const repaired = moveLibraryBook(stale, ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 'c', 'b');
assert.deepEqual(orderLibraryIds(books, repaired).map(book => book.id), ['a', 'c', 'b', 'd']);
assert.equal(JSON.stringify(books), snapshot, 'no metadata mutations');
assert.equal(saved.includes('a'), true, 'temporarily excluded IDs remain');

// Audit 2026-11: deterministic randomized invariants for moveLibraryBook over stale/partial
// saved orders and filtered (partially visible) lists: nothing lost or duplicated, hidden IDs keep
// their slots, and the moved book lands at the target's visible position after reload.
{
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const shuffle = <T,>(items: T[]) => { const out = [...items]; for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  let cases = 0;
  for (let run = 0; run < 5000; run += 1) {
    const ids = Array.from({ length: 3 + Math.floor(rnd() * 8) }, (_, i) => String.fromCharCode(97 + i));
    const context = shuffle(ids);
    const savedOrder = rnd() < 0.3 ? [] : shuffle(ids).slice(0, Math.floor(rnd() * ids.length) + 1);
    const rendered = orderLibraryIds(context.map(id => ({ id })), savedOrder).map(book => book.id);
    const visible = rendered.filter(() => rnd() < 0.7);
    if (visible.length < 2) continue;
    const moved = visible[Math.floor(rnd() * visible.length)];
    const others = visible.filter(id => id !== moved);
    const target = others[Math.floor(rnd() * others.length)];
    const out = moveLibraryBook(savedOrder, context, visible, moved, target);
    const all = [...new Set([...savedOrder, ...context])];
    assert.equal(out.length, all.length, 'no ID lost or duplicated');
    assert.ok(all.every(id => out.includes(id)));
    all.forEach((id, index) => { if (!visible.includes(id)) assert.equal(out[index], id, 'hidden IDs keep their slots'); });
    const reloaded = orderLibraryIds(context.map(id => ({ id })), out).map(book => book.id).filter(id => visible.includes(id));
    assert.equal(reloaded.indexOf(moved), visible.indexOf(target), 'moved book lands at the target position');
    cases += 1;
  }
  assert.ok(cases > 3000, 'fuzz exercised enough cases');
}

console.log('Custom library ordering regressions passed.');
