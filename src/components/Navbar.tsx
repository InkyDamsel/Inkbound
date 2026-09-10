import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Bell, BookHeart, BookMarked, BookOpen, Bookmark, CalendarClock, CalendarDays,
  ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, DownloadCloud, History, Home, Images, Library, Moon,
  MoreHorizontal, Palette, Plus, Search, Settings, ShieldCheck, Sparkles, Sun, Target, Trophy, UserRound, X,
} from 'lucide-react';
import { UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { useAccountSync } from '../context/AccountSyncContext';
import { inkboundBrand } from '../design/tokens';
import { usePersistentState } from '../hooks/usePersistentState';
import { useReaderProfileIdentity } from '../hooks/useReaderProfileIdentity';
import { getRuntimeStorage } from '../platform/runtimeStorage';
import { buildLibraryLoanReminders } from '../features/loans/libraryLoanReminders';
import { syncNativeLibraryLoanReminders } from '../features/loans/nativeLibraryLoanReminders';

export type NavTab =
  | 'home' | 'library' | 'duplicates' | 'tbr' | 'sessions' | 'collections' | 'import-history' | 'timeline' | 'memories'
  | 'time-capsules' | 'photo-memories' | 'bookshelf-time' | 'my-dragon' | 'personality'
  | 'insights' | 'challenges' | 'achievements' | 'studio' | 'wrapped' | 'yearbook'
  | 'stats' | 'import' | 'settings' | 'profile' | 'admin';

type NavigationGroupId = 'reading' | 'journal' | 'insights' | 'studio' | 'account';
type NavigationItem = { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }>; premium?: boolean; adminOnly?: boolean };
type NavigationGroup = { id: NavigationGroupId; label: string; items: NavigationItem[] };

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

const OWNER_EMAILS = new Set(['blackdame494@gmail.com', 'inkbound@inkydameinteractive.com']);
const IMPORT_CENTER_VIEW_KEY = 'inkbound_import_center_view';
const homeItem: NavigationItem = { id: 'home', label: 'Home', icon: Home };
const navigationGroups: NavigationGroup[] = [
  { id: 'reading', label: 'Reading', items: [
    { id: 'library', label: 'My Library', icon: Library },
    { id: 'sessions', label: 'Reading Sessions', icon: Clock3 },
    { id: 'import', label: 'Import', icon: DownloadCloud },
  ]},
  { id: 'journal', label: 'Journal', items: [
    { id: 'timeline', label: 'Reading Timeline', icon: History }, { id: 'memories', label: 'Reading Memories', icon: BookHeart },
    { id: 'photo-memories', label: 'Photo Memories', icon: Images }, { id: 'time-capsules', label: 'Time Capsules', icon: CalendarClock },
    { id: 'my-dragon', label: 'My Dragon', icon: Sparkles },
  ]},
  { id: 'insights', label: 'Insights', items: [
    { id: 'stats', label: 'Statistics', icon: BarChart3 }, { id: 'personality', label: 'Reader Personality', icon: Sparkles },
    { id: 'insights', label: 'Reading Insights', icon: BarChart3, premium: true }, { id: 'challenges', label: 'Challenges', icon: Target },
    { id: 'achievements', label: 'Achievements', icon: Trophy },
  ]},
  { id: 'studio', label: 'Studio', items: [
    { id: 'studio', label: 'Inkbound Studio', icon: Palette },
    { id: 'wrapped', label: 'Monthly Wrapped', icon: CalendarDays, premium: true },
    { id: 'yearbook', label: 'Year in Books', icon: BookOpen, premium: true },
    { id: 'bookshelf-time', label: 'Bookshelf Through Time', icon: Library, premium: true },
  ]},
  { id: 'account', label: 'Account', items: [
    { id: 'duplicates', label: 'Library Maintenance', icon: Copy },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'admin', label: 'Administration', icon: ShieldCheck, adminOnly: true },
  ] },
];

const allNavigationItems = [homeItem, ...navigationGroups.flatMap((group) => group.items)];
const mobilePrimaryItems = [homeItem, ...navigationGroups[0].items.slice(0, 2)];
const mobilePrimaryIds = new Set(mobilePrimaryItems.map((item) => item.id));
const defaultCollapsedGroups: Record<NavigationGroupId, boolean> = { reading: false, journal: false, insights: false, studio: false, account: false };

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, books, onSelectBook, onOpenAddBook, onOpenTimer, isDarkMode, setIsDarkMode }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [notificationsRead, setNotificationsRead] = usePersistentState('inkbound_notifications_read', false);
  const [loanReminderReadIds, setLoanReminderReadIds] = usePersistentState<string[]>('inkbound_library_loan_reminders_read', []);
  const [collapsedGroups, setCollapsedGroups] = usePersistentState<Record<NavigationGroupId, boolean>>('inkbound_navigation_collapsed_groups', defaultCollapsedGroups);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = usePersistentState('inkbound_sidebar_collapsed', false);
  const { userPlan, openUpgradeModal } = useUserPlan();
  const { user } = useAccountSync();
  const { displayName, avatarImage, initials } = useReaderProfileIdentity();
  const isAdmin = Boolean(user?.email && OWNER_EMAILS.has(user.email.toLowerCase()));
  const visibleNavigationGroups = navigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.adminOnly || isAdmin) }))
    .filter((group) => group.items.length > 0);
  const mobileNavigationGroups = visibleNavigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !mobilePrimaryIds.has(item.id)) }))
    .filter((group) => group.items.length > 0);
  const loanReminders = useMemo(() => buildLibraryLoanReminders(books), [books]);
  const unreadLoanReminderCount = loanReminders.filter((reminder) => !loanReminderReadIds.includes(reminder.id)).length;
  const hasUnreadNotifications = !notificationsRead || unreadLoanReminderCount > 0;

  useEffect(() => {
    document.documentElement.style.setProperty('--ink-sidebar-width', isSidebarCollapsed ? '76px' : '232px');
    return () => document.documentElement.style.setProperty('--ink-sidebar-width', '232px');
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (activeTab !== 'import-history') return;
    try { getRuntimeStorage().setItem(IMPORT_CENTER_VIEW_KEY, 'history'); } catch { /* no-op */ }
    setActiveTab('import');
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    if (userPlan !== 'free') return;
    const activeItem = allNavigationItems.find((item) => item.id === activeTab);
    if (activeItem?.premium) setActiveTab('home');
  }, [activeTab, setActiveTab, userPlan]);

  useEffect(() => {
    void syncNativeLibraryLoanReminders(books);
  }, [books]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults = normalizedQuery ? books.filter((book) =>
    book.work.title.toLowerCase().includes(normalizedQuery) || book.work.author.toLowerCase().includes(normalizedQuery) ||
    book.work.seriesName?.toLowerCase().includes(normalizedQuery) || book.work.genres.some((genre) => genre.toLowerCase().includes(normalizedQuery)) ||
    book.privateTags.some((tag) => tag.toLowerCase().includes(normalizedQuery))).slice(0, 7) : [];
  const currentlyReadingCount = books.filter((book) => book.status === 'currently-reading').length;
  const tbrCount = books.filter((book) => book.status === 'tbr').length;
  const isMoreSectionActive = !mobilePrimaryIds.has(activeTab) && activeTab !== 'home';
  const activeLabel = activeTab === 'profile' ? 'Profile' : activeTab === 'import-history' ? 'Import' : allNavigationItems.find((item) => item.id === activeTab)?.label ?? 'Home';

  const navigate = (tab: NavTab) => {
    if (tab === 'admin' && !isAdmin) return;
    if (tab === 'import') {
      try { getRuntimeStorage().setItem(IMPORT_CENTER_VIEW_KEY, 'import'); } catch { /* no-op */ }
    }
    setActiveTab(tab); setIsSearchOpen(false); setIsMobileMenuOpen(false); setIsNotificationsOpen(false); setIsProfileOpen(false); setSearchQuery('');
  };
  const navigateToItem = (item: NavigationItem) => {
    if (item.premium && userPlan === 'free') {
      setIsSearchOpen(false); setIsMobileMenuOpen(false); setIsNotificationsOpen(false); setIsProfileOpen(false);
      openUpgradeModal(`${item.label} is an Inkbound Premium feature.`);
      return;
    }
    navigate(item.id);
  };
  const openMobilePlan = () => {
    setIsSearchOpen(false); setIsMobileMenuOpen(false); setIsNotificationsOpen(false); setIsProfileOpen(false);
    if (userPlan === 'free') {
      openUpgradeModal('Explore Inkbound Premium plans and features.');
      return;
    }
    navigate('settings');
  };
  const toggleGroup = (groupId: NavigationGroupId) => setCollapsedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  const markNotificationsRead = () => {
    setNotificationsRead(true);
    setLoanReminderReadIds(loanReminders.map((reminder) => reminder.id));
  };
  const openLoanReminder = (bookId: string) => {
    const book = books.find((candidate) => candidate.id === bookId);
    if (!book) return;
    onSelectBook(book);
    setIsNotificationsOpen(false);
  };
  const renderNavigationItem = (item: NavigationItem, mobile = false) => {
    const Icon = item.icon;
    const premium = item.premium && userPlan === 'free';
    return mobile ? (
      <button key={item.id} type="button" onClick={() => navigateToItem(item)} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-sm font-semibold ${activeTab === item.id ? 'border-[var(--ink-mauve)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>
        <Icon className="h-5 w-5 text-[var(--ink-mauve)]" /><span className="flex-1">{item.label}</span>{premium && <small className="quiet-shelf-premium-pill">Premium</small>}
      </button>
    ) : (
      <button key={item.id} type="button" title={isSidebarCollapsed ? item.label : undefined} onClick={() => navigateToItem(item)} className={`quiet-shelf-sidebar-link ${isSidebarCollapsed ? '!justify-center !gap-0 !px-0' : ''} ${activeTab === item.id ? 'is-active' : ''}`}>
        <Icon />{!isSidebarCollapsed && <span>{item.label}</span>}{!isSidebarCollapsed && premium && <small className="quiet-shelf-premium-pill">Premium</small>}
      </button>
    );
  };

  return <>
    <aside className={`quiet-shelf-sidebar ${isSidebarCollapsed ? '!px-3' : ''}`}>
      <button type="button" onClick={() => setIsSidebarCollapsed((current) => !current)} className="absolute -right-2 top-[76px] z-10 grid h-8 w-4 place-items-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] text-[var(--ink-muted)] shadow-md transition hover:border-[var(--ink-border-strong)] hover:text-[var(--ink-ivory)]" aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {isSidebarCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className={`quiet-shelf-brand ${isSidebarCollapsed ? '!p-0 !pb-4' : ''}`} onClick={() => navigate('home')} title={isSidebarCollapsed ? inkboundBrand.name : undefined}><span className={`quiet-shelf-mark ${isSidebarCollapsed ? '!mb-0 !h-10 !w-10 !rounded-xl' : ''}`} aria-hidden="true"><BookMarked /></span>{!isSidebarCollapsed && <span className="quiet-shelf-brand-copy"><span className="quiet-shelf-brand-name">{inkboundBrand.name}</span><span className="quiet-shelf-tagline">{inkboundBrand.tagline}</span></span>}</button>
      <nav className={`quiet-shelf-sidebar-nav ${isSidebarCollapsed ? '!gap-1 overflow-y-auto' : ''}`} aria-label="Primary navigation">
        {renderNavigationItem(homeItem)}
        {visibleNavigationGroups.map((group) => {
          if (isSidebarCollapsed) return <section key={group.id} className="mt-2 grid gap-1 border-t border-white/5 pt-2">{group.items.map((item) => renderNavigationItem(item))}</section>;
          const isCollapsed = collapsedGroups[group.id] ?? false;
          const containsActiveItem = group.items.some((item) => item.id === activeTab);
          return <section key={group.id} className="mt-3"><button type="button" onClick={() => toggleGroup(group.id)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.18em] ${containsActiveItem ? 'text-[var(--ink-mauve)]' : 'text-[var(--ink-muted)]'}`} aria-expanded={!isCollapsed}><span>{group.label}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} /></button>{!isCollapsed && <div className="grid gap-1">{group.items.map((item) => renderNavigationItem(item))}</div>}</section>;
        })}
      </nav>
      {!isSidebarCollapsed && (userPlan === 'free' ? <section className="quiet-shelf-plan-card"><div className="quiet-shelf-plan-heading"><span>Free Plan</span><button type="button" onClick={() => openUpgradeModal('Explore Inkbound Premium')}>See Plans</button></div><p className="quiet-shelf-plan-count"><strong>Unlimited</strong> books included</p><p className="quiet-shelf-plan-remaining">{books.length} books currently in your library</p><button type="button" className="quiet-shelf-upgrade-button" onClick={() => openUpgradeModal('Premium adds advanced insights, Wrapped, Year in Books, and historical shelf views.')}><Sparkles />Upgrade to Premium</button></section> : <section className="quiet-shelf-plan-card is-premium"><Sparkles /><div><strong>Inkbound Premium</strong><p>Advanced insights and power tools</p></div></section>)}
      <div className="relative"><button type="button" title={isSidebarCollapsed ? displayName : undefined} className={`quiet-shelf-profile w-full ${isSidebarCollapsed ? '!justify-center !px-0' : ''}`} onClick={() => { setIsProfileOpen((current) => !current); setIsNotificationsOpen(false); }} aria-expanded={isProfileOpen} aria-haspopup="menu">{avatarImage ? <img src={avatarImage} alt="" className="quiet-shelf-avatar object-cover" referrerPolicy="no-referrer" /> : <span className="quiet-shelf-avatar">{initials}</span>}{!isSidebarCollapsed && <><span className="quiet-shelf-profile-copy"><strong>{displayName}</strong><small>{user ? 'View Profile' : 'Connect account'}</small></span><ChevronDown className={`h-4 w-4 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} /></>}</button>{isProfileOpen && <div className={`absolute bottom-full z-[90] mb-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-2 shadow-2xl ${isSidebarCollapsed ? 'left-12 w-56' : 'left-0 w-full'}`} role="menu"><button type="button" role="menuitem" onClick={() => navigate('profile')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-[var(--ink-muted)] hover:bg-[var(--ink-surface-soft)] hover:text-[var(--ink-ivory)]"><UserRound className="h-4 w-4 text-[var(--ink-mauve)]" />Profile & account</button>{isAdmin && <button type="button" role="menuitem" onClick={() => navigate('admin')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-[var(--ink-muted)] hover:bg-[var(--ink-surface-soft)] hover:text-[var(--ink-ivory)]"><ShieldCheck className="h-4 w-4 text-[var(--ink-mauve)]" />Administration</button>}<button type="button" role="menuitem" onClick={() => navigate('my-dragon')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-[var(--ink-muted)] hover:bg-[var(--ink-surface-soft)] hover:text-[var(--ink-ivory)]"><Sparkles className="h-4 w-4 text-[var(--ink-mauve)]" />My Dragon</button></div>}</div>
    </aside>

    <header className="quiet-shelf-topbar"><div className="quiet-shelf-page-heading"><h1>{activeLabel}</h1></div><div className="quiet-shelf-header-search"><Search /><input value={searchQuery} onFocus={() => setIsSearchOpen(true)} onChange={(event) => { setSearchQuery(event.target.value); setIsSearchOpen(true); }} placeholder="Search books, authors, series, notes..." aria-label="Search library" /><kbd>⌘ K</kbd>{isSearchOpen && <div className="quiet-shelf-search-panel"><div className="quiet-shelf-search-panel-heading"><span>Search your library</span><button type="button" onClick={() => setIsSearchOpen(false)} aria-label="Close search"><X /></button></div>{!normalizedQuery ? <p className="quiet-shelf-search-empty">Start typing to search your books.</p> : searchResults.length === 0 ? <p className="quiet-shelf-search-empty">No matching books found.</p> : searchResults.map((book) => <button key={book.id} type="button" className="quiet-shelf-search-result" onClick={() => { onSelectBook(book); setSearchQuery(''); setIsSearchOpen(false); }}><span className={`quiet-shelf-search-cover bg-gradient-to-br ${book.editions[0]?.coverGradient || 'from-purple-950 to-stone-950'}`}>{book.work.title.charAt(0)}</span><span><strong>{book.work.title}</strong><small>{book.work.author}</small></span></button>)}</div>}</div>
      <div className="quiet-shelf-actions relative"><div className="relative"><button type="button" className="quiet-shelf-icon-button relative" aria-label="Notifications" aria-expanded={isNotificationsOpen} onClick={() => { setIsNotificationsOpen((current) => !current); setIsProfileOpen(false); }}><Bell />{hasUnreadNotifications && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--ink-mauve)]" />}</button>{isNotificationsOpen && <div className="absolute right-0 top-full z-[100] mt-3 max-h-[min(70dvh,560px)] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 shadow-2xl"><div className="flex items-center justify-between"><strong className="font-serif text-lg text-[var(--ink-ivory)]">Notifications</strong><button type="button" onClick={markNotificationsRead} className="text-xs text-[var(--ink-mauve)]">Mark read</button></div>{loanReminders.length > 0 && <div className="mt-3 border-b border-[var(--ink-border-subtle)] pb-2"><p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-gold)]">Library returns</p>{loanReminders.map((reminder) => <button key={reminder.id} type="button" onClick={() => openLoanReminder(reminder.bookId)} className="flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-[var(--ink-surface-soft)]"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-gold)]" /><span className="min-w-0"><strong className="block text-sm text-[var(--ink-ivory)]">{reminder.headline}</strong><small className="text-[var(--ink-muted)]">{reminder.detail}</small></span>{!loanReminderReadIds.includes(reminder.id) && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ink-mauve)]" />}</button>)}</div>}<button type="button" onClick={() => navigate('sessions')} className="mt-2 flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-[var(--ink-surface-soft)]"><Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" /><span><strong className="block text-sm text-[var(--ink-ivory)]">{currentlyReadingCount} books in progress</strong><small className="text-[var(--ink-muted)]">Continue a reading session.</small></span></button><button type="button" onClick={() => navigate('tbr')} className="flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-[var(--ink-surface-soft)]"><Bookmark className="h-4 w-4 text-[var(--ink-mauve)]" /><span><strong className="block text-sm text-[var(--ink-ivory)]">{tbrCount} books waiting</strong><small className="text-[var(--ink-muted)]">Choose what comes next.</small></span></button></div>}</div><button type="button" className="quiet-shelf-icon-button" onClick={() => { setIsDarkMode((current) => !current); setIsNotificationsOpen(false); }} aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}>{isDarkMode ? <Moon /> : <Sun />}</button><button type="button" onClick={onOpenTimer} className="quiet-shelf-secondary-action"><Clock3 /><span>Start Session</span></button><button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action"><Plus /><span>Add Book</span></button></div>
    </header>

    {isMobileMenuOpen && <div className="fixed inset-0 z-[120] flex items-end bg-black/70 px-[max(0.75rem,env(safe-area-inset-left))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm lg:hidden" onClick={() => setIsMobileMenuOpen(false)}><section className="inkbound-panel flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full flex-col overflow-hidden rounded-3xl p-5" role="dialog" aria-modal="true" aria-label="More navigation options" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-[var(--ink-border-subtle)] pb-4"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">More</h2><button type="button" className="quiet-shelf-icon-button h-11 w-11" onClick={() => setIsMobileMenuOpen(false)} aria-label="Close more navigation"><X /></button></div><div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">{mobileNavigationGroups.map((group) => <section key={group.id}><h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">{group.label}</h3><div className="grid gap-2">{group.items.map((item) => renderNavigationItem(item, true))}</div></section>)}<section><h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Profile</h3><button type="button" onClick={() => navigate('profile')} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--ink-border-subtle)] px-4 text-left text-sm font-semibold text-[var(--ink-muted)]"><UserRound className="h-5 w-5 text-[var(--ink-mauve)]" />Profile & account</button></section></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--ink-border-subtle)] pt-4"><button type="button" onClick={() => { setIsMobileMenuOpen(false); onOpenTimer(); }} className="quiet-shelf-secondary-action justify-center"><Clock3 />Start Session</button><button type="button" onClick={() => { setIsMobileMenuOpen(false); onOpenAddBook(); }} className="quiet-shelf-primary-action justify-center"><Plus />Add Book</button></div></section></div>}

    <nav className="quiet-shelf-mobile-nav" aria-label="Mobile navigation">{mobilePrimaryItems.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => navigateToItem(item)} className={activeTab === item.id ? 'is-active' : ''}><Icon /><span>{item.label}</span></button>; })}<button type="button" onClick={openMobilePlan} className={userPlan === 'premium' && activeTab === 'settings' ? 'is-active' : ''} aria-label={userPlan === 'free' ? 'View Premium plans' : 'View subscription settings'}><Sparkles /><span>{userPlan === 'free' ? 'Premium' : 'Plan'}</span></button><button type="button" onClick={() => setIsMobileMenuOpen(true)} className={isMoreSectionActive || activeTab === 'profile' ? 'is-active' : ''}><MoreHorizontal /><span>More</span></button></nav>
  </>;
};