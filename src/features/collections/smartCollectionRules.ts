import type {
  Format,
  OwnershipStatus,
  Priority,
  ReadingStatus,
  UserBookRecord,
} from '../../types';
import { getActiveEdition, getBookReadingState } from '../reading/bookReadingState';

export type SmartCollectionMatchMode = 'all' | 'any';

export type SmartCollectionField =
  | 'title'
  | 'author'
  | 'series'
  | 'genre'
  | 'tag'
  | 'status'
  | 'format'
  | 'ownership'
  | 'priority'
  | 'rating'
  | 'year'
  | 'page-count'
  | 'progress';

export type SmartCollectionOperator =
  | 'contains'
  | 'not-contains'
  | 'equals'
  | 'not-equals'
  | 'at-least'
  | 'at-most';

export interface SmartCollectionRule {
  id: string;
  field: SmartCollectionField;
  operator: SmartCollectionOperator;
  value: string;
}

export interface LegacySmartCollectionRule {
  field: 'status' | 'format' | 'rating' | 'tag' | 'author' | 'title' | 'year';
  value: string;
}

export const SMART_COLLECTION_FIELD_OPTIONS: Array<{
  value: SmartCollectionField;
  label: string;
}> = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'series', label: 'Series' },
  { value: 'genre', label: 'Genre' },
  { value: 'tag', label: 'Tag' },
  { value: 'status', label: 'Status' },
  { value: 'format', label: 'Format' },
  { value: 'ownership', label: 'Ownership' },
  { value: 'priority', label: 'Priority' },
  { value: 'rating', label: 'Rating' },
  { value: 'year', label: 'Publication year' },
  { value: 'page-count', label: 'Page count' },
  { value: 'progress', label: 'Progress %' },
];

const textFields = new Set<SmartCollectionField>(['title', 'author', 'series', 'genre', 'tag']);
const enumFields = new Set<SmartCollectionField>(['status', 'format', 'ownership', 'priority']);
const numericFields = new Set<SmartCollectionField>(['rating', 'year', 'page-count', 'progress']);

export function smartCollectionOperatorOptions(field: SmartCollectionField): Array<{
  value: SmartCollectionOperator;
  label: string;
}> {
  if (textFields.has(field)) {
    return [
      { value: 'contains', label: 'contains' },
      { value: 'not-contains', label: 'does not contain' },
      { value: 'equals', label: 'equals' },
      { value: 'not-equals', label: 'does not equal' },
    ];
  }
  if (enumFields.has(field)) {
    return [
      { value: 'equals', label: 'is' },
      { value: 'not-equals', label: 'is not' },
    ];
  }
  if (numericFields.has(field)) {
    return [
      { value: 'at-least', label: 'at least' },
      { value: 'at-most', label: 'at most' },
      { value: 'equals', label: 'equals' },
    ];
  }
  return [{ value: 'equals', label: 'is' }];
}

export function defaultSmartCollectionOperator(field: SmartCollectionField): SmartCollectionOperator {
  if (textFields.has(field)) return 'contains';
  if (numericFields.has(field)) return 'at-least';
  return 'equals';
}

export function createSmartCollectionRule(
  field: SmartCollectionField = 'title',
  value = '',
): SmartCollectionRule {
  return {
    id: crypto.randomUUID(),
    field,
    operator: defaultSmartCollectionOperator(field),
    value,
  };
}

const normalized = (value?: string) => value?.trim().toLowerCase() ?? '';

function compareText(actual: string, expected: string, operator: SmartCollectionOperator): boolean {
  const left = normalized(actual);
  const right = normalized(expected);
  if (!right) return false;
  if (operator === 'contains') return left.includes(right);
  if (operator === 'not-contains') return !left.includes(right);
  if (operator === 'not-equals') return left !== right;
  return left === right;
}

function compareTextArray(actual: string[], expected: string, operator: SmartCollectionOperator): boolean {
  const values = actual.map(normalized);
  const right = normalized(expected);
  if (!right) return false;
  if (operator === 'contains') return values.some((value) => value.includes(right));
  if (operator === 'not-contains') return values.every((value) => !value.includes(right));
  if (operator === 'not-equals') return values.every((value) => value !== right);
  return values.some((value) => value === right);
}

function compareEnum(actual: string | undefined, expected: string, operator: SmartCollectionOperator): boolean {
  const matches = normalized(actual) === normalized(expected);
  return operator === 'not-equals' ? !matches : matches;
}

function compareNumber(actual: number | undefined, expected: string, operator: SmartCollectionOperator): boolean {
  const right = Number(expected);
  if (actual === undefined || !Number.isFinite(actual) || !Number.isFinite(right)) return false;
  if (operator === 'at-least') return actual >= right;
  if (operator === 'at-most') return actual <= right;
  return actual === right;
}

export function smartCollectionRuleMatches(book: UserBookRecord, rule: SmartCollectionRule): boolean {
  if (!rule.value.trim()) return false;

  switch (rule.field) {
    case 'title':
      return compareText(book.work.title, rule.value, rule.operator);
    case 'author':
      return compareText(book.work.author, rule.value, rule.operator);
    case 'series':
      return compareText(book.work.seriesName ?? '', rule.value, rule.operator);
    case 'genre':
      return compareTextArray(book.work.genres ?? [], rule.value, rule.operator);
    case 'tag':
      return compareTextArray(book.privateTags ?? [], rule.value, rule.operator);
    case 'status':
      return compareEnum(book.status as ReadingStatus, rule.value, rule.operator);
    case 'format':
      return compareEnum(getActiveEdition(book)?.format as Format | undefined, rule.value, rule.operator);
    case 'ownership':
      return compareEnum(book.ownership as OwnershipStatus, rule.value, rule.operator);
    case 'priority':
      return compareEnum(book.priority as Priority, rule.value, rule.operator);
    case 'rating':
      return compareNumber(book.rating, rule.value, rule.operator);
    case 'year':
      return compareNumber(book.work.publicationYear, rule.value, rule.operator);
    case 'page-count':
      return compareNumber(getActiveEdition(book)?.pageCount, rule.value, rule.operator);
    case 'progress':
      return compareNumber(getBookReadingState(book).progressPercentage, rule.value, rule.operator);
    default:
      return false;
  }
}

export function smartCollectionMatches(
  book: UserBookRecord,
  rules: SmartCollectionRule[],
  matchMode: SmartCollectionMatchMode,
): boolean {
  const activeRules = rules.filter((rule) => rule.value.trim());
  if (activeRules.length === 0) return false;
  return matchMode === 'any'
    ? activeRules.some((rule) => smartCollectionRuleMatches(book, rule))
    : activeRules.every((rule) => smartCollectionRuleMatches(book, rule));
}

export function migrateLegacySmartCollectionRule(
  rule?: LegacySmartCollectionRule,
): SmartCollectionRule[] {
  if (!rule?.value?.trim()) return [];

  const field = rule.field as SmartCollectionField;
  const operator: SmartCollectionOperator =
    field === 'rating' ? 'at-least'
      : field === 'author' || field === 'title' ? 'contains'
        : 'equals';

  return [{
    id: crypto.randomUUID(),
    field,
    operator,
    value: rule.value,
  }];
}
