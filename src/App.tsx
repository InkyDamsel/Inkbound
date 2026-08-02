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
import { SAMPLE_BOOKS, INITIAL_READING_SESSIONS } from './data/sampleBooks';
import { Navbar, NavTab } from './components/Navbar';
import { HomeDashboard } from './components/HomeDashboard';
import { LibraryScreen } from './components/LibraryScreen';
import { TBRScreen } from './components/TBRScreen';
import { ReadingSessionsScreen } from './components/ReadingSessionsScreen';
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
import { AddBookModal } from './components/AddBookModal';
import { ResponsiveShell } from './layout/shell/ResponsiveShell';
import { ResponsiveContainer } from './layout/responsive/ResponsiveContainer';
import { usePersistentState } from './hooks/usePersistentState';
import { Check, RotateCcw } from 'lucide-react';

const BOOKS_STORAGE_KEY = 'inkbound_books';
const SESSIONS_STORAGE_KEY = 'inkbound_sessions';
const THEME_STORAGE_KEY = 'inkbound_theme';
const LEGACY_BOOKS_STORAGE_KEY = 'bookhaven_books';
const LEGACY_SESSIONS_STORAGE_KEY = 'bookhaven_sessions';

function readStoredCollection<T>(primaryKey: string, legacyKey: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(primaryKey) ?? localStorage.getItem(legacyKey);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = usePersistentState<NavTab>('inkbound_active_tab', 'home');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme ? savedTheme === 'dark' : true;
  });
  const [books, setBooks] = useState<UserBookRecord[]>(() => readStoredCollection(BOOKS_STORAGE_KEY, LEGACY_BOOKS_STORAGE_KEY, SAMPLE_BOOKS));
  const [sessions, setSessions] = useState<ReadingSession[]>(() => readStoredCollection(SESSIONS_STORAGE_KEY, LEGACY_SESSIONS_STORAGE_KEY, INITIAL_READING_SESSIONS));
  const [previousBooksState, setPreviousBooksState] = useState<UserBookRecord[] | null>(null);
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<UserBookRecord | null>(null);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [isTimerOpen, setIsTimerOpen] = usePersistentState('inkbound_timer_open', false);
  const [timerInitialBookId, setTimerInitialBookId] = usePersistentState<string | undefined>('inkbound_timer_book_id', undefined);
  const [isAddBookOpen, setIsAddBookOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
    localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(books));
    localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);
  }, [books]);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY);
  }, [sessions]);

  const showToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 4000);
  };

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

  const handleExecuteImport = (importedItems: ImportRecordItem[]) => {
    setPreviousBooksState(books);
    const importedBooks: UserBookRecord[] = importedItems.map((item) => {
      const editionId = `edition-import-${item.id}`;
      return {
        id: `book-import-${item.id}`,
        work: { id: `work-import-${item.id}`, title: item.title, author: item.author, summary: 'Imported book summary record.', genres: ['Imported Shelf'], publicationYear: 2024 },
        activeEditionId: editionId,
        editions: [{ id: editionId, format: item.format, isbn: item.isbn, coverGradient: item.coverGradient }],
        status: item.status,
        ownership: 'owned',
        progressPages: item.status === 'finished' ? 300 : 0,
        progressMinutes: 0,
        progressPercentage: item.status === 'finished' ? 100 : 0,
        rating: item.rating,
        review: item.review,
        favoriteQuotes: [],
        privateTags: ['imported'],
        priority: 'medium',
        moods: ['Atmospheric'],
        collections: [],
        sourceOfImport: 'Import Wizard',
        dateAdded: item.dateAdded,
        dateFinished: item.dateRead,
      };
    });
    setBooks((current) => [...current, ...importedBooks]);
    showToast(`Imported ${importedBooks.length} books into Inkbound.`);
  };

  const handleResetData = () => {
    setBooks(SAMPLE_BOOKS);
    setSessions(INITIAL_READING_SESSIONS);
    localStorage.removeItem(BOOKS_STORAGE_KEY);
    localStorage.removeItem(SESSIONS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY);
    showToast('Reset Inkbound to the sample library.');
  };

  return (
    <ResponsiveShell navigation={<Navbar activeTab={activeTab} setActiveTab={setActiveTab} books={books} onSelectBook={setSelectedBookForDetails} onOpenAddBook={() => setIsAddBookOpen(true)} onOpenTimer={() => openTimer()} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}>
      <main className="inkbound-main-content">
        <ResponsiveContainer width="wide">
          {activeTab === 'home' && <HomeDashboard books={books} sessions={sessions} onSelectBook={setSelectedBookForDetails} onStartSessionForBook={(book) => openTimer(book.id)} onUpdateStatus={handleUpdateStatus} onNavigateToTab={setActiveTab} onOpenAddBook={() => setIsAddBookOpen(true)} />}
          {activeTab === 'library' && <LibraryScreen books={books} selectedBookIds={selectedBookIds} onToggleSelectBook={handleToggleSelectBook} onSelectAll={setSelectedBookIds} onClearSelection={() => setSelectedBookIds([])} onSelectBook={setSelectedBookForDetails} onOpenBatchEdit={() => setIsBatchEditOpen(true)} onOpenAddBook={() => setIsAddBookOpen(true)} />}
          {activeTab === 'tbr' && <TBRScreen books={books} onSelectBook={setSelectedBookForDetails} onUpdateStatus={handleUpdateStatus} onUpdatePriority={handleUpdatePriority} />}
          {activeTab === 'sessions' && <ReadingSessionsScreen books={books} sessions={sessions} onOpenTimer={openTimer} onSelectBook={setSelectedBookForDetails} />}
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
        </ResponsiveContainer>
      </main>

      {selectedBookForDetails && <BookDetailsModal book={selectedBookForDetails} onClose={() => setSelectedBookForDetails(null)} onUpdateBook={handleUpdateBook} onStartSession={(book) => { setSelectedBookForDetails(null); openTimer(book.id); }} />}
      {isBatchEditOpen && <BatchEditModal selectedBookIds={selectedBookIds} books={books} onClose={() => setIsBatchEditOpen(false)} onApplyBatchChanges={handleApplyBatchChanges} onDeleteSelected={handleDeleteSelected} onUndoLastBatch={handleUndoLastBatch} />}
      {isTimerOpen && <ReadingSessionModal books={books} initialBookId={timerInitialBookId} onClose={closeTimer} onSaveSession={handleSaveSession} />}
      {isAddBookOpen && <AddBookModal currentBookCount={books.length} onClose={() => setIsAddBookOpen(false)} onAddBook={(newBook) => { setBooks((current) => [newBook, ...current]); showToast(`Added “${newBook.work.title}” to Inkbound.`); }} onAddMultipleBooks={(newBooks) => { setBooks((current) => [...newBooks, ...current]); showToast(`Added ${newBooks.length} books to Inkbound.`); }} />}
      {toastMessage && <div className="inkbound-toast" role="status"><Check className="h-4 w-4 text-[var(--ink-gold)]" /><span>{toastMessage}</span>{previousBooksState && <button type="button" onClick={handleUndoLastBatch}><RotateCcw className="h-3 w-3" /> Undo</button>}</div>}
    </ResponsiveShell>
  );
}
