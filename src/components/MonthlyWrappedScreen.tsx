import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Share2, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

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
  return {
    key: monthKeyFor(date),
    label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  };
});

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const MonthlyWrappedScreen: React.FC<MonthlyWrappedScreenProps> = ({ books, sessions }) => {
  const [preferences, setPreferences] = usePersistentState<WrappedPreferences>(STORAGE_KEY, {
    monthKey: monthChoices[0].key,
    theme: 'quiet-library',
    format: 'portrait',
    currentCard: 0,
  });
  const [message, setMessage] = useState('');

  const selectedMonth = monthChoices.find((month) => month.key === preferences.monthKey) ?? monthChoices[0];
  const monthSessions = sessions.filter((session) => session.date.startsWith(preferences.monthKey));
  const finishedBooks = books.filter((book) => book.dateFinished?.startsWith(preferences.monthKey));
  const activeBookIds = new Set(monthSessions.map((session) => session.bookId));
  const activeBooks = books.filter((book) => activeBookIds.has(book.id));

  const stats = useMemo(() => {
    const totalMinutes = monthSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
    const pagesRead = monthSessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);
    const readingDays = new Set(monthSessions.map((session) => session.date)).size;
    const averageSession = monthSessions.length ? Math.round(totalMinutes / monthSessions.length) : 0;
    const genreCounts = new Map<string, number>();
    activeBooks.forEach((book) =>
      book.work.genres.forEach((genre) => genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)),
    );
    const favoriteGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Your next favorite genre';
    const highestRated = [...finishedBooks]
      .filter((book) => book.rating)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    const favoriteQuote = finishedBooks.flatMap((book) => book.favoriteQuotes ?? [])[0]?.quote;
    return { totalMinutes, pagesRead, readingDays, averageSession, favoriteGenre, highestRated, favoriteQuote };
  }, [activeBooks, finishedBooks, monthSessions]);

  const cards = [
    {
      eyebrow: `${selectedMonth.label} Reading Wrapped`,
      title: `${finishedBooks.length} ${finishedBooks.length === 1 ? 'book' : 'books'} finished`,
      body: `${stats.pagesRead.toLocaleString()} pages · ${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`,
      footer: `${monthSessions.length} sessions across ${stats.readingDays} reading days`,
    },
    {
      eyebrow: 'Your Reading Rhythm',
      title: `${stats.averageSession} minute average session`,
      body: stats.readingDays > 0 ? `You made time to read on ${stats.readingDays} days this month.` : 'Your next reading month is waiting.',
      footer: `${monthSessions.length} sessions recorded with Inkbound`,
    },
    {
      eyebrow: 'Your Month in Stories',
      title: stats.favoriteGenre,
      body: stats.highestRated
        ? `${stats.highestRated.work.title} was your highest-rated finish${stats.highestRated.rating ? ` at ${stats.highestRated.rating} stars` : ''}.`
        : 'Keep rating your finished books to reveal a monthly favorite.',
      footer: `${activeBooks.length} books appeared in your reading life`,
    },
    {
      eyebrow: 'A Memory to Keep',
      title: stats.favoriteQuote ? `“${stats.favoriteQuote.slice(0, 90)}${stats.favoriteQuote.length > 90 ? '…' : ''}”` : 'A quiet month of reading, remembered.',
      body: stats.favoriteQuote ? 'Your saved quote of the month' : 'Save quotes while reading and Inkbound will feature one here.',
      footer: 'Created with Inkbound',
    },
  ];

  const cardIndex = Math.min(preferences.currentCard, cards.length - 1);
  const currentCard = cards[cardIndex];
  const theme = themeOptions[preferences.theme];
  const format = formatOptions[preferences.format];

  const changeCard = (next: number) =>
    setPreferences((current) => ({ ...current, currentCard: (next + cards.length) % cards.length }));

  const buildSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
    <defs><radialGradient id="glow" cx="85%" cy="8%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".55"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
    <rect x="8%" y="7%" width="84%" height="86%" rx="42" fill="none" stroke="${theme.accent}" stroke-opacity=".42" stroke-width="3"/>
    <text x="50%" y="14%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="28" letter-spacing="8">INKBOUND</text>
    <text x="50%" y="24%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="24" letter-spacing="4">${escapeXml(currentCard.eyebrow.toUpperCase())}</text>
    <text x="50%" y="45%" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="58" font-weight="700">${escapeXml(currentCard.title.slice(0, 42))}</text>
    <text x="50%" y="57%" text-anchor="middle" fill="${theme.text}" opacity=".82" font-family="Arial,sans-serif" font-size="30">${escapeXml(currentCard.body.slice(0, 80))}</text>
    <text x="50%" y="72%" text-anchor="middle" fill="${theme.text}" opacity=".68" font-family="Arial,sans-serif" font-size="25">${escapeXml(currentCard.footer.slice(0, 82))}</text>
    <text x="50%" y="88%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="22">${cardIndex + 1} / ${cards.length} · Created with Inkbound</text>
  </svg>`;

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
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not create image.'))), 'image/png', 1),
      );
      return new File([pngBlob], `inkbound-${preferences.monthKey}-wrapped-${cardIndex + 1}.png`, { type: 'image/png' });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const downloadCurrent = async () => {
    try {
      const file = await createPngFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Wrapped card downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Download failed.');
    }
  };

  const shareCurrent = async () => {
    try {
      const file = await createPngFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${selectedMonth.label} Reading Wrapped`, text: 'Made with Inkbound', files: [file] });
        setMessage('Share sheet opened.');
      } else {
        await downloadCurrent();
        setMessage('Direct sharing is unavailable here, so the card was downloaded.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.');
    }
  };

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Your Reading Month</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Monthly Reading Wrapped</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
          A shareable recap derived from your library and reading sessions—no duplicate journal records required.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <section className="inkbound-panel space-y-5 rounded-3xl p-5 sm:p-7">
          <label className="block text-sm font-semibold text-[var(--ink-ivory)]">Month
            <select value={preferences.monthKey} onChange={(event) => setPreferences((current) => ({ ...current, monthKey: event.target.value, currentCard: 0 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">
              {monthChoices.map((month) => <option key={month.key} value={month.key}>{month.label}</option>)}
            </select>
          </label>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Export size</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(Object.entries(formatOptions) as [WrappedFormat, (typeof formatOptions)[WrappedFormat]][]).map(([id, option]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, format: id }))} className={`min-h-11 rounded-xl border px-2 text-xs font-semibold ${preferences.format === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{option.label}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid gap-2">
              {(Object.entries(themeOptions) as [WrappedTheme, (typeof themeOptions)[WrappedTheme]][]).map(([id, option]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)] text-white' : 'border-[var(--ink-border)] text-white/70'}`} style={{ background: option.background }}>{option.label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => void shareCurrent()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button>
            <button type="button" onClick={() => void downloadCurrent()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> Download</button>
          </div>
          {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel flex min-h-[650px] flex-col items-center justify-center rounded-3xl p-5 sm:p-8">
          <div className="mb-4 flex w-full max-w-[560px] items-center justify-between">
            <button type="button" onClick={() => changeCard(cardIndex - 1)} className="quiet-shelf-icon-button" aria-label="Previous Wrapped card"><ChevronLeft /></button>
            <span className="text-xs font-semibold text-[var(--ink-muted)]">Card {cardIndex + 1} of {cards.length}</span>
            <button type="button" onClick={() => changeCard(cardIndex + 1)} className="quiet-shelf-icon-button" aria-label="Next Wrapped card"><ChevronRight /></button>
          </div>

          <div className="relative flex w-full max-w-[560px] flex-col items-center justify-between overflow-hidden rounded-[32px] border border-white/15 p-[9%] text-center shadow-2xl" style={{ aspectRatio: `${format.width} / ${format.height}`, background: `radial-gradient(circle at top right, ${theme.accent}66, transparent 42%), ${theme.background}`, color: theme.text }}>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound</p>
              <p className="mt-8 text-xs font-bold uppercase tracking-[0.25em] opacity-75">{currentCard.eyebrow}</p>
            </div>
            <div className="my-12">
              <Sparkles className="mx-auto mb-7 h-9 w-9" style={{ color: theme.accent }} />
              <h2 className="font-serif text-4xl font-bold leading-tight sm:text-5xl">{currentCard.title}</h2>
              <p className="mx-auto mt-6 max-w-md text-base leading-7 opacity-80">{currentCard.body}</p>
            </div>
            <div>
              <p className="text-sm opacity-65">{currentCard.footer}</p>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em]" style={{ color: theme.accent }}>{cardIndex + 1} / {cards.length} · Created with Inkbound</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
