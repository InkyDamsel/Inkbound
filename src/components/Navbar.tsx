import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  BookHeart,
  BookMarked,
  BookOpen,
  Bookmark,
  CalendarDays,
  ChevronDown,
  Clock3,
  DownloadCloud,
  FolderHeart,
  History,
  Home,
  Library,
  Moon,
  MoreHorizontal,
  Palette,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Target,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import { UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { inkboundBrand } from '../design/tokens';
import { usePersistentState } from '../hooks/usePersistentState';

export type NavTab =
  | 'home'
  | 'library'
  | 'tbr'
  | 'sessions'
  | 'collections'
  | 'timeline'
  | 'memories'
  | 'challenges'
  | 'achievements'
  | 'studio'
  | 'wrapped'
  | 'yearbook'
  | 'stats'
  | 'import'
  | 'settings'
  | 'profile';

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
  { id: 'collections' as NavTab, label: 'Collections', icon: FolderHeart },
  { id: 'timeline' as NavTab, label: 'Reading Timeline', icon: History },
  { id: 'memories' as NavTab, label: 'Reading Memories', icon: BookHeart },
  { id: 'challenges' as NavTab, label: 'Challenges', icon: Target },
  { id: 'achievements' as NavTab, label: 'Achievements', icon: Trophy },
  { id: 'studio' as NavTab, label: 'Inkbound Studio', icon: Palette },
  { id: 'wrapped' as NavTab, label: 'Monthly Wrapped', icon: CalendarDays },
  { id: 'yearbook' as NavTab, label: 'Year in Books', icon: BookOpen },
  { id: 'stats' as NavTab, label: 'Statistics', icon: BarChart3 },
  { id: 'import' as NavTab, label: 'Import', icon: DownloadCloud },
  { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
];

const mobilePrimaryItems = navItems.slice(0, 4);
const mobileMoreItems = navItems.slice(4);

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [notificationsRead, setNotificationsRead] = usePersistentState('inkbound_notifications_read', false);
  const { userPlan, freeBookLimit, openUpgradeModal } = useUserPlan();

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults = normalizedQuery
    ? books.filter((book) =>
        book.work.title.toLowerCase().includes(normalizedQuery) ||
        book.work.author.toLowerCase().includes(normalizedQuery) ||
        book.work.seriesName?.toLowerCase().includes(normalizedQuery) ||
        book.work.genres.some((genre) => genre.toLowerCase().includes(normalizedQuery)) ||
        book.privateTags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
      ).slice(0, 7)
    : [];

  const currentlyReadingCount = books.filter((book) => book.status === 'currently-reading').length;
  const tbrCount = books.filter((book) => book.status === 'tbr').length;
  const remainingSlots = Math.max(0, freeBookLimit - books.length);
  const usedPercent = Math.min(100, Math.round((books.length / freeBookLimit) * 100));
  const isMoreSectionActive = mobileMoreItems.some((item) => item.id === activeTab);
  const activeLabel = activeTab === 'profile' ? 'Profile' : navItems.find((item) => item.id === activeTab)?.label ?? 'Home';

  const navigate = (tab: NavTab) => {
    setActiveTab(tab);
    setIsSearchOpen(false);
    setIsMobileMenuOpen(false);
    setIsNotificationsOpen(false);
    setIsProfileOpen(false);
    setSearchQuery('');
  };

  return (
    <>
      <aside className="quiet-shelf-sidebar">
        <button type="button" className="quiet-shelf-brand" onClick={() => navigate('home')}>
          <span className="quiet-shelf-mark" aria-hidden="true"><BookMarked /></span>
          <span className="quiet-shelf-brand-copy">
            <span className="quiet-shelf-brand-name">{inkboundBrand.name}</span>
            <span className="quiet-shelf-tagline">{inkboundBrand.tagline}</span>
          </span>
        </button>

        <nav className="quiet-shelf-sidebar-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" onClick={() => navigate(item.id)} className={`quiet-shelf-sidebar-link ${activeTab === item.id ? 'is-active' : ''}`}>
                <Icon /><span>{item.label}</span>
                {item.id === 'stats' && userPlan === 'free' && <small className="quiet-shelf-premium-pill">Premium</small>}
              </button>
            );
          })}
        </nav>

        {userPlan === 'free' ? (
          <section className="quiet-shelf-plan-card">
            <div className="quiet-shelf-plan-heading"><span>Free Plan</span><button type="button" onClick={() => openUpgradeModal('Explore Inkbound Premium')}>See Plans</button></div>
            <p className="quiet-shelf-plan-count"><strong>{books.length}</strong> of {freeBookLimit} books used</p>
            <div className="quiet-shelf-plan-track"><span style={{ width: `${usedPercent}%` }} /></div>
            <p className="quiet-shelf-plan-remaining">{remainingSlots} books remaining</p>
            <button type="button" className="quiet-shelf-upgrade-button" onClick={() => openUpgradeModal('Upgrade for unlimited books, collections, Studio themes, and detailed reports')}><Sparkles />Upgrade to Premium</button>
          </section>
        ) : (
          <section className="quiet-shelf-plan-card is-premium"><Sparkles /><div><strong>Inkbound Premium</strong><p>Unlimited books and advanced insights</p></div></section>
        )}

        <div className="relative">
          <button type="button" className="quiet-shelf-profile w-full" onClick={() => { setIsProfileOpen((current) => !current); setIsNotificationsOpen(false); }} aria-expanded={isProfileOpen} aria-haspopup="menu">
            <span className="quiet-shelf-avatar">JL</span>
            <span className="quiet-shelf-profile-copy"><strong>Jamie Lee</strong><small>View Profile</small></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
          </button>
          {isProfileOpen && (
            <div className="absolute bottom-full left-0 z-[90] mb-3 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-2 shadow-2xl" role="menu">
              <button type="button" role="menuitem" onClick={() => navigate('profile')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-[var(--ink-muted)] hover:bg-[var(--ink-surface-soft)] hover:text-[var(--ink-ivory)]"><UserRound className="h-4 w-4 text-[var(--ink-gold)]" />Profile & account</button>
            </div>
          )}
        </div>
      </aside>

      <header className="quiet-shelf-topbar">
        <div className="quiet-shelf-page-heading"><h1>{activeLabel}</h1></div>
        <div className="quiet-shelf-header-search">
          <Search />
          <input value={searchQuery} onFocus={() => setIsSearchOpen(true)} onChange={(event) => { setSearchQuery(event.target.value); setIsSearchOpen(true); }} placeholder="Search books, authors, series, notes..." aria-label="Search library" />
          <kbd>⌘ K</kbd>
          {isSearchOpen && (
            <div className="quiet-shelf-search-panel">
              <div className="quiet-shelf-search-panel-heading"><span>Search your library</span><button type="button" onClick={() => setIsSearchOpen(false)} aria-label="Close search"><X /></button></div>
              {!normalizedQuery ? <p className="quiet-shelf-search-empty">Start typing to search your books.</p> : searchResults.length === 0 ? <p className="quiet-shelf-search-empty">No matching books found.</p> : searchResults.map((book) => (
                <button key={book.id} type="button" className="quiet-shelf-search-result" onClick={() => { onSelectBook(book); setSearchQuery(''); setIsSearchOpen(false); }}>
                  <span className={`quiet-shelf-search-cover bg-gradient-to-br ${book.editions[0]?.coverGradient || 'from-amber-900 to-stone-950'}`}>{book.work.title.charAt(0)}</span>
                  <span><strong>{book.work.title}</strong><small>{book.work.author}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="quiet-shelf-actions relative">
          <div className="relative">
            <button type="button" className="quiet-shelf-icon-button relative" aria-label="Notifications" aria-expanded={isNotificationsOpen} onClick={() => { setIsNotificationsOpen((current) => !current); setIsProfileOpen(false); }}>
              <Bell />{!notificationsRead && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--ink-gold-bright)]" />}
            </button>
            {isNotificationsOpen && (
              <div className="absolute right-0 top-full z-[100] mt-3 w-[min(360px,calc(100vw-32px))] rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 shadow-2xl">
                <div className="flex items-center justify-between"><strong className="font-serif text-lg text-[var(--ink-ivory)]">Notifications</strong><button type="button" onClick={() => setNotificationsRead(true)} className="text-xs text-[var(--ink-gold-bright)]">Mark read</button></div>
                <button type="button" onClick={() => navigate('sessions')} className="mt-3 flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-[var(--ink-surface-soft)]"><Clock3 className="h-4 w-4 text-[var(--ink-gold)]" /><span><strong className="block text-sm text-[var(--ink-ivory)]">{currentlyReadingCount} books in progress</strong><small className="text-[var(--ink-muted)]">Continue a reading session.</small></span></button>
                <button type="button" onClick={() => navigate('tbr')} className="flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-[var(--ink-surface-soft)]"><Bookmark className="h-4 w-4 text-[var(--ink-gold)]" /><span><strong className="block text-sm text-[var(--ink-ivory)]">{tbrCount} books waiting</strong><small className="text-[var(--ink-muted)]">Choose what comes next.</small></span></button>
              </div>
            )}
          </div>
          <button type="button" className="quiet-shelf-icon-button" onClick={() => { setIsDarkMode((current) => !current); setIsNotificationsOpen(false); }} aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}>{isDarkMode ? <Moon /> : <Sun />}</button>
          <button type="button" onClick={onOpenTimer} className="quiet-shelf-secondary-action"><Clock3 /><span>Start Session</span></button>
          <button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action"><Plus /><span>Add Book</span></button>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[120] flex items-end bg-black/70 p-4 backdrop-blur-sm lg:hidden" onClick={() => setIsMobileMenuOpen(false)}>
          <section className="inkbound-panel w-full rounded-3xl p-5" role="dialog" aria-modal="true" aria-label="More navigation options" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--ink-border-subtle)] pb-4"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">More</h2><button type="button" className="quiet-shelf-icon-button" onClick={() => setIsMobileMenuOpen(false)}><X /></button></div>
            <div className="mt-4 grid max-h-[55vh] gap-2 overflow-y-auto">
              {mobileMoreItems.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => navigate(item.id)} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-sm font-semibold ${activeTab === item.id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}><Icon className="h-5 w-5 text-[var(--ink-gold)]" /><span className="flex-1">{item.label}</span></button>; })}
              <button type="button" onClick={() => navigate('profile')} className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border-subtle)] px-4 text-left text-sm font-semibold text-[var(--ink-muted)]"><UserRound className="h-5 w-5 text-[var(--ink-gold)]" />Profile & account</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--ink-border-subtle)] pt-4"><button type="button" onClick={() => { setIsMobileMenuOpen(false); onOpenTimer(); }} className="quiet-shelf-secondary-action justify-center"><Clock3 />Start Session</button><button type="button" onClick={() => { setIsMobileMenuOpen(false); onOpenAddBook(); }} className="quiet-shelf-primary-action justify-center"><Plus />Add Book</button></div>
          </section>
        </div>
      )}

      <nav className="quiet-shelf-mobile-nav" aria-label="Mobile navigation">
        {mobilePrimaryItems.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => navigate(item.id)} className={activeTab === item.id ? 'is-active' : ''}><Icon /><span>{item.label}</span></button>; })}
        <button type="button" onClick={() => setIsMobileMenuOpen(true)} className={isMoreSectionActive || activeTab === 'profile' ? 'is-active' : ''}><MoreHorizontal /><span>More</span></button>
      </nav>
    </>
  );
};
