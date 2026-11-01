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
import { ReadingWidgetSyncBridge } from './features/reading/ReadingWidgetSyncBridge';
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
import { withBookOwnership } from './features/ownership/bookOwnership';
import { syncNativeLibraryLoanReminders } from './features/loans/nativeLibraryLoanReminders';
import { replaceCanonicalLibrary, replaceCanonicalSessions } from './features/library/libraryMutations';
import { openLibrarySeriesForBook } from './features/library/libraryNavigation';
import { getActiveEdition, withReadingStatus } from './features/reading/bookReadingState';
import { withCustomReadingStatus } from './features/reading/customReadingStatuses';
import {
  applySessionProgressToBook,
  reconcileBookAfterSessionMutation,
  reconcileBooksAfterSessionCollectionChange,
  reconcileBooksFromExistingSessionEvidence,
} from './features/reading/sessionBookReconciliation';
import {
  getDailyActivityCount,
  getDailyGoalMinutes,
  getDailyPagesRead,
  getReadingStreak,
  getSessionDurationMinutes,
  localDateKey,
} from './features/reading/sessionAnalytics';
import {
  addConfirmedProgressActivity,
  buildProgressActivityPrompt,
  type ProgressActivityPrompt,
} from './features/reading/progressActivity';
import { INKBOUND_CLOUD_DATA_EVENT, type CloudDataUpdatedDetail } from './features/sync/cloudSyncEvents';
import { ACCOUNT_DATA_STORAGE_KEYS, LEGACY_SYNC_STORAGE_KEYS, SYNC_STORAGE_KEYS } from './features/sync/storageKeys';
import { subscribeToRuntimeResume } from './platform/runtimeLifecycle';
import { LARGE_BROWSER_STORAGE_WRITE_FAILED_EVENT } from './platform/largeBrowserStorage';
import {
  getRuntimeStorage,
  readRuntimeValue,
  removeRuntimeValue,
  writeRuntimeValue,
} from './platform/runtimeStorage';
import { Check, Flame, RotateCcw, Target } from 'lucide-react';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_STORAGE_KEY = SYNC_STORAGE_KEYS.sessions;
const THEME_STORAGE_KEY = SYNC_STORAGE_KEYS.theme;
const LEGACY_BOOKS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.books;
const LEGACY_SESSIONS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.sessions;
const TIMER_OPEN_STORAGE_KEY = 'inkbound_timer_open';
const DAYTIME_MAINTENANCE_KEY = 'inkbound_last_daytime_library_maintenance';
const DAILY_GOAL_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes;
const DAILY_PAGE_GOAL_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalPages;
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
  dailyValue: number;
  dailyGoal: number;
  unit: 'pages' | 'minutes';
  activityCount: number;
}

interface BookProgressCorrection {
  progressPages?: number;
  progressMinutes?: number;
  pageCount?: number;
  audiobookDurationMins?: number;
}

function readStoredCollection<T>(primaryKey: string, legacyKey: string, fallback: T): T {
  const storage = getRuntimeStorage();
  const stored = storage.getItem(primaryKey) ?? storage.getItem(legacyKey);
  if (stored === null) return fallback;
  try {
    return JSON.parse(stored) as T;
  } catch (error) {
    // Unreadable canonical data is NOT an empty library. Keep the original
    // bytes untouched and stop this read instead of overwriting with [].
    console.error('[Inkbound persistence] Stored collection is unreadable; preserving original bytes.', primaryKey, error);
    throw new Error(`Inkbound cannot safely read saved collection ${primaryKey}. Existing data has not been replaced.`);
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

function readDailyGoalPages(): number {
  try {
    const raw = getRuntimeStorage().getItem(DAILY_PAGE_GOAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : 20;
    return Math.max(1, Number(parsed) || 20);
  } catch {
    return 20;
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
  const [activeTab, setActiveTab] = usePersistentState<NavTab>('inkbound_active_tab', 'home');
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
  const [timerInitialBookId, setTimerInitialBookId] = usePersistentState<string | undefined>('inkbound_timer_book_id', undefined);
  const [isAddBookOpen, setIsAddBookOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [sessionMilestone, setSessionMilestone] = useState<SessionMilestoneNotice | null>(null);
  const [progressActivityPrompt, setProgressActivityPrompt] = useState<ProgressActivityPrompt | null>(null);

  useEffect(() => {
    void syncNativeLibraryLoanReminders(books);
  }, [books]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
    writeRuntimeValue(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const handleLargeStorageWriteFailure = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key !== BOOKS_STORAGE_KEY) return;
      const restoredBooks = readStoredCollection<UserBookRecord[]>(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, booksRef.current);
      booksRef.current = restoredBooks;
      setBooks(restoredBooks);
      setSelectedBookForDetails((current) => current
        ? restoredBooks.find((book) => book.id === current.id) ?? current
        : current);
      showToast('Inkbound could not finish that library save. Your previous saved library was restored.');
    };

    window.addEventListener(LARGE_BROWSER_STORAGE_WRITE_FAILED_EVENT, handleLargeStorageWriteFailure);
    return () => window.removeEventListener(LARGE_BROWSER_STORAGE_WRITE_FAILED_EVENT, handleLargeStorageWriteFailure);
  }, []);

  useEffect(() => {
    const refreshCanonicalCollections = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      const keys = detail?.keys ?? [];

      let nextBooks = booksRef.current;
      let nextSessions = sessionsRef.current;

      if (keys.includes(BOOKS_STORAGE_KEY)) {
        nextBooks = readStoredCollection<UserBookRecord[]>(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, []);
        booksRef.current = nextBooks;
        setBooks(nextBooks);
      }

      if (keys.includes(SESSIONS_STORAGE_KEY)) {
        const previousSessions = sessionsRef.current;
        nextSessions = readStoredCollection<ReadingSession[]>(SESSIONS_STORAGE_KEY, LEGACY_SESSIONS_STORAGE_KEY, []);
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);

        nextBooks = reconcileBooksAfterSessionCollectionChange(
          nextBooks,
          previousSessions,
          nextSessions,
        );
      }

      if (keys.includes(BOOKS_STORAGE_KEY) || keys.includes(SESSIONS_STORAGE_KEY)) {
        nextBooks = reconcileBooksFromExistingSessionEvidence(nextBooks, nextSessions);
        if (nextBooks !== booksRef.current) {
          commitCanonicalBooks(nextBooks);
        }
      }
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refreshCanonicalCollections);
    return () => window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refreshCanonicalCollections);
  }, []);

  const commitCanonicalBooks = (
    update: UserBookRecord[] | ((current: UserBookRecord[]) => UserBookRecord[]),
    options?: { deletedBookIds?: string[] },
  ): UserBookRecord[] => {
    const current = booksRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    if (!replaceCanonicalLibrary(next, options)) {
      console.error('[Inkbound persistence] Canonical library write failed; keeping the previous in-memory library.', {
        operation: 'commitCanonicalBooks',
        previousCount: current.length,
        attemptedCount: next.length,
        timestamp: new Date().toISOString(),
      });
      showToast('Inkbound could not save that library change. Your previous library is still protected.');
      return current;
    }
    booksRef.current = next;
    removeRuntimeValue(LEGACY_BOOKS_STORAGE_KEY);
    setBooks(next);
    return next;
  };

  const commitCanonicalSessions = (
    update: ReadingSession[] | ((current: ReadingSession[]) => ReadingSession[]),
    options?: { deletedSessionIds?: string[] },
  ): ReadingSession[] => {
    const current = sessionsRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    if (!replaceCanonicalSessions(next, options)) {
      console.error('[Inkbound persistence] Canonical session write failed; keeping the previous in-memory sessions.', {
        operation: 'commitCanonicalSessions',
        previousCount: current.length,
        attemptedCount: next.length,
        timestamp: new Date().toISOString(),
      });
      showToast('Inkbound could not save that reading-session change. Your previous sessions are still protected.');
      return current;
    }
    sessionsRef.current = next;
    removeRuntimeValue(LEGACY_SESSIONS_STORAGE_KEY);
    setSessions(next);
    return next;
  };

  useEffect(() => {
    const repairedBooks = reconcileBooksFromExistingSessionEvidence(
      booksRef.current,
      sessionsRef.current,
    );
    if (repairedBooks !== booksRef.current) commitCanonicalBooks(repairedBooks);
  }, []);

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

  const openTimer = (bookId?: string) => { setTimerInitialBookId(bookId); setIsTimerOpen(true); };
  const closeTimer = () => setIsTimerOpen(false);
  const handleToggleSelectBook = (id: string) => setSelectedBookIds((current) => current.includes(id) ? current.filter((bookId) => bookId !== id) : [...current, id]);
  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    const committed = commitCanonicalBooks((current) => current.map((book) => (book.id === updatedBook.id ? updatedBook : book)));
    const committedBook = committed.find((book) => book.id === updatedBook.id);
    const didCommit = committedBook === updatedBook;
    setSelectedBookForDetails((current) => {
      if (current?.id !== updatedBook.id) return current;
      return didCommit ? updatedBook : committedBook ?? current;
    });
  };
  const handleDeleteBook = (bookToDelete: UserBookRecord) => { const deletedSessionIds = sessionsRef.current.filter((session) => session.bookId === bookToDelete.id).map((session) => session.id); const nextBooks = booksRef.current.filter((book) => book.id !== bookToDelete.id); if (commitCanonicalBooks(nextBooks, { deletedBookIds: [bookToDelete.id] }) !== nextBooks) return; const nextSessions = sessionsRef.current.filter((session) => session.bookId !== bookToDelete.id); if (commitCanonicalSessions(nextSessions, { deletedSessionIds }) !== nextSessions) return; setSelectedBookIds((current) => current.filter((id) => id !== bookToDelete.id)); setSelectedBookForDetails(null); showToast(`Deleted “${bookToDelete.work.title}” and its reading sessions.`); };
  const handleMergeDuplicateGroup = ({ keepBookId, removeBookIds, mergedBook }: DuplicateMergeRequest) => { const removeIds = new Set(removeBookIds); const nextBooks = booksRef.current.filter((book) => !removeIds.has(book.id)).map((book) => book.id === keepBookId ? mergedBook : book); const nextSessions = sessionsRef.current.map((session) => removeIds.has(session.bookId) ? { ...session, bookId: keepBookId } : session); if (commitCanonicalSessions(nextSessions) !== nextSessions) return; if (commitCanonicalBooks(nextBooks, { deletedBookIds: removeBookIds }) !== nextBooks) return; setPreviousBooksState(null); setPreviousSessionsState(null); setSelectedBookIds((current) => current.filter((id) => !removeIds.has(id))); setSelectedBookForDetails((current) => current && removeIds.has(current.id) ? mergedBook : current?.id === keepBookId ? mergedBook : current); writeImportEnrichmentQueue(readImportEnrichmentQueue().filter((item) => !removeIds.has(item.targetBookId))); showToast(`Merged ${removeBookIds.length + 1} copies of “${mergedBook.work.title}” into one library record.`); };
  const handleUpdateStatus = (bookId: string, status: ReadingStatus) => { const today = localDateKey(); const nextBooks = booksRef.current.map((book) => book.id !== bookId ? book : withReadingStatus(book, status, today)); if (commitCanonicalBooks(nextBooks) !== nextBooks) return; showToast(`Updated reading status to ${status}.`); };

  const handleCorrectBookProgress = (bookId: string, correction: BookProgressCorrection) => {
    const sourceBook = booksRef.current.find((book) => book.id === bookId);
    if (!sourceBook) return;
    const sourceEdition = getActiveEdition(sourceBook);
    if (!sourceEdition) return;
    const isAudiobook = sourceEdition.format === 'audiobook';

    // Current progress and reading activity are intentionally separate. A
    // correction/update never rewrites an existing session. A positive delta can
    // become canonical activity only after the reader explicitly confirms it.
    const activityPrompt = buildProgressActivityPrompt(
      sourceBook,
      correction.progressPages,
      correction.progressMinutes,
    );

    commitCanonicalBooks((current) => current.map((book) => {
      if (book.id !== bookId) return book;
      const activeEdition = getActiveEdition(book);
      if (!activeEdition) return book;

      const nextEdition = {
        ...activeEdition,
        ...(correction.pageCount !== undefined
          ? { pageCount: Math.max(0, correction.pageCount), externalSource: 'manual' as const }
          : {}),
        ...(correction.audiobookDurationMins !== undefined
          ? { audiobookDurationMins: Math.max(0, correction.audiobookDurationMins), externalSource: 'manual' as const }
          : {}),
      };
      const nextPages = Math.max(0, correction.progressPages ?? book.progressPages);
      const nextMinutes = Math.max(0, correction.progressMinutes ?? book.progressMinutes);
      const nextTotal = isAudiobook ? nextEdition.audiobookDurationMins : nextEdition.pageCount;
      const nextCompleted = isAudiobook ? nextMinutes : nextPages;
      const progressPercentage = nextTotal && nextTotal > 0
        ? Math.min(100, Math.round((nextCompleted / nextTotal) * 100))
        : book.progressPercentage;
      const reachedEnd = Boolean(nextTotal && nextTotal > 0 && nextCompleted >= nextTotal);
      const status = reachedEnd ? 'finished' : book.status;
      const progressChanged = nextPages !== book.progressPages || nextMinutes !== book.progressMinutes;
      const updatedBook: UserBookRecord = {
        ...book,
        editions: book.editions.map((edition) => edition.id === activeEdition.id ? nextEdition : edition),
        progressPages: nextPages,
        progressMinutes: nextMinutes,
        progressPercentage,
        status,
        dateFinished: reachedEnd ? (book.dateFinished ?? book.lastSessionDate ?? localDateKey()) : book.dateFinished,
        lastProgressUpdatedAt: progressChanged ? new Date().toISOString() : book.lastProgressUpdatedAt,
      };
      setSelectedBookForDetails((selected) => selected?.id === bookId ? updatedBook : selected);
      return updatedBook;
    }));

    if (activityPrompt) {
      setProgressActivityPrompt(activityPrompt);
      showToast(
        activityPrompt.kind === 'pages'
          ? `Updated progress by ${activityPrompt.delta} page${activityPrompt.delta === 1 ? '' : 's'}.`
          : `Updated audiobook progress by ${activityPrompt.delta} minute${activityPrompt.delta === 1 ? '' : 's'}.`,
      );
    } else {
      setProgressActivityPrompt(null);
      showToast('Updated book progress. No reading activity was assumed.');
    }
  };

  const confirmProgressActivity = () => {
    const prompt = progressActivityPrompt;
    if (!prompt) return;
    const result = addConfirmedProgressActivity(sessionsRef.current, prompt);
    if (result.added) {
      commitCanonicalSessions(result.sessions);
      const dailyValue = prompt.kind === 'pages'
        ? getDailyPagesRead(result.sessions, prompt.date)
        : getDailyGoalMinutes(result.sessions, prompt.date);
      const dailyGoal = prompt.kind === 'pages' ? readDailyGoalPages() : readDailyGoalMinutes();
      showSessionMilestone({
        date: prompt.date,
        streak: getReadingStreak(result.sessions, prompt.date),
        dailyValue,
        dailyGoal,
        unit: prompt.kind === 'pages' ? 'pages' : 'minutes',
        activityCount: getDailyActivityCount(result.sessions, prompt.date),
      });
      showToast(
        prompt.kind === 'pages'
          ? `Counted ${prompt.delta} page${prompt.delta === 1 ? '' : 's'} toward today's reading.`
          : `Counted ${prompt.delta} audiobook minute${prompt.delta === 1 ? '' : 's'} toward today's reading.`,
      );
    }
    setProgressActivityPrompt(null);
  };

  const declineProgressActivity = () => {
    setProgressActivityPrompt(null);
    showToast('Progress saved without adding reading activity.');
  };

  const handleUpdatePriority = (bookId: string, priority: Priority) => commitCanonicalBooks((current) => current.map((book) => (book.id === bookId ? { ...book, priority } : book)));

  const handleApplyBatchChanges = (changes: BatchEditChanges) => {
    setPreviousBooksState(books); setPreviousSessionsState(null); const today = localDateKey();
    commitCanonicalBooks((current) => current.map((book) => {
      if (!selectedBookIds.includes(book.id)) return book;
      let updatedBook: UserBookRecord = { ...book };
      if (changes.format) updatedBook.editions = updatedBook.editions.map((edition) => edition.id === updatedBook.activeEditionId ? { ...edition, format: changes.format! } : edition);
      if (changes.status) {
        updatedBook = changes.status === 'custom' && changes.customReadingStatusId
          ? withCustomReadingStatus(updatedBook, changes.customReadingStatusId)
          : withReadingStatus(updatedBook, changes.status, today);
      }
      if (changes.ownership) {
        updatedBook = withBookOwnership(
          updatedBook,
          changes.ownership,
          changes.ownership === 'custom' ? changes.customOwnershipCategoryId ?? undefined : undefined,
        );
      }
      if (changes.priority) updatedBook.priority = changes.priority;
      if (changes.rating !== undefined) updatedBook.rating = changes.rating ?? undefined;
      if (changes.spiceLevel !== undefined) updatedBook.spiceLevel = changes.spiceLevel ?? undefined;
      if (changes.dateStarted !== undefined) updatedBook.dateStarted = changes.dateStarted ?? undefined;
      if (changes.dateFinished !== undefined) updatedBook.dateFinished = updatedBook.status === 'finished' ? changes.dateFinished ?? undefined : undefined;
      if (changes.addTag && !updatedBook.privateTags.includes(changes.addTag)) updatedBook.privateTags = [...updatedBook.privateTags, changes.addTag];
      if (changes.removeTag) updatedBook.privateTags = updatedBook.privateTags.filter((tag) => tag.toLowerCase() !== changes.removeTag!.toLowerCase());
      if (changes.addCollection && !updatedBook.collections.includes(changes.addCollection)) updatedBook.collections = [...updatedBook.collections, changes.addCollection];
      if (changes.removeCollection) updatedBook.collections = updatedBook.collections.filter((collection) => collection.toLowerCase() !== changes.removeCollection!.toLowerCase());
      return updatedBook;
    }));
    const count = selectedBookIds.length; setSelectedBookIds([]); setIsBatchEditOpen(false); showToast(`Applied batch changes to ${count} books.`);
  };

  const handleDeleteSelected = () => { const selectedIds = new Set(selectedBookIds); const count = selectedBookIds.length; const deletedSessionIds = sessionsRef.current.filter((session) => selectedIds.has(session.bookId)).map((session) => session.id); const nextBooks = booksRef.current.filter((book) => !selectedIds.has(book.id)); const nextSessions = sessionsRef.current.filter((session) => !selectedIds.has(session.bookId)); const previousBooks = booksRef.current; const previousSessions = sessionsRef.current; if (commitCanonicalBooks(nextBooks, { deletedBookIds: selectedBookIds }) !== nextBooks) return; if (commitCanonicalSessions(nextSessions, { deletedSessionIds }) !== nextSessions) return; setPreviousBooksState(previousBooks); setPreviousSessionsState(previousSessions); setSelectedBookIds([]); setIsBatchEditOpen(false); showToast(`Deleted ${count} books and their reading sessions.`); };
  const handleUndoLastBatch = () => { if (!previousBooksState) return; if (commitCanonicalBooks(previousBooksState) !== previousBooksState) return; if (previousSessionsState && commitCanonicalSessions(previousSessionsState) !== previousSessionsState) return; setPreviousBooksState(null); setPreviousSessionsState(null); showToast('Undid the most recent library change.'); };

  const updateBookFromSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    const changedAt = new Date().toISOString();
    commitCanonicalBooks((current) => current.map((book) => {
      if (book.id !== newSession.bookId) return book;
      const updated = applySessionProgressToBook(book, newSession, updatedPages, updatedMinutes);
      const progressChanged = updated.progressPages !== book.progressPages || updated.progressMinutes !== book.progressMinutes;
      return progressChanged ? { ...updated, lastProgressUpdatedAt: changedAt } : updated;
    }));
  };

  const reconcileBookProgressFromSessions = (bookId: string, nextSessions: ReadingSession[], changedSession?: ReadingSession) => {
    commitCanonicalBooks((current) => current.map((book) => book.id === bookId ? reconcileBookAfterSessionMutation(book, nextSessions, changedSession) : book));
  };

  const maybeShowFirstSessionMilestone = (newSession: ReadingSession, projectedSessions: ReadingSession[]) => {
    const hadPriorActivityThatDay = sessionsRef.current.some((session) =>
      session.date === newSession.date
      && (getSessionDurationMinutes(session) > 0 || getDailyPagesRead([session], session.date) > 0 || getDailyGoalMinutes([session], session.date) > 0),
    );
    if (hadPriorActivityThatDay) return;

    const book = booksRef.current.find((candidate) => candidate.id === newSession.bookId);
    const isAudiobook = book ? getActiveEdition(book)?.format === 'audiobook' : false;
    const dailyValue = isAudiobook
      ? getDailyGoalMinutes(projectedSessions, newSession.date)
      : getDailyPagesRead(projectedSessions, newSession.date);
    const dailyGoal = isAudiobook ? readDailyGoalMinutes() : readDailyGoalPages();

    showSessionMilestone({
      date: newSession.date,
      streak: getReadingStreak(projectedSessions, newSession.date),
      dailyValue,
      dailyGoal,
      unit: isAudiobook ? 'minutes' : 'pages',
      activityCount: getDailyActivityCount(projectedSessions, newSession.date),
    });
  };

  const handleSaveSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    const book = booksRef.current.find((candidate) => candidate.id === newSession.bookId);
    const recordedSession: ReadingSession = {
      ...newSession,
      editionId: newSession.editionId ?? (book ? getActiveEdition(book)?.id : undefined),
      activitySource: newSession.activitySource ?? 'timer',
    };
    const projectedSessions = [recordedSession, ...sessionsRef.current];
    if (commitCanonicalSessions(projectedSessions) !== projectedSessions) return;
    maybeShowFirstSessionMilestone(recordedSession, projectedSessions);
    updateBookFromSession(recordedSession, updatedPages, updatedMinutes);
    setTimerInitialBookId(undefined);
    setIsTimerOpen(false);
    showToast(`Saved a ${getSessionDurationMinutes(recordedSession)}-minute reading session.`);
  };

  const handleSaveManualSession = (session: ReadingSession) => {
    const book = booksRef.current.find((candidate) => candidate.id === session.bookId);
    const recordedSession: ReadingSession = {
      ...session,
      editionId: session.editionId ?? (book ? getActiveEdition(book)?.id : undefined),
      activitySource: session.activitySource ?? 'manual-session',
    };
    const nextSessions = [recordedSession, ...sessionsRef.current];
    if (commitCanonicalSessions(nextSessions) !== nextSessions) return;
    maybeShowFirstSessionMilestone(recordedSession, nextSessions);
    commitCanonicalBooks((current) => current.map((bookRecord) =>
      bookRecord.id === recordedSession.bookId ? reconcileBookAfterSessionMutation(bookRecord, nextSessions) : bookRecord,
    ));
    showToast('Added past reading session.');
  };

  const handleSaveManualSessions = (newSessions: ReadingSession[]) => {
    if (newSessions.length === 0) return;
    const recordedSessions = newSessions.map((session) => {
      const book = booksRef.current.find((candidate) => candidate.id === session.bookId);
      return {
        ...session,
        editionId: session.editionId ?? (book ? getActiveEdition(book)?.id : undefined),
        activitySource: session.activitySource ?? 'manual-session',
      } satisfies ReadingSession;
    });
    const nextSessions = [...recordedSessions, ...sessionsRef.current];
    const affectedBookIds = new Set(recordedSessions.map((session) => session.bookId));
    if (commitCanonicalSessions(nextSessions) !== nextSessions) return;
    commitCanonicalBooks((current) => current.map((book) =>
      affectedBookIds.has(book.id) ? reconcileBookAfterSessionMutation(book, nextSessions) : book,
    ));
    showToast(`Added ${recordedSessions.length} past reading session${recordedSessions.length === 1 ? '' : 's'}.`);
  };
  const handleUpdateSession = (session: ReadingSession) => { const previous = sessions.find((item) => item.id === session.id); const nextSessions = sessions.map((item) => item.id === session.id ? session : item); if (commitCanonicalSessions(nextSessions) !== nextSessions) return; if (previous && previous.bookId !== session.bookId) { reconcileBookProgressFromSessions(previous.bookId, nextSessions, previous); reconcileBookProgressFromSessions(session.bookId, nextSessions); } else reconcileBookProgressFromSessions(session.bookId, nextSessions, previous); showToast('Updated reading session and reconciled book progress.'); };
  const handleDeleteSession = (sessionId: string) => { const removed = sessions.find((session) => session.id === sessionId); const nextSessions = sessions.filter((session) => session.id !== sessionId); if (commitCanonicalSessions(nextSessions, { deletedSessionIds: [sessionId] }) !== nextSessions) return; if (removed) reconcileBookProgressFromSessions(removed.bookId, nextSessions, removed); showToast('Deleted reading session and reconciled book progress.'); };

  const handleExecuteImport = async (importedItems: ImportRecordItem[]): Promise<ImportRecordItem[]> => {
    const currentLibrary = booksRef.current; const { unique: acceptedItems, duplicates: writeDuplicates } = analyzeImportDuplicates(importedItems, currentLibrary);
    if (acceptedItems.length === 0) { showToast('No books were added because they already exist in your library.'); return []; }
    setPreviousBooksState(currentLibrary); setPreviousSessionsState(null); const immediateBooks = acceptedItems.map(createFallbackImportedBook); const nextLibrary = [...currentLibrary, ...immediateBooks]; if (commitCanonicalBooks(nextLibrary) !== nextLibrary) return [];
    const existingQueue = readImportEnrichmentQueue(); const queuedByBookId = new Map(existingQueue.map((item) => [item.targetBookId, item])); queueImportedItems(acceptedItems).forEach((item) => queuedByBookId.set(item.targetBookId, item)); writeImportEnrichmentQueue([...queuedByBookId.values()]);
    const verificationSnapshot = getImportVerificationSnapshot(); appendImportHistory(acceptedItems, verificationSnapshot.duplicates.length + writeDuplicates.length); const skippedAtWrite = importedItems.length - acceptedItems.length; showToast(navigator.onLine ? `Added ${immediateBooks.length} books${skippedAtWrite > 0 ? ` and skipped ${skippedAtWrite} late duplicate${skippedAtWrite === 1 ? '' : 's'}` : ''}. Covers and publisher summaries will continue updating automatically.` : `Added ${immediateBooks.length} books offline${skippedAtWrite > 0 ? ` and skipped ${skippedAtWrite} late duplicate${skippedAtWrite === 1 ? '' : 's'}` : ''}. Covers and publisher summaries will update when Inkbound is online.`); void processImportEnrichmentQueue(); return acceptedItems;
  };

  const handleResetData = () => { const emptyBooks: UserBookRecord[] = []; const emptySessions: ReadingSession[] = []; if (commitCanonicalBooks(emptyBooks, { deletedBookIds: booksRef.current.map((book) => book.id) }) !== emptyBooks) return; if (commitCanonicalSessions(emptySessions, { deletedSessionIds: sessionsRef.current.map((session) => session.id) }) !== emptySessions) return; setPreviousBooksState(null); setPreviousSessionsState(null); setSelectedBookForDetails(null); setSelectedBookIds([]); removeRuntimeValue(LEGACY_BOOKS_STORAGE_KEY); removeRuntimeValue(LEGACY_SESSIONS_STORAGE_KEY); removeRuntimeValue(DAYTIME_MAINTENANCE_KEY); writeImportEnrichmentQueue([]); writeImportHistory([]); writeImportEnrichmentRetryProgress(null); setImportEnrichmentPaused(false); showToast('Cleared all Inkbound books and reading sessions.'); };
  const currentSelectedBook = selectedBookForDetails ? books.find((book) => book.id === selectedBookForDetails.id) ?? selectedBookForDetails : null;

  return (
    <ResponsiveShell navigation={<Navbar activeTab={activeTab} setActiveTab={setActiveTab} books={books} onSelectBook={setSelectedBookForDetails} onOpenAddBook={() => setIsAddBookOpen(true)} onOpenTimer={() => openTimer()} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}>
      <ReadingWidgetSyncBridge books={books} sessions={sessions} onOpenTimer={openTimer} />
      <main className="inkbound-main-content"><ResponsiveContainer width="wide">
        {activeTab === 'home' && <HomeDashboard books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onStartSessionForBook={(book) => openTimer(book.id)} onUpdateStatus={handleUpdateStatus} onNavigateToTab={setActiveTab} onOpenAddBook={() => setIsAddBookOpen(true)} />}
        {activeTab === 'library' && <LibraryScreen books={books} selectedBookIds={selectedBookIds} onToggleSelectBook={handleToggleSelectBook} onSelectAll={setSelectedBookIds} onClearSelection={() => setSelectedBookIds([])} onSelectBook={setSelectedBookForDetails} onOpenBatchEdit={() => setIsBatchEditOpen(true)} onOpenAddBook={() => setIsAddBookOpen(true)} />}
        {activeTab === 'duplicates' && <DuplicateManagerScreen books={books} onMergeGroup={handleMergeDuplicateGroup} onSelectBook={setSelectedBookForDetails} onUpdateBook={handleUpdateBook} />}
        {activeTab === 'tbr' && <TBRScreen books={books} onSelectBook={setSelectedBookForDetails} onUpdateStatus={handleUpdateStatus} onUpdatePriority={handleUpdatePriority} />}
        {activeTab === 'sessions' && <div className="space-y-8"><ReadingActivityOverview books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onUpdateBook={handleUpdateBook} /><ReadingSessionsScreen books={books} sessions={sessions} onOpenTimer={openTimer} onSelectBook={setSelectedBookForDetails} onSaveManualSession={handleSaveManualSession} onSaveManualSessions={handleSaveManualSessions} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} /></div>}
        {activeTab === 'challenges' && <ReadingChallengesScreen books={books} sessions={sessions} />}{activeTab === 'achievements' && <AchievementsScreen books={books} sessions={sessions} />}{activeTab === 'collections' && <CollectionsScreen books={books} onUpdateBook={handleUpdateBook} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'import-history' && <ImportHistoryScreen books={books} onResumeEnrichment={() => void processImportEnrichmentQueue()} onRetryEnrichment={(targetBookIds) => processImportEnrichmentQueue(targetBookIds)} />}{activeTab === 'timeline' && <ReadingTimelineScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'memories' && <ReadingMemoriesScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'time-capsules' && <ReadingTimeCapsulesScreen books={books} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'photo-memories' && <PhotoMemoriesScreen books={books} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'bookshelf-time' && <BookshelfThroughTimeScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'my-dragon' && <MyDragonScreen books={books} sessions={sessions} />}{activeTab === 'personality' && <ReaderPersonalityScreen books={books} sessions={sessions} />}{activeTab === 'insights' && <ReadingInsightsScreen books={books} sessions={sessions} />}{activeTab === 'studio' && <InkboundStudioScreen books={books} sessions={sessions} />}{activeTab === 'wrapped' && <MonthlyWrappedScreen books={books} sessions={sessions} />}{activeTab === 'yearbook' && <YearInBooksScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}{activeTab === 'stats' && <StatisticsScreen books={books} sessions={sessions} />}{activeTab === 'import' && <ImportCenterScreen books={books} onExecuteImport={handleExecuteImport} onUndoLastImport={handleUndoLastBatch} onRetryEnrichment={(targetBookIds) => processImportEnrichmentQueue(targetBookIds)} />}{activeTab === 'settings' && <SettingsScreen books={books} sessions={sessions} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} onResetData={handleResetData} />}{activeTab === 'profile' && <ProfileScreen books={books} sessions={sessions} />}{activeTab === 'admin' && <AdminScreen />}
      </ResponsiveContainer></main>
      {currentSelectedBook && <BookDetailsModal book={currentSelectedBook} sessions={sessions} onClose={() => setSelectedBookForDetails(null)} onViewSeries={(book) => { openLibrarySeriesForBook(book.id); setActiveTab('library'); setSelectedBookForDetails(null); }} onUpdateBook={handleUpdateBook} onCorrectProgress={handleCorrectBookProgress} onDeleteBook={handleDeleteBook} onStartSession={(book) => { setSelectedBookForDetails(null); openTimer(book.id); }} onSaveManualSession={handleSaveManualSession} onSaveManualSessions={handleSaveManualSessions} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} />}
      {isBatchEditOpen && <BatchEditModal selectedBookIds={selectedBookIds} books={books} onClose={() => setIsBatchEditOpen(false)} onApplyBatchChanges={handleApplyBatchChanges} onDeleteSelected={handleDeleteSelected} onUndoLastBatch={handleUndoLastBatch} />}
      {isTimerOpen && <ReadingSessionModal books={books} sessions={sessions} initialBookId={timerInitialBookId} onClose={closeTimer} onSaveSession={handleSaveSession} />}
      {isAddBookOpen && <AddBookModal currentBookCount={books.length} onClose={() => setIsAddBookOpen(false)} onAddBook={(newBook) => { const next = [newBook, ...booksRef.current]; if (commitCanonicalBooks(next) !== next) return; showToast(`Added “${newBook.work.title}” to Inkbound.`); }} onAddMultipleBooks={(newBooks) => { const next = [...newBooks, ...booksRef.current]; const committed = commitCanonicalBooks(next); const saved = committed === next && newBooks.every((book) => committed.some((candidate) => candidate.id === book.id)); if (saved) showToast(`Saved ${newBooks.length} books locally to Inkbound.`); return saved; }} onRemoveBook={(book) => { const next = booksRef.current.filter((candidate) => candidate.id !== book.id); if (commitCanonicalBooks(next, { deletedBookIds: [book.id] }) !== next) return; showToast(`Removed “${book.work.title}” from Inkbound.`); }} />}
      {progressActivityPrompt && <div className="fixed inset-0 z-[230] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><section className="w-full max-w-md rounded-3xl border border-[#c5a059]/35 bg-[#17101b] p-5 text-[#f4efe6] shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="progress-activity-title"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#c5a059]">Reading activity</p><h2 id="progress-activity-title" className="mt-2 font-serif text-2xl font-bold">{progressActivityPrompt.kind === 'pages' ? `Count these ${progressActivityPrompt.delta} page${progressActivityPrompt.delta === 1 ? '' : 's'} toward today’s reading?` : `Count these ${progressActivityPrompt.delta} audiobook minute${progressActivityPrompt.delta === 1 ? '' : 's'} toward today’s reading?`}</h2><p className="mt-3 text-sm leading-6 text-stone-400">Your book progress is already saved. Confirming will also add one canonical reading activity for today so goals, streaks, stats, and reports can use the same recorded evidence.</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={declineProgressActivity} className="quiet-shelf-secondary-action justify-center">Progress only</button><button type="button" onClick={confirmProgressActivity} className="quiet-shelf-primary-action justify-center">Count toward today</button></div></section></div>}
      {sessionMilestone && <div className="fixed bottom-24 left-1/2 z-[150] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-[#c5a059]/45 bg-[#1c0f24]/95 p-4 text-[#f4efe6] shadow-2xl backdrop-blur"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2"><Flame className="h-5 w-5 text-[#e5c158]" /><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading streak</p><p className="font-serif text-xl font-bold">{sessionMilestone.streak} day{sessionMilestone.streak === 1 ? '' : 's'}</p></div></div><div className="flex items-center gap-2 text-right"><Target className="h-5 w-5 text-[#e5c158]" /><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Today</p><p className="font-serif text-xl font-bold">{sessionMilestone.dailyValue} / {sessionMilestone.dailyGoal} {sessionMilestone.unit}</p><p className="text-xs text-stone-400">{sessionMilestone.dailyValue >= sessionMilestone.dailyGoal ? 'Goal reached!' : `${sessionMilestone.dailyGoal - sessionMilestone.dailyValue} ${sessionMilestone.unit} to go.`} · {sessionMilestone.activityCount} recorded activit{sessionMilestone.activityCount === 1 ? 'y' : 'ies'}</p></div></div></div></div>}
      {toastMessage && <div className="inkbound-toast" role="status"><Check className="h-4 w-4 text-[var(--ink-gold)]" /><span>{toastMessage}</span>{previousBooksState && <button type="button" onClick={handleUndoLastBatch}><RotateCcw className="h-3 w-3" /> Undo</button>}</div>}
    </ResponsiveShell>
  );
}
