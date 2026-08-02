import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Download, Share2, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

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

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const YearInBooksScreen: React.FC<YearInBooksScreenProps> = ({ books, sessions, onSelectBook }) => {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear]);
    books.forEach((book) => {
      if (book.dateFinished) years.add(new Date(book.dateFinished).getFullYear());
      if (book.dateStarted) years.add(new Date(book.dateStarted).getFullYear());
    });
    sessions.forEach((session) => years.add(new Date(session.date).getFullYear()));
    return [...years].sort((a, b) => b - a);
  }, [books, sessions, currentYear]);

  const [preferences, setPreferences] = usePersistentState<YearbookPreferences>(STORAGE_KEY, {
    year: availableYears[0] ?? currentYear,
    page: 0,
    theme: 'quiet-library',
    exportFormat: 'portrait',
  });
  const [message, setMessage] = useState('');

  const yearBooks = books.filter((book) => book.dateFinished && new Date(book.dateFinished).getFullYear() === preferences.year);
  const yearSessions = sessions.filter((session) => new Date(session.date).getFullYear() === preferences.year);
  const totalMinutes = yearSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const totalPages = yearSessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);
  const readingDays = new Set(yearSessions.map((session) => session.date)).size;
  const averageSession = yearSessions.length ? Math.round(totalMinutes / yearSessions.length) : 0;
  const topBook = [...yearBooks].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

  const genreCounts = yearBooks.flatMap((book) => book.work.genres).reduce<Record<string, number>>((acc, genre) => {
    acc[genre] = (acc[genre] ?? 0) + 1;
    return acc;
  }, {});
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';

  const authorCounts = yearBooks.reduce<Record<string, number>>((acc, book) => {
    acc[book.work.author] = (acc[book.work.author] ?? 0) + 1;
    return acc;
  }, {});
  const topAuthor = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';

  const formatCounts = yearBooks.reduce<Record<string, number>>((acc, book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    const format = edition?.format ?? 'unknown';
    acc[format] = (acc[format] ?? 0) + 1;
    return acc;
  }, {});
  const topFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No favorite yet';

  const pages = [
    {
      kicker: `${preferences.year} Yearbook`,
      title: 'Your Year in Books',
      body: `${yearBooks.length} finished books, ${totalPages.toLocaleString()} pages, and ${Math.round(totalMinutes / 60)} hours spent reading.`,
      stats: [
        ['Books', yearBooks.length.toString()],
        ['Pages', totalPages.toLocaleString()],
        ['Hours', Math.round(totalMinutes / 60).toString()],
        ['Reading days', readingDays.toString()],
      ],
    },
    {
      kicker: 'Your Reading Rhythm',
      title: `${yearSessions.length} sessions shaped your year`,
      body: `Your average session lasted ${averageSession} minutes, across ${readingDays} different reading days.`,
      stats: [
        ['Sessions', yearSessions.length.toString()],
        ['Average', `${averageSession}m`],
        ['Longest book', yearBooks.sort((a, b) => (b.editions[0]?.pageCount ?? 0) - (a.editions[0]?.pageCount ?? 0))[0]?.work.title ?? '—'],
        ['Top format', topFormat],
      ],
    },
    {
      kicker: 'Your Story Taste',
      title: topGenre,
      body: `${topGenre} defined your year, while ${topAuthor} appeared most often on your shelf.`,
      stats: [
        ['Favorite genre', topGenre],
        ['Most-read author', topAuthor],
        ['Five-star reads', yearBooks.filter((book) => book.rating === 5).length.toString()],
        ['Reviews written', yearBooks.filter((book) => Boolean(book.review?.trim())).length.toString()],
      ],
    },
    {
      kicker: 'Book of the Year',
      title: topBook?.work.title ?? 'Your favorite is waiting',
      body: topBook ? `${topBook.work.author}${topBook.rating ? ` · ${topBook.rating} stars` : ''}` : 'Finish and rate books to reveal your annual favorite.',
      stats: [
        ['Author', topBook?.work.author ?? '—'],
        ['Rating', topBook?.rating ? `${topBook.rating} / 5` : '—'],
        ['Finished', topBook?.dateFinished ? new Date(topBook.dateFinished).toLocaleDateString() : '—'],
        ['Sessions', topBook ? yearSessions.filter((session) => session.bookId === topBook.id).length.toString() : '0'],
      ],
    },
  ];

  const safePage = Math.min(preferences.page, pages.length - 1);
  const page = pages[safePage];
  const theme = themes[preferences.theme];
  const exportFormat = exportFormats[preferences.exportFormat];

  const buildSvg = () => {
    const statRows = page.stats.map(([label, value], index) => {
      const y = exportFormat.height * (0.58 + index * 0.075);
      return `<text x="12%" y="${y}" fill="${theme.text}" opacity=".68" font-family="Arial,sans-serif" font-size="24">${escapeXml(label)}</text><text x="88%" y="${y}" text-anchor="end" fill="${theme.text}" font-family="Georgia,serif" font-size="30" font-weight="700">${escapeXml(value)}</text>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${exportFormat.width}" height="${exportFormat.height}" viewBox="0 0 ${exportFormat.width} ${exportFormat.height}">
      <defs><radialGradient id="glow" cx="82%" cy="8%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".58"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="8%" y="7%" width="84%" height="86%" rx="44" fill="none" stroke="${theme.accent}" stroke-opacity=".42" stroke-width="3"/>
      <text x="50%" y="14%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="27" letter-spacing="7">INKBOUND</text>
      <text x="50%" y="23%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="25" letter-spacing="5">${escapeXml(page.kicker.toUpperCase())}</text>
      <text x="50%" y="36%" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="54" font-weight="700">${escapeXml(page.title.slice(0, 34))}</text>
      <foreignObject x="14%" y="41%" width="72%" height="13%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};opacity:.75;font:28px Arial,sans-serif;text-align:center;line-height:1.45">${escapeXml(page.body)}</div></foreignObject>
      ${statRows}
      <text x="50%" y="88%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="23">Created with Inkbound</text>
    </svg>`;
  };

  const createPng = async () => {
    const svg = buildSvg();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
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
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const download = async () => {
    try {
      const file = await createPng();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Yearbook page downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const share = async () => {
    try {
      const file = await createPng();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${preferences.year} Year in Books`, text: 'My reading year, made with Inkbound', files: [file] });
        setMessage('Share sheet opened.');
      } else {
        await download();
        setMessage('Direct sharing is unavailable here, so the image was downloaded.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.');
    }
  };

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Annual Yearbook</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Year in Books</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">A collectible annual recap built from your real books and reading sessions.</p>
        </div>
        <select value={preferences.year} onChange={(event) => setPreferences((current) => ({ ...current, year: Number(event.target.value), page: 0 }))} className="min-h-12 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </header>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="inkbound-panel space-y-5 rounded-3xl p-5 sm:p-6">
          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid gap-2">
              {(Object.entries(themes) as [YearbookTheme, typeof themes[YearbookTheme]][]).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`} style={{ background: item.background }}>{item.label}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Export size</p>
            <div className="mt-2 grid gap-2">
              {(Object.entries(exportFormats) as [ExportFormat, typeof exportFormats[ExportFormat]][]).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, exportFormat: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm ${preferences.exportFormat === id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item.label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => void share()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button>
            <button type="button" onClick={() => void download()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> PNG</button>
          </div>
          {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-8">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-[32px] border border-white/10 p-7 shadow-2xl sm:p-12" style={{ background: `radial-gradient(circle at top right, ${theme.accent}66, transparent 42%), ${theme.background}`, color: theme.text }}>
            <p className="text-center text-xs font-bold uppercase tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound · {page.kicker}</p>
            <Sparkles className="mx-auto mt-10 h-8 w-8" style={{ color: theme.accent }} />
            <h2 className="mt-6 text-center font-serif text-4xl font-bold sm:text-6xl">{page.title}</h2>
            <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-7 opacity-75 sm:text-base">{page.body}</p>
            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {page.stats.map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wider opacity-60">{label}</p>
                  <p className="mt-2 font-serif text-2xl font-bold">{value}</p>
                </div>
              ))}
            </div>
            {safePage === 3 && topBook && <button type="button" onClick={() => onSelectBook(topBook)} className="mx-auto mt-8 flex items-center gap-2 text-sm font-semibold" style={{ color: theme.accent }}><BookOpen className="h-4 w-4" /> Open book memory</button>}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button type="button" disabled={safePage === 0} onClick={() => setPreferences((current) => ({ ...current, page: Math.max(0, current.page - 1) }))} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
            <div className="flex gap-2" aria-label="Yearbook pages">
              {pages.map((_, index) => <button key={index} type="button" onClick={() => setPreferences((current) => ({ ...current, page: index }))} className={`h-2.5 rounded-full transition-all ${index === safePage ? 'w-8 bg-[var(--ink-gold)]' : 'w-2.5 bg-[var(--ink-border)]'}`} aria-label={`Open page ${index + 1}`} />)}
            </div>
            <button type="button" disabled={safePage === pages.length - 1} onClick={() => setPreferences((current) => ({ ...current, page: Math.min(pages.length - 1, current.page + 1) }))} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
          </div>
        </section>
      </div>
    </div>
  );
};
