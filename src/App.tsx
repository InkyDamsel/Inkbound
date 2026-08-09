import React, { useEffect, useState } from 'react';
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
  consumeForegroundImportRetryRequest,
  isImportEnrichmentPaused,
  requestForegroundImportRetry,
  setImportEnrichmentPaused,
  writeImportEnrichmentRetryProgress,
  writeImportHistory,
} from './features/import/importHistory';
import { getImportVerificationSnapshot } from './features/import/importVerificationJob';
import { Check, RotateCcw } from 'lucide-react';

const BOOKS_STORAGE_KEY = 'inkbound_books';
const SESSIONS_STORAGE_KEY = 'inkbound_sessions';
const THEME_STORAGE_KEY = 'inkbound_theme';
const LEGACY_BOOKS_STORAGE_KEY = 'bookhaven_books';
const LEGACY_SESSIONS_STORAGE_KEY = 'bookhaven_sessions';
const TIMER_OPEN_STORAGE_KEY = 'inkbound_timer_open';
const DAYTIME_MAINTENANCE_KEY = 'inkbound_last_daytime_library_maintenance';
const DAYTIME_MAINTENANCE_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DAYTIME_MAINTENANCE_BATCH_SIZE = 3;
const MAINTENANCE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
let isImportQueueProcessing = false;

function readStoredCollection<T>(primaryKey: string, legacyKey: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(primaryKey) ?? localStorage.getItem(legacyKey);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteLocalStorage(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Inkbound could not update ${key} in the browser cache.`, error);
    return false;
  }
}

function isReadingTimerOpen(): boolean {
  try {
    return localStorage.getItem(TIMER_OPEN_STORAGE_KEY) === 'true';
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
    const lastRun = Number(localStorage.getItem(DAYTIME_MAINTENANCE_KEY) ?? 0);
    return !Number.isFinite(lastRun) || Date.now() - lastRun >= DAYTIME_MAINTENANCE_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markDaytimeMaintenanceRun() {
  try {
    localStorage.setItem(DAYTIME_MAINTENANCE_KEY, String(Date.now()));
  } catch {
    // Maintenance scheduling is best-effort only.
  }
}

export default function App() {
  const [activeTab, setActiveTab] = usePersistentState<NavTab>('inkbound_active_tab', 'home');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme ? savedTheme === 'dark' : true;
  });
  const [books, setBooks] = useState<UserBookRecord[]>(() => readStoredCollection<UserBookRecord[]>(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, []));
  const [sessions, setSessions] = useState<ReadingSession[]>(() => readStoredCollection<ReadingSession[]>(SESSIONS_STORAGE_KEY, LEGACY_SESSIONS_STORAGE_KEY, []));
  const [previousBooksState, setPreviousBooksState] = useState<UserBookRecord[] | null>(null);
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<UserBookRecord | null>(null);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [isTimerOpen, setIsTimerOpen] = usePersistentState(TIMER_OPEN_STORAGE_KEY, false);
  const [timerInitialBookId, setTimerInitialBookId] = usePersistentState<string | undefined>('inkbound_timer_book_id', undefined);
  const [isAddBookOpen, setIsAddBookOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
    try { localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light'); } catch { /* no-op */ }
  }, [isDarkMode]);

  useEffect(() => {
    safeWriteLocalStorage(BOOKS_STORAGE_KEY, books);
    try { localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY); } catch { /* no-op */ }
  }, [books]);

  useEffect(() => {
    safeWriteLocalStorage(SESSIONS_STORAGE_KEY, sessions);
    try { localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY); } catch { /* no-op */ }
  }, [sessions]);

  const showToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 4000);
  };

  const processImportEnrichmentQueue = async () => {
    const retryRequest = consumeForegroundImportRetryRequest();
    const forceRetry = Boolean(retryRequest);

    if (isImportQueueProcessing) {
      if (retryRequest) requestForegroundImportRetry(retryRequest.targetBookIds);
      return;
    }
    if (!navigator.onLine || isReadingTimerOpen()) {
      if (retryRequest) {
        requestForegroundImportRetry(retryRequest.targetBookIds);
        writeImportEnrichmentRetryProgress({
          status: 'error',
          completed: 0,
          total: retryRequest.targetBookIds.length,
          matched: 0,
          covers: 0,
          summaries: 0,
          message: !navigator.onLine ? 'Connect to the internet, then retry the missing details again.' : 'Finish or close the active reading timer, then retry the missing details again.',
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (!forceRetry && isImportEnrichmentPaused()) return;

    const initialQueue = readImportEnrichmentQueue();
    if (initialQueue.length === 0) {
      if (retryRequest) {
        writeImportEnrichmentRetryProgress({
          status: 'complete', completed: 0, total: 0, matched: 0, covers: 0, summaries: 0,
          message: 'There are no missing book details left in the retry queue.', updatedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const targetIds = retryRequest ? new Set(retryRequest.targetBookIds) : null;
    const untouchedQueue = targetIds ? initialQueue.filter((item) => !targetIds.has(item.targetBookId)) : [];
    let pending = targetIds ? initialQueue.filter((item) => targetIds.has(item.targetBookId)) : [...initialQueue];
    if (forceRetry && pending.length === 0) {
      writeImportEnrichmentRetryProgress({
        status: 'complete', completed: 0, total: 0, matched: 0, covers: 0, summaries: 0,
        message: 'Those books no longer need a retry.', updatedAt: new Date().toISOString(),
      });
      return;
    }

    const isQuietHours = isPreferredMaintenanceWindow();
    if (!forceRetry && !isQuietHours && !canRunDaytimeMaintenance()) return;

    isImportQueueProcessing = true;
    const retryItems: ImportEnrichmentQueueItem[] = [];
    let updatedCount = 0;
    let coverCount = 0;
    let summaryCount = 0;
    let processedBatchCount = 0;
    const retryTotal = forceRetry ? pending.length : 0;

    if (forceRetry) {
      writeImportEnrichmentRetryProgress({
        status: 'running', completed: 0, total: retryTotal, matched: 0, covers: 0, summaries: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      while (pending.length > 0 && navigator.onLine) {
        if (isReadingTimerOpen() || (!forceRetry && isImportEnrichmentPaused())) break;
        if (!forceRetry && !isQuietHours && processedBatchCount >= 1) break;
        const batchSize = forceRetry ? IMPORT_ENRICHMENT_BATCH_SIZE : isQuietHours ? IMPORT_ENRICHMENT_BATCH_SIZE : DAYTIME_MAINTENANCE_BATCH_SIZE;
        const batch = pending.slice(0, batchSize);
        pending = pending.slice(batch.length);
        processedBatchCount += 1;
        const results = await enrichImportedBooks(batch);
        const successful = results.filter((result) => result.success && result.enriched);
        const enrichedById = new Map(successful.map((result) => [result.item.targetBookId, result.enriched!]));
        if (enrichedById.size > 0) {
          setBooks((current) => current.map((book) => {
            const enriched = enrichedById.get(book.id);
            return enriched ? mergeEnrichedImportedBook(book, enriched) : book;
          }));
        }
        results.forEach((result) => {
          if (result.success) {
            updatedCount += 1;
            if (result.foundCover) coverCount += 1;
            if (result.foundSummary) summaryCount += 1;
          } else {
            retryItems.push({ ...result.item, attempts: (result.item.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString() });
          }
        });
        writeImportEnrichmentQueue([...retryItems, ...pending, ...untouchedQueue]);
        if (forceRetry) {
          writeImportEnrichmentRetryProgress({
            status: 'running',
            completed: retryTotal - pending.length,
            total: retryTotal,
            matched: updatedCount,
            covers: coverCount,
            summaries: summaryCount,
            updatedAt: new Date().toISOString(),
          });
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, forceRetry ? 250 : isQuietHours ? 300 : 750));
      }

      writeImportEnrichmentQueue([...retryItems, ...pending, ...untouchedQueue]);
      if (!forceRetry && !isQuietHours && processedBatchCount > 0) markDaytimeMaintenanceRun();

      if (forceRetry) {
        const completed = retryTotal - pending.length;
        const finished = pending.length === 0;
        writeImportEnrichmentRetryProgress({
          status: finished ? 'complete' : 'error',
          completed,
          total: retryTotal,
          matched: updatedCount,
          covers: coverCount,
          summaries: summaryCount,
          message: finished
            ? `${completed.toLocaleString()} books were checked. Books that still could not be matched remain safely queued for later background attempts.`
            : `The retry stopped after ${completed.toLocaleString()} of ${retryTotal.toLocaleString()} books. The remaining books are still queued.`,
          updatedAt: new Date().toISOString(),
        });
        showToast(`Retry checked ${completed} books · ${coverCount} covers · ${summaryCount} summaries.`);
      } else if (updatedCount > 0) {
        showToast(`Updated ${updatedCount} books · ${coverCount} covers · ${summaryCount} summaries.`);
      } else if (isQuietHours && initialQueue.length > 0 && !isReadingTimerOpen() && !isImportEnrichmentPaused()) {
        showToast('Inkbound kept the remaining books queued and will retry their details later.');
      }
    } catch {
      writeImportEnrichmentQueue([...retryItems, ...pending, ...untouchedQueue]);
      if (!forceRetry && !isQuietHours && processedBatchCount > 0) markDaytimeMaintenanceRun();
      if (forceRetry) {
        writeImportEnrichmentRetryProgress({
          status: 'error',
          completed: retryTotal - pending.length,
          total: retryTotal,
          matched: updatedCount,
          covers: coverCount,
          summaries: summaryCount,
          message: 'Inkbound could not finish this retry. The unprocessed books remain safely queued so you can try again.',
          updatedAt: new Date().toISOString(),
        });
      }
      showToast('Book details are safely queued and will resume when Inkbound can reach its metadata sources.');
    } finally {
      isImportQueueProcessing = false;
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
    window.addEventListener('focus', resumeMaintenance);
    const interval = window.setInterval(resumeMaintenance, MAINTENANCE_CHECK_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', resumeMaintenance);
      window.removeEventListener('focus', resumeMaintenance);
      window.clearInterval(interval);
    };
  }, []);

  const openTimer = (bookId?: string) => { setTimerInitialBookId(bookId); setIsTimerOpen(true); };
  const closeTimer = () => setIsTimerOpen(false);

  const handleToggleSelectBook = (id: string) => setSelectedBookIds((current) => current.includes(id) ? current.filter((bookId) => bookId !== id) : [...current, id]);

  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    setBooks((current) => current.map((book) => (book.id === updatedBook.id ? updatedBook : book)));
    setSelectedBookForDetails((current) => (current?.id === updatedBook.id ? updatedBook : current));
  };

  const handleDeleteBook = (bookToDelete: UserBookRecord) => {
    setBooks((current) => current.filter((book) => book.id !== bookToDelete.id));
    setSessions((current) => current.filter((session) => session.bookId !== bookToDelete.id));
    setSelectedBookIds((current) => current.filter((id) => id !== bookToDelete.id));
    setSelectedBookForDetails(null);
    showToast(`Deleted “${bookToDelete.work.title}” and its reading sessions.`);
  };

  const handleMergeDuplicateGroup = ({ keepBookId, removeBookIds, mergedBook }: DuplicateMergeRequest) => {
    const removeIds = new Set(removeBookIds);
    setPreviousBooksState(null);
    setBooks((current) => current.filter((book) => !removeIds.has(book.id)).map((book) => book.id === keepBookId ? mergedBook : book));
    setSessions((current) => current.map((session) => removeIds.has(session.bookId) ? { ...session, bookId: keepBookId } : session));
    setSelectedBookIds((current) => current.filter((id) => !removeIds.has(id)));
    setSelectedBookForDetails((current) => current && removeIds.has(current.id) ? mergedBook : current?.id === keepBookId ? mergedBook : current);
    writeImportEnrichmentQueue(readImportEnrichmentQueue().filter((item) => !removeIds.has(item.targetBookId)));
    showToast(`Merged ${removeBookIds.length + 1} copies of “${mergedBook.work.title}” into one library record.`);
  };

  const handleUpdateStatus = (bookId: string, status: ReadingStatus) => {
    setBooks((current) => current.map((book) => book.id !== bookId ? book : {
      ...book,
      status,
      progressPercentage: status === 'finished' ? 100 : book.progressPercentage,
      dateFinished: status === 'finished' ? book.dateFinished ?? new Date().toISOString().split('T')[0] : book.dateFinished,
    }));
    showToast(`Updated reading status to ${status}.`);
  };

  const handleUpdatePriority = (bookId: string, priority: Priority) => setBooks((current) => current.map((book) => (book.id === bookId ? { ...book, priority } : book)));

  const handleApplyBatchChanges = (changes: BatchEditChanges) => {
    setPreviousBooksState(books);
    setBooks((current) => current.map((book) => {
      if (!selectedBookIds.includes(book.id)) return book;
      const updatedBook = { ...book };

      if (changes.status) {
        updatedBook.status = changes.status;
        if (changes.status === 'finished') {
          updatedBook.progressPercentage = 100;
          updatedBook.dateFinished = changes.dateFinished === undefined
            ? updatedBook.dateFinished ?? new Date().toISOString().split('T')[0]
            : updatedBook.dateFinished;
        }
      }
      if (changes.ownership) updatedBook.ownership = changes.ownership;
      if (changes.priority) updatedBook.priority = changes.priority;
      if (changes.rating !== undefined) updatedBook.rating = changes.rating ?? undefined;
      if (changes.dateStarted !== undefined) updatedBook.dateStarted = changes.dateStarted ?? undefined;
      if (changes.dateFinished !== undefined) updatedBook.dateFinished = changes.dateFinished ?? undefined;
      if (changes.format) {
        updatedBook.editions = updatedBook.editions.map((edition) =>
          edition.id === updatedBook.activeEditionId ? { ...edition, format: changes.format! } : edition,
        );
      }
      if (changes.addTag && !updatedBook.privateTags.includes(changes.addTag)) updatedBook.privateTags = [...updatedBook.privateTags, changes.addTag];
      if (changes.removeTag) updatedBook.privateTags = updatedBook.privateTags.filter((tag) => tag.toLowerCase() !== changes.removeTag!.toLowerCase());
      if (changes.addCollection && !updatedBook.collections.includes(changes.addCollection)) updatedBook.collections = [...updatedBook.collections, changes.addCollection];
      if (changes.removeCollection) updatedBook.collections = updatedBook.collections.filter((collection) => collection.toLowerCase() !== changes.removeCollection!.toLowerCase());
      return updatedBook;
    }));
    const count = selectedBookIds.length;
    setSelectedBookIds([]);
    setIsBatchEditOpen(false);
    showToast(`Applied batch changes to ${count} books.`);
  };

  const handleDeleteSelected = () => {
    setPreviousBooksState(books);
    const count = selectedBookIds.length;
    setBooks((current) => current.filter((book) => !selectedBookIds.includes(book.id)));
    setSelectedBookIds([]);
    setIsBatchEditOpen(false);
    showToast(`Deleted ${count} books.`);
  };

  const handleUndoLastBatch = () => {
    if (!previousBooksState) return;
    setBooks(previousBooksState);
    setPreviousBooksState(null);
    showToast('Undid the most recent library change.');
  };

  const updateBookFromSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    setBooks((current) => current.map((book) => {
      if (book.id !== newSession.bookId) return book;
      const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
      const isAudiobook = activeEdition?.format === 'audiobook';
      const nextPages = isAudiobook ? book.progressPages : Math.max(book.progressPages, updatedPages);
      const nextMinutes = isAudiobook ? Math.max(book.progressMinutes, updatedMinutes) : book.progressMinutes;
      const total = isAudiobook ? activeEdition?.audiobookDurationMins ?? 600 : activeEdition?.pageCount ?? 350;
      const completed = isAudiobook ? nextMinutes : nextPages;
      const progressPercentage = Math.min(100, Math.round((completed / Math.max(1, total)) * 100));
      return {
        ...book,
        progressPages: nextPages,
        progressMinutes: nextMinutes,
        progressPercentage,
        status: progressPercentage === 100 ? 'finished' : 'currently-reading',
        dateStarted: book.dateStarted ?? newSession.date,
        dateFinished: progressPercentage === 100 ? book.dateFinished ?? newSession.date : book.dateFinished,
        lastSessionDate: !book.lastSessionDate || newSession.date > book.lastSessionDate ? newSession.date : book.lastSessionDate,
      };
    }));
  };

  const handleSaveSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    setSessions((current) => [newSession, ...current]);
    updateBookFromSession(newSession, updatedPages, updatedMinutes);
    setTimerInitialBookId(undefined);
    setIsTimerOpen(false);
    showToast(`Saved a ${newSession.durationMinutes}-minute reading session.`);
  };

  const handleSaveManualSession = (session: ReadingSession) => {
    setSessions((current) => [session, ...current]);
    updateBookFromSession(session, session.endPage ?? 0, Math.floor((session.endTimestampSec ?? 0) / 60));
    showToast('Added reading session.');
  };

  const handleUpdateSession = (session: ReadingSession) => {
    setSessions((current) => current.map((item) => item.id === session.id ? session : item));
    updateBookFromSession(session, session.endPage ?? 0, Math.floor((session.endTimestampSec ?? 0) / 60));
    showToast('Updated reading session.');
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    showToast('Deleted reading session. Book progress was left unchanged.');
  };

  const handleExecuteImport = async (importedItems: ImportRecordItem[]) => {
    setPreviousBooksState(books);
    const immediateBooks = importedItems.map(createFallbackImportedBook);
    setBooks((current) => [...current, ...immediateBooks]);
    const existingQueue = readImportEnrichmentQueue();
    const queuedByBookId = new Map(existingQueue.map((item) => [item.targetBookId, item]));
    queueImportedItems(importedItems).forEach((item) => queuedByBookId.set(item.targetBookId, item));
    writeImportEnrichmentQueue([...queuedByBookId.values()]);
    appendImportHistory(importedItems, getImportVerificationSnapshot().duplicates.length);
    showToast(navigator.onLine ? `Added ${immediateBooks.length} books. Covers and publisher summaries will continue updating automatically.` : `Added ${immediateBooks.length} books offline. Covers and publisher summaries will update when Inkbound is online.`);
    void processImportEnrichmentQueue();
  };

  const handleResetData = () => {
    setBooks([]); setSessions([]); setPreviousBooksState(null); setSelectedBookForDetails(null); setSelectedBookIds([]);
    try {
      localStorage.removeItem(BOOKS_STORAGE_KEY); localStorage.removeItem(SESSIONS_STORAGE_KEY); localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY); localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY); localStorage.removeItem(DAYTIME_MAINTENANCE_KEY);
    } catch { /* no-op */ }
    writeImportEnrichmentQueue([]);
    writeImportHistory([]);
    writeImportEnrichmentRetryProgress(null);
    setImportEnrichmentPaused(false);
    showToast('Cleared all Inkbound books and reading sessions.');
  };

  return (
    <ResponsiveShell navigation={<Navbar activeTab={activeTab} setActiveTab={setActiveTab} books={books} onSelectBook={setSelectedBookForDetails} onOpenAddBook={() => setIsAddBookOpen(true)} onOpenTimer={() => openTimer()} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}>
      <main className="inkbound-main-content">
        <ResponsiveContainer width="wide">
          {activeTab === 'home' && <HomeDashboard books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onStartSessionForBook={(book) => openTimer(book.id)} onUpdateStatus={handleUpdateStatus} onNavigateToTab={setActiveTab} onOpenAddBook={() => setIsAddBookOpen(true)} />}
          {activeTab === 'library' && <LibraryScreen books={books} selectedBookIds={selectedBookIds} onToggleSelectBook={handleToggleSelectBook} onSelectAll={setSelectedBookIds} onClearSelection={() => setSelectedBookIds([])} onSelectBook={setSelectedBookForDetails} onOpenBatchEdit={() => setIsBatchEditOpen(true)} onOpenAddBook={() => setIsAddBookOpen(true)} />}
          {activeTab === 'duplicates' && <DuplicateManagerScreen books={books} onMergeGroup={handleMergeDuplicateGroup} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'tbr' && <TBRScreen books={books} onSelectBook={setSelectedBookForDetails} onUpdateStatus={handleUpdateStatus} onUpdatePriority={handleUpdatePriority} />}
          {activeTab === 'sessions' && <div className="space-y-8"><ReadingActivityOverview books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onUpdateBook={handleUpdateBook} /><ReadingSessionsScreen books={books} sessions={sessions} onOpenTimer={openTimer} onSelectBook={setSelectedBookForDetails} onSaveManualSession={handleSaveManualSession} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} /></div>}
          {activeTab === 'challenges' && <ReadingChallengesScreen books={books} sessions={sessions} />}
          {activeTab === 'achievements' && <AchievementsScreen books={books} sessions={sessions} />}
          {activeTab === 'collections' && <CollectionsScreen books={books} onUpdateBook={handleUpdateBook} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'import-history' && <ImportHistoryScreen books={books} onResumeEnrichment={() => void processImportEnrichmentQueue()} />}
          {activeTab === 'timeline' && <ReadingTimelineScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'memories' && <ReadingMemoriesScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'time-capsules' && <ReadingTimeCapsulesScreen books={books} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'photo-memories' && <PhotoMemoriesScreen books={books} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'bookshelf-time' && <BookshelfThroughTimeScreen books={books} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'my-dragon' && <MyDragonScreen books={books} sessions={sessions} />}
          {activeTab === 'personality' && <ReaderPersonalityScreen books={books} sessions={sessions} />}
          {activeTab === 'insights' && <ReadingInsightsScreen books={books} sessions={sessions} />}
          {activeTab === 'studio' && <InkboundStudioScreen books={books} sessions={sessions} />}
          {activeTab === 'wrapped' && <MonthlyWrappedScreen books={books} sessions={sessions} />}
          {activeTab === 'yearbook' && <YearInBooksScreen books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />}
          {activeTab === 'stats' && <StatisticsScreen books={books} sessions={sessions} />}
          {activeTab === 'import' && <ImportCenterScreen currentBookCount={books.length} onExecuteImport={handleExecuteImport} onUndoLastImport={handleUndoLastBatch} />}
          {activeTab === 'settings' && <SettingsScreen books={books} sessions={sessions} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} onResetData={handleResetData} />}
          {activeTab === 'profile' && <ProfileScreen books={books} sessions={sessions} />}
          {activeTab === 'admin' && <AdminScreen />}
        </ResponsiveContainer>
      </main>

      {selectedBookForDetails && <BookDetailsModal book={selectedBookForDetails} sessions={sessions} onClose={() => setSelectedBookForDetails(null)} onUpdateBook={handleUpdateBook} onDeleteBook={handleDeleteBook} onStartSession={(book) => { setSelectedBookForDetails(null); openTimer(book.id); }} />}
      {isBatchEditOpen && <BatchEditModal selectedBookIds={selectedBookIds} books={books} onClose={() => setIsBatchEditOpen(false)} onApplyBatchChanges={handleApplyBatchChanges} onDeleteSelected={handleDeleteSelected} onUndoLastBatch={handleUndoLastBatch} />}
      {isTimerOpen && <ReadingSessionModal books={books} initialBookId={timerInitialBookId} onClose={closeTimer} onSaveSession={handleSaveSession} />}
      {isAddBookOpen && <AddBookModal currentBookCount={books.length} onClose={() => setIsAddBookOpen(false)} onAddBook={(newBook) => { setBooks((current) => [newBook, ...current]); showToast(`Added “${newBook.work.title}” to Inkbound.`); }} onAddMultipleBooks={(newBooks) => { setBooks((current) => [...newBooks, ...current]); showToast(`Added ${newBooks.length} books to Inkbound.`); }} />}
      {toastMessage && <div className="inkbound-toast" role="status"><Check className="h-4 w-4 text-[var(--ink-gold)]" /><span>{toastMessage}</span>{previousBooksState && <button type="button" onClick={handleUndoLastBatch}><RotateCcw className="h-3 w-3" /> Undo</button>}</div>}
    </ResponsiveShell>
  );
}
