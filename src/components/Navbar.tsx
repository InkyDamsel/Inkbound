import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  BookMarked,
  Bookmark,
  Clock3,
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

export type NavTab =
  | 'home'
  | 'library'
  | 'tbr'
  | 'sessions'
  | 'stats'
  | 'import'
  | 'settings';

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
  { id: 'sessions' as NavTab, label: 'Reading Sessions', icon: Clock3 },
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
        .slice(0, 7)
    : [];

  const navigate = (tab: NavTab) => {
    setActiveTab(tab);
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  const activeLabel = navItems.find((item) => item.id === activeTab)?.label ?? 'Home';
  const usedPercent = Math.min(100, Math.round((books.length / freeBookLimit) * 100));

  return (
    <>
      <aside className="quiet-shelf-sidebar">
        <button type="button" className="quiet-shelf-brand" onClick={() => navigate('home')}>
          <span className="quiet-shelf-mark" aria-hidden="true">
            <BookMarked />
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
                <Icon />
                <span>{item.label}</span>
                {item.id === 'stats' && userPlan === 'free' && (
                  <small className="quiet-shelf-premium-pill">Premium</small>
                )}
              </button>
            );
          })}
        </nav>

        {userPlan === 'free' ? (
          <section className="quiet-shelf-plan-card">
            <div className="quiet-shelf-plan-heading">
              <span>Free Plan</span>
              <button
                type="button"
                onClick={() => openUpgradeModal('Explore Inkbound Premium')}
              >
                See Plans
              </button>
            </div>
            <p className="quiet-shelf-plan-count">
              <strong>{books.length}</strong> of {freeBookLimit} books used
            </p>
            <div className="quiet-shelf-plan-track">
              <span style={{ width: `${usedPercent}%` }} />
            </div>
            <p className="quiet-shelf-plan-remaining">
              {Math.max(0, freeBookLimit - books.length)} books remaining
            </p>
            <button
              type="button"
              className="quiet-shelf-upgrade-button"
              onClick={() =>
                openUpgradeModal(
                  'Upgrade for unlimited books, batch editing, and detailed reports',
                )
              }
            >
              <Sparkles />
              Upgrade to Premium
            </button>
          </section>
        ) : (
          <section className="quiet-shelf-plan-card is-premium">
            <Sparkles />
            <div>
              <strong>Inkbound Premium</strong>
              <p>Unlimited books and advanced insights</p>
            </div>
          </section>
        )}

        <button type="button" className="quiet-shelf-profile">
          <span className="quiet-shelf-avatar">JL</span>
          <span className="quiet-shelf-profile-copy">
            <strong>Jamie Lee</strong>
            <small>View Profile</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
      </aside>

      <header className="quiet-shelf-topbar">
        <div className="quiet-shelf-page-heading">
          <h1>{activeLabel}</h1>
        </div>

        <div className="quiet-shelf-header-search">
          <Search />
          <input
            value={searchQuery}
            onFocus={() => setIsSearchOpen(true)}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setIsSearchOpen(true);
            }}
            placeholder="Search books, authors, series, notes..."
            aria-label="Search library"
          />
          <kbd>⌘ K</kbd>

          {isSearchOpen && (
            <div className="quiet-shelf-search-panel">
              <div className="quiet-shelf-search-panel-heading">
                <span>Search your library</span>
                <button type="button" onClick={() => setIsSearchOpen(false)} aria-label="Close search">
                  <X />
                </button>
              </div>

              {!normalizedQuery ? (
                <p className="quiet-shelf-search-empty">Start typing to search your books.</p>
              ) : searchResults.length === 0 ? (
                <p className="quiet-shelf-search-empty">No matching books found.</p>
              ) : (
                searchResults.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    className="quiet-shelf-search-result"
                    onClick={() => {
                      onSelectBook(book);
                      setSearchQuery('');
                      setIsSearchOpen(false);
                    }}
                  >
                    <span
                      className={`quiet-shelf-search-cover bg-gradient-to-br ${
                        book.editions[0]?.coverGradient || 'from-amber-900 to-stone-950'
                      }`}
                    >
                      {book.work.title.charAt(0)}
                    </span>
                    <span>
                      <strong>{book.work.title}</strong>
                      <small>{book.work.author}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="quiet-shelf-actions">
          <button type="button" className="quiet-shelf-icon-button" aria-label="Notifications">
            <Bell />
          </button>

          <button
            type="button"
            className="quiet-shelf-icon-button"
            onClick={() => setIsDarkMode((current) => !current)}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Moon /> : <Sun />}
          </button>

          <button type="button" onClick={onOpenTimer} className="quiet-shelf-secondary-action">
            <Clock3 />
            <span>Start Session</span>
          </button>

          <button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action">
            <Plus />
            <span>Add Book</span>
          </button>
        </div>
      </header>

      <nav className="quiet-shelf-mobile-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              className={activeTab === item.id ? 'is-active' : ''}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
