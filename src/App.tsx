import React, { useEffect, useState } from 'react';
import {
  Format,
  ImportRecordItem,
  OwnershipStatus,
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
import { BatchEditModal } from './components/BatchEditModal';
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
  // Date#getHours uses the browser/device timezone, so the quiet-hours window
  // automatically follows the reader wherever they use Inkbound.
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
  const [books, setBooks] = useState<UserBookRecord[]>(() =>
    readStoredCollection<UserBookRecord[]>(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, []),
  );
  const [sessions, setSessions] = useState<ReadingSession[]>(() =>
    readStoredCollection<ReadingSession[]>(SESSIONS_STORAGE_KEY, LEGACY_SESSIONS_STORAGE_KEY, []),
  );
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
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
    } catch {
      // Theme persistence should never interrupt the app.
    }
  }, [isDarkMode]);

  useEffect(() => {
    safeWriteLocalStorage(BOOKS_STORAGE_KEY, books);
    try {
      localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);
    } catch {
      // Legacy cleanup is best-effort only.
    }
  }, [books]);

  useEffect(() => {
    safeWriteLocalStorage(SESSIONS_STORAGE_KEY, sessions);
    try {
      localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY);
    } catch {
      // Legacy cleanup is best-effort only.
    }
  }, [sessions]);

  const showToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 4000);
  };

  const processImportEnrichmentQueue = async () => {
    if (isImportQueueProcessing || !navigator.onLine || isReadingTimerOpen()) return;
    const initialQueue = readImportEnrichmentQueue();
    if (initialQueue.length === 0) return;

    const isQuietHours = isPreferredMaintenanceWindow();
    if (!isQuietHours && !canRunDaytimeMaintenance()) return;

    isImportQueueProcessing = true;
    let pending = [...initialQueue];
    const retryItems: ImportEnrichmentQueueItem[] = [];
    let updatedCount = 0;
    let coverCount = 0;
    let summaryCount = 0;
    let processedBatchCount = 0;

    try {
      while (pending.length > 0 && navigator.onLine) {
        // Reading sessions always take priority. During the day Inkbound only
        // performs one tiny maintenance batch; from 11 PM through 5 AM local
        // time it may continue working through the queue while the app is open.
        if (isReadingTimerOpen()) break;
        if (!isQuietHours && processedBatchCount >= 1) break;

        const batchSize = isQuietHours
          ? IMPORT_ENRICHMENT_BATCH_SIZE
          : DAYTIME_MAINTENANCE_BATCH_SIZE;
        const batch = pending.slice(0, batchSize);
        pending = pending.slice(batch.length);
        processedBatchCount += 1;

        const results = await enrichImportedBooks(batch);
        const successful = results.filter((result) => result.success && result.enriched);
        const enrichedById = new Map(
          successful.map((result) => [result.item.targetBookId, result.enriched!]),
        );

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
            return;
          }
          retryItems.push({
            ...result.item,
            attempts: (result.item.attempts ?? 0) + 1,
            lastAttemptAt: new Date().toISOString(),
          });
        });

        writeImportEnrichmentQueue([...retryItems, ...pending]);
        await new Promise<void>((resolve) => window.setTimeout(resolve, isQuietHours ? 300 : 750));
      }

      writeImportEnrichmentQueue([...retryItems, ...pending]);
      if (!isQuietHours && processedBatchCount > 0) markDaytimeMaintenanceRun();

      if (updatedCount > 0) {
        showToast(`Updated ${updatedCount} books · ${coverCount} covers · ${summaryCount} summaries.`);
      } else if (isQuietHours && initialQueue.length > 0 && !isReadingTimerOpen()) {
        showToast('Inkbound kept the remaining books queued and will retry their details later.');
      }
    } catch {
      writeImportEnrichmentQueue([...retryItems, ...pending]);
      if (!isQuietHours && processedBatchCount > 0) markDaytimeMaintenanceRun();
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

  useEffect(() => {
    if (!isTimerOpen) void processImportEnrichmentQueue();
  }, [isTimerOpen]);

  useEffect(() => {
    const resumeMaintenance = () => void processImportEnrichmentQueue();
    window.addEventListener('online', resumeMaintenance);
    window.addEventListener('focus', resumeMaintenance);

    // The browser cannot wake a closed/sleeping device, but if Inkbound is left
    // open this check notices when the user's local clock enters quiet hours.
    const interval = window.setInterval(resumeMaintenance, MAINTENANCE_CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', resumeMaintenance);
      window.removeEventListener('focus', resumeMaintenance);
      window.clearInterval(interval);
    };
  }, []);

  const openTimer = (bookId?: string) => {
    setTimerInitialBookId(bookId);
    setIsTimerOpen(true);
  };

  const closeTimer = () => setIsTimerOpen(false);

  const handleToggleSelectBook = (id: string) => {
    setSelectedBookIds((current) => current.includes(id) ? current.filter((bookId) => bookId !== id) : [...current, id]);
  };

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

  const handleUpdateStatus = (bookId: string, status: ReadingStatus) => {
    setBooks((current) => current.map((book) => {
      if (book.id !== bookId) return book;
      return {
        ...book,
        status,
        progressPercentage: status === 'finished' ? 100 : book.progressPercentage,
        dateFinished: status === 'finished' ? book.dateFinished ?? new Date().toISOString().split('T')[0] : book.dateFinished,
      };
    }));
    showToast(`Updated reading status to ${status}.`);
  };

  const handleUpdatePriority = (bookId: string, priority: Priority) => {
    setBooks((current) => current.map((book) => (book.id === bookId ? { ...book, priority } : book)));
  };

  const handleApplyBatchChanges = (changes: { status?: ReadingStatus; ownership?: OwnershipStatus; format?: Format; priority?: Priority; addTag?: string; addCollection?: string }) => {
    setPreviousBooksState(books);
    setBooks((current) => current.map((book) => {
      if (!selectedBookIds.includes(book.id)) return book;
      const updatedBook = { ...book };
      if (changes.status) {
        updatedBook.status = changes.status;
        if (changes.status === 'finished') {
          updatedBook.progressPercentage = 100;
          updatedBook.dateFinished = new Date().toISOString().split('T')[0];
        }
      }
      if (changes.ownership) updatedBook.ownership = changes.ownership;
      if (changes.priority) updatedBook.priority = changes.priority;
      if (changes.format) updatedBook.editions = updatedBook.editions.map((edition) => edition.id === updatedBook.activeEditionId ? { ...edition, format: changes.format! } : edition);
      if (changes.addTag && !updatedBook.privateTags.includes(changes.addTag)) updatedBook.privateTags = [...updatedBook.privateTags, changes.addTag];
      if (changes.addCollection && !updatedBook.collections.includes(changes.addCollection)) updatedBook.collections = [...updatedBook.collections, changes.addCollection];
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

  const handleSaveSession = (newSession: ReadingSession, updatedPages: number, updatedMinutes: number) => {
    setSessions((current) => [newSession, ...current]);
    setBooks((current) => current.map((book) => {
      if (book.id !== newSession.bookId) return book;
      const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
      const isAudiobook = activeEdition?.format === 'audiobook';
      const total = isAudiobook ? activeEdition?.audiobookDurationMins ?? 600 : activeEdition?.pageCount ?? 350;
      const completed = isAudiobook ? updatedMinutes : updatedPages;
      const progressPercentage = Math.min(100, Math.round((completed / total) * 100));
      return {
        ...book,
        progressPages: isAudiobook ? book.progressPages : updatedPages,
        progressMinutes: isAudiobook ? updatedMinutes : book.progressMinutes,
        progressPercentage,
        status: progressPercentage === 100 ? 'finished' : 'currently-reading',
        dateFinished: progressPercentage === 100 ? new Date().toISOString().split('T')[0] : book.dateFinished,
        lastSessionDate: newSession.date,
      };
    }));
    setTimerInitialBookId(undefined);
    setIsTimerOpen(false);
    showToast(`Saved a ${newSession.durationMinutes}-minute reading session.`);
  };

  const handleExecuteImport = async (importedItems: ImportRecordItem[]) => {
    setPreviousBooksState(books);
    const immediateBooks = importedItems.map(createFallbackImportedBook);
    setBooks((current) => [...current, ...immediateBooks]);

    const existingQueue = readImportEnrichmentQueue();
    const queuedByBookId = new Map(existingQueue.map((item) => [item.targetBookId, item]));
    queueImportedItems(importedItems).forEach((item) => queuedByBookId.set(item.targetBookId, item));
    writeImportEnrichmentQueue([...queuedByBookId.values()]);

    showToast(
      navigator.onLine
        ? `Added ${immediateBooks.length} books. Covers and publisher summaries will continue updating automatically.`
        : `Added ${immediateBooks.length} books offline. Covers and publisher summaries will update when Inkbound is online.`,
    );
    void processImportEnrichmentQueue();
  };

  const handleResetData = () => {
    setBooks([]);
    setSessions([]);
    setPreviousBooksState(null);
    setSelectedBookForDetails(null);
    setSelectedBookIds([]);
    try {
      localStorage.removeItem(BOOKS_STORAGE_KEY);
      localStorage.removeItem(SESSIONS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY);
      localStorage.removeItem(DAYTIME_MAINTENANCE_KEY);
    } catch {
      // Device cleanup is best-effort; state is already cleared above.
    }
    writeImportEnrichmentQueue([]);
    showToast('Cleared all Inkbound books and reading sessions.');
  };

  return (
    <ResponsiveShell navigation={<Navbar activeTab={activeTab} setActiveTab={setActiveTab} books={books} onSelectBook={setSelectedBookForDetails} onOpenAddBook={() => setIsAddBookOpen(true)} onOpenTimer={() => openTimer()} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}>
      <main className="inkbound-main-content">
        <ResponsiveContainer width="wide">
          {activeTab === 'home' && <HomeDashboard books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onStartSessionForBook={(book) => openTimer(book.id)} onUpdateStatus={handleUpdateStatus} onNavigateToTab={setActiveTab} onOpenAddBook={() => setIsAddBookOpen(true)} />}
          {activeTab === 'library' && <LibraryScreen books={books} selectedBookIds={selectedBookIds} onToggleSelectBook={handleToggleSelectBook} onSelectAll={setSelectedBookIds} onClearSelection={() => setSelectedBookIds([])} onSelectBook={setSelectedBookForDetails} onOpenBatchEdit={() => setIsBatchEditOpen(true)} onOpenAddBook={() => setIsAddBookOpen(true)} />}
          {activeTab === 'tbr' && <TBRScreen books={books} onSelectBook={setSelectedBookForDetails} onUpdateStatus={handleUpdateStatus} onUpdatePriority={handleUpdatePriority} />}
          {activeTab === 'sessions' && (
            <div className="space-y-8">
              <ReadingActivityOverview books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} />
              <ReadingSessionsScreen books={books} sessions={sessions} onOpenTimer={openTimer} onSelectBook={setSelectedBookForDetails} />
            </div>
          )}
          {activeTab === 'challenges' && <ReadingChallengesScreen books={books} sessions={sessions} />}
          {activeTab === 'achievements' && <AchievementsScreen books={books} sessions={sessions} />}
          {activeTab === 'collections' && <CollectionsScreen books={books} onUpdateBook={handleUpdateBook} onSelectBook={setSelectedBookForDetails} />}
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

      {selectedBookForDetails && <BookDetailsModal book={selectedBookForDetails} onClose={() => setSelectedBookForDetails(null)} onUpdateBook={handleUpdateBook} onDeleteBook={handleDeleteBook} onStartSession={(book) => { setSelectedBookForDetails(null); openTimer(book.id); }} />}
      {isBatchEditOpen && <BatchEditModal selectedBookIds={selectedBookIds} books={books} onClose={() => setIsBatchEditOpen(false)} onApplyBatchChanges={handleApplyBatchChanges} onDeleteSelected={handleDeleteSelected} onUndoLastBatch={handleUndoLastBatch} />}
      {isTimerOpen && <ReadingSessionModal books={books} initialBookId={timerInitialBookId} onClose={closeTimer} onSaveSession={handleSaveSession} />}
      {isAddBookOpen && <AddBookModal currentBookCount={books.length} onClose={() => setIsAddBookOpen(false)} onAddBook={(newBook) => { setBooks((current) => [newBook, ...current]); showToast(`Added “${newBook.work.title}” to Inkbound.`); }} onAddMultipleBooks={(newBooks) => { setBooks((current) => [...newBooks, ...current]); showToast(`Added ${newBooks.length} books to Inkbound.`); }} />}
      {toastMessage && <div className="inkbound-toast" role="status"><Check className="h-4 w-4 text-[var(--ink-gold)]" /><span>{toastMessage}</span>{previousBooksState && <button type="button" onClick={handleUndoLastBatch}><RotateCcw className="h-3 w-3" /> Undo</button>}</div>}
    </ResponsiveShell>
  );
}
