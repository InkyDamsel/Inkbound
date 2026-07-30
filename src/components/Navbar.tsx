import React, { useState } from 'react';
import {
  BookOpen,
  Bookmark,
  Home,
  Library,
  Clock,
  BarChart3,
  DownloadCloud,
  Settings,
  Plus,
  Search,
  Moon,
  Sun,
  X,
  Sparkles,
  Filter
} from 'lucide-react';
import { UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';

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


  // Filtered search results across Title, Author, Series, Summary, Tags
  const searchResults = searchQuery.trim()
    ? books.filter((b) => {
        const q = searchQuery.toLowerCase();
        return (
          b.work.title.toLowerCase().includes(q) ||
          b.work.author.toLowerCase().includes(q) ||
          (b.work.seriesName && b.work.seriesName.toLowerCase().includes(q)) ||
          b.work.genres.some((g) => g.toLowerCase().includes(q)) ||
          b.privateTags.some((t) => t.toLowerCase().includes(q)) ||
          (b.editions[0]?.isbn && b.editions[0].isbn.includes(q))
        );
      }).slice(0, 6)
    : [];

  const navItems = [
    { id: 'home' as NavTab, label: 'Home', icon: Home },
    { id: 'library' as NavTab, label: 'My Library', icon: Library },
    { id: 'tbr' as NavTab, label: 'TBR', icon: Bookmark },
    { id: 'sessions' as NavTab, label: 'Sessions', icon: Clock },
    { id: 'stats' as NavTab, label: 'Statistics', icon: BarChart3 },
    { id: 'import' as NavTab, label: 'Import', icon: DownloadCloud },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Main Top Header */}
      <header className="sticky top-0 z-40 bg-[#140a1a]/95 backdrop-blur-md border-b border-[#36213d] dark:border-[#3a2242] shadow-xl transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo Wordmark */}
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setActiveTab('home')}>
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#2a1733] to-[#1c0e24] border border-[#c5a059]/40 flex items-center justify-center text-[#c5a059] shadow-inner group-hover:border-[#e5c158] transition">
                <Bookmark className="w-5 h-5 fill-[#c5a059]/20 text-[#c5a059]" />
              </div>
              <div>
                <span className="font-brand text-xl sm:text-2xl font-bold tracking-wider text-[#f4efe6] group-hover:text-[#e5c158] transition">
                  Reading App
                </span>
                <span className="hidden sm:inline-block ml-2 text-[10px] font-sans tracking-widest text-[#c5a059]/70 uppercase">
                  Personal Journal
                </span>
              </div>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center space-x-1 lg:space-x-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs lg:text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow-md shadow-[#c5a059]/10'
                        : 'text-[#d8c8dc] hover:text-[#f4efe6] hover:bg-[#281532]/70 border border-transparent hover:border-[#c5a059]/20'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-[#120817]' : 'text-[#c5a059]/80'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Actions: Search, Timer, Add Book, Theme Toggle */}
            <div className="flex items-center gap-2">
              {/* Search Toggle / Bar */}
              <div className="relative">
                <button
                  onClick={() => setIsSearchOpen(!isSearchOpen)}
                  className="p-2 rounded-full text-[#5a4e5c] dark:text-[#c4b6c7] hover:bg-[#ebd9c5]/40 dark:hover:bg-[#2d1e30] transition"
                  aria-label="Search Library"
                >
                  <Search className="w-5 h-5" />
                </button>

                {/* Search Dropdown / Overlay */}
                {isSearchOpen && (
                  <div className="absolute right-0 top-12 w-80 sm:w-96 bg-[#f8f4ed] dark:bg-[#221724] border border-[#d8cbb8] dark:border-[#422e45] rounded-xl shadow-2xl p-3 z-50">
                    <div className="flex items-center gap-2 border-b border-[#e2d6c5] dark:border-[#38263b] pb-2">
                      <Search className="w-4 h-4 text-[#849383]" />
                      <input
                        type="text"
                        placeholder="Search title, author, series, tag, ISBN..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                        className="w-full bg-transparent text-sm focus:outline-none text-[#242125] dark:text-stone-100"
                      />
                      {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="text-stone-400 hover:text-stone-600">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Search Results list */}
                    {searchQuery.trim() !== '' && (
                      <div className="mt-2 max-h-72 overflow-y-auto space-y-1">
                        {searchResults.length === 0 ? (
                          <p className="text-xs text-stone-500 py-3 text-center">No matching books found</p>
                        ) : (
                          searchResults.map((book) => (
                            <div
                              key={book.id}
                              onClick={() => {
                                onSelectBook(book);
                                setIsSearchOpen(false);
                                setSearchQuery('');
                              }}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#eedfcb] dark:hover:bg-[#2e1d32] cursor-pointer transition"
                            >
                              <div className={`w-8 h-11 rounded bg-gradient-to-br ${book.editions[0]?.coverGradient || 'from-amber-900 to-stone-900'} shrink-0 flex items-center justify-center text-[10px] text-white font-bold`}>
                                {book.work.title.substring(0, 1)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-[#2e102d] dark:text-stone-100 truncate font-serif">
                                  {book.work.title}
                                </p>
                                <p className="text-[11px] text-[#849383] truncate">{book.work.author}</p>
                              </div>
                              <span className="text-[10px] uppercase font-semibold text-[#c5a059] bg-[#c5a059]/10 px-1.5 py-0.5 rounded">
                                {book.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Plan & Usage Counter Indicator */}
              {userPlan === 'free' ? (
                <button
                  onClick={() => openUpgradeModal('Upgrade to Premium for Unlimited Books')}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#25132f] text-[#f4efe6] hover:bg-[#32193f] border border-[#c5a059]/30 transition"
                  title={`Free Plan: Up to ${freeBookLimit} books allowed`}
                >
                  <span className={`w-2 h-2 rounded-full ${books.length >= freeBookLimit ? 'bg-amber-400 animate-pulse' : 'bg-[#c5a059]'}`} />
                  <span className="font-bold">{books.length} of {freeBookLimit} books used</span>
                </button>
              ) : (
                <button
                  onClick={() => openUpgradeModal('Manage Reading App Premium')}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#c5a059]/15 text-[#e5c158] border border-[#c5a059]/40 hover:bg-[#c5a059]/25 transition"
                  title="Premium Plan: Unlimited books"
                >
                  <Sparkles className="w-3 h-3 text-[#e5c158]" />
                  <span>PREMIUM</span>
                </button>
              )}

              {/* Start Timer Quick Action */}
              <button
                onClick={onOpenTimer}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#25132f] text-[#d8c8dc] hover:text-[#f4efe6] hover:bg-[#32193f] border border-[#c5a059]/20 transition"
                title="Start Reading Session Timer"
              >
                <Clock className="w-4 h-4 text-[#c5a059]" />
                <span>Timer</span>
              </button>

              {/* Add Book Quick Action */}
              <button
                onClick={onOpenAddBook}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-[#c5a059] to-[#d4af37] hover:from-[#d4af37] hover:to-[#e5c158] text-[#120817] shadow-md shadow-[#c5a059]/10 transition"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Book</span>
              </button>

              {/* Theme Toggle */}
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-full text-[#d8c8dc] hover:text-[#f4efe6] hover:bg-[#281532] transition"
                aria-label="Toggle Theme"
              >
                {isDarkMode ? <Sun className="w-5 h-5 text-amber-300" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#140a1a]/95 backdrop-blur-md border-t border-[#36213d] px-2 py-1 flex justify-around items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center py-1 px-2 rounded-lg text-[10px] font-medium transition ${
                isActive
                  ? 'text-[#e5c158] font-bold'
                  : 'text-[#a895ad] hover:text-[#f4efe6]'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'scale-110 text-[#e5c158]' : ''}`} />
              <span className="mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};
