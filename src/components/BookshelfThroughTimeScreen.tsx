import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Download, Eye, Repeat2, Share2, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { getEffectivePagesReadForPeriod } from '../features/reading/readingPageTotals';
import { getAverageBookRating } from '../features/reading/readingReportStats';
import { usePersistentState } from '../hooks/usePersistentState';
import { getEffectiveRereadCount } from '../features/reading/bookReadingState';
import {
  canonicalReadingDateKey,
  getTrustworthyFinishedBooks,
  readingMonthKey,
} from '../features/reading/inkboundActivity';
import { localDateKey } from '../features/reading/sessionAnalytics';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';
import { fetchRuntimeMediaDataUrl } from '../platform/runtimeMedia';

interface BookshelfThroughTimeScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
}

type ShelfTheme = 'quiet-library' | 'cozy-evening' | 'midnight-study';

interface ShelfPreferences {
  month: string;
  theme: ShelfTheme;
  showRatings: boolean;
  showRereads?: boolean;
  showStats: boolean;
  highlightNew?: boolean;
}

const PREFERENCES_KEY = 'inkbound_bookshelf_through_time_preferences';
const BOOKS_PER_SHELF = 12;
const MINIMUM_SHELF_ROWS = 3;
const SHELVES_PER_PAGE = 4;

const themeClasses: Record<ShelfTheme, string> = {
  'quiet-library': 'from-stone-950 via-[#302923] to-[#171411]',
  'cozy-evening': 'from-[#3a241c] via-[#5a3929] to-[#211713]',
  'midnight-study': 'from-[#171825] via-[#26283a] to-[#101119]',
};

const themeBackgroundImages: Record<ShelfTheme, string> = {
  'quiet-library': '/assets/library/cozy-bookshelf-background.png',
  'cozy-evening': '/assets/library/cozy-bookshelf-background.png',
  'midnight-study': '/assets/library/cozy-bookshelf-background.png',
};

const shelfWoodClasses: Record<ShelfTheme, string> = {
  'quiet-library': 'from-[#8a5b3f] via-[#68432f] to-[#4a3024]',
  'cozy-evening': 'from-[#a76b43] via-[#7d4c31] to-[#543120]',
  'midnight-study': 'from-[#5d493e] via-[#42352f] to-[#2d2726]',
};

function monthLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'Reading Shelf';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return 'Reading Shelf';
  return new Date(year, month - 1, 1, 12, 0, 0, 0).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function getShelfBookDimensions(book: UserBookRecord, index: number) {
  const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const pages = edition?.pageCount ?? 300;
  const format = edition?.format;
  const heightBase = format === 'hardcover' ? 102 : format === 'audiobook' ? 88 : format === 'ebook' ? 92 : 96;
  const height = Math.max(82, Math.min(122, heightBase + ((book.work.title.length + index * 7) % 17) - 8));
  const widthBase = format === 'hardcover' ? 62 : format === 'paperback' ? 57 : format === 'audiobook' ? 54 : 56;
  const width = Math.max(50, Math.min(68, widthBase + Math.round((Math.min(700, pages) - 300) / 100)));
  return { height, width };
}

export const BookshelfThroughTimeScreen: React.FC<BookshelfThroughTimeScreenProps> = ({
  books,
  sessions,
  onSelectBook,
}) => {
  const finishedBooks = useMemo(
    () =>
      getTrustworthyFinishedBooks(books)
        .sort((a, b) => (canonicalReadingDateKey(a.dateFinished) ?? '').localeCompare(canonicalReadingDateKey(b.dateFinished) ?? '')),
    [books],
  );

  const availableMonths = useMemo(() => {
    const months = Array.from(
      new Set(
        finishedBooks
          .map((book) => readingMonthKey(book.dateFinished))
          .filter((month): month is string => Boolean(month)),
      ),
    ).sort();
    const currentMonth = localDateKey().slice(0, 7);
    return months.length > 0 ? months : [currentMonth];
  }, [finishedBooks]);

  const [preferences, setPreferences] = usePersistentState<ShelfPreferences>(PREFERENCES_KEY, {
    month: availableMonths[availableMonths.length - 1],
    theme: 'quiet-library',
    showRatings: true,
    showRereads: true,
    showStats: true,
    highlightNew: true,
  });
  const [shelfPage, setShelfPage] = useState(0);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const selectedMonth = availableMonths.includes(preferences.month)
    ? preferences.month
    : availableMonths[availableMonths.length - 1];
  const selectedIndex = Math.max(0, availableMonths.indexOf(selectedMonth));
  const shelfBooks = finishedBooks.filter((book) => readingMonthKey(book.dateFinished) === selectedMonth);
  const booksFinishedThisMonth = shelfBooks;
  const shelfRowCount = Math.max(MINIMUM_SHELF_ROWS, Math.ceil(shelfBooks.length / BOOKS_PER_SHELF));
  const shelfPageCount = Math.max(1, Math.ceil(shelfRowCount / SHELVES_PER_PAGE));
  const safeShelfPage = Math.min(shelfPage, shelfPageCount - 1);
  const pageStartShelf = safeShelfPage * SHELVES_PER_PAGE;
  const visibleShelfCount = Math.min(SHELVES_PER_PAGE, shelfRowCount - pageStartShelf);
  const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number);
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = `${selectedMonth}-${String(new Date(selectedYear, selectedMonthNumber, 0).getDate()).padStart(2, '0')}`;
  // Match Reading Wrapped: report pages read during this calendar month using
  // the canonical session/history calculation, not full edition page counts.
  const totalPages = getEffectivePagesReadForPeriod(books, sessions, monthStart, monthEnd);
  const averageRating = getAverageBookRating(shelfBooks) ?? 0;
  const highlightNew = preferences.highlightNew !== false;
  const showRereads = preferences.showRereads !== false;
  const themeBackgroundImage = themeBackgroundImages[preferences.theme];

  useEffect(() => {
    setShelfPage(0);
  }, [selectedMonth]);

  const updatePreference = <K extends keyof ShelfPreferences>(key: K, value: ShelfPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const moveMonth = (direction: -1 | 1) => {
    const nextIndex = Math.min(availableMonths.length - 1, Math.max(0, selectedIndex + direction));
    updatePreference('month', availableMonths[nextIndex]);
  };

  const createShelfPng = async () => {
    const width = 1600;
    const rowHeight = 225;
    const headerHeight = 235;
    const statsHeight = preferences.showStats ? 145 : 55;
    const rows = Math.max(MINIMUM_SHELF_ROWS, Math.ceil(shelfBooks.length / BOOKS_PER_SHELF));
    const height = headerHeight + rows * rowHeight + statsHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the shelf image.');

    const palettes: Record<ShelfTheme, { top: string; bottom: string; wood: string; accent: string }> = {
      'quiet-library': { top: '#302923', bottom: '#171411', wood: '#68432f', accent: '#c5a059' },
      'cozy-evening': { top: '#5a3929', bottom: '#211713', wood: '#7d4c31', accent: '#d29a6d' },
      'midnight-study': { top: '#26283a', bottom: '#101119', wood: '#42352f', accent: '#d2ae68' },
    };
    const palette = palettes[preferences.theme];
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette.top);
    gradient.addColorStop(1, palette.bottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const backgroundData = await fetchRuntimeMediaDataUrl(themeBackgroundImage);
    if (backgroundData) {
      try {
        const background = new Image();
        background.src = backgroundData;
        await background.decode();
        context.save();
        context.globalAlpha = 0.32;
        const scale = Math.max(width / background.width, height / background.height);
        const drawWidth = background.width * scale;
        const drawHeight = background.height * scale;
        context.drawImage(background, (width - drawWidth) / 2, 0, drawWidth, drawHeight);
        context.restore();
      } catch {
        // The themed gradient remains the canonical fallback if bundled art cannot be decoded.
      }
    }

    context.fillStyle = 'rgba(0,0,0,.18)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(255,255,255,.62)';
    context.font = '600 24px Arial, sans-serif';
    context.fillText(monthLabel(selectedMonth).toUpperCase(), 72, 76);
    context.fillStyle = '#ffffff';
    context.font = '54px Georgia, serif';
    context.fillText('Your Reading Shelf', 72, 142);
    context.fillStyle = 'rgba(255,255,255,.58)';
    context.font = '22px Arial, sans-serif';
    context.fillText('Every book here was finished in this month.', 72, 184);
    context.fillStyle = palette.accent;
    context.font = '700 22px Arial, sans-serif';
    context.textAlign = 'right';
    context.fillText(`${shelfBooks.length.toLocaleString()} books`, width - 72, 88);
    context.textAlign = 'left';

    const coverData = await Promise.all(shelfBooks.map(async (book) => {
      const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
      const dataUrl = edition?.coverUrl ? await fetchRuntimeMediaDataUrl(edition.coverUrl) : '';
      return { book, dataUrl };
    }));

    for (let row = 0; row < rows; row += 1) {
      const rowBooks = coverData.slice(row * BOOKS_PER_SHELF, row * BOOKS_PER_SHELF + BOOKS_PER_SHELF);
      const shelfY = headerHeight + row * rowHeight + 165;
      const gap = 22;
      const availableWidth = width - 144;
      const slotWidth = availableWidth / BOOKS_PER_SHELF;
      for (let index = 0; index < rowBooks.length; index += 1) {
        const { book, dataUrl } = rowBooks[index];
        const { height: uiHeight, width: uiWidth } = getShelfBookDimensions(book, row * BOOKS_PER_SHELF + index);
        const bookHeight = Math.round(118 + (uiHeight - 82) * 1.15);
        const bookWidth = Math.max(64, Math.min(92, Math.round(bookHeight * (uiWidth / Math.max(uiHeight, 1)))));
        const x = 72 + index * slotWidth + Math.max(0, (slotWidth - bookWidth - gap / 2) / 2);
        const y = shelfY - bookHeight;
        context.save();
        context.shadowColor = 'rgba(0,0,0,.55)';
        context.shadowBlur = 16;
        context.shadowOffsetX = 6;
        context.shadowOffsetY = 8;
        if (dataUrl) {
          try {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            context.drawImage(image, x, y, bookWidth, bookHeight);
          } catch {
            context.fillStyle = '#60495a';
            context.fillRect(x, y, bookWidth, bookHeight);
          }
        } else {
          const fallback = context.createLinearGradient(x, y, x + bookWidth, y + bookHeight);
          fallback.addColorStop(0, '#76586d');
          fallback.addColorStop(1, '#30242d');
          context.fillStyle = fallback;
          context.fillRect(x, y, bookWidth, bookHeight);
          context.fillStyle = 'rgba(255,255,255,.16)';
          context.fillRect(x, y, 4, bookHeight);
          context.fillStyle = '#fff';
          context.font = '600 11px Arial, sans-serif';
          context.textAlign = 'center';
          const title = book.work.title.length > 18 ? `${book.work.title.slice(0, 17)}…` : book.work.title;
          context.fillText(title, x + bookWidth / 2, y + bookHeight / 2 - 5);
          context.fillStyle = 'rgba(255,255,255,.68)';
          context.font = '9px Arial, sans-serif';
          const author = book.work.author.length > 18 ? `${book.work.author.slice(0, 17)}…` : book.work.author;
          context.fillText(author, x + bookWidth / 2, y + bookHeight / 2 + 13);
          context.textAlign = 'left';
        }
        context.restore();

        const totalReads = getEffectiveRereadCount(book) + 1;
        const ratingLabel = preferences.showRatings && book.rating ? `★ ${book.rating}` : '';
        const rereadLabel = showRereads && totalReads > 1 ? `×${totalReads}` : '';
        const bookBadgeLabel = [ratingLabel, rereadLabel].filter(Boolean).join(' · ');
        if (bookBadgeLabel) {
          context.fillStyle = 'rgba(0,0,0,.82)';
          const badgeWidth = Math.max(48, context.measureText(bookBadgeLabel).width + 12);
          context.fillRect(x + bookWidth - badgeWidth, shelfY - 25, badgeWidth, 25);
          context.fillStyle = '#f8d889';
          context.font = '700 14px Arial, sans-serif';
          context.fillText(bookBadgeLabel, x + bookWidth - badgeWidth + 5, shelfY - 8);
        }
      }

      context.fillStyle = palette.wood;
      context.fillRect(72, shelfY, width - 144, 16);
      context.fillStyle = 'rgba(0,0,0,.38)';
      context.fillRect(82, shelfY + 16, width - 164, 8);
    }

    if (preferences.showStats) {
      const statsY = headerHeight + rows * rowHeight + 32;
      context.fillStyle = 'rgba(0,0,0,.28)';
      context.fillRect(72, statsY, width - 144, 82);
      const stats = [
        [String(shelfBooks.length), 'Books this month'],
        [String(booksFinishedThisMonth.length), 'Finished this month'],
        [totalPages.toLocaleString(), 'Pages read'],
        [averageRating ? averageRating.toFixed(1) : '—', 'Average rating'],
      ];
      stats.forEach(([value, label], index) => {
        const x = 72 + ((width - 144) / 4) * (index + 0.5);
        context.textAlign = 'center';
        context.fillStyle = '#fff';
        context.font = '34px Georgia, serif';
        context.fillText(value, x, statsY + 38);
        context.fillStyle = 'rgba(255,255,255,.58)';
        context.font = '15px Arial, sans-serif';
        context.fillText(label, x, statsY + 64);
      });
      context.textAlign = 'left';
    }

    context.fillStyle = 'rgba(255,255,255,.48)';
    context.font = '600 17px Arial, sans-serif';
    context.textAlign = 'right';
    context.fillText('Created with Inkbound', width - 72, height - 22);
    context.textAlign = 'left';

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create the shelf PNG.')), 'image/png', 1);
    });
    const slug = selectedMonth.replace(/[^0-9-]+/g, '');
    return { filename: `inkbound-reading-shelf-${slug}.png`, blob };
  };

  const shareShelf = async () => {
    setShareMessage(null);
    try {
      const { filename, blob } = await createShelfPng();
      const result = await shareRuntimeBinaryFile({
        filename,
        mimeType: 'image/png',
        contents: blob,
        title: `My ${monthLabel(selectedMonth)} Inkbound shelf`,
        text: `I finished ${shelfBooks.length} ${shelfBooks.length === 1 ? 'book' : 'books'} in ${monthLabel(selectedMonth)}. Made with Inkbound.`,
      });
      setShareMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the shelf was saved instead.');
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'Sharing was cancelled.');
    }
  };

  const saveShelf = async () => {
    setShareMessage(null);
    try {
      const { filename, blob } = await createShelfPng();
      await exportRuntimeBinaryFile({ filename, mimeType: 'image/png', contents: blob });
      setShareMessage('Shelf image saved.');
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'Could not save the shelf image.');
    }
  };

  return (
    <section className="space-y-6 pb-12">
      <header className="inkbound-panel overflow-hidden rounded-3xl p-5 sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <span className="inkbound-eyebrow">A living record of your reading year</span>
            <h2 className="mt-2 font-serif text-3xl text-[var(--ink-ivory)] sm:text-4xl">Bookshelf Through Time</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
              Move through the months and see the books you finished in each part of your reading year.
            </p>
          </div>
          <div className="flex min-w-0 w-full flex-wrap items-center gap-2 xl:w-auto">
            <button type="button" onClick={() => void shareShelf()} disabled={shelfBooks.length === 0} className="quiet-shelf-primary-action min-h-11 shrink-0 justify-center disabled:opacity-40"><Share2 className="h-4 w-4" /> Share Shelf</button>
            <button type="button" onClick={() => void saveShelf()} disabled={shelfBooks.length === 0} className="quiet-shelf-secondary-action min-h-11 shrink-0 justify-center disabled:opacity-40" aria-label="Save shelf PNG"><Download className="h-4 w-4" /> Save PNG</button>
            <button type="button" onClick={() => moveMonth(-1)} disabled={selectedIndex <= 0} className="quiet-shelf-icon-button shrink-0 disabled:opacity-30" aria-label="Previous month"><ChevronLeft /></button>
            <div className="min-w-0 flex-1 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 py-2 text-center xl:min-w-48 xl:flex-none xl:px-4">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--ink-muted)] sm:text-xs">Shelf snapshot</span>
              <strong className="block truncate font-serif text-base text-[var(--ink-ivory)] sm:text-lg">{monthLabel(selectedMonth)}</strong>
            </div>
            <button type="button" onClick={() => moveMonth(1)} disabled={selectedIndex >= availableMonths.length - 1} className="quiet-shelf-icon-button shrink-0 disabled:opacity-30" aria-label="Next month"><ChevronRight /></button>
          </div>
        </div>
      </header>
      {shareMessage && <p role="status" className="px-1 text-sm text-[var(--ink-muted)]">{shareMessage}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className={`inkbound-themed-preview relative min-h-[560px] min-w-0 overflow-hidden rounded-3xl bg-gradient-to-br ${themeClasses[preferences.theme]} p-4 shadow-2xl sm:p-8`}>
          {themeBackgroundImage && (
            <div
              className="pointer-events-none absolute inset-0 bg-cover bg-top opacity-55"
              style={{ backgroundImage: `url("${themeBackgroundImage}")` }}
              aria-hidden="true"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-black/10" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,.13), transparent 42%), linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px)', backgroundSize: 'auto, 100% 28px' }} />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.035] to-transparent" />

          <div className="relative z-10 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <span className="block truncate text-xs uppercase tracking-[0.24em] text-white/60">{monthLabel(selectedMonth)}</span>
              <h3 className="mt-1 font-serif text-2xl text-white sm:text-3xl">Your Reading Shelf</h3>
              <p className="mt-2 text-xs text-white/45">Every book here was finished in this month.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-2 text-xs text-white/60 backdrop-blur-sm">
              <Sparkles className="h-4 w-4 text-[var(--ink-gold-bright)]" />
              <span>{shelfBooks.length.toLocaleString()} books</span>
            </div>
          </div>

          <div className="relative z-10 mt-8 space-y-7">
            {Array.from({ length: visibleShelfCount }, (_, visibleShelfIndex) => {
              const shelfIndex = pageStartShelf + visibleShelfIndex;
              const shelfSlice = shelfBooks.slice(shelfIndex * BOOKS_PER_SHELF, shelfIndex * BOOKS_PER_SHELF + BOOKS_PER_SHELF);
              return (
                <div key={shelfIndex} className="min-w-0">
                  <div className="overflow-x-auto overflow-y-visible overscroll-x-contain px-1 pb-1 sm:px-2">
                    <div className="bookshelf-row flex min-h-36 min-w-full w-max items-end gap-2 sm:gap-3">
                      {shelfSlice.map((book, index) => {
                        const isNewThisMonth = readingMonthKey(book.dateFinished) === selectedMonth;
                        const { height, width } = getShelfBookDimensions(book, index);
                        const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
                        const coverUrl = edition?.coverUrl;
                        const fallbackGradient = edition?.coverGradient ?? 'from-[#76586d] to-[#30242d]';
                        const spineWidth = Math.max(12, Math.round(width * 0.24));
                        const faceWidth = width - spineWidth + 1;

                        return (
                          <button
                            key={book.id}
                            type="button"
                            onClick={() => onSelectBook(book)}
                            title={`${book.work.title} by ${book.work.author}`}
                            aria-label={`Open ${book.work.title} by ${book.work.author}`}
                            className={`group relative flex shrink-0 items-end transition-all duration-200 hover:-translate-y-2 focus-visible:-translate-y-2 ${isNewThisMonth && highlightNew ? 'drop-shadow-[0_0_10px_rgba(218,178,96,.28)]' : ''}`}
                            style={{ height, width }}
                          >
                            <span
                              className={`relative z-20 flex h-full shrink-0 items-center justify-center overflow-hidden rounded-l-[3px] border border-white/15 bg-gradient-to-b ${fallbackGradient} shadow-lg`}
                              style={{
                                width: spineWidth,
                                backgroundImage: coverUrl
                                  ? `linear-gradient(rgba(0,0,0,.32), rgba(0,0,0,.5)), url("${coverUrl}")`
                                  : undefined,
                                backgroundSize: coverUrl ? 'auto 100%' : undefined,
                                backgroundPosition: coverUrl ? 'left center' : undefined,
                              }}
                              aria-hidden="true"
                            >
                              <span className="max-w-[92px] -rotate-90 whitespace-nowrap text-[7px] font-semibold tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.9)]">
                                {book.work.title.length > 22 ? `${book.work.title.slice(0, 21)}…` : book.work.title}
                              </span>
                            </span>

                            <span
                              className={`relative z-10 -ml-px block overflow-hidden rounded-r-[3px] border border-white/15 bg-gradient-to-b ${fallbackGradient} shadow-[5px_7px_14px_rgba(0,0,0,.42)] transition-transform duration-200 group-hover:translate-x-1 group-hover:-rotate-1 group-focus-visible:translate-x-1`}
                              style={{ height: Math.max(64, height - 4), width: faceWidth }}
                            >
                              {coverUrl ? (
                                <img
                                  src={coverUrl}
                                  alt={`Cover of ${book.work.title}`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="flex h-full w-full flex-col items-center justify-center px-1 text-center">
                                  <span className="line-clamp-3 font-serif text-[7px] font-semibold leading-tight text-white">{book.work.title}</span>
                                  <span className="mt-1 line-clamp-2 text-[6px] text-white/65">{book.work.author}</span>
                                </span>
                              )}
                              <span className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/20" />
                              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent" />
                            </span>

                            {((preferences.showRatings && book.rating) || (showRereads && getEffectiveRereadCount(book) > 0)) && (
                              <span className="absolute -bottom-1 right-0 z-30 rounded-md border border-white/10 bg-black/75 px-1.5 py-0.5 text-[8px] font-bold text-amber-200 shadow">
                                {preferences.showRatings && book.rating ? `★ ${book.rating}` : ''}{preferences.showRatings && book.rating && showRereads && getEffectiveRereadCount(book) > 0 ? ' · ' : ''}{showRereads && getEffectiveRereadCount(book) > 0 ? `×${getEffectiveRereadCount(book) + 1}` : ''}
                              </span>
                            )}
                            {isNewThisMonth && highlightNew && (
                              <span className="absolute -top-2 right-0 z-30 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/50 bg-[var(--ink-gold-bright)] text-[8px] font-black text-[#281b13] shadow-[0_0_12px_rgba(218,178,96,.55)]" title="Finished this month">+</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="relative h-5">
                    <div className={`absolute inset-x-0 top-0 h-3 rounded-sm border-t border-white/20 bg-gradient-to-b ${shelfWoodClasses[preferences.theme]} shadow-[0_10px_18px_rgba(0,0,0,.46)]`} />
                    <div className="absolute inset-x-1 top-3 h-1.5 rounded-b-sm bg-black/30 blur-[1px]" />
                  </div>
                </div>
              );
            })}
          </div>

          {shelfPageCount > 1 && (
            <div className="relative z-10 mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShelfPage((current) => Math.max(0, current - 1))}
                disabled={safeShelfPage <= 0}
                className="quiet-shelf-icon-button disabled:opacity-30"
                aria-label="Previous shelf page"
              >
                <ChevronLeft />
              </button>
              <div className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs text-white/60 backdrop-blur-sm">
                Shelves {pageStartShelf + 1}–{Math.min(pageStartShelf + visibleShelfCount, shelfRowCount)} of {shelfRowCount}
              </div>
              <button
                type="button"
                onClick={() => setShelfPage((current) => Math.min(shelfPageCount - 1, current + 1))}
                disabled={safeShelfPage >= shelfPageCount - 1}
                className="quiet-shelf-icon-button disabled:opacity-30"
                aria-label="Next shelf page"
              >
                <ChevronRight />
              </button>
            </div>
          )}

          {preferences.showStats && (
            <div className="relative z-10 mt-8 grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-center backdrop-blur-sm sm:grid-cols-4">
              <div><strong className="block font-serif text-2xl text-white">{shelfBooks.length}</strong><span className="text-xs text-white/55">Books this month</span></div>
              <div><strong className="block font-serif text-2xl text-white">{booksFinishedThisMonth.length}</strong><span className="text-xs text-white/55">Finished this month</span></div>
              <div><strong className="block font-serif text-2xl text-white">{totalPages.toLocaleString()}</strong><span className="text-xs text-white/55">Pages represented</span></div>
              <div><strong className="block font-serif text-2xl text-white">{averageRating ? averageRating.toFixed(1) : '—'}</strong><span className="text-xs text-white/55">Average rating</span></div>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="inkbound-panel rounded-3xl p-5">
            <span className="inkbound-eyebrow">Shelf appearance</span>
            <div className="mt-4 space-y-2">
              {([
                ['quiet-library', 'Quiet Library'],
                ['cozy-evening', 'Cozy Evening'],
                ['midnight-study', 'Midnight Study'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => updatePreference('theme', value)} className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold transition ${preferences.theme === value ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,.07)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'}`}>
                  {label}{preferences.theme === value && <Sparkles className="h-4 w-4 text-[var(--ink-gold)]" />}
                </button>
              ))}
            </div>
          </section>

          <section className="inkbound-panel rounded-3xl p-5">
            <span className="inkbound-eyebrow">Display</span>
            <label className="mt-4 flex min-h-11 items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex min-w-0 items-center gap-2"><Eye className="h-4 w-4 shrink-0" />Show ratings on books</span><input type="checkbox" checked={preferences.showRatings} onChange={(event) => updatePreference('showRatings', event.target.checked)} /></label>
            <label className="mt-3 flex min-h-11 items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex min-w-0 items-center gap-2"><Repeat2 className="h-4 w-4 shrink-0" />Show reread counts</span><input type="checkbox" checked={showRereads} onChange={(event) => updatePreference('showRereads', event.target.checked)} /></label>
            <label className="mt-3 flex min-h-11 items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex min-w-0 items-center gap-2"><Sparkles className="h-4 w-4 shrink-0" />Highlight this month</span><input type="checkbox" checked={highlightNew} onChange={(event) => updatePreference('highlightNew', event.target.checked)} /></label>
            <label className="mt-3 flex min-h-11 items-center justify-between gap-4 text-sm text-[var(--ink-muted)]"><span className="inline-flex min-w-0 items-center gap-2"><BookOpen className="h-4 w-4 shrink-0" />Show shelf statistics</span><input type="checkbox" checked={preferences.showStats} onChange={(event) => updatePreference('showStats', event.target.checked)} /></label>
          </section>

          <section className="inkbound-panel rounded-3xl p-5">
            <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-gold)]" /><div className="min-w-0"><strong className="block text-sm text-[var(--ink-ivory)]">This shelf snapshot</strong><span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">{booksFinishedThisMonth.length} {booksFinishedThisMonth.length === 1 ? 'book was' : 'books were'} finished in {monthLabel(selectedMonth)}.</span></div></div>
          </section>
        </aside>
      </div>
    </section>
  );
};