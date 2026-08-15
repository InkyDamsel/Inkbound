import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Download, Share2, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';

interface YearInBooksScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
}

type YearbookTheme = 'quiet-library' | 'winter-study' | 'celestial';
type ExportFormat = 'story' | 'portrait' | 'square';

interface YearbookPreferences {
  year: number;
  page: number;
  theme: YearbookTheme;
  exportFormat: ExportFormat;
}

const STORAGE_KEY = 'inkbound_year_in_books_preferences';

const themes: Record<YearbookTheme, { label: string; background: string; accent: string; text: string }> = {
  'quiet-library': { label: 'Quiet Library', background: '#171217', accent: '#a87d92', text: '#f4ece3' },
  'winter-study': { label: 'Winter Study', background: '#263036', accent: '#b8ced5', text: '#f5f1e9' },
  celestial: { label: 'Celestial', background: '#17192f', accent: '#aaa4df', text: '#f5f2ff' },
};

const exportFormats: Record<ExportFormat, { label: string; width: number; height: number }> = {
  story: { label: 'Story 9:16', width: 1080, height: 1920 },
  portrait: { label: 'Feed 4:5', width: 1080, height: 1350 },
  square: { label: 'Square 1:1', width: 1080, height: 1080 },
};

const dateYear = (value?: string): number | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return year;
};

const formatLocalDate = (value?: string) => {
  if (!value || dateYear(value) === null) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).toLocaleDateString();
};

const getActiveEdition = (book: UserBookRecord) => book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const YearInBooksScreen: React.FC<YearInBooksScreenProps> = ({ books, sessions, onSelectBook }) => {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear]);
    books.forEach((book) => {
      const finishedYear = dateYear(book.dateFinished);
      const startedYear = dateYear(book.dateStarted);
      if (finishedYear !== null) years.add(finishedYear);
      if (startedYear !== null) years.add(startedYear);
    });
    sessions.forEach((session) => {
      const year = dateYear(session.date);
      if (year !== null && getSessionDurationMinutes(session) > 0) years.add(year);
    });
    return [...years].sort((a, b) => b - a);
  }, [books, sessions, currentYear]);

  const [preferences, setPreferences] = usePersistentState<YearbookPreferences>(STORAGE_KEY, {
    year: availableYears[0] ?? currentYear,
    page: 0,
    theme: 'quiet-library',
    exportFormat: 'portrait',
  });
  const [message, setMessage] = useState('');

  const yearBooks = books.filter((book) => book.status === 'finished' && dateYear(book.dateFinished) === preferences.year);
  const yearSessions = sessions.filter((session) => dateYear(session.date) === preferences.year && getSessionDurationMinutes(session) > 0);
  const totalMinutes = yearSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
  const totalPages = yearSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
  const readingDays = new Set(yearSessions.map((session) => session.date)).size;
  const averageSession = yearSessions.length ? Math.round(totalMinutes / yearSessions.length) : 0;
  const ratedYearBooks = yearBooks.filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating));
  const topBook = [...ratedYearBooks].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

  const countValues = (values: string[]) => values.filter(Boolean).reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const topGenre = Object.entries(countValues(yearBooks.flatMap((book) => book.work.genres))).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';
  const topAuthor = Object.entries(countValues(yearBooks.map((book) => book.work.author))).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';
  const topFormat = Object.entries(countValues(yearBooks.map((book) => getActiveEdition(book)?.format ?? 'unknown'))).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No favorite yet';
  const longestBook = [...yearBooks].sort((a, b) => (getActiveEdition(b)?.pageCount ?? 0) - (getActiveEdition(a)?.pageCount ?? 0))[0];

  const pages = [
    { kicker: `${preferences.year} Yearbook`, title: 'Your Year in Books', body: `${yearBooks.length} finished books, ${totalPages.toLocaleString()} canonical pages, and ${Math.round(totalMinutes / 60)} hours spent reading.`, stats: [['Books', yearBooks.length.toString()], ['Pages', totalPages.toLocaleString()], ['Hours', Math.round(totalMinutes / 60).toString()], ['Reading days', readingDays.toString()]] },
    { kicker: 'Your Reading Rhythm', title: yearSessions.length ? `${yearSessions.length} sessions shaped your year` : 'Your reading year is waiting to take shape', body: yearSessions.length ? `Your average completed session lasted ${averageSession} minutes, across ${readingDays} different reading days.` : 'Complete reading sessions and Inkbound will build this yearbook from your real activity.', stats: [['Sessions', yearSessions.length.toString()], ['Average', `${averageSession}m`], ['Longest book', longestBook?.work.title ?? '—'], ['Top format', topFormat]] },
    { kicker: 'Your Story Taste', title: topGenre, body: yearBooks.length ? `${topGenre} defined your finished books, while ${topAuthor} appeared most often on your shelf.` : 'Finish books during this year to reveal the genres and authors that defined it.', stats: [['Favorite genre', topGenre], ['Most-read author', topAuthor], ['Five-star reads', yearBooks.filter((book) => book.rating === 5).length.toString()], ['Reviews written', yearBooks.filter((book) => Boolean(book.review?.trim())).length.toString()]] },
    { kicker: 'Book of the Year', title: topBook?.work.title ?? 'Your favorite is waiting', body: topBook ? `${topBook.work.author}${topBook.rating ? ` · ${topBook.rating} stars` : ''}` : 'Finish and rate books to reveal your annual favorite.', stats: [['Author', topBook?.work.author ?? '—'], ['Rating', topBook?.rating ? `${topBook.rating} / 5` : '—'], ['Finished', formatLocalDate(topBook?.dateFinished)], ['Sessions', topBook ? yearSessions.filter((session) => session.bookId === topBook.id).length.toString() : '0']] },
  ];

  const safePage = Math.min(Math.max(preferences.page, 0), pages.length - 1);
  const page = pages[safePage];
  const theme = themes[preferences.theme] ?? themes['quiet-library'];
  const exportFormat = exportFormats[preferences.exportFormat] ?? exportFormats.portrait;
  const isSquare = preferences.exportFormat === 'square';
  const isStory = preferences.exportFormat === 'story';

  const buildSvg = () => {
    const titleY = isSquare ? 300 : isStory ? 540 : 390;
    const bodyY = isSquare ? 420 : isStory ? 720 : 520;
    const statsStart = isSquare ? 590 : isStory ? 1030 : 760;
    const statGap = isSquare ? 82 : isStory ? 120 : 95;
    const titleSize = isSquare ? 48 : isStory ? 66 : 56;
    const statRows = page.stats.map(([label, value], index) => {
      const y = statsStart + index * statGap;
      return `<text x="12%" y="${y}" fill="${theme.text}" opacity=".68" font-family="Arial,sans-serif" font-size="24">${escapeXml(label)}</text><text x="88%" y="${y}" text-anchor="end" fill="${theme.text}" font-family="Georgia,serif" font-size="${isSquare ? 26 : 30}" font-weight="700">${escapeXml(value.slice(0, isSquare ? 30 : 42))}</text>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${exportFormat.width}" height="${exportFormat.height}" viewBox="0 0 ${exportFormat.width} ${exportFormat.height}">
      <defs><radialGradient id="glow" cx="82%" cy="8%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".58"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="8%" y="7%" width="84%" height="86%" rx="44" fill="none" stroke="${theme.accent}" stroke-opacity=".42" stroke-width="3"/>
      <text x="50%" y="14%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="27" letter-spacing="7">INKBOUND</text>
      <text x="50%" y="23%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="25" letter-spacing="5">${escapeXml(page.kicker.toUpperCase())}</text>
      <foreignObject x="12%" y="${titleY}" width="76%" height="${isSquare ? 120 : 180}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};font:700 ${titleSize}px Georgia,serif;text-align:center;line-height:1.12">${escapeXml(page.title)}</div></foreignObject>
      <foreignObject x="14%" y="${bodyY}" width="72%" height="${isSquare ? 120 : 180}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};opacity:.75;font:${isSquare ? 24 : 28}px Arial,sans-serif;text-align:center;line-height:1.45">${escapeXml(page.body)}</div></foreignObject>
      ${statRows}
      <text x="50%" y="90%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="23">Created with Inkbound</text>
    </svg>`;
  };

  const createPng = async () => {
    const svgBlob = new Blob([buildSvg()], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = exportFormat.width;
      canvas.height = exportFormat.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image export is unavailable.');
      context.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create image.')), 'image/png', 1));
      return new File([blob], `inkbound-${preferences.year}-year-in-books-${safePage + 1}.png`, { type: 'image/png' });
    } finally { URL.revokeObjectURL(url); }
  };

  const download = async () => {
    try {
      const file = await createPng();
      await exportRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file });
      setMessage('Yearbook page saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); }
  };

  const share = async () => {
    try {
      const file = await createPng();
      const result = await shareRuntimeBinaryFile({
        filename: file.name,
        mimeType: 'image/png',
        contents: file,
        title: `${preferences.year} Year in Books`,
        text: 'My reading year, made with Inkbound',
      });
      setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the image was saved instead.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.'); }
  };

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Annual Yearbook</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Year in Books</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">A collectible annual recap built from your real books and reading sessions.</p>
        </div>
        <select value={preferences.year} onChange={(event) => setPreferences((current) => ({ ...current, year: Number(event.target.value), page: 0 }))} className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)] sm:w-auto">
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </header>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="inkbound-panel space-y-5 rounded-3xl p-5 sm:p-6">
          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid gap-2">
              {(Object.entries(themes) as [YearbookTheme, typeof themes[YearbookTheme]][]).map(([id, item]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`} style={{ background: item.background }}>{item.label}</button>)}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Export size</p>
            <div className="mt-2 grid gap-2">
              {(Object.entries(exportFormats) as [ExportFormat, typeof exportFormats[ExportFormat]][]).map(([id, item]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, exportFormat: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm ${preferences.exportFormat === id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item.label}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => void share()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button>
            <button type="button" onClick={() => void download()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> Save PNG</button>
          </div>
          {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel rounded-3xl p-4 sm:p-8">
          <div className={`mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-white/10 shadow-2xl ${isSquare ? 'p-5 sm:p-8' : isStory ? 'p-6 sm:p-12' : 'p-6 sm:p-10'}`} style={{ aspectRatio: `${exportFormat.width} / ${exportFormat.height}`, background: `radial-gradient(circle at top right, ${theme.accent}66, transparent 42%), ${theme.background}`, color: theme.text }}>
            <p className="text-center text-[10px] font-bold uppercase tracking-[0.25em] sm:text-xs sm:tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound · {page.kicker}</p>
            <Sparkles className={`mx-auto ${isSquare ? 'mt-5 h-6 w-6' : isStory ? 'mt-8 h-7 w-7 sm:mt-14 sm:h-9 sm:w-9' : 'mt-7 h-7 w-7 sm:mt-9 sm:h-8 sm:w-8'}`} style={{ color: theme.accent }} />
            <h2 className={`text-center font-serif font-bold leading-tight ${isSquare ? 'mt-4 text-2xl sm:text-4xl' : isStory ? 'mt-6 text-3xl sm:mt-8 sm:text-6xl' : 'mt-5 text-3xl sm:mt-6 sm:text-5xl'}`}>{page.title}</h2>
            <p className={`mx-auto max-w-xl text-center leading-6 opacity-75 ${isSquare ? 'mt-3 text-xs sm:text-sm' : 'mt-4 text-xs sm:mt-5 sm:text-base'}`}>{page.body}</p>
            <div className={`grid gap-2 sm:gap-3 ${isSquare ? 'mt-4 grid-cols-2 sm:mt-5' : isStory ? 'mt-auto grid-cols-1' : 'mt-6 grid-cols-2 sm:mt-8'}`}>
              {page.stats.map(([label, value]) => <div key={label} className={`rounded-2xl border border-white/10 bg-white/5 ${isSquare ? 'p-2 sm:p-3' : 'p-3 sm:p-4'}`}><p className="text-[10px] uppercase tracking-wider opacity-60 sm:text-xs">{label}</p><p className={`${isSquare ? 'mt-1 text-base sm:text-lg' : 'mt-1 text-lg sm:mt-2 sm:text-2xl'} break-words font-serif font-bold`}>{value}</p></div>)}
            </div>
            {safePage === 3 && topBook && <button type="button" onClick={() => onSelectBook(topBook)} className={`${isStory ? 'mt-6 sm:mt-8' : 'mt-4 sm:mt-5'} mx-auto flex min-h-11 items-center gap-2 text-sm font-semibold`} style={{ color: theme.accent }}><BookOpen className="h-4 w-4" /> Open book memory</button>}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={safePage === 0} onClick={() => setPreferences((current) => ({ ...current, page: Math.max(0, current.page - 1) }))} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
            <div className="order-3 flex w-full justify-center gap-2 sm:order-none sm:w-auto" aria-label="Yearbook pages">{pages.map((_, index) => <button key={index} type="button" onClick={() => setPreferences((current) => ({ ...current, page: index }))} className={`min-h-11 min-w-11 rounded-full transition-all ${index === safePage ? 'bg-[var(--ink-gold)]/20' : 'bg-transparent'}`} aria-label={`Open page ${index + 1}`}><span className={`mx-auto block h-2.5 rounded-full transition-all ${index === safePage ? 'w-8 bg-[var(--ink-gold)]' : 'w-2.5 bg-[var(--ink-border)]'}`} /></button>)}</div>
            <button type="button" disabled={safePage === pages.length - 1} onClick={() => setPreferences((current) => ({ ...current, page: Math.min(pages.length - 1, current.page + 1) }))} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
          </div>
        </section>
      </div>
    </div>
  );
};