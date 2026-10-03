import { registerPlugin } from '@capacitor/core';
import type { UserBookRecord } from '../../types';
import { isAndroidRuntime } from '../../platform/runtimePlatform';
import { notifyRuntimeStorageChanged, readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';

export const ACTIVE_READING_DRAFT_KEY = 'inkbound_active_session_draft';

export interface ActiveReadingDraft {
  selectedBookId: string;
  timerSeconds: number;
  isActive: boolean;
  isFinished: boolean;
  lastActiveAt?: number;
  startedAt?: number;
  endedAt?: number;
  startPage: number;
  endPage: number;
  startMins: number;
  endMins: number;
  secondsByDate?: Record<string, number>;
  splitAtMidnight?: boolean;
  midnightProgress?: number;
  notes: string;
  mood: string;
  location: string;
}

type ReadingWidgetAction = 'start' | 'resume' | 'pause' | 'stop';

interface ReadingWidgetSnapshot {
  sessionMode: 'none' | 'active' | 'paused' | 'finished';
  bookId?: string;
  title?: string;
  author?: string;
  progressLabel?: string;
  timerSeconds?: number;
  timerRunning?: boolean;
  timerAnchorMillis?: number;
  dueTitle?: string;
  dueDate?: string;
  dueLabel?: string;
}

interface ReadingWidgetPlugin {
  syncState(options: ReadingWidgetSnapshot): Promise<void>;
  consumeAction(): Promise<{ action?: ReadingWidgetAction }>;
}

const ReadingWidget = registerPlugin<ReadingWidgetPlugin>('ReadingWidget');

const localDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const addElapsedToDateBuckets = (
  existing: Record<string, number> | undefined,
  startTimestamp: number,
  endTimestamp: number,
) => {
  const next = { ...(existing ?? {}) };
  let cursor = startTimestamp;
  while (cursor < endTimestamp) {
    const date = new Date(cursor);
    const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();
    const segmentEnd = Math.min(endTimestamp, nextMidnight);
    const seconds = Math.max(0, Math.floor((segmentEnd - cursor) / 1000));
    const key = localDateKey(cursor);
    next[key] = (next[key] ?? 0) + seconds;
    cursor = segmentEnd;
  }
  return next;
};

const addElapsed = (draft: ActiveReadingDraft, now: number): ActiveReadingDraft => {
  if (!draft.isActive || !draft.lastActiveAt || now <= draft.lastActiveAt) return draft;
  const elapsed = Math.max(0, Math.floor((now - draft.lastActiveAt) / 1000));
  if (!elapsed) return { ...draft, lastActiveAt: now };
  return {
    ...draft,
    timerSeconds: draft.timerSeconds + elapsed,
    secondsByDate: addElapsedToDateBuckets(draft.secondsByDate, draft.lastActiveAt, now),
    lastActiveAt: now,
  };
};

export function applyReadingWidgetAction(action: ReadingWidgetAction): {
  bookId?: string;
  shouldOpenTimer: boolean;
} {
  const draft = readRuntimeJson<ActiveReadingDraft | null>(ACTIVE_READING_DRAFT_KEY, null);
  const now = Date.now();

  if (action === 'start') {
    return { shouldOpenTimer: true };
  }
  if (!draft?.selectedBookId) {
    return { shouldOpenTimer: true };
  }

  let next = addElapsed(draft, now);
  if (action === 'resume') {
    next = {
      ...next,
      isActive: true,
      isFinished: false,
      startedAt: next.startedAt ?? now,
      lastActiveAt: now,
      endedAt: undefined,
    };
  } else if (action === 'pause') {
    next = { ...next, isActive: false, lastActiveAt: undefined };
  } else if (action === 'stop') {
    next = {
      ...next,
      isActive: false,
      isFinished: true,
      lastActiveAt: undefined,
      endedAt: now,
    };
  }

  if (writeRuntimeJson(ACTIVE_READING_DRAFT_KEY, next)) {
    notifyRuntimeStorageChanged(ACTIVE_READING_DRAFT_KEY);
  }
  return { bookId: next.selectedBookId, shouldOpenTimer: true };
}

function nextLibraryLoan(books: UserBookRecord[]) {
  return books
    .filter((book) => book.ownership === 'borrowed-library' && /^\d{4}-\d{2}-\d{2}$/.test(book.libraryLoan?.dueDate ?? ''))
    .sort((a, b) => (a.libraryLoan?.dueDate ?? '').localeCompare(b.libraryLoan?.dueDate ?? ''))[0];
}

function dueLabel(dueDate?: string) {
  if (!dueDate) return undefined;
  const [year, month, day] = dueDate.split('-').map(Number);
  const target = new Date(year, month - 1, day, 12);
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const days = Math.round((target.getTime() - base.getTime()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days}d`;
}

export function buildReadingWidgetSnapshot(books: UserBookRecord[]): ReadingWidgetSnapshot {
  const draft = readRuntimeJson<ActiveReadingDraft | null>(ACTIVE_READING_DRAFT_KEY, null);
  const draftBook = draft?.selectedBookId ? books.find((book) => book.id === draft.selectedBookId) : undefined;
  const currentBook = draftBook ?? books.find((book) => book.status === 'currently-reading');
  const edition = currentBook?.editions.find((item) => item.id === currentBook.activeEditionId) ?? currentBook?.editions[0];
  const loan = nextLibraryLoan(books);

  let progressLabel: string | undefined;
  if (currentBook) {
    if (edition?.format === 'audiobook' && edition.audiobookDurationMins) {
      progressLabel = `${currentBook.progressMinutes.toLocaleString()} / ${edition.audiobookDurationMins.toLocaleString()} min`;
    } else if (edition?.pageCount) {
      progressLabel = `Page ${currentBook.progressPages.toLocaleString()} of ${edition.pageCount.toLocaleString()}`;
    } else if (currentBook.progressPercentage > 0) {
      progressLabel = `${Math.round(currentBook.progressPercentage)}% complete`;
    }
  }

  const timerSeconds = draft?.timerSeconds ?? 0;
  const running = Boolean(draft?.isActive && draft.lastActiveAt);
  return {
    sessionMode: draft?.selectedBookId && (timerSeconds > 0 || draft.isActive || draft.isFinished)
      ? (draft.isFinished ? 'finished' : draft.isActive ? 'active' : 'paused')
      : 'none',
    bookId: currentBook?.id,
    title: currentBook?.work.title,
    author: currentBook?.work.author,
    progressLabel,
    timerSeconds,
    timerRunning: running,
    timerAnchorMillis: running ? draft!.lastActiveAt : undefined,
    dueTitle: loan?.work.title,
    dueDate: loan?.libraryLoan?.dueDate,
    dueLabel: dueLabel(loan?.libraryLoan?.dueDate),
  };
}

export async function syncAndroidReadingWidget(books: UserBookRecord[]) {
  if (!isAndroidRuntime()) return;
  try {
    await ReadingWidget.syncState(buildReadingWidgetSnapshot(books));
  } catch (error) {
    console.warn('Inkbound could not refresh the Android reading widget.', error);
  }
}

export async function consumeAndroidReadingWidgetAction(): Promise<ReadingWidgetAction | undefined> {
  if (!isAndroidRuntime()) return undefined;
  try {
    const result = await ReadingWidget.consumeAction();
    return result.action;
  } catch (error) {
    console.warn('Inkbound could not read the Android reading widget action.', error);
    return undefined;
  }
}
