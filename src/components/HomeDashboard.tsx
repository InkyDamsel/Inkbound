import React from 'react';
import { ReadingSession, ReadingStatus, UserBookRecord } from '../types';
import { HearthScreen } from '../features/sanctuary/presentation/HearthScreen';

interface HomeDashboardProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
  onStartSessionForBook: (book: UserBookRecord) => void;
  onUpdateStatus: (bookId: string, status: ReadingStatus) => void;
  onNavigateToTab: (tab: any) => void;
  onOpenAddBook: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  books,
  sessions,
  onSelectBook,
  onStartSessionForBook,
  onNavigateToTab,
}) => (
  <HearthScreen
    books={books}
    sessions={sessions}
    onSelectBook={onSelectBook}
    onStartSessionForBook={onStartSessionForBook}
    onNavigateToLibrary={() => onNavigateToTab('library')}
  />
);
