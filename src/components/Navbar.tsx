import React, { useState } from 'react';
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Bookmark,
  Clock,
  DownloadCloud,
  Home,
  Library,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { inkboundBrand } from '../design/tokens';

export type NavTab = 'home' | 'library' | 'tbr' | 'sessions' | 'stats' | 'import' | 'settings';

interface NavbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
  onOpenAddBook: () => void;
  onOpenTimer: () => void;
  isDarkMode: boolean;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const navItems = [
  { id: 'home' as NavTab, label: 'Home', icon: Home },
  { id: 'library' as NavTab, label: 'My Library', icon: Library },
  { id: 'tbr' as NavTab, label: 'TBR', icon: Bookmark },
  { id: 'sessions' as NavTab, label: 'Sessions', icon: Clock },
  { id: 'stats' as NavTab, label: 'Statistics', icon: BarChart3 },
  { id: 'import' as NavTab, label: 'Import', icon: DownloadCloud },
  { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  books,
  onSelectBook,
  onOpenAddBook,
  onOpenTimer,
  isDarkMode,
  setIsDarkMode,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { userPlan, freeBookLimit, openUpgradeModal } = useUserPlan();

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults = normalizedQuery
    ? books
        .filter((book) =>
          book.work.title.toLowerCase().includes(normalizedQuery) ||
          book.work.author.toLowerCase().includes(normalizedQuery) ||
          book.work.seriesName?.toLowerCase().includes(normalizedQuery) ||
          book.work.genres.some((genre) => genre.toLowerCase().includes(normalizedQuery)) ||
          book.privateTags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
          book.editions.some((edition) => edition.isbn?.includes(normalizedQuery)),
        )
        .slice(0, 6)
    : [];

  const navigate = (tab: NavTab) => {
    setActiveTab(tab);
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <>
      <aside className="quiet-shelf-sidebar hidden md:flex">
        <button type="button" className="quiet-shelf-brand" onClick={() => navigate('home')}>
          <span className="quiet-shelf-mark" aria-hidden="true">
            <BookMarked className="h-8 w-8" />
          </span>
          <span className="quiet-shelf-brand-copy">
            <span className="quiet-shelf-brand-name">{inkboundBrand.name}</span>
            <span className="quiet-shelf-tagline">{inkboundBrand.tagline}</span>
          </span>
        </button>

        <nav className="quiet-shelf-sidebar-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`quiet-shelf-sidebar-link ${activeTab === item.id ? 'is-active' : ''}`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="quiet-shelf-profile">
          <div className="quiet-shelf-avatar">JM</div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-[#f4efe6]">Jamie Lee</p>
            <p className="text-xs text-[#b8aab8]">My Profile</p>
          </div>
        </div>
      </aside>

      <header className="quiet-shelf-topbar">
        <div className="quiet-shelf-mobile-brand md:hidden">
          <span className="quiet-shelf-mobile-mark"><BookOpen className="h-5 w-5" /></span>
          <span>{inkboundBrand.name}</span>
        </div>

        <div className="hidden md:block">
          <p className="text-xs uppercase tracking-[0.22em] text-[#9e8d9f]">Your reading life</p>
          <h1 className="font-serif text-2xl text-[#f4efe6]">
            {navItems.find((item) => item.id === activeTab)?.label ?? 'Home'}
          </h1>
        </div>

        <div className="quiet-shelf-actions">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSearchOpen((open) => !open)}
              className="quiet-shelf-icon-button"
              aria-label="Search library"
              aria-expanded={isSearchOpen}
            >
              <Search className="h-5 w-5" />
            </button>

            {isSearchOpen && (
              <div className="quiet-shelf-search-panel">
                <div className="quiet-shelf-search-field">
                  <Search className="h-4 w-4 text-[#c5a059]" />
                  <input
                    type="search"
                    placeholder="Search title, author, series, tag, ISBN..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    autoFocus
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {normalizedQuery && (
                  <div className="quiet-shelf-search-results">
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-5 text-center text-xs text-[#9e8d9f]">No matching books found.</p>
                    ) : (
                      searchResults.map((book) => (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => {
                            onSelectBook(book);
                            setIsSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="quiet-shelf-search-result"
                        >
                          <span className={`quiet-shelf-search-cover bg-gradient-to-br ${book.editions[0]?.coverGradient || 'from-amber-900 to-stone-950'}`}>
                            {book.work.title.charAt(0)}
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate font-serif text-sm text-[#f4efe6]">{book.work.title}</span>
                            <span className="block truncate text-xs text-[#9e8d9f]">{book.work.author}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {userPlan === 'free' ? (
            <button
              type="button"
              onClick={() => openUpgradeModal('Upgrade to Inkbound Premium for unlimited books')}
              className="quiet-shelf-usage"
              title={`Free Plan: Up to ${freeBookLimit} books allowed`}
            >
              <span>{books.length}</span>
              <small>of {freeBookLimit}</small>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openUpgradeModal('Manage Inkbound Premium')}
              className="quiet-shelf-premium"
            >
              <Sparkles className="h-4 w-4" />
              <span>Premium</span>
            </button>
          )}

          <button type="button" onClick={onOpenTimer} className="quiet-shelf-secondary-action">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">Timer</span>
          </button>

          <button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Book</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDarkMode((darkMode) => !darkMode)}
            className="quiet-shelf-icon-button"
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <nav className="quiet-shelf-mobile-nav md:hidden" aria-label="Mobile navigation">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              className={activeTab === item.id ? 'is-active' : ''}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
