import React, { useEffect, useRef, useState } from 'react';
import {
  ImportRecordItem,
  Priority,
  ReadingSession,
  ReadingStatus,
  UserBookRecord,
} from './types';
import { Navbar, NavTab } from './components/Navbar';
import { HomeDashboard } from './components/HomeDashboard';
import { LibraryScreen } from './components/LibraryScreen';
import { TBRScreen } from './components/TBRScreen';
import { ReadingSessionsScreen } from './components/ReadingSessionsScreen';
import { ReadingActivityOverview } from './components/ReadingActivityOverview';
import { ReadingChallengesScreen } from './components/ReadingChallengesScreen';
import { AchievementsScreen } from './components/AchievementsScreen';
import { CollectionsScreen } from './components/CollectionsScreen';
import { DuplicateManagerScreen, type DuplicateMergeRequest } from './components/DuplicateManagerScreen';
import { ImportHistoryScreen } from './components/ImportHistoryScreen';
import { ReadingTimelineScreen } from './components/ReadingTimelineScreen';
import { ReadingMemoriesScreen } from './components/ReadingMemoriesScreen';
import { ReadingTimeCapsulesScreen } from './components/ReadingTimeCapsulesScreen';
import { PhotoMemoriesScreen } from './components/PhotoMemoriesScreen';
import { BookshelfThroughTimeScreen } from './components/BookshelfThroughTimeScreen';
import { MyDragonScreen } from './components/MyDragonScreen';
import { ReaderPersonalityScreen } from './components/ReaderPersonalityScreen';
import { ReadingInsightsScreen } from './components/ReadingInsightsScreen';
import { InkboundStudioScreen } from './components/InkboundStudioScreen';
import { MonthlyWrappedScreen } from './components/MonthlyWrappedScreen';
import { YearInBooksScreen } from './components/YearInBooksScreen';
import { BookDetailsModal } from './components/BookDetailsModal';
import { BatchEditModal, type BatchEditChanges } from './components/BatchEditModal';
import { ReadingSessionModal } from './components/ReadingSessionModal';
import { ImportCenterScreen } from './components/ImportCenterScreen';
import { StatisticsScreen } from './components/StatisticsScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { AdminScreen } from './components/AdminScreen';
import { AddBookModal } from './components/AddBookModal';
import { ResponsiveShell } from './layout/shell/ResponsiveShell';
import { ResponsiveContainer } from './layout/responsive/ResponsiveContainer';
import { usePersistentState } from './hooks/usePersistentState';
import {
  analyzeImportDuplicates,
  buildRepairQueueItems,
  createFallbackImportedBook,
  enrichImportedBooks,
  IMPORT_ENRICHMENT_BATCH_SIZE,
  mergeEnrichedImportedBook,
  queueImportedItems,
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
  type ImportEnrichmentQueueItem,
} from './features/import/libraryEnrichment';
import {
  appendImportHistory,
  isImportEnrichmentPaused,
  setImportEnrichmentPaused,
  writeImportEnrichmentRetryProgress,
  writeImportHistory,
} from './features/import/importHistory';
import { getImportVerificationSnapshot } from './features/import/importVerificationJob';
import { normalizeLibraryRecord } from './features/library/libraryNormalization';
import { withBookOwnership } from './features/ownership/bookOwnership';
import { replaceCanonicalLibrary, replaceCanonicalSessions } from './features/library/libraryMutations';
import { getActiveEdition, reconcileBookProgressWithActiveEdition, withReadingStatus } from './features/reading/bookReadingState';
import {
  applySessionProgressToBook,
  getSessionProgressEndpoint,
  reconcileBookAfterSessionMutation,
  sessionSortKey,
} from './features/reading/sessionBookReconciliation';
import { getDailyReadingMinutes, getReadingStreak, getSessionDurationMinutes, localDateKey } from './features/reading/sessionAnalytics';
import { INKBOUND_CLOUD_DATA_EVENT, type CloudDataUpdatedDetail } from './features/sync/cloudSyncEvents';
import { ACCOUNT_DATA_STORAGE_KEYS, DEVICE_STORAGE_KEYS, LEGACY_SYNC_STORAGE_KEYS, SYNC_STORAGE_KEYS } from './features/sync/storageKeys';
import { subscribeToRuntimeResume } from './platform/runtimeLifecycle';
import { subscribeToRuntimeBackNavigation } from './platform/runtimeBackNavigation';
import { notifyNativeBookFinished, notifyNativeReadingSessionFinished } from './features/notifications/nativeInkboundNotifications';
import {
  getRuntimeStorage,
  readRuntimeValue,
  removeRuntimeValue,
  writeRuntimeJson,
  writeRuntimeValue,
} from './platform/runtimeStorage';
import { Check, Flame, RotateCcw, Target } from 'lucide-react';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_STORAGE_KEY = SYNC_STORAGE_KEYS.sessions;
const THEME_STORAGE_KEY = SYNC_STORAGE_KEYS.theme;
const LEGACY_BOOKS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.books;
const LEGACY_SESSIONS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.sessions;
const TIMER_OPEN_STORAGE_KEY = DEVICE_STORAGE_KEYS.timerOpen;
const DAYTIME_MAINTENANCE_KEY = DEVICE_STORAGE_KEYS.daytimeLibraryMaintenance;
const DAILY_GOAL_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes;
const DAYTIME_MAINTENANCE_COOLDOWN_MS = 60 * 1000;
const DAYTIME_MAINTENANCE_BATCH_SIZE = 2;
const MAINTENANCE_CHECK_INTERVAL_MS = 60 * 1000;
const IMPORT_QUEUE_LOCK_LEASE_MS = 12 * 1000;
let isImportQueueProcessing = false;
let importQueueProcessingStartedAt = 0;
let importQueueRunId = 0;
let foregroundImportRetryPending = false;

interface SessionMilestoneNotice {
  date: string;
  streak: number;
  dailyMinutes: number;
  dailyGoal: number;
}

interface BookProgressCorrection {
  progressPages?: number;
  progressMinutes?: number;
  pageCount?: number;
  audiobookDurationMins?: number;
}

function readStoredCollection<T>(primaryKey: string, legacyKey: string, fallback: T): T {
  try {
    const storage = getRuntimeStorage();
    const stored = storage.getItem(primaryKey) ?? storage.getItem(legacyKey);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readDailyGoalMinutes(): number {
  try {
    const raw = getRuntimeStorage().getItem(DAILY_GOAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : 30;
    return Math.max(1, Number(parsed) || 30);
  } catch {
    return 30;
  }
}

function isReadingTimerOpen(): boolean {
  try {
    return getRuntimeStorage().getItem(TIMER_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function isPreferredMaintenanceWindow(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

function canRunDaytimeMaintenance(): boolean {
  try {
    const lastRun = Number(getRuntimeStorage().getItem(DAYTIME_MAINTENANCE_KEY) ?? 0);
    return !Number.isFinite(lastRun) || Date.now() - lastRun >= DAYTIME_MAINTENANCE_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markDaytimeMaintenanceRun() {
  writeRuntimeValue(DAYTIME_MAINTENANCE_KEY, String(Date.now()));
}

export default function App() {
  const [activeTab, setActiveTab] = usePersistentState<NavTab>(DEVICE_STORAGE_KEYS.activeTab, 'home');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = readRuntimeValue(THEME_STORAGE_KEY);
    return savedTheme ? savedTheme === 'dark' : true;
  });
  const [books, setBooks] = useState<UserBookRecord[]>(() => readStoredCollection<UserBookRecord[]>(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, []));
  const booksRef = useRef(books);
  const [sessions, setSessions] = useState<ReadingSession[]>(() => readStoredCollection<ReadingSession[]>(SESSIONS_STORAGE_KEY, LEGACY_SESSIONS_STORAGE_KEY, []));
  const sessionsRef = useRef(sessions);
  const [previousBooksState, setPreviousBooksState] = useState<UserBookRecord[] | null>(null);
  const [previousSessionsState, setPreviousSessionsState] = useState<ReadingSession[] | null>(null);
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<UserBookRecord | null>(null);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [isTimerOpen, setIsTimerOpen] = usePersistentState(TIMER_OPEN_STORAGE_KEY, false);
  const [timerInitialBookId, setTimerInitialBookId] = usePersistentState<string | undefined>(DEVICE_STORAGE_KEYS.timerBookId, undefined);
  const [isAddBookOpen, setIsAddBookOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [sessionMilestone, setSessionMilestone] = useState<SessionMilestoneNotice | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
    writeRuntimeValue(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    booksRef.current = books;
    writeRuntimeJson(BOOKS_STORAGE_KEY, books);
    removeRuntimeValue(LEGACY_BOOKS_STORAGE_KEY);
  }, [books]);

  useEffect(() => {
    sessionsRef.current = sessions;
    writeRuntimeJson(SESSIONS_STORAGE_KEY, sessions);
    removeRuntimeValue(LEGACY_SESSIONS_STORAGE_KEY);
  }, [sessions]);

  useEffect(() => {
    const refreshCanonicalCollections = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      const keys = detail?.keys ?? [];

      if (keys.includes(BOOKS_STORAGE_KEY)) {
        const nextBooks = readStoredCollection<UserBookRecord[]>(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, []);
        booksRef.current = nextBooks;
        setBooks(nextBooks);
      }

      if (keys.includes(SESSIONS_STORAGE_KEY)) {
        const nextSessions = readStoredCollection<ReadingSession[]>(SESSIONS_STORAGE_KEY, LEGACY_SESSIONS_STORAGE_KEY, []);
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
      }
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refreshCanonicalCollections);
    return () => window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refreshCanonicalCollections);
  }, []);

  const commitCanonicalBooks = (
    update: UserBookRecord[] | ((current: UserBookRecord[]) => UserBookRecord[]),
  ): UserBookRecord[] => {
    const current = booksRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    // Persist first so runtimeStorage captures durable local intent before any
    // cloud listener can reconcile against this mutation. React state mirrors
    // that canonical local write; it is not the persistence owner.
    booksRef.current = next;
    replaceCanonicalLibrary(next);
    setBooks(next);
    return next;
  };

  const commitCanonicalSessions = (
    update: ReadingSession[] | ((current: ReadingSession[]) => ReadingSession[]),
  ): ReadingSession[] => {
    const current = sessionsRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    sessionsRef.current = next;
    replaceCanonicalSessions(next);
    setSessions(next);
    return next;
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 4000);
  };

  const showSessionMilestone = (notice: SessionMilestoneNotice) => {
    setSessionMilestone(notice);
    window.setTimeout(() => setSessionMilestone((current) => current?.date === notice.date ? null : current), 7000);
  };

  const processImportEnrichmentQueue = async (foregroundTargetBookIds?: string[]) => {
    const forceRetry = Boolean(foregroundTargetBookIds?.length);
    if (forceRetry) {
      const requestedCount = foregroundTargetBookIds!.length;
      writeImportEnrichmentRetryProgress({ status: 'queued', completed: 0, total: requestedCount, matched: 0, covers: 0, summaries: 0, message: isImportQueueProcessing ? 'Finishing the current background metadata check, then this retry will start automatically.' : undefined, updatedAt: new Date().toISOString() });
      foregroundImportRetryPending = true;
      while (isImportQueueProcessing) {
        const lockAge = importQueueProcessingStartedAt ? Date.now() - importQueueProcessingStartedAt : IMPORT_QUEUE_LOCK_LEASE_MS + 1;
        if (lockAge > IMPORT_QUEUE_LOCK_LEASE_MS) { importQueueRunId += 1; isImportQueueProcessing = false; importQueueProcessingStartedAt = 0; break; }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      }
      foregroundImportRetryPending = false;
    } else if (isImportQueueProcessing || foregroundImportRetryPending) return;

    if (!navigator.onLine || isReadingTimerOpen()) {
      if (forceRetry) writeImportEnrichmentRetryProgress({ status: 'error', completed: 0, total: foregroundTargetBookIds!.length, matched: 0, covers: 0, summaries: 0, message: !navigator.onLine ? 'Connect to the internet, then retry the missing details again.' : 'Finish or close the active reading timer, then retry the missing details again.', updatedAt: new Date().toISOString() });
      return;
    }
    if (!forceRetry && isImportEnrichmentPaused()) return;

    const initialQueue = readImportEnrichmentQueue();
    if (initialQueue.length === 0) {
      if (forceRetry) writeImportEnrichmentRetryProgress({ status: 'complete', completed: 0, total: 0, matched: 0, covers: 0, summaries: 0, message: 'There are no missing book details left in the retry queue.', updatedAt: new Date().toISOString() });
      return;
    }

    const targetIds = forceRetry ? new Set(foregroundTargetBookIds) : null;
    const untouchedQueue = targetIds ? initialQueue.filter((item) => !targetIds.has(item.targetBookId)) : [];
    let pending = targetIds ? initialQueue.filter((item) => targetIds.has(item.targetBookId)) : [...initialQueue];
    if (forceRetry && pending.length === 0) {
      writeImportEnrichmentRetryProgress({ status: 'complete', completed: 0, total: 0, matched: 0, covers: 0, summaries: 0, message: 'Those books no longer need a retry.', updatedAt: new Date().toISOString() });
      return;
    }

    const isQuietHours = isPreferredMaintenanceWindow();
    if (!forceRetry && !canRunDaytimeMaintenance()) return;
    isImportQueueProcessing = true;
    importQueueProcessingStartedAt = Date.now();
    const runId = ++importQueueRunId;
    const retryItems: ImportEnrichmentQueueItem[] = [];
    let updatedCount = 0;
    let coverCount = 0;
    let summaryCount = 0;
    let processedBatchCount = 0;
    const retryTotal = forceRetry ? pending.length : 0;
    if (forceRetry) writeImportEnrichmentRetryProgress({ status: 'running', completed: 0, total: retryTotal, matched: 0, covers: 0, summaries: 0, message: undefined, updatedAt: new Date().toISOString() });

    try {
      while (pending.length > 0 && navigator.onLine) {
        if (runId !== importQueueRunId) return;
        if (isReadingTimerOpen() || (!forceRetry && isImportEnrichmentPaused())) break;
        if (!forceRetry && processedBatchCount >= 1) break;
        const batchSize = forceRetry ? IMPORT_ENRICHMENT_BATCH_SIZE : DAYTIME_MAINTENANCE_BATCH_SIZE;
        const batch = pending.slice(0, batchSize);
        pending = pending.slice(batch.length);
        processedBatchCount += 1;
        const results = await enrichImportedBooks(batch);
        if (runId !== importQueueRunId) return;
        const successful = results.filter((result) => result.success && result.enriched);
        const enrichedById = new Map(successful.map((result) => [result.item.targetBookId, result.enriched!]));
        if (enrichedById.size > 0) commitCanonicalBooks((current) => current.map((book) => { const enriched = enrichedById.get(book.id); return enriched ? mergeEnrichedImportedBook(book, enriched) : book; }));
        results.forEach((result) => {
          if (result.success) { updatedCount += 1; if (result.foundCover) coverCount += 1; if (result.foundSummary) summaryCount += 1; }
          else retryItems.push({ ...result.item, attempts: (result.item.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString() });
        });
        writeImportEnrichmentQueue([...retryItems, ...pending, ...untouchedQueue]);
        if (forceRetry) writeImportEnrichmentRetryProgress({ status: 'running', completed: retryTotal - pending.length, total: retryTotal, matched: updatedCount, covers: coverCount, summaries: summaryCount, updatedAt: new Date().toISOString() });
        await new Promise<void>((resolve) => window.setTimeout(resolve, forceRetry ? 250 : 750));
      }
      if (runId !== importQueueRunId) return;
      writeImportEnrichmentQueue([...retryItems, ...pending, ...untouchedQueue]);
      if (!forceRetry && processedBatchCount > 0) markDaytimeMaintenanceRun();
      if (forceRetry) {
        const completed = retryTotal - pending.length;
        const finished = pending.length === 0;
        writeImportEnrichmentRetryProgress({ status: finished ? 'complete' : 'error', completed, total: retryTotal, matched: updatedCount, covers: coverCount, summaries: summaryCount, message: finished ? `${completed.toLocaleString()} books were checked. Books that still could not be matched remain safely queued for later background attempts.` : `The retry stopped after ${completed.toLocaleString()} of ${retryTotal.toLocaleString()} books. The remaining books are still queued.`, updatedAt: new Date().toISOString() });
        showToast(`Retry checked ${completed} books · ${coverCount} covers · ${summaryCount} summaries.`);
      } else if (updatedCount > 0) showToast(`Updated ${updatedCount} books · ${coverCount} covers · ${summaryCount} summaries.`);
      else if (isQuietHours && initialQueue.length > 0 && !isReadingTimerOpen() && !isImportEnrichmentPaused()) showToast('Inkbound kept the remaining books queued and will retry their details later.');
    } catch {
      if (runId !== importQueueRunId) return;
      writeImportEnrichmentQueue([...retryItems, ...pending, ...untouchedQueue]);
      if (!forceRetry && processedBatchCount > 0) markDaytimeMaintenanceRun();
      if (forceRetry) writeImportEnrichmentRetryProgress({ status: 'error', completed: retryTotal - pending.length, total: retryTotal, matched: updatedCount, covers: coverCount, summaries: summaryCount, message: 'Inkbound could not finish this retry. The unprocessed books remain safely queued so you can try again.', updatedAt: new Date().toISOString() });
      showToast('Book details are safely queued and will resume when Inkbound can reach its metadata sources.');
    } finally {
      if (runId === importQueueRunId) { isImportQueueProcessing = false; importQueueProcessingStartedAt = 0; }
      if (forceRetry) foregroundImportRetryPending = false;
    }
  };

  useEffect(() => {
    const repairedQueue = buildRepairQueueItems(books, readImportEnrichmentQueue());
    writeImportEnrichmentQueue(repairedQueue);
    if (!isTimerOpen) void processImportEnrichmentQueue();
  }, [books, isTimerOpen]);
  useEffect(() => { if (!isTimerOpen) void processImportEnrichmentQueue(); }, [isTimerOpen]);
  useEffect(() => {
    const resumeMaintenance = () => void processImportEnrichmentQueue();
    window.addEventListener('online', resumeMaintenance);
    const unsubscribeRuntimeResume = subscribeToRuntimeResume(resumeMaintenance);
    const interval = window.setInterval(resumeMaintenance, MAINTENANCE_CHECK_INTERVAL_MS);
    return () => { window.removeEventListener('online', resumeMaintenance); unsubscribeRuntimeResume(); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!selectedBookForDetails) return undefined;
    return subscribeToRuntimeBackNavigation(() => {
      setSelectedBookForDetails(null);
    });
  }, [selectedBookForDetails]);

  const openTimer = (bookId?: string) => { setTimerInitialBookId(bookId); setIsTimerOpen(true); };
  const closeTimer = () => setIsTimerOpen(false);
  const handleToggleSelectBook = (id: string) => setSelectedBookIds((current) => current.includes(id) ? current.filter((bookId) => bookId !== id) : [...current, id]);
  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    const previous = booksRef.current.find((book) => book.id === updatedBook.id);
    commitCanonicalBooks((current) => current.map((book) => (book.id === updatedBook.id ? updatedBook : book)));
    setSelectedBookForDetails((current) => (current?.id === updatedBook.id ? updatedBook : current));
    if (previous?.status !== 'finished' && updatedBook.status === 'finished') {
      void notifyNativeBookFinished(updatedBook);
    }
  };
  const handleDeleteBook = (bookToDelete: UserBookRecord) => { commitCanonicalBooks((current) => current.filter((book) => book.id !== bookToDelete.id)); commitCanonicalSessions((current) => current.filter((session) => session.bookId !== bookToDelete.id)); setSelectedBookIds((current) => current.filter((id) => id !== bookToDelete.id)); setSelectedBookForDetails(null); showToast(`Deleted “${bookToDelete.work.title}” and its reading sessions.`); };
  const handleMergeDuplicateGroup = ({ keepBookId, removeBookIds, mergedBook }: DuplicateMergeRequest) => { const removeIds = new Set(removeBookIds); setPreviousBooksState(null); setPreviousSessionsState(null); commitCanonicalBooks((current) => current.filter((book) => !removeIds.has(book.id)).map((book) => book.id === keepBookId ? mergedBook : book)); commitCanonicalSessions((current) => current.map((session) => removeIds.has(session.bookId) ? { ...session, bookId: keepBookId } : session)); setSelectedBookIds((current) => current.filter((id) => !removeIds.has(id))); setSelectedBookForDetails((current) => current && removeIds.has(current.id) ? mergedBook : current?.id === keepBookId ? mergedBook : current); writeImportEnrichmentQueue(readImportEnrichmentQueue().filter((item) => !removeIds.has(item.targetBookId))); showToast(`Merged ${removeBookIds.length + 1} copies of “${mergedBook.work.title}” into one library record.`); };
  const handleUpdateStatus = (bookId: string, status: ReadingStatus) => {
    const today = localDateKey();
    const previous = booksRef.current.find((book) => book.id === bookId);
    const updated = previous ? withReadingStatus(previous, status, today) : undefined;
    if (updated) {
      commitCanonicalBooks((current) => current.map((book) => book.id === bookId ? updated : book));
      if (previous?.status !== 'finished' && updated.status === 'finished') void notifyNativeBookFinished(updated);
    }
    showToast(`Updated reading status to ${status}.`);
  };

  const handleCorrectBookProgress = (bookId: string, correction: BookProgressCorrection) => {
    const sourceBook = booksRef.current.find((book) => book.id === bookId);
    if (!sourceBook) return;
    const sourceEdition = getActiveEdition(sourceBook);
    if (!sourceEdition) return;
    const isAudiobook = sourceEdition.format === 'audiobook';
    const oldProgress = isAudiobook ? sourceBook.progressMinutes : sourceBook.progressPages;
    const correctedProgress = isAudiobook ? Math.max(0, correction.progressMinutes ?? sourceBook.progressMinutes) : Math.max(0, correction.progressPages ?? sourceBook.progressPages);
    if ((isAudiobook && correction.progressMinutes !== undefined) || (!isAudiobook && correction.progressPages !== undefined)) {
      const related = sessions.filter((session) => session.bookId === bookId).sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
      const latest = related.at(-1);
      if (latest && getSessionProgressEndpoint(latest, isAudiobook, 'end') === oldProgress) {
        commitCanonicalSessions((current) => current.map((session) => {
          if (session.id !== latest.id) return session;
          if (isAudiobook) { const endTimestampSec = correctedProgress * 60; const startTimestampSec = Math.min(session.startTimestampSec ?? endTimestampSec, endTimestampSec); return { ...session, startTimestampSec, endTimestampSec, minutesListened: Math.max(0, Math.round((endTimestampSec - startTimestampSec) / 60)) }; }
          const endPage = correctedProgress; const startPage = Math.min(session.startPage ?? endPage, endPage); return { ...session, startPage, endPage, pagesRead: Math.max(0, endPage - startPage) };
        }));
      }
    }
    commitCanonicalBooks((current) => current.map((book) => {
      if (book.id !== bookId) return book;
      const activeEdition = getActiveEdition(book);
      if (!activeEdition) return book;
      const nextEdition = { ...activeEdition, ...(correction.pageCount !== undefined ? { pageCount: Math.max(0, correction.pageCount), externalSource: 'manual' as const } : {}), ...(correction.audiobookDurationMins !== undefined ? { audiobookDurationMins: Math.max(0, correction.audiobookDurationMins), externalSource: 'manual' as const } : {}) };
      const nextPages = Math.max(0, correction.progressPages ?? book.progressPages);
      const nextMinutes = Math.max(0, correction.progressMinutes ?? book.progressMinutes);
      const updatedBook = reconcileBookProgressWithActiveEdition({
        ...book,
        editions: book.editions.map((edition) => edition.id === activeEdition.id ? nextEdition : edition),
        progressPages: nextPages,
        progressMinutes: nextMinutes,
      });
      setSelectedBookForDetails((selected) => selected?.id === bookId ? updatedBook : selected); return updatedBook;
    }));
    showToast('Corrected book progress and reconciled the latest reading session.');
  };

  const handleUpdatePriority = (bookId: string, priority: Priority) => { commitCanonicalBooks((current) => current.map((book) => (book.id === bookId ? { ...book, priority } : book))); };

  const handleApplyBatchChanges = (changes: BatchEditChanges) => {
    setPreviousBooksState(books); setPreviousSessionsState(null); const today = localDateKey();
    commitCanonicalBooks((current) => current.map((book) => {
      if (!selectedBookIds.includes(book.id)) return book;
      let updatedBook: UserBookRecord = { ...book };
      if (changes.format) updatedBook.editions = updatedBook.editions.map((edition) => edition.id === updatedBook.activeEditionId ? { ...edition, format: changes.format! } : edition);
      if (changes.status) updatedBook = withReadingStatus(updatedBook, changes.status, today);
      if (changes.ownership) {
        updatedBook = withBookOwnership(
          updatedBook,
          changes.ownership,
          changes.ownership === 'custom' ? changes.customOwnershipCategoryId ?? undefined : undefined,
        );
      }
      if (changes.priority) updatedBook.priority = changes.priority;
      if (changes.rating !== undefined) updatedBook.rating = changes.rating ?? undefined;
      if (changes.dateStarted !== undefined) updatedBook.dateStarted = changes.dateStarted ?? undefined;
      if (changes.dateFinished !== undefined) updatedBook.dateFinished = updatedBook.status === 'finished' ? changes.dateFinished ?? undefined : undefined;
      if (changes.libraryLoanDueDate !== undefined) updatedBook.libraryLoan = changes.libraryLoanDueDate === null
        ? { ...(updatedBook.libraryLoan?.borrowedDate ? { borrowedDate: updatedBook.libraryLoan.borrowedDate } : {}) }
        : { ...updatedBook.libraryLoan, dueDate: changes.libraryLoanDueDate };
      if (changes.addTag && !updatedBook.privateTags.includes(changes.addTag)) updatedBook.privateTags = [...updatedBook.privateTags, changes.addTag];
      if (changes.removeTag) updatedBook.privateTags = updatedBook.privateTags.filter((tag) => tag.toLowerCase() !== changes.removeTag!.toLowerCase());
      if (changes.addCollection && !updatedBook.collections.includes(changes.addCollection)) updatedBook.collections = [...updatedBook.collections, changes.addCollection];
      if (changes.removeCollection) updatedBook.collections = updatedBook.collections.filter((collection) => collection.toLowerCase() !== changes.removeCollection!.toLowerCase());
      return normalizeLibraryRecord(updatedBook);
    }));
    const count = selectedBookIds.length; setSelectedBookIds([]); setIsBatchEditOpen(false); showToast(`Applied batch changes to ${count} books.`);
  };

  const handleDeleteSelected = () => { setPreviousBooksState(books); setPreviousSessionsState(sessions); const selectedIds = new Set(selectedBookIds); const count = selectedBookIds.length; commitCanonicalBooks((current) => current.filter((book) => !selectedIds.has(book.id))); commitCanonicalSessions((current) => current.filter((session) => !selectedIds.has(session.bookId))); setSelectedBookIds([]); setIsBatchEditOpen(false); showToast(`Deleted ${count} books and their reading sessions.`); };
  const handleUndoLastBatch = () => { if (!previousBooksState) return; commitCanonicalBooks(previousBooksState); if (previousSessionsState) commitCanonicalSessions(previousSessionsState); setPreviousBooksState(null); setPreviousSessionsState(null); showToast('Undid the most recent library change.'); };

  const updateBookFromSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    commitCanonicalBooks((current) => current.map((book) => applySessionProgressToBook(book, newSession, updatedPages, updatedMinutes)));
  };

  const reconcileBookProgressFromSessions = (bookId: string, nextSessions: ReadingSession[], changedSession?: ReadingSession) => {
    commitCanonicalBooks((current) => current.map((book) => book.id === bookId ? reconcileBookAfterSessionMutation(book, nextSessions, changedSession) : book));
  };

  const maybeShowFirstSessionMilestone = (newSession: ReadingSession) => { const hadPriorSessionThatDay = sessionsRef.current.some((session) => session.date === newSession.date && getSessionDurationMinutes(session) > 0); const isFirstCompletedSessionThatDay = !hadPriorSessionThatDay && getSessionDurationMinutes(newSession) > 0; if (!isFirstCompletedSessionThatDay) return; const projectedSessions = [newSession, ...sessionsRef.current]; showSessionMilestone({ date: newSession.date, streak: getReadingStreak(projectedSessions, newSession.date), dailyMinutes: getDailyReadingMinutes(projectedSessions, newSession.date), dailyGoal: readDailyGoalMinutes() }); };
  const handleSaveSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    maybeShowFirstSessionMilestone(newSession);
    const previousBook = booksRef.current.find((book) => book.id === newSession.bookId);
    const updatedBook = previousBook
      ? applySessionProgressToBook(previousBook, newSession, updatedPages, updatedMinutes)
      : undefined;
    commitCanonicalSessions((current) => [newSession, ...current]);
    updateBookFromSession(newSession, updatedPages, updatedMinutes);
    setTimerInitialBookId(undefined);
    setIsTimerOpen(false);
    void notifyNativeReadingSessionFinished(newSession, updatedBook ?? previousBook);
    if (previousBook?.status !== 'finished' && updatedBook?.status === 'finished') {
      void notifyNativeBookFinished(updatedBook);
    }
    showToast(`Saved a ${getSessionDurationMinutes(newSession)}-minute reading session.`);
  };
  const handleSaveManualSession = (session: ReadingSession) => {
    const nextSessions = [session, ...sessionsRef.current];
    commitCanonicalSessions(nextSessions);
    commitCanonicalBooks((current) => current.map((book) =>
      book.id === session.bookId ? reconcileBookAfterSessionMutation(book, nextSessions) : book,
    ));
    showToast('Added past reading session.');
  };
  const handleSaveManualSessions = (newSessions: ReadingSession[]) => {
    if (newSessions.length === 0) return;
    const nextSessions = [...newSessions, ...sessionsRef.current];
    const affectedBookIds = new Set(newSessions.map((session) => session.bookId));
    commitCanonicalSessions(nextSessions);
    commitCanonicalBooks((current) => current.map((book) =>
      affectedBookIds.has(book.id) ? reconcileBookAfterSessionMutation(book, nextSessions) : book,
    ));
    showToast(`Added ${newSessions.length} past reading session${newSessions.length === 1 ? '' : 's'}.`);
  };
  const handleUpdateSession = (session: ReadingSession) => { const previous = sessionsRef.current.find((item) => item.id === session.id); const nextSessions = sessionsRef.current.map((item) => item.id === session.id ? session : item); commitCanonicalSessions(nextSessions); if (previous && previous.bookId !== session.bookId) { reconcileBookProgressFromSessions(previous.bookId, nextSessions, previous); reconcileBookProgressFromSessions(session.bookId, nextSessions); } else reconcileBookProgressFromSessions(session.bookId, nextSessions, previous); showToast('Updated reading session and reconciled book progress.'); };
  const handleDeleteSession = (sessionId: string) => { const removed = sessionsRef.current.find((session) => session.id === sessionId); const nextSessions = sessionsRef.current.filter((session) => session.id !== sessionId); commitCanonicalSessions(nextSessions); if (removed) reconcileBookProgressFromSessions(removed.bookId, nextSessions, removed); showToast('Deleted reading session and reconciled book progress.'); };

  const handleExecuteImport = async (importedItems: ImportRecordItem[]): Promise<ImportRecordItem[]> => {
    const currentLibrary = booksRef.current; const { unique: acceptedItems, duplicates: writeDuplicates } = analyzeImportDuplicates(importedItems, currentLibrary);
    if (acceptedItems.length === 0) { showToast('No books were added because they already exist in your library.'); return []; }
    setPreviousBooksState(currentLibrary); setPreviousSessionsState(null); const immediateBooks = acceptedItems.map(createFallbackImportedBook); const nextLibrary = [...currentLibrary, ...immediateBooks]; commitCanonicalBooks(nextLibrary);
    const existingQueue = readImportEnrichmentQueue(); const queuedByBookId = new Map(existingQueue.map((item) => [item.targetBookId, item])); queueImportedItems(acceptedItems).forEach((item) => queuedByBookId.set(item.targetBookId, item)); writeImportEnrichmentQueue([...queuedByBookId.values()]);
    const verificationSnapshot = getImportVerificationSnapshot(); appendImportHistory(acceptedItems, verificationSnapshot.duplicates.length + writeDuplicates.length); const skippedAtWrite = importedItems.length - acceptedItems.length; showToast(navigator.onLine ? `Added ${immediateBooks.length} books${skippedAtWrite > 0 ? ` and skipped ${skippedAtWrite} late duplicate${skippedAtWrite === 1 ? '' : 's'}` : ''}. Covers and publisher summaries will continue updating automatically.` : `Added ${immediateBooks.length} books offline${skippedAtWrite > 0 ? ` and skipped ${skippedAtWrite} late duplicate${skippedAtWrite === 1 ? '' : 's'}` : ''}. Covers and publisher summaries will update when Inkbound is online.`); void processImportEnrichmentQueue(); return acceptedItems;
  };

  const handleResetData = () => { commitCanonicalBooks([]); commitCanonicalSessions([]); setPreviousBooksState(null); setPreviousSessionsState(null); setSelectedBookForDetails(null); setSelectedBookIds([]); removeRuntimeValue(LEGACY_BOOKS_STORAGE_KEY); removeRuntimeValue(LEGACY_SESSIONS_STORAGE_KEY); removeRuntimeValue(DAYTIME_MAINTENANCE_KEY); writeImportEnrichmentQueue([]); writeImportHistory([]); writeImportEnrichmentRetryProgress(null); setImportEnrichmentPaused(false); showToast('Cleared all Inkbound books and reading sessions.'); };
  const currentSelectedBook = selectedBookForDetails ? books.find((book) => book.id === selectedBookForDetails.id) ?? selectedBookForDetails : null;

  return (
    <ResponsiveShell navigation={<Navbar activeTab={activeTab} setActiveTab={setActiveTab} books={books} onSelectBook={setSelectedBookForDetails} onOpenAddBook={() => setIsAddBookOpen(true)} onOpenTimer={() => openTimer()} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}>
      <main className="inkbound-main-content"><ResponsiveContainer width="wide">
        {activeTab === 'home' && <HomeDashboard books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onStartSessionForBook={(book) => openTimer(book.id)} onUpdateStatus={handleUpdateStatus} onNavigateToTab={setActiveTab} onOpenAddBook={() => setIsAddBookOpen(true)} />}
        {activeTab === 'library' && <LibraryScreen books={books} selectedBookIds={selectedBookIds} onToggleSelectBook={handleToggleSelectBook} onSelectAll={setSelectedBookIds} onClearSelection={() => setSelectedBookIds([])} onSelectBook={setSelectedBookForDetails} onOpenBatchEdit={() => setIsBatchEditOpen(true)} onOpenAddBook={() => setIsAddBookOpen(true)} onAddBook={(newBook) => { commitCanonicalBooks((current) => [newBook, ...current]); showToast(`Added “${newBook.work.title}” to Inkbound.`); }} />}
        {activeTab === 'duplicates' && <DuplicateManagerScreen books={books} onMergeGroup={handleMergeDuplicateGroup} onSelectBook={setSelectedBookForDetails} />}
        {activeTab === 'tbr' && <TBRScreen books={books} onSelectBook={setSelectedBookForDetails} onUpdateStatus={handleUpdateStatus} onUpdatePriority={handleUpdatePriority} />}
        {activeTab === 'sessions' && <div className="space-y-8"><ReadingActivityOverview books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onUpdateBook={handleUpdateBook} /><ReadingSessionsScreen books={books} sessions={sessions} onOpenTimer={openTimer} onSelectBook={setSelectedBookForDetails} onSaveManualSession={handleSaveManualSession} onSaveManualSessions={handleSaveManualSessions} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} /></div>}
        {activeTab === 'challenges' && <ReadingChallengesScreen books={books} sessions={sessions} />}{activeTab === 'achievements' && <AchievementsScreen books={books} sessions={sessions} />}{activeTab === 'collections' && <CollectionsScreen books={books} onUpdateBook={handleUpdateBook} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'import-history' && <ImportHistoryScreen books={books} onResumeEnrichment={() => void processImportEnrichmentQueue()} onRetryEnrichment={(targetBookIds) => processImportEnrichmentQueue(targetBookIds)} />}{activeTab === 'timeline' && <ReadingTimelineScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'memories' && <ReadingMemoriesScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'time-capsules' && <ReadingTimeCapsulesScreen books={books} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'photo-memories' && <PhotoMemoriesScreen books={books} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'bookshelf-time' && <BookshelfThroughTimeScreen books={books} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'my-dragon' && <MyDragonScreen books={books} sessions={sessions} />}{activeTab === 'personality' && <ReaderPersonalityScreen books={books} sessions={sessions} />}{activeTab === 'insights' && <ReadingInsightsScreen books={books} sessions={sessions} />}{activeTab === 'studio' && <InkboundStudioScreen books={books} sessions={sessions} />}{activeTab === 'wrapped' && <MonthlyWrappedScreen books={books} sessions={sessions} />}{activeTab === 'yearbook' && <YearInBooksScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'stats' && <StatisticsScreen books={books} sessions={sessions} />}{activeTab === 'import' && <ImportCenterScreen books={books} onExecuteImport={handleExecuteImport} onUndoLastImport={handleUndoLastBatch} onRetryEnrichment={(targetBookIds) => processImportEnrichmentQueue(targetBookIds)} />}{activeTab === 'settings' && <SettingsScreen books={books} sessions={sessions} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} onResetData={handleResetData} />}{activeTab === 'profile' && <ProfileScreen books={books} sessions={sessions} />}{activeTab === 'admin' && <AdminScreen />}
      </ResponsiveContainer></main>
      {currentSelectedBook && <BookDetailsModal book={currentSelectedBook} sessions={sessions} onClose={() => setSelectedBookForDetails(null)} onUpdateBook={handleUpdateBook} onCorrectProgress={handleCorrectBookProgress} onDeleteBook={handleDeleteBook} onStartSession={(book) => { setSelectedBookForDetails(null); openTimer(book.id); }} onSaveManualSession={handleSaveManualSession} onSaveManualSessions={handleSaveManualSessions} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} />}
      {isBatchEditOpen && <BatchEditModal selectedBookIds={selectedBookIds} books={books} onClose={() => setIsBatchEditOpen(false)} onApplyBatchChanges={handleApplyBatchChanges} onDeleteSelected={handleDeleteSelected} onUndoLastBatch={handleUndoLastBatch} />}
      {isTimerOpen && <ReadingSessionModal books={books} sessions={sessions} initialBookId={timerInitialBookId} onClose={closeTimer} onSaveSession={handleSaveSession} />}
      {isAddBookOpen && <AddBookModal currentBookCount={books.length} onClose={() => setIsAddBookOpen(false)} onAddBook={(newBook) => { commitCanonicalBooks((current) => [newBook, ...current]); showToast(`Added “${newBook.work.title}” to Inkbound.`); }} onAddMultipleBooks={(newBooks) => { commitCanonicalBooks((current) => [...newBooks, ...current]); showToast(`Added ${newBooks.length} books to Inkbound.`); }} />}
      {sessionMilestone && <div className="fixed bottom-24 left-1/2 z-[150] w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl border border-[#c5a059]/45 bg-[#1c0f24]/95 p-4 text-[#f4efe6] shadow-2xl backdrop-blur"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2"><Flame className="h-5 w-5 text-[#e5c158]" /><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading streak</p><p className="font-serif text-xl font-bold">{sessionMilestone.streak} day{sessionMilestone.streak === 1 ? '' : 's'}</p></div></div><div className="flex items-center gap-2 text-right"><Target className="h-5 w-5 text-[#e5c158]" /><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Daily goal</p><p className="font-serif text-xl font-bold">{sessionMilestone.dailyMinutes} / {sessionMilestone.dailyGoal}m</p><p className="text-xs text-stone-400">{sessionMilestone.dailyMinutes >= sessionMilestone.dailyGoal ? 'Goal reached!' : `${sessionMilestone.dailyGoal - sessionMilestone.dailyMinutes} minutes to go.`}</p></div></div></div></div>}
      {toastMessage && <div className="inkbound-toast" role="status"><Check className="h-4 w-4 text-[var(--ink-gold)]" /><span>{toastMessage}</span>{previousBooksState && <button type="button" onClick={handleUndoLastBatch}><RotateCcw className="h-3 w-3" /> Undo</button>}</div>}
    </ResponsiveShell>
  );
}
