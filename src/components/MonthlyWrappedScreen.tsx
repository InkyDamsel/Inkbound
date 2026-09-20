import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Share2, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { hasTrustworthyFinishedHistory } from '../features/reading/inkboundActivity';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';

interface MonthlyWrappedScreenProps { books: UserBookRecord[]; sessions: ReadingSession[]; }
type WrappedTheme = 'quiet-library' | 'cozy-autumn' | 'celestial';
type WrappedFormat = 'story' | 'portrait' | 'square';
interface WrappedPreferences { monthKey: string; theme: WrappedTheme; format: WrappedFormat; currentCard: number; }
interface WrappedCard { eyebrow: string; title: string; body: string; footer: string; }

const STORAGE_KEY = 'inkbound_monthly_wrapped_preferences';
const MONTHLY_BACKGROUND_URL = '/assets/monthly/cozy-monthly-background.png';
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
const monthChoices = Array.from({ length: 18 }, (_, index) => { const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - index); return { key: monthKeyFor(date), label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }; });
const previousMonthKey = (monthKey: string) => { const [year, month] = monthKey.split('-').map(Number); return monthKeyFor(new Date(year, month - 2, 1)); };
const isValidSessionDate = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split('-').map(Number); const parsed = new Date(year, month - 1, day, 12); return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day; };
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const percentageChange = (current: number, previous: number) => previous <= 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
const formatMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;

export const MonthlyWrappedScreen: React.FC<MonthlyWrappedScreenProps> = ({ books, sessions }) => {
  const [preferences, setPreferences] = usePersistentState<WrappedPreferences>(STORAGE_KEY, { monthKey: monthChoices[0].key, theme: 'quiet-library', format: 'portrait', currentCard: 0 });
  const [message, setMessage] = useState('');
  const selectedMonth = monthChoices.find((month) => month.key === preferences.monthKey) ?? monthChoices[0];
  const priorMonthKey = previousMonthKey(preferences.monthKey);
  const monthSessions = sessions.filter((session) => session.date.startsWith(preferences.monthKey) && isValidSessionDate(session.date) && getSessionDurationMinutes(session) > 0);
  const priorSessions = sessions.filter((session) => session.date.startsWith(priorMonthKey) && isValidSessionDate(session.date) && getSessionDurationMinutes(session) > 0);
  const finishedBooks = books.filter((book) => hasTrustworthyFinishedHistory(book) && book.dateFinished?.startsWith(preferences.monthKey));
  const priorFinishedBooks = books.filter((book) => hasTrustworthyFinishedHistory(book) && book.dateFinished?.startsWith(priorMonthKey));
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
    const highestRated = [...finishedBooks].filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating)).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    const favoriteQuote = finishedBooks.flatMap((book) => book.favoriteQuotes ?? [])[0]?.quote;
    const fiveStarReads = finishedBooks.filter((book) => book.rating === 5).length;
    const formatCounts = activeBooks.reduce<Record<string, number>>((counts, book) => { const format = getActiveEdition(book)?.format ?? 'unknown'; counts[format] = (counts[format] ?? 0) + 1; return counts; }, {});
    const topFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No dominant format';
    const priorMinutes = priorSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const priorPages = priorSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const priorDays = new Set(priorSessions.map((session) => session.date)).size;
    return { totalMinutes, pagesRead, readingDays, averageSession, longestSession, favoriteGenre, highestRated, favoriteQuote, fiveStarReads, topFormat, changes: { pages: percentageChange(pagesRead, priorPages), minutes: percentageChange(totalMinutes, priorMinutes), days: percentageChange(readingDays, priorDays), finishes: percentageChange(finishedBooks.length, priorFinishedBooks.length) } };
  }, [activeBooks, finishedBooks, monthSessions, priorFinishedBooks.length, priorSessions]);

  const cards: WrappedCard[] = [
    { eyebrow: `${selectedMonth.label} Reading Wrapped`, title: `${finishedBooks.length} ${finishedBooks.length === 1 ? 'book' : 'books'} finished`, body: `${stats.pagesRead.toLocaleString()} pages · ${formatMinutes(stats.totalMinutes)} · ${stats.readingDays} reading days`, footer: `${monthSessions.length} completed sessions · ${stats.fiveStarReads} five-star ${stats.fiveStarReads === 1 ? 'read' : 'reads'}` },
    { eyebrow: 'Your Monthly Momentum', title: stats.changes.days > 0 ? `You read on ${Math.abs(stats.changes.days)}% more days` : stats.changes.days < 0 ? `Your reading days dipped ${Math.abs(stats.changes.days)}%` : 'Your reading rhythm held steady', body: `${stats.readingDays} reading days this month compared with ${new Set(priorSessions.map((session) => session.date)).size} last month.`, footer: `${stats.changes.pages >= 0 ? '+' : ''}${stats.changes.pages}% pages · ${stats.changes.minutes >= 0 ? '+' : ''}${stats.changes.minutes}% reading time` },
    { eyebrow: 'Your Reading Rhythm', title: monthSessions.length ? `${stats.averageSession} minute average session` : 'Your next reading rhythm is waiting', body: monthSessions.length ? `Your longest reading session lasted ${stats.longestSession} minutes.` : 'Complete a reading session and Inkbound will build this recap from your real activity.', footer: `${monthSessions.length} completed sessions across ${stats.readingDays} days` },
    { eyebrow: 'Your Month in Stories', title: stats.favoriteGenre, body: stats.highestRated ? `${stats.highestRated.work.title} was your highest-rated finish${stats.highestRated.rating ? ` at ${stats.highestRated.rating} stars` : ''}.` : 'Keep rating your finished books to reveal a monthly favorite.', footer: `${activeBooks.length} books appeared in recorded sessions · ${stats.topFormat} led your format mix` },
    { eyebrow: 'Your Standout Read', title: stats.highestRated?.work.title ?? 'Your favorite is still waiting', body: stats.highestRated ? `${stats.highestRated.work.author}${stats.highestRated.rating ? ` · ${stats.highestRated.rating} / 5` : ''}` : 'Finish and rate a book this month and Inkbound will remember the standout.', footer: stats.highestRated ? 'Highest-rated finish this month' : 'Built from your real ratings' },
    { eyebrow: 'How You Read', title: stats.topFormat === 'unknown' ? 'Your format mix is still forming' : `${stats.topFormat.replace('-', ' ')} led the month`, body: `${activeBooks.length} books appeared across your recorded sessions this month.`, footer: `${stats.pagesRead.toLocaleString()} pages · ${formatMinutes(stats.totalMinutes)} recorded reading time` },
    { eyebrow: 'A Memory to Keep', title: stats.favoriteQuote ? `“${stats.favoriteQuote.slice(0, 110)}${stats.favoriteQuote.length > 110 ? '…' : ''}”` : 'A quiet month of reading, remembered.', body: stats.favoriteQuote ? 'A saved quote from a trustworthy finished book this month' : 'Save quotes while reading and Inkbound will feature one here.', footer: 'Created with Inkbound' },
  ];

  const cardIndex = Math.min(preferences.currentCard, cards.length - 1);
  const currentCard = cards[cardIndex];
  const theme = themeOptions[preferences.theme] ?? themeOptions['quiet-library'];
  const format = formatOptions[preferences.format] ?? formatOptions.portrait;
  const isSquare = preferences.format === 'square';
  const isStory = preferences.format === 'story';
  const titleLength = currentCard.title.length;
  const previewCardPadding = isSquare ? 'p-[5%]' : isStory ? 'p-[6%]' : 'p-[6%]';
  const previewTitleClass = isSquare ? titleLength > 70 ? 'text-lg sm:text-xl' : titleLength > 45 ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl' : isStory ? titleLength > 70 ? 'text-3xl sm:text-4xl' : titleLength > 45 ? 'text-4xl sm:text-5xl' : 'text-4xl sm:text-6xl' : titleLength > 70 ? 'text-xl sm:text-2xl' : titleLength > 45 ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl';
  const previewBodyClass = isSquare ? 'mt-3 text-xs leading-5 sm:text-sm' : isStory ? 'mt-6 text-base leading-7 sm:text-lg' : 'mt-4 text-sm leading-6';
  const previewFooterClass = isSquare ? 'mt-4 text-[10px] sm:text-xs' : isStory ? 'mt-8 text-sm sm:text-base' : 'mt-5 text-xs sm:text-sm';
  const backgroundPosition = isStory ? 'center center' : 'center bottom';
  const previewBackground = `linear-gradient(${theme.background}88, ${theme.background}9a), url(${MONTHLY_BACKGROUND_URL}) ${backgroundPosition} / cover no-repeat`;

  const changeCard = (next: number) => setPreferences((current) => ({ ...current, currentCard: (next + cards.length) % cards.length }));
  const buildSvg = (backgroundDataUrl: string) => {
    const titleSize = isSquare ? titleLength > 70 ? 30 : titleLength > 45 ? 36 : 44 : isStory ? titleLength > 70 ? 56 : titleLength > 45 ? 64 : 76 : titleLength > 70 ? 36 : titleLength > 45 ? 44 : 54;
    const bodySize = isSquare ? 21 : isStory ? 32 : 24;
    const footerSize = isSquare ? 18 : isStory ? 27 : 21;
    const innerPadding = isSquare ? 56 : isStory ? 72 : 68;
    const headerGap = isSquare ? 12 : isStory ? 20 : 18;
    const bodyGap = isSquare ? 14 : isStory ? 34 : 20;
    const footerGap = isSquare ? 22 : isStory ? 48 : 28;
    const imageAlignment = isStory ? 'xMidYMid' : 'xMidYMax';
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}"><defs><linearGradient id="themeTint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.background}" stop-opacity=".48"/><stop offset="1" stop-color="${theme.background}" stop-opacity=".64"/></linearGradient></defs><image href="${backgroundDataUrl}" x="0" y="0" width="${format.width}" height="${format.height}" preserveAspectRatio="${imageAlignment} slice"/><rect width="100%" height="100%" fill="url(#themeTint)"/><rect x="8%" y="7%" width="84%" height="86%" rx="44" fill="none" stroke="${theme.accent}" stroke-opacity=".52" stroke-width="3"/><foreignObject x="8%" y="7%" width="84%" height="86%"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;padding:${innerPadding}px;display:flex;flex-direction:column;justify-content:space-between;text-align:center;color:${theme.text};font-family:Arial,sans-serif;overflow:hidden;text-shadow:0 2px 12px rgba(0,0,0,.42);"><div><div style="color:${theme.accent};font-family:Georgia,serif;font-size:${isSquare ? 19 : isStory ? 29 : 23}px;font-weight:700;letter-spacing:${isSquare ? 5 : 7}px;line-height:1.15;">INKBOUND</div><div style="margin-top:${headerGap}px;font-size:${isSquare ? 16 : isStory ? 26 : 20}px;font-weight:700;letter-spacing:${isSquare ? 3 : 5}px;line-height:1.2;text-transform:uppercase;opacity:.84;">${escapeXml(currentCard.eyebrow)}</div></div><div style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:${isSquare ? 16 : isStory ? 28 : 22}px 0;"><div style="color:${theme.accent};font-size:${isSquare ? 34 : isStory ? 52 : 42}px;line-height:1;">✦</div><div style="margin-top:${isSquare ? 14 : isStory ? 28 : 20}px;font-family:Georgia,serif;font-size:${titleSize}px;font-weight:700;line-height:1.08;overflow-wrap:anywhere;word-break:break-word;max-width:100%;">${escapeXml(currentCard.title)}</div><div style="margin-top:${bodyGap}px;max-width:92%;font-size:${bodySize}px;line-height:1.4;opacity:.9;overflow-wrap:anywhere;word-break:break-word;">${escapeXml(currentCard.body)}</div><div style="margin-top:${footerGap}px;max-width:92%;padding:${isSquare ? 14 : isStory ? 24 : 18}px ${isSquare ? 18 : 26}px;border:1px solid rgba(255,255,255,.11);border-radius:${isSquare ? 18 : 22}px;background:rgba(15,14,20,.17);font-size:${footerSize}px;line-height:1.35;opacity:.88;backdrop-filter:blur(3px);overflow-wrap:anywhere;word-break:break-word;">${escapeXml(currentCard.footer)}</div></div><div style="color:${theme.accent};font-size:${isSquare ? 16 : isStory ? 23 : 19}px;font-weight:700;line-height:1.2;">${cardIndex + 1} / ${cards.length} · Created with Inkbound</div></div></foreignObject></svg>`;
  };

  const loadBackgroundDataUrl = async (): Promise<string> => {
    const response = await fetch(MONTHLY_BACKGROUND_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Could not load the Wrapped background.');
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not prepare the Wrapped background.'));
      reader.onerror = () => reject(new Error('Could not prepare the Wrapped background.'));
      reader.readAsDataURL(blob);
    });
  };

  const createPngFile = async () => {
    const backgroundDataUrl = await loadBackgroundDataUrl();
    const svgBlob = new Blob([buildSvg(backgroundDataUrl)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
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

      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error('Could not create image.')),
          'image/png',
          1,
        ),
      );

      return new File(
        [pngBlob],
        `inkbound-${preferences.monthKey}-wrapped-${cardIndex + 1}.png`,
        { type: 'image/png' },
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const downloadCurrent = async () => { try { const file = await createPngFile(); await exportRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file }); setMessage('Wrapped card saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); } };
  const shareCurrent = async () => { try { const file = await createPngFile(); const result = await shareRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file, title: `${selectedMonth.label} Reading Wrapped`, text: 'Made with Inkbound' }); setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the card was saved instead.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.'); } };
  const dayChange = stats.changes.days;

  return <div className="space-y-7 pb-24">
    <header><p className="inkbound-kicker">Your Reading Month</p><h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Monthly Reading Wrapped</h1><p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">A collectible monthly recap built from your books, sessions, ratings and saved moments.</p></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Books finished', finishedBooks.length.toLocaleString(), stats.changes.finishes], ['Pages read', stats.pagesRead.toLocaleString(), stats.changes.pages], ['Reading time', formatMinutes(stats.totalMinutes), stats.changes.minutes], ['Reading days', stats.readingDays.toLocaleString(), stats.changes.days]].map(([label, value, change]) => { const numericChange = Number(change); return <div key={String(label)} className="inkbound-panel rounded-2xl p-5"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p><p className="mt-2 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{value}</p><p className={`mt-2 flex items-center gap-1 text-xs font-semibold ${numericChange > 0 ? 'text-emerald-400' : numericChange < 0 ? 'text-rose-300' : 'text-[var(--ink-muted)]'}`}>{numericChange > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : numericChange < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}{numericChange === 0 ? 'Same as last month' : `${numericChange > 0 ? '+' : ''}${numericChange}% vs last month`}</p></div>; })}</section>
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]"><section className="inkbound-panel space-y-5 rounded-3xl p-5 sm:p-6">
      <label className="block text-sm font-semibold text-[var(--ink-ivory)]">Month<select value={preferences.monthKey} onChange={(event) => setPreferences((current) => ({ ...current, monthKey: event.target.value, currentCard: 0 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">{monthChoices.map((month) => <option key={month.key} value={month.key}>{month.label}</option>)}</select></label>
      <div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p><div className="mt-2 grid gap-2">{(Object.entries(themeOptions) as [WrappedTheme, (typeof themeOptions)[WrappedTheme]][]).map(([id, option]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`inkbound-themed-preview-swatch min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)]' : 'border-[var(--ink-border)]'}`} style={{ '--preview-theme-background': option.background, '--preview-theme-text': option.text, '--preview-theme-accent': option.accent } as React.CSSProperties}>{option.label}</button>)}</div></div>
      <div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Export size</p><div className="mt-2 grid gap-2">{(Object.entries(formatOptions) as [WrappedFormat, (typeof formatOptions)[WrappedFormat]][]).map(([id, option]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, format: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.format === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{option.label}</button>)}</div></div>
      <div className="rounded-2xl border border-[var(--ink-border-subtle)] p-4"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">This Wrapped contains</p><p className="mt-2 text-sm leading-6 text-[var(--ink-ivory)]">7 personalized cards covering totals, momentum, rhythm, taste, standout read, format mix and a saved reading memory.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><button type="button" onClick={() => void shareCurrent()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button><button type="button" onClick={() => void downloadCurrent()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> Save PNG</button></div>{message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
    </section>
    <section className="inkbound-panel flex min-h-[620px] flex-col items-center justify-center rounded-3xl p-4 sm:p-8"><div className="mb-4 flex w-full max-w-[620px] items-center justify-between"><button type="button" onClick={() => changeCard(cardIndex - 1)} className="quiet-shelf-icon-button h-11 w-11" aria-label="Previous Wrapped card"><ChevronLeft /></button><span className="text-xs font-semibold text-[var(--ink-muted)]">Card {cardIndex + 1} of {cards.length}</span><button type="button" onClick={() => changeCard(cardIndex + 1)} className="quiet-shelf-icon-button h-11 w-11" aria-label="Next Wrapped card"><ChevronRight /></button></div>
      <div className={`inkbound-themed-preview relative flex w-full max-w-[620px] flex-col justify-between overflow-hidden rounded-[32px] border border-white/20 text-center shadow-2xl ${previewCardPadding}`} style={{ aspectRatio: `${format.width} / ${format.height}`, background: previewBackground, color: theme.text, '--preview-theme-text': theme.text, boxShadow: '0 30px 80px rgba(0,0,0,.42), inset 0 0 80px rgba(0,0,0,.18)' } as React.CSSProperties}><div><p className="text-[10px] font-bold uppercase tracking-[0.35em] sm:text-xs sm:tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound</p><p className={`${isSquare ? 'mt-2' : isStory ? 'mt-4' : 'mt-3'} text-[10px] font-bold uppercase tracking-[0.18em] opacity-80 sm:text-xs sm:tracking-[0.23em]`}>{currentCard.eyebrow}</p></div><div className="flex flex-1 flex-col items-center justify-center py-3 sm:py-5"><Sparkles className={`${isSquare ? 'mb-3 h-6 w-6' : isStory ? 'mb-8 h-10 w-10' : 'mb-4 h-7 w-7'} mx-auto drop-shadow`} style={{ color: theme.accent }} /><h2 className={`font-serif font-bold leading-[1.08] drop-shadow-lg ${previewTitleClass}`}>{currentCard.title}</h2><p className={`mx-auto max-w-xl opacity-90 drop-shadow ${previewBodyClass}`}>{currentCard.body}</p><div className={`mx-auto max-w-xl rounded-2xl border border-white/10 bg-black/[0.12] px-4 py-3 backdrop-blur-[2px] shadow-[0_8px_24px_rgba(0,0,0,0.12)] ${previewFooterClass}`}>{currentCard.footer}</div></div><p className={`${isSquare ? 'text-[10px]' : 'text-xs'} font-semibold drop-shadow`} style={{ color: theme.accent }}>{cardIndex + 1} / {cards.length} · Created with Inkbound</p></div>
    </section></div>
    {dayChange !== 0 && <p className="text-center text-xs text-[var(--ink-muted)]">Monthly comparisons use the immediately preceding calendar month and only completed Inkbound reading sessions.</p>}
  </div>;
};