import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Share2, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';

interface MonthlyWrappedScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

type WrappedTheme = 'quiet-library' | 'cozy-autumn' | 'celestial';
type WrappedFormat = 'story' | 'portrait' | 'square';

interface WrappedPreferences {
  monthKey: string;
  theme: WrappedTheme;
  format: WrappedFormat;
  currentCard: number;
}

interface WrappedCard {
  eyebrow: string;
  title: string;
  body: string;
  footer: string;
}

const STORAGE_KEY = 'inkbound_monthly_wrapped_preferences';

const themeOptions: Record<WrappedTheme, { label: string; background: string; accent: string; text: string }> = {
  'quiet-library': { label: 'Quiet Library', background: '#171217', accent: '#a77a91', text: '#f2e9df' },
  'cozy-autumn': { label: 'Cozy Autumn', background: '#38231d', accent: '#ce936b', text: '#fff0df' },
  celestial: { label: 'Celestial', background: '#17192f', accent: '#aaa5dc', text: '#f4f2ff' },
};

const formatOptions: Record<WrappedFormat, { label: string; width: number; height: number }> = {
  story: { label: 'Story 9:16', width: 1080, height: 1920 },
  portrait: { label: 'Feed 4:5', width: 1080, height: 1350 },
  square: { label: 'Square 1:1', width: 1080, height: 1080 },
};

const monthKeyFor = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthChoices = Array.from({ length: 18 }, (_, index) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - index);
  return { key: monthKeyFor(date), label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
});

const previousMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return monthKeyFor(new Date(year, month - 2, 1));
};

const isValidSessionDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
};

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const percentageChange = (current: number, previous: number) => {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const formatMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;

export const MonthlyWrappedScreen: React.FC<MonthlyWrappedScreenProps> = ({ books, sessions }) => {
  const [preferences, setPreferences] = usePersistentState<WrappedPreferences>(STORAGE_KEY, {
    monthKey: monthChoices[0].key,
    theme: 'quiet-library',
    format: 'portrait',
    currentCard: 0,
  });
  const [message, setMessage] = useState('');

  const selectedMonth = monthChoices.find((month) => month.key === preferences.monthKey) ?? monthChoices[0];
  const priorMonthKey = previousMonthKey(preferences.monthKey);
  const monthSessions = sessions.filter((session) => session.date.startsWith(preferences.monthKey) && isValidSessionDate(session.date) && getSessionDurationMinutes(session) > 0);
  const priorSessions = sessions.filter((session) => session.date.startsWith(priorMonthKey) && isValidSessionDate(session.date) && getSessionDurationMinutes(session) > 0);
  const finishedBooks = books.filter((book) => book.status === 'finished' && book.dateFinished?.startsWith(preferences.monthKey));
  const priorFinishedBooks = books.filter((book) => book.status === 'finished' && book.dateFinished?.startsWith(priorMonthKey));
  const activeBookIds = new Set(monthSessions.map((session) => session.bookId));
  const activeBooks = books.filter((book) => activeBookIds.has(book.id));

  const stats = useMemo(() => {
    const totalMinutes = monthSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const pagesRead = monthSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const readingDays = new Set(monthSessions.map((session) => session.date)).size;
    const averageSession = monthSessions.length ? Math.round(totalMinutes / monthSessions.length) : 0;
    const longestSession = monthSessions.reduce((longest, session) => Math.max(longest, getSessionDurationMinutes(session)), 0);
    const genreCounts = new Map<string, number>();
    activeBooks.forEach((book) => book.work.genres.forEach((genre) => genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)));
    const favoriteGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';
    const highestRated = [...finishedBooks]
      .filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    const favoriteQuote = finishedBooks.flatMap((book) => book.favoriteQuotes ?? [])[0]?.quote;
    const fiveStarReads = finishedBooks.filter((book) => book.rating === 5).length;
    const formatCounts = activeBooks.reduce<Record<string, number>>((counts, book) => {
      const format = getActiveEdition(book)?.format ?? 'unknown';
      counts[format] = (counts[format] ?? 0) + 1;
      return counts;
    }, {});
    const topFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No dominant format';

    const priorMinutes = priorSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const priorPages = priorSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const priorDays = new Set(priorSessions.map((session) => session.date)).size;

    return {
      totalMinutes,
      pagesRead,
      readingDays,
      averageSession,
      longestSession,
      favoriteGenre,
      highestRated,
      favoriteQuote,
      fiveStarReads,
      topFormat,
      changes: {
        pages: percentageChange(pagesRead, priorPages),
        minutes: percentageChange(totalMinutes, priorMinutes),
        days: percentageChange(readingDays, priorDays),
        finishes: percentageChange(finishedBooks.length, priorFinishedBooks.length),
      },
    };
  }, [activeBooks, finishedBooks, monthSessions, priorFinishedBooks.length, priorSessions]);

  const cards: WrappedCard[] = [
    {
      eyebrow: `${selectedMonth.label} Reading Wrapped`,
      title: `${finishedBooks.length} ${finishedBooks.length === 1 ? 'book' : 'books'} finished`,
      body: `${stats.pagesRead.toLocaleString()} pages · ${formatMinutes(stats.totalMinutes)} · ${stats.readingDays} reading days`,
      footer: `${monthSessions.length} completed sessions · ${stats.fiveStarReads} five-star ${stats.fiveStarReads === 1 ? 'read' : 'reads'}`,
    },
    {
      eyebrow: 'Your Monthly Momentum',
      title: stats.changes.days > 0 ? `You read on ${Math.abs(stats.changes.days)}% more days` : stats.changes.days < 0 ? `Your reading days dipped ${Math.abs(stats.changes.days)}%` : 'Your reading rhythm held steady',
      body: `${stats.readingDays} reading days this month compared with ${new Set(priorSessions.map((session) => session.date)).size} last month.`,
      footer: `${stats.changes.pages >= 0 ? '+' : ''}${stats.changes.pages}% pages · ${stats.changes.minutes >= 0 ? '+' : ''}${stats.changes.minutes}% reading time`,
    },
    {
      eyebrow: 'Your Reading Rhythm',
      title: monthSessions.length ? `${stats.averageSession} minute average session` : 'Your next reading rhythm is waiting',
      body: monthSessions.length ? `Your longest reading session lasted ${stats.longestSession} minutes.` : 'Complete a reading session and Inkbound will build this recap from your real activity.',
      footer: `${monthSessions.length} completed sessions across ${stats.readingDays} days`,
    },
    {
      eyebrow: 'Your Month in Stories',
      title: stats.favoriteGenre,
      body: stats.highestRated ? `${stats.highestRated.work.title} was your highest-rated finish${stats.highestRated.rating ? ` at ${stats.highestRated.rating} stars` : ''}.` : 'Keep rating your finished books to reveal a monthly favorite.',
      footer: `${activeBooks.length} books appeared in recorded sessions · ${stats.topFormat} led your format mix`,
    },
    {
      eyebrow: 'Your Standout Read',
      title: stats.highestRated?.work.title ?? 'Your favorite is still waiting',
      body: stats.highestRated ? `${stats.highestRated.work.author}${stats.highestRated.rating ? ` · ${stats.highestRated.rating} / 5` : ''}` : 'Finish and rate a book this month and Inkbound will remember the standout.',
      footer: stats.highestRated ? 'Highest-rated finish this month' : 'Built from your real ratings',
    },
    {
      eyebrow: 'How You Read',
      title: stats.topFormat === 'unknown' ? 'Your format mix is still forming' : `${stats.topFormat.replace('-', ' ')} led the month`,
      body: `${activeBooks.length} books appeared across your recorded sessions this month.`,
      footer: `${stats.pagesRead.toLocaleString()} pages · ${formatMinutes(stats.totalMinutes)} recorded reading time`,
    },
    {
      eyebrow: 'A Memory to Keep',
      title: stats.favoriteQuote ? `“${stats.favoriteQuote.slice(0, 110)}${stats.favoriteQuote.length > 110 ? '…' : ''}”` : 'A quiet month of reading, remembered.',
      body: stats.favoriteQuote ? 'A saved quote from a book you finished this month' : 'Save quotes while reading and Inkbound will feature one here.',
      footer: 'Created with Inkbound',
    },
  ];

  const cardIndex = Math.min(preferences.currentCard, cards.length - 1);
  const currentCard = cards[cardIndex];
  const theme = themeOptions[preferences.theme] ?? themeOptions['quiet-library'];
  const format = formatOptions[preferences.format] ?? formatOptions.portrait;
  const isSquare = preferences.format === 'square';
  const isStory = preferences.format === 'story';

  const changeCard = (next: number) => setPreferences((current) => ({ ...current, currentCard: (next + cards.length) % cards.length }));

  const buildSvg = () => {
    const titleY = isSquare ? 330 : isStory ? 690 : 500;
    const bodyY = isSquare ? 520 : isStory ? 980 : 720;
    const footerY = isSquare ? 735 : isStory ? 1370 : 990;
    const titleSize = isSquare ? 54 : isStory ? 68 : 60;
    const bodySize = isSquare ? 28 : 32;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
      <defs><radialGradient id="glow" cx="85%" cy="8%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".55"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="8%" y="7%" width="84%" height="86%" rx="42" fill="none" stroke="${theme.accent}" stroke-opacity=".42" stroke-width="3"/>
      <text x="50%" y="14%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="28" letter-spacing="8">INKBOUND</text>
      <foreignObject x="12%" y="18%" width="76%" height="9%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.accent};font:700 24px Arial,sans-serif;text-align:center;letter-spacing:4px;text-transform:uppercase">${escapeXml(currentCard.eyebrow)}</div></foreignObject>
      <foreignObject x="12%" y="${titleY}" width="76%" height="${isSquare ? 220 : isStory ? 300 : 250}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};font:700 ${titleSize}px Georgia,serif;text-align:center;line-height:1.12">${escapeXml(currentCard.title)}</div></foreignObject>
      <foreignObject x="14%" y="${bodyY}" width="72%" height="${isSquare ? 145 : 190}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};opacity:.82;font:${bodySize}px Arial,sans-serif;text-align:center;line-height:1.45">${escapeXml(currentCard.body)}</div></foreignObject>
      <foreignObject x="14%" y="${footerY}" width="72%" height="120"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};opacity:.68;font:25px Arial,sans-serif;text-align:center;line-height:1.4">${escapeXml(currentCard.footer)}</div></foreignObject>
      <text x="50%" y="90%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="22">${cardIndex + 1} / ${cards.length} · Created with Inkbound</text>
    </svg>`;
  };

  const createPngFile = async () => {
    const blob = new Blob([buildSvg()], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = format.width;
      canvas.height = format.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the Wrapped image.');
      context.drawImage(image, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create image.')), 'image/png', 1));
      return new File([pngBlob], `inkbound-${preferences.monthKey}-wrapped-${cardIndex + 1}.png`, { type: 'image/png' });
    } finally { URL.revokeObjectURL(url); }
  };

  const downloadCurrent = async () => {
    try {
      const file = await createPngFile();
      await exportRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file });
      setMessage('Wrapped card saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); }
  };

  const shareCurrent = async () => {
    try {
      const file = await createPngFile();
      const result = await shareRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file, title: `${selectedMonth.label} Reading Wrapped`, text: 'Made with Inkbound' });
      setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the card was saved instead.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.'); }
  };

  const dayChange = stats.changes.days;

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Your Reading Month</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Monthly Reading Wrapped</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">A collectible monthly recap built from your books, sessions, ratings and saved moments.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Books finished', finishedBooks.length.toLocaleString(), stats.changes.finishes],
          ['Pages read', stats.pagesRead.toLocaleString(), stats.changes.pages],
          ['Reading time', formatMinutes(stats.totalMinutes), stats.changes.minutes],
          ['Reading days', stats.readingDays.toLocaleString(), stats.changes.days],
        ].map(([label, value, change]) => {
          const numericChange = Number(change);
          return <div key={String(label)} className="inkbound-panel rounded-2xl p-5"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p><p className="mt-2 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{value}</p><p className={`mt-2 flex items-center gap-1 text-xs font-semibold ${numericChange > 0 ? 'text-emerald-400' : numericChange < 0 ? 'text-rose-300' : 'text-[var(--ink-muted)]'}`}>{numericChange > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : numericChange < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}{numericChange === 0 ? 'Same as last month' : `${numericChange > 0 ? '+' : ''}${numericChange}% vs last month`}</p></div>;
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <section className="inkbound-panel space-y-5 rounded-3xl p-5 sm:p-7">
          <label className="block text-sm font-semibold text-[var(--ink-ivory)]">Month
            <select value={preferences.monthKey} onChange={(event) => setPreferences((current) => ({ ...current, monthKey: event.target.value, currentCard: 0 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">
              {monthChoices.map((month) => <option key={month.key} value={month.key}>{month.label}</option>)}
            </select>
          </label>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Export size</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{(Object.entries(formatOptions) as [WrappedFormat, (typeof formatOptions)[WrappedFormat]][]).map(([id, option]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, format: id }))} className={`min-h-11 rounded-xl border px-2 text-xs font-semibold ${preferences.format === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{option.label}</button>)}</div>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid gap-2">{(Object.entries(themeOptions) as [WrappedTheme, (typeof themeOptions)[WrappedTheme]][]).map(([id, option]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)] text-white' : 'border-[var(--ink-border)] text-white/70'}`} style={{ background: option.background }}>{option.label}</button>)}</div>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">This Wrapped contains</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-ivory)]">7 personalized cards covering totals, momentum, rhythm, taste, standout read, format mix and a saved reading memory.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => void shareCurrent()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button>
            <button type="button" onClick={() => void downloadCurrent()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> Save PNG</button>
          </div>
          {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel flex min-h-0 flex-col items-center justify-center rounded-3xl p-4 sm:min-h-[650px] sm:p-8">
          <div className="mb-4 flex w-full max-w-[560px] items-center justify-between">
            <button type="button" onClick={() => changeCard(cardIndex - 1)} className="quiet-shelf-icon-button h-11 w-11" aria-label="Previous Wrapped card"><ChevronLeft /></button>
            <span className="text-xs font-semibold text-[var(--ink-muted)]">Card {cardIndex + 1} of {cards.length}</span>
            <button type="button" onClick={() => changeCard(cardIndex + 1)} className="quiet-shelf-icon-button h-11 w-11" aria-label="Next Wrapped card"><ChevronRight /></button>
          </div>
          <div className={`relative flex w-full max-w-[560px] flex-col items-center justify-between overflow-hidden rounded-[32px] border border-white/15 text-center shadow-2xl ${isSquare ? 'p-[7%]' : isStory ? 'p-[10%]' : 'p-[9%]'}`} style={{ aspectRatio: `${format.width} / ${format.height}`, background: `radial-gradient(circle at top right, ${theme.accent}66, transparent 42%), ${theme.background}`, color: theme.text }}>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound</p>
              <p className={`${isSquare ? 'mt-4' : 'mt-8'} text-xs font-bold uppercase tracking-[0.25em] opacity-75`}>{currentCard.eyebrow}</p>
            </div>
            <div className={isSquare ? 'my-5' : isStory ? 'my-16' : 'my-10'}>
              <Sparkles className={`mx-auto ${isSquare ? 'mb-4 h-7 w-7' : 'mb-7 h-9 w-9'}`} style={{ color: theme.accent }} />
              <h2 className={`font-serif font-bold leading-tight ${isSquare ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{currentCard.title}</h2>
              <p className={`mx-auto max-w-md leading-7 opacity-80 ${isSquare ? 'mt-4 text-sm' : 'mt-6 text-base'}`}>{currentCard.body}</p>
            </div>
            <div>
              <p className={`${isSquare ? 'text-xs' : 'text-sm'} opacity-65`}>{currentCard.footer}</p>
              <p className={`${isSquare ? 'mt-3' : 'mt-5'} text-xs font-bold uppercase tracking-[0.25em]`} style={{ color: theme.accent }}>{cardIndex + 1} / {cards.length} · Created with Inkbound</p>
            </div>
          </div>
        </section>
      </div>

      {dayChange !== 0 && <p className="text-center text-xs text-[var(--ink-muted)]">Monthly comparisons use the immediately preceding calendar month and only completed Inkbound reading sessions.</p>}
    </div>
  );
};