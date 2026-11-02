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
console.log('Custom library ordering regressions passed.');
