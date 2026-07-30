import React, { useState, useEffect } from 'react';
import { UserBookRecord, ReadingSession, ReadingStatus, OwnershipStatus, Format, Priority, ImportRecordItem } from './types';
import { SAMPLE_BOOKS, INITIAL_READING_SESSIONS } from './data/sampleBooks';
import { Navbar, NavTab } from './components/Navbar';
import { HomeDashboard } from './components/HomeDashboard';
import { LibraryScreen } from './components/LibraryScreen';
import { TBRScreen } from './components/TBRScreen';
import { BookDetailsModal } from './components/BookDetailsModal';
import { BatchEditModal } from './components/BatchEditModal';
import { ReadingSessionModal } from './components/ReadingSessionModal';
import { ImportCenterScreen } from './components/ImportCenterScreen';
import { StatisticsScreen } from './components/StatisticsScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { AddBookModal } from './components/AddBookModal';
import { Check, RotateCcw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Core Data Collections
  const [books, setBooks] = useState<UserBookRecord[]>(() => {
    const saved = localStorage.getItem('bookhaven_books');
    return saved ? JSON.parse(saved) : SAMPLE_BOOKS;
  });

  const [sessions, setSessions] = useState<ReadingSession[]>(() => {
    const saved = localStorage.getItem('bookhaven_sessions');
    return saved ? JSON.parse(saved) : INITIAL_READING_SESSIONS;
  });

  // Undo Backup State for Batch Editing / Import
  const [previousBooksState, setPreviousBooksState] = useState<UserBookRecord[] | null>(null);

  // Modals & Selection States
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<UserBookRecord | null>(null);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  
  const [isTimerOpen, setIsTimerOpen] = useState(false);
  const [timerInitialBookId, setTimerInitialBookId] = useState<string | undefined>(undefined);
  
  const [isAddBookOpen, setIsAddBookOpen] = useState(false);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync dark mode HTML class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Persist local state
  useEffect(() => {
    localStorage.setItem('bookhaven_books', JSON.stringify(books));
  }, [books]);

  useEffect(() => {
    localStorage.setItem('bookhaven_sessions', JSON.stringify(sessions));
  }, [sessions]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Selection toggle
  const handleToggleSelectBook = (id: string) => {
    setSelectedBookIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = (ids: string[]) => {
    setSelectedBookIds(ids);
  };

  const handleClearSelection = () => {
    setSelectedBookIds([]);
  };

  // Update single book
  const handleUpdateBook = (updatedBook: UserBookRecord) => {
    setBooks((prev) => prev.map((b) => (b.id === updatedBook.id ? updatedBook : b)));
    if (selectedBookForDetails?.id === updatedBook.id) {
      setSelectedBookForDetails(updatedBook);
    }
  };

  // Update status single
  const handleUpdateStatus = (bookId: string, status: ReadingStatus) => {
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id === bookId) {
          let dateFinished = b.dateFinished;
          if (status === 'finished' && !dateFinished) {
            dateFinished = new Date().toISOString().split('T')[0];
          }
          return {
            ...b,
            status,
            progressPercentage: status === 'finished' ? 100 : b.progressPercentage,
            dateFinished,
          };
        }
        return b;
      })
    );
    showToast(`Updated reading status to ${status}`);
  };

  // Update priority single
  const handleUpdatePriority = (bookId: string, priority: Priority) => {
    setBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, priority } : b))
    );
  };

  // Apply Batch Changes
  const handleApplyBatchChanges = (changes: {
    status?: ReadingStatus;
    ownership?: OwnershipStatus;
    format?: Format;
    priority?: Priority;
    addTag?: string;
    addCollection?: string;
  }) => {
    setPreviousBooksState(books);

    setBooks((prev) =>
      prev.map((b) => {
        if (selectedBookIds.includes(b.id)) {
          let updated = { ...b };
          if (changes.status) {
            updated.status = changes.status;
            if (changes.status === 'finished') {
              updated.progressPercentage = 100;
              updated.dateFinished = new Date().toISOString().split('T')[0];
            }
          }
          if (changes.ownership) updated.ownership = changes.ownership;
          if (changes.priority) updated.priority = changes.priority;
          if (changes.format) {
            updated.editions = updated.editions.map((e) =>
              e.id === updated.activeEditionId ? { ...e, format: changes.format! } : e
            );
          }
          if (changes.addTag && !updated.privateTags.includes(changes.addTag)) {
            updated.privateTags = [...updated.privateTags, changes.addTag];
          }
          if (changes.addCollection && !updated.collections.includes(changes.addCollection)) {
            updated.collections = [...updated.collections, changes.addCollection];
          }
          return updated;
        }
        return b;
      })
    );

    const count = selectedBookIds.length;
    setSelectedBookIds([]);
    showToast(`Applied batch changes to ${count} books.`);
  };

  // Batch Delete
  const handleDeleteSelected = () => {
    setPreviousBooksState(books);
    const count = selectedBookIds.length;
    setBooks((prev) => prev.filter((b) => !selectedBookIds.includes(b.id)));
    setSelectedBookIds([]);
    showToast(`Deleted ${count} books.`);
  };

  // Undo Last Batch
  const handleUndoLastBatch = () => {
    if (previousBooksState) {
      setBooks(previousBooksState);
      setPreviousBooksState(null);
      showToast('Undone recent batch action!');
    }
  };

  // Save Session
  const handleSaveSession = (
    newSession: ReadingSession,
    updatedPages: number,
    updatedMins: number
  ) => {
    setSessions((prev) => [newSession, ...prev]);

    // Update book progress
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id === newSession.bookId) {
          const activeEd = b.editions.find((e) => e.id === b.activeEditionId) || b.editions[0];
          const totalPages = activeEd?.pageCount || 350;
          const totalMins = activeEd?.audiobookDurationMins || 600;

          const isAudio = activeEd?.format === 'audiobook';
          const newPages = !isAudio ? updatedPages : b.progressPages;
          const newMins = isAudio ? updatedMins : b.progressMinutes;

          const pct = Math.min(
            100,
            Math.round(isAudio ? (newMins / totalMins) * 100 : (newPages / totalPages) * 100)
          );

          return {
            ...b,
            progressPages: newPages,
            progressMinutes: newMins,
            progressPercentage: pct,
            status: pct === 100 ? 'finished' : 'currently-reading',
            dateFinished: pct === 100 ? new Date().toISOString().split('T')[0] : b.dateFinished,
            lastSessionDate: newSession.date,
          };
        }
        return b;
      })
    );

    showToast(`Saved session: ${newSession.durationMinutes} minutes logged!`);
  };

  // Execute Import
  const handleExecuteImport = (importedItems: ImportRecordItem[]) => {
    setPreviousBooksState(books);

    const newRecords: UserBookRecord[] = importedItems.map((item) => {
      const edId = 'ed-imp-' + item.id;
      return {
        id: 'book-imp-' + item.id,
        work: {
          id: 'work-imp-' + item.id,
          title: item.title,
          author: item.author,
          summary: 'Imported book summary record.',
          genres: ['Imported Shelf'],
          publicationYear: 2024,
        },
        activeEditionId: edId,
        editions: [
          {
            id: edId,
            format: item.format,
            isbn: item.isbn,
            coverGradient: item.coverGradient,
          },
        ],
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

    setBooks((prev) => [...prev, ...newRecords]);
    showToast(`Imported ${newRecords.length} books into library.`);
  };

  // Add Book
  const handleAddBook = (newBook: UserBookRecord) => {
    setBooks((prev) => [newBook, ...prev]);
    showToast(`Added "${newBook.work.title}" to library!`);
  };

  // Reset Sample Data
  const handleResetData = () => {
    setBooks(SAMPLE_BOOKS);
    setSessions(INITIAL_READING_SESSIONS);
    localStorage.removeItem('bookhaven_books');
    localStorage.removeItem('bookhaven_sessions');
    showToast('Reset library to initial sample books.');
  };

  return (
    <div className="min-h-screen bg-[#faf8f5] dark:bg-[#161118] text-[#242125] dark:text-[#f0eaf2] transition-colors">
      
      {/* Top Header & Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        books={books}
        onSelectBook={setSelectedBookForDetails}
        onOpenAddBook={() => setIsAddBookOpen(true)}
        onOpenTimer={() => {
          setTimerInitialBookId(undefined);
          setIsTimerOpen(true);
        }}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        
        {activeTab === 'home' && (
          <HomeDashboard
            books={books}
            sessions={sessions}
            onSelectBook={setSelectedBookForDetails}
            onStartSessionForBook={(book) => {
              setTimerInitialBookId(book.id);
              setIsTimerOpen(true);
            }}
            onUpdateStatus={handleUpdateStatus}
            onNavigateToTab={setActiveTab}
            onOpenAddBook={() => setIsAddBookOpen(true)}
          />
        )}

        {activeTab === 'library' && (
          <LibraryScreen
            books={books}
            selectedBookIds={selectedBookIds}
            onToggleSelectBook={handleToggleSelectBook}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onSelectBook={setSelectedBookForDetails}
            onOpenBatchEdit={() => setIsBatchEditOpen(true)}
            onOpenAddBook={() => setIsAddBookOpen(true)}
          />
        )}

        {activeTab === 'tbr' && (
          <TBRScreen
            books={books}
            onSelectBook={setSelectedBookForDetails}
            onUpdateStatus={handleUpdateStatus}
            onUpdatePriority={handleUpdatePriority}
          />
        )}

        {activeTab === 'sessions' && (
          <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#c5a059] bg-[#c5a059]/10 px-2.5 py-1 rounded">
                  Reading Companion
                </span>
                <h1 className="text-3xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2] mt-1">
                  Reading Sessions History
                </h1>
              </div>
              <button
                onClick={() => {
                  setTimerInitialBookId(undefined);
                  setIsTimerOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-[#c5a059] text-[#1c121e] text-xs font-bold shadow hover:bg-[#b58e45]"
              >
                + Launch Timer
              </button>
            </div>

            <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-6 shadow-xs space-y-4">
              <div className="space-y-3">
                {sessions.map((sess) => {
                  const b = books.find((x) => x.id === sess.bookId);
                  return (
                    <div key={sess.id} className="p-4 bg-[#f3ede2] dark:bg-[#181119] rounded-xl border border-stone-200 dark:border-stone-800 flex items-center justify-between">
                      <div>
                        <h4 className="font-serif font-bold text-base text-[#2e102d] dark:text-[#f3ede2]">
                          {b?.work.title || 'Reading Session'}
                        </h4>
                        <p className="text-xs text-stone-500">
                          {sess.durationMinutes} minutes • {sess.date} ({sess.startTime} - {sess.endTime})
                        </p>
                        {sess.notes && (
                          <p className="text-xs text-[#849383] italic mt-1 font-serif">&quot;{sess.notes}&quot;</p>
                        )}
                      </div>
                      <span className="text-xs font-bold text-[#c5a059] bg-[#c5a059]/10 px-2.5 py-1 rounded">
                        {sess.location || 'Cozy Spot'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <StatisticsScreen books={books} sessions={sessions} />
        )}

        {activeTab === 'import' && (
          <ImportCenterScreen
            currentBookCount={books.length}
            onExecuteImport={handleExecuteImport}
            onUndoLastImport={handleUndoLastBatch}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsScreen
            books={books}
            sessions={sessions}
            isDarkMode={isDarkMode}
            setIsDarkMode={setIsDarkMode}
            onResetData={handleResetData}
          />
        )}

      </main>

      {/* MODALS */}
      {selectedBookForDetails && (
        <BookDetailsModal
          book={selectedBookForDetails}
          onClose={() => setSelectedBookForDetails(null)}
          onUpdateBook={handleUpdateBook}
          onStartSession={(book) => {
            setSelectedBookForDetails(null);
            setTimerInitialBookId(book.id);
            setIsTimerOpen(true);
          }}
        />
      )}

      {isBatchEditOpen && (
        <BatchEditModal
          selectedBookIds={selectedBookIds}
          books={books}
          onClose={() => setIsBatchEditOpen(false)}
          onApplyBatchChanges={handleApplyBatchChanges}
          onDeleteSelected={handleDeleteSelected}
          onUndoLastBatch={handleUndoLastBatch}
        />
      )}

      {isTimerOpen && (
        <ReadingSessionModal
          books={books}
          initialBookId={timerInitialBookId}
          onClose={() => setIsTimerOpen(false)}
          onSaveSession={handleSaveSession}
        />
      )}

      {isAddBookOpen && (
        <AddBookModal
          currentBookCount={books.length}
          onClose={() => setIsAddBookOpen(false)}
          onAddBook={handleAddBook}
          onAddMultipleBooks={(newBooks) => {
            setBooks((prev) => [...newBooks, ...prev]);
            showToast(`Added ${newBooks.length} books to library!`);
          }}
        />
      )}

      {/* TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#361539] text-[#f8f4ed] px-4 py-3 rounded-xl shadow-2xl border border-[#c5a059] text-xs font-bold flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4 text-[#c5a059]" />
          <span>{toastMessage}</span>
          {previousBooksState && (
            <button
              onClick={handleUndoLastBatch}
              className="ml-2 underline text-[#c5a059] hover:text-white flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Undo
            </button>
          )}
        </div>
      )}

    </div>
  );
}
