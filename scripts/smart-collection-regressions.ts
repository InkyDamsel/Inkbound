import assert from 'node:assert/strict';
import type { UserBookRecord } from '../src/types';
import {
  smartCollectionMatches,
  type SmartCollectionRule,
} from '../src/features/collections/smartCollectionRules';

const book: UserBookRecord = {
  id: 'book-1',
  work: {
    id: 'work-1',
    title: 'A Dark and Drowning Tide',
    author: 'Allison Saft',
    summary: '',
    genres: ['Fantasy', 'Romance'],
    seriesName: 'Dark Waters',
    publicationYear: 2024,
  },
  activeEditionId: 'edition-1',
  editions: [{
    id: 'edition-1',
    format: 'ebook',
    pageCount: 384,
    coverGradient: '',
  }],
  status: 'tbr',
  ownership: 'owned',
  progressPages: 0,
  progressMinutes: 0,
  progressPercentage: 0,
  rating: 4.5,
  privateTags: ['dark academia', 'favorites'],
  priority: 'high',
  moods: [],
  collections: [],
  dateAdded: '2026-09-19',
};

const rule = (
  field: SmartCollectionRule['field'],
  operator: SmartCollectionRule['operator'],
  value: string,
): SmartCollectionRule => ({ id: `${field}-${operator}-${value}`, field, operator, value });

assert.equal(smartCollectionMatches(book, [
  rule('title', 'contains', 'dark'),
  rule('status', 'equals', 'tbr'),
], 'all'), true);

assert.equal(smartCollectionMatches(book, [
  rule('title', 'contains', 'dark'),
  rule('status', 'equals', 'finished'),
], 'all'), false);

assert.equal(smartCollectionMatches(book, [
  rule('title', 'contains', 'missing'),
  rule('genre', 'contains', 'romance'),
], 'any'), true);

assert.equal(smartCollectionMatches(book, [
  rule('author', 'not-contains', 'king'),
], 'all'), true);

assert.equal(smartCollectionMatches(book, [
  rule('rating', 'at-least', '4'),
  rule('page-count', 'at-most', '400'),
  rule('progress', 'at-most', '10'),
], 'all'), true);

assert.equal(smartCollectionMatches(book, [
  rule('series', 'contains', 'dark waters'),
  rule('ownership', 'equals', 'owned'),
  rule('priority', 'equals', 'high'),
], 'all'), true);

assert.equal(smartCollectionMatches(book, [
  rule('tag', 'contains', 'academia'),
], 'all'), true);

console.log('Inkbound smart collection regressions passed.');
