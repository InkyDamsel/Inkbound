import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Download, Share2, Trophy } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, isRecordedReadingActivity } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { getEffectivePagesReadForPeriod } from '../features/reading/readingPageTotals';
import { hasTrustworthyFinishedHistory } from '../features/reading/inkboundActivity';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';
import { createPngZip } from '../features/export/createPngZip';

interface YearInBooksScreenProps { books: UserBookRecord[]; sessions: ReadingSession[]; onSelectBook: (book: UserBookRecord) => void; }
type YearbookTheme = 'quiet-library' | 'winter-study' | 'celestial';
type ExportFormat = 'story' | 'portrait' | 'square';
interface YearbookPreferences { year: number; page: number; theme: YearbookTheme; exportFormat: ExportFormat; }
const STORAGE_KEY = 'inkbound_year_in_books_preferences';
const YEARBOOK_BACKGROUND_URL = '/assets/yearbook/cozy-yearbook-background.png';
const themes: Record<YearbookTheme, { label: string; background: string; accent: string; text: string }> = {
  'quiet-library': { label: 'Quiet Library', background: '#171217', accent: '#a87d92', text: '#f4ece3' },
  'winter-study': { label: 'Winter Study', background: '#263036', accent: '#b8ced5', text: '#f5f1e9' },
  celestial: { label: 'Celestial', background: '#17192f', accent: '#aaa4df', text: '#f5f2ff' },
};
const exportFormats: Record<ExportFormat, { label: string; width: number; height: number }> = {
  story: { label: 'Story 9:16', width: 1080, height: 1920 }, portrait: { label: 'Feed 4:5', width: 1080, height: 1350 }, square: { label: 'Square 1:1', width: 1080, height: 1080 },
};
const dateYear = (value?: string): number | null => { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const [year, month, day] = value.split('-').map(Number); const parsed = new Date(year, month - 1, day, 12); return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? year : null; };
const dateMonth = (value?: string): number | null => { if (!value || dateYear(value) === null) return null; return Number(value.split('-')[1]) - 1; };
const formatLocalDate = (value?: string) => { if (!value || dateYear(value) === null) return '—'; const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12).toLocaleDateString(); };
const dateKey = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const monthRange = (year: number, month: number) => ({ start: dateKey(year, month, 1), end: dateKey(year, month, new Date(year, month + 1, 0).getDate()) });
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const countValues = (values: string[]) => values.filter(Boolean).reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
const topKey = (counts: Record<string, number>) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
const percentDelta = (current: number, previous: number) => previous > 0 ? Math.round(((current - previous) / previous) * 100) : current > 0 ? 100 : 0;
const deltaLabel = (current: number, previous: number) => { const delta = percentDelta(current, previous); if (delta === 0) return 'Same as last year'; return `${delta > 0 ? '+' : ''}${delta}% vs last year`; };

export const YearInBooksScreen: React.FC<YearInBooksScreenProps> = ({ books, sessions, onSelectBook }) => {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => { const years = new Set<number>([currentYear]); books.forEach((book) => { const finishedYear = dateYear(book.dateFinished); const startedYear = dateYear(book.dateStarted); if (finishedYear !== null) years.add(finishedYear); if (startedYear !== null) years.add(startedYear); }); sessions.forEach((session) => { const year = dateYear(session.date); if (year !== null && isRecordedReadingActivity(session)) years.add(year); }); return [...years].sort((a, b) => b - a); }, [books, sessions, currentYear]);
  const [preferences, setPreferences] = usePersistentState<YearbookPreferences>(STORAGE_KEY, { year: availableYears[0] ?? currentYear, page: 0, theme: 'quiet-library', exportFormat: 'portrait' });
  const [message, setMessage] = useState('');
  const [exportingAll, setExportingAll] = useState(false);
  const yearBooks = books.filter((book) => hasTrustworthyFinishedHistory(book) && dateYear(book.dateFinished) === preferences.year);
  const yearSessions = sessions.filter((session) => dateYear(session.date) === preferences.year && isRecordedReadingActivity(session));
  const previousBooks = books.filter((book) => hasTrustworthyFinishedHistory(book) && dateYear(book.dateFinished) === preferences.year - 1);
  const previousSessions = sessions.filter((session) => dateYear(session.date) === preferences.year - 1 && isRecordedReadingActivity(session));
  const yearStart = `${preferences.year}-01-01`;
  const yearEnd = `${preferences.year}-12-31`;
  const previousYearStart = `${preferences.year - 1}-01-01`;
  const previousYearEnd = `${preferences.year - 1}-12-31`;
  const totalMinutes = yearSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
  const totalPages = getEffectivePagesReadForPeriod(books, yearSessions, yearStart, yearEnd);
  const readingDays = new Set(yearSessions.map((session) => session.date)).size;
  const timedYearSessions = yearSessions.filter((session) => getSessionDurationMinutes(session) > 0);
  const averageSession = timedYearSessions.length ? Math.round(totalMinutes / timedYearSessions.length) : 0;
  const previousMinutes = previousSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
  const previousPages = getEffectivePagesReadForPeriod(books, previousSessions, previousYearStart, previousYearEnd);
  const previousDays = new Set(previousSessions.map((session) => session.date)).size;
  const ratedYearBooks = yearBooks.filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating));
  const topBook = [...ratedYearBooks].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const fiveStarReads = yearBooks.filter((book) => book.rating === 5).length;
  const reviewsWritten = yearBooks.filter((book) => Boolean(book.review?.trim())).length;
  const topGenre = topKey(countValues(yearBooks.flatMap((book) => book.work.genres))) ?? 'Still discovering';
  const topAuthor = topKey(countValues(yearBooks.map((book) => book.work.author))) ?? 'Still discovering';
  const topFormat = topKey(countValues(yearBooks.map((book) => getActiveEdition(book)?.format ?? 'unknown'))) ?? 'No favorite yet';
  const longestBook = [...yearBooks].sort((a, b) => (getActiveEdition(b)?.pageCount ?? 0) - (getActiveEdition(a)?.pageCount ?? 0))[0];
  const shortestBook = [...yearBooks].filter((book) => (getActiveEdition(book)?.pageCount ?? 0) > 0).sort((a, b) => (getActiveEdition(a)?.pageCount ?? 0) - (getActiveEdition(b)?.pageCount ?? 0))[0];
  const longestSession = [...yearSessions].sort((a, b) => getSessionDurationMinutes(b) - getSessionDurationMinutes(a))[0];
  const monthCounts = Array.from({ length: 12 }, (_, month) => { const range = monthRange(preferences.year, month); return { month, books: yearBooks.filter((book) => dateMonth(book.dateFinished) === month).length, sessions: yearSessions.filter((session) => dateMonth(session.date) === month).length, pages: getEffectivePagesReadForPeriod(books, yearSessions, range.start, range.end) }; });
  const biggestMonth = [...monthCounts].sort((a, b) => (b.books - a.books) || (b.pages - a.pages) || (b.sessions - a.sessions))[0];
  const biggestMonthName = biggestMonth ? new Date(preferences.year, biggestMonth.month, 1).toLocaleDateString(undefined, { month: 'long' }) : '—';
  const pages = [
    { kicker: `${preferences.year} Yearbook`, title: 'Your Year in Books', body: `${yearBooks.length} finished books, ${totalPages.toLocaleString()} pages and ${Math.round(totalMinutes / 60)} hours spent reading.`, stats: [['Books', yearBooks.length.toString()], ['Pages', totalPages.toLocaleString()], ['Hours', Math.round(totalMinutes / 60).toString()], ['Reading days', readingDays.toString()]] },
    { kicker: 'Year over Year', title: previousBooks.length || previousSessions.length ? 'How this year changed' : 'Your comparison starts here', body: previousBooks.length || previousSessions.length ? `Inkbound compared ${preferences.year} with ${preferences.year - 1} using trustworthy finish history and available reading activity.` : 'Once you have another year of reliable reading history, Inkbound will show how your habits changed.', stats: [['Finished books', deltaLabel(yearBooks.length, previousBooks.length)], ['Pages', deltaLabel(totalPages, previousPages)], ['Reading time', deltaLabel(totalMinutes, previousMinutes)], ['Reading days', deltaLabel(readingDays, previousDays)]] },
    { kicker: 'Your Reading Rhythm', title: yearSessions.length ? `${yearSessions.length} sessions shaped your year` : 'Your reading year is waiting', body: yearSessions.length ? `Your average completed session lasted ${averageSession} minutes across ${readingDays} reading days.` : 'Complete reading sessions and Inkbound will build this page from your real activity.', stats: [['Average session', `${averageSession}m`], ['Longest session', longestSession ? `${getSessionDurationMinutes(longestSession)}m` : '—'], ['Biggest month', biggestMonthName], ['Top format', topFormat]] },
    { kicker: 'Your Story Taste', title: topGenre, body: yearBooks.length ? `${topGenre} defined your trustworthy finished books while ${topAuthor} appeared most often.` : 'Finish books to reveal the genres and authors that defined your year.', stats: [['Favorite genre', topGenre], ['Most-read author', topAuthor], ['Five-star reads', fiveStarReads.toString()], ['Reviews written', reviewsWritten.toString()]] },
    { kicker: 'Shelf Extremes', title: longestBook?.work.title ?? 'Your longest read is waiting', body: longestBook ? `${longestBook.work.title} was your longest trustworthy finished book${getActiveEdition(longestBook)?.pageCount ? ` at ${getActiveEdition(longestBook)?.pageCount} pages` : ''}.` : 'Finish books with page data to build your shelf extremes.', stats: [['Longest', longestBook?.work.title ?? '—'], ['Shortest', shortestBook?.work.title ?? '—'], ['Biggest month', biggestMonthName], ['Top format', topFormat]] },
    { kicker: 'Book of the Year', title: topBook?.work.title ?? 'Your favorite is waiting', body: topBook ? `${topBook.work.author}${topBook.rating ? ` · ${topBook.rating} stars` : ''}` : 'Finish and rate books to reveal your annual favorite.', stats: [['Author', topBook?.work.author ?? '—'], ['Rating', topBook?.rating ? `${topBook.rating} / 5` : '—'], ['Finished', formatLocalDate(topBook?.dateFinished)], ['Sessions', topBook ? yearSessions.filter((session) => session.bookId === topBook.id).length.toString() : '0']] },
  ];
  const safePage = Math.min(Math.max(preferences.page, 0), pages.length - 1);
  const page = pages[safePage]; const theme = themes[preferences.theme] ?? themes['quiet-library']; const exportFormat = exportFormats[preferences.exportFormat] ?? exportFormats.portrait;
  const isSquare = preferences.exportFormat === 'square'; const isStory = preferences.exportFormat === 'story'; const isDenseStoryPage = isStory && safePage === 4; const titleLength = page.title.length;
  const previewCardPadding = isSquare ? 'p-[5%]' : isStory ? 'p-[6%]' : 'p-[6%]';
  const previewContentSpacing = isSquare ? 'my-3 sm:my-4' : isStory ? 'my-3 sm:my-6' : 'my-4 sm:my-7';
  const previewTitleClass = isSquare ? titleLength > 70 ? 'text-lg sm:text-xl' : titleLength > 45 ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl' : isStory ? titleLength > 70 ? 'text-xl sm:text-4xl' : titleLength > 45 ? 'text-2xl sm:text-5xl' : 'text-2xl sm:text-6xl' : titleLength > 70 ? 'text-lg sm:text-2xl' : titleLength > 45 ? 'text-xl sm:text-3xl' : 'text-2xl sm:text-4xl';
  const previewBodyClass = isSquare ? 'mt-3 text-xs leading-5 sm:text-sm' : isStory ? 'mt-3 text-xs leading-5 sm:mt-6 sm:text-lg sm:leading-7' : 'mt-3 text-xs leading-5 sm:mt-4 sm:text-sm sm:leading-6';
  const previewStatsMargin = isSquare ? 'mt-4' : isStory ? (isDenseStoryPage ? 'mt-5 sm:mt-10' : 'mt-5 sm:mt-12') : 'mt-4 sm:mt-5';
  const previewStatPadding = isSquare ? 'p-2 sm:p-2.5' : isStory ? (isDenseStoryPage ? 'p-3 sm:p-6' : 'p-3 sm:p-7') : 'p-2 sm:p-2.5';
  const previewStatValueClass = isSquare ? 'text-sm sm:text-base' : isStory ? 'text-sm sm:text-2xl' : 'text-sm sm:text-lg';
  const previewStatMinHeight = isStory ? (isDenseStoryPage ? 'min-h-[70px] sm:min-h-[108px]' : 'min-h-[74px] sm:min-h-[144px]') : '';
  const backgroundPosition = isStory ? 'center center' : 'center bottom';
  const previewBackground = `linear-gradient(${theme.background}88, ${theme.background}9a), url(${YEARBOOK_BACKGROUND_URL}) ${backgroundPosition} / cover no-repeat`;
  const wrapSvgLines = (value: string, fontSize: number, maxWidth: number, maxLines = 4) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    const approximateWidth = (text: string) => text.length * fontSize * 0.56;
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && approximateWidth(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.…]+$/, '')}…`;
    return clipped;
  };
  const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not prepare the Year in Books background.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not prepare the Year in Books background.'));
    reader.readAsDataURL(blob);
  });
  const loadYearbookBackground = async () => {
    const response = await fetch(YEARBOOK_BACKGROUND_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Could not load the Year in Books background.');
    return blobToDataUrl(await response.blob());
  };
  const buildSvg = (backgroundDataUrl: string, exportIndex = safePage) => {
    const page = pages[exportIndex];
    const titleLength = page.title.length;
    const isDenseStoryPage = isStory && exportIndex === 4;
    const w = exportFormat.width;
    const h = exportFormat.height;
    const titleSize = isSquare ? titleLength > 70 ? 30 : titleLength > 45 ? 36 : 44 : isStory ? titleLength > 70 ? 56 : titleLength > 45 ? 64 : 76 : titleLength > 70 ? 36 : titleLength > 45 ? 44 : 54;
    const bodySize = isSquare ? 21 : isStory ? 32 : 24;
    const statLabelSize = isSquare ? 16 : isStory ? 22 : 18;
    const statValueSize = isSquare ? 20 : isStory ? 34 : 23;
    const titleLines = wrapSvgLines(page.title, titleSize, w * .70, isStory ? 4 : 3);
    const bodyLines = wrapSvgLines(page.body, bodySize, w * .72, isStory ? 5 : 4);
    const titleLineHeight = titleSize * 1.12;
    const bodyLineHeight = bodySize * 1.42;
    const centerY = isStory ? h * .35 : h * .31;
    const titleY = centerY;
    const bodyY = titleY + titleLines.length * titleLineHeight + (isStory ? 38 : 24);
    const statsTop = isStory ? h * .57 : isSquare ? h * .59 : h * .56;
    const statsLeft = w * .13;
    const statsWidth = w * .74;
    const statsGap = isStory ? 24 : 16;
    const cardWidth = (statsWidth - statsGap) / 2;
    const cardHeight = isStory ? (isDenseStoryPage ? 148 : 194) : isSquare ? 112 : 132;
    const imageAlignment = isStory ? 'xMidYMid' : 'xMidYMax';
    const textLines = (lines: string[], x: number, y: number, lineHeight: number) => lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" text-anchor="middle">${escapeXml(line)}</text>`).join('');
    const statCards = page.stats.map(([label, value], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = statsLeft + col * (cardWidth + statsGap);
      const y = statsTop + row * (cardHeight + statsGap);
      const valueLines = wrapSvgLines(value, statValueSize, cardWidth - 36, 2);
      const valueStart = y + cardHeight * .57 - ((valueLines.length - 1) * statValueSize * .58);
      return `<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="20" fill="#0f0e14" fill-opacity=".28" stroke="#ffffff" stroke-opacity=".12"/><text x="${x + cardWidth / 2}" y="${y + cardHeight * .30}" text-anchor="middle" fill="${theme.text}" fill-opacity=".74" font-family="Arial,sans-serif" font-size="${statLabelSize}" font-weight="600" letter-spacing="2">${escapeXml(label.toUpperCase())}</text><g fill="${theme.text}" font-family="Georgia,serif" font-size="${statValueSize}" font-weight="700">${textLines(valueLines, x + cardWidth / 2, valueStart, statValueSize * 1.16)}</g>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="themeTint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.background}" stop-opacity=".48"/><stop offset="1" stop-color="${theme.background}" stop-opacity=".64"/></linearGradient></defs><image href="${backgroundDataUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${imageAlignment} slice"/><rect width="100%" height="100%" fill="url(#themeTint)"/><rect x="8%" y="7%" width="84%" height="86%" rx="44" fill="none" stroke="${theme.accent}" stroke-opacity=".52" stroke-width="3"/><text x="50%" y="${isStory ? h * .12 : h * .13}" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="${isSquare ? 19 : isStory ? 29 : 23}" font-weight="700" letter-spacing="${isSquare ? 5 : 7}">INKBOUND</text><text x="50%" y="${isStory ? h * .15 : h * .17}" text-anchor="middle" fill="${theme.text}" fill-opacity=".84" font-family="Arial,sans-serif" font-size="${isSquare ? 16 : isStory ? 26 : 20}" font-weight="700" letter-spacing="${isSquare ? 3 : 5}">${escapeXml(page.kicker.toUpperCase())}</text><g fill="${theme.text}" font-family="Georgia,serif" font-size="${titleSize}" font-weight="700">${textLines(titleLines, w / 2, titleY, titleLineHeight)}</g><g fill="${theme.text}" fill-opacity=".90" font-family="Arial,sans-serif" font-size="${bodySize}">${textLines(bodyLines, w / 2, bodyY, bodyLineHeight)}</g>${statCards}<text x="50%" y="92%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="${isSquare ? 16 : isStory ? 23 : 19}" font-weight="700">${exportIndex + 1} / ${pages.length} · Created with Inkbound</text></svg>`;
  };
  const createPng = async (exportIndex = safePage, cachedBackground?: string) => {
    const backgroundDataUrl = cachedBackground ?? await loadYearbookBackground();
    const svgBlob = new Blob([buildSvg(backgroundDataUrl, exportIndex)], { type: 'image/svg+xml;charset=utf-8' });
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
      const blob = await new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create the Year in Books PNG.')), 'image/png', 1);
        } catch {
          reject(new Error('Could not create the Year in Books PNG.'));
        }
      });
      return new File([blob], `inkbound-${preferences.year}-year-in-books-${exportIndex + 1}.png`, { type: 'image/png' });
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const download = async () => { try { const file = await createPng(); await exportRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file }); setMessage('Yearbook page saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); } };
  const downloadAll = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    setMessage('Preparing all Year in Books pages…');
    try {
      const background = await loadYearbookBackground();
      const files: File[] = [];
      for (let index = 0; index < pages.length; index++) files.push(await createPng(index, background));
      const zip = await createPngZip(files);
      await exportRuntimeBinaryFile({ filename: `inkbound-${preferences.year}-year-in-books-all-pages.zip`, mimeType: 'application/zip', contents: zip });
      setMessage(`All ${pages.length} Year in Books pages saved in one ZIP.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not export all pages.'); }
    finally { setExportingAll(false); }
  };
  const share = async () => { try { const file = await createPng(); const result = await shareRuntimeBinaryFile({ filename: file.name, mimeType: 'image/png', contents: file, title: `${preferences.year} Year in Books`, text: 'My reading year, made with Inkbound' }); setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the image was saved instead.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.'); } };
  return <div className="min-w-0 space-y-7 pb-24">
    <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><p className="inkbound-kicker">Annual Yearbook</p><h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Year in Books</h1><p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">A collectible annual recap built from your real books and reading sessions.</p></div><select value={preferences.year} onChange={(event) => setPreferences((current) => ({ ...current, year: Number(event.target.value), page: 0 }))} className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)] sm:w-auto">{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></header>
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Books finished', yearBooks.length.toString(), deltaLabel(yearBooks.length, previousBooks.length)], ['Pages read', totalPages.toLocaleString(), deltaLabel(totalPages, previousPages)], ['Reading time', `${Math.round(totalMinutes / 60)}h`, deltaLabel(totalMinutes, previousMinutes)], ['Reading days', readingDays.toString(), deltaLabel(readingDays, previousDays)]].map(([label, value, comparison]) => <div key={label} className="inkbound-panel min-w-0 rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{label}</p><p className="mt-2 break-words font-serif text-3xl font-bold text-[var(--ink-ivory)]">{value}</p><p className="mt-2 break-words text-xs font-semibold text-[var(--ink-gold)]">{comparison}</p></div>)}</section>
    <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[340px_minmax(0,1fr)]"><section className="inkbound-panel min-w-0 space-y-5 rounded-3xl p-5 sm:p-6"><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p><div className="mt-2 grid gap-2">{(Object.entries(themes) as [YearbookTheme, typeof themes[YearbookTheme]][]).map(([id, item]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`inkbound-themed-preview-swatch min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)]' : 'border-[var(--ink-border)]'}`} style={{ '--preview-theme-background': item.background, '--preview-theme-text': item.text, '--preview-theme-accent': item.accent } as React.CSSProperties}>{item.label}</button>)}</div></div><div><p className="text-sm font-semibold text-[var(--ink-ivory)]">Export size</p><div className="mt-2 grid gap-2">{(Object.entries(exportFormats) as [ExportFormat, typeof exportFormats[ExportFormat]][]).map(([id, item]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, exportFormat: id }))} className={`min-h-11 rounded-xl border px-4 text-left text-sm font-semibold ${preferences.exportFormat === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item.label}</button>)}</div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><button type="button" onClick={() => void share()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button><button type="button" onClick={() => void download()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> Save This Page</button><button type="button" disabled={exportingAll} onClick={() => void downloadAll()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> {exportingAll ? "Preparing ZIP…" : `Save All ${pages.length} Pages (ZIP)`}</button></div>{topBook && <button type="button" onClick={() => onSelectBook(topBook)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--ink-border-subtle)] p-3 text-left"><BookOpen className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" /><span className="min-w-0"><strong className="block truncate text-sm text-[var(--ink-ivory)]">Open Book of the Year</strong><span className="block truncate text-xs text-[var(--ink-muted)]">{topBook.work.title}</span></span></button>}{message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}</section>
      <section className="inkbound-panel flex min-h-[620px] min-w-0 max-w-full flex-col items-center justify-center overflow-hidden rounded-3xl p-3 sm:p-8"><div className="mb-4 flex w-full min-w-0 max-w-[620px] items-center justify-between"><button type="button" onClick={() => setPreferences((current) => ({ ...current, page: (safePage - 1 + pages.length) % pages.length }))} className="quiet-shelf-icon-button h-11 w-11 shrink-0" aria-label="Previous yearbook page"><ChevronLeft /></button><span className="min-w-0 px-2 text-center text-xs font-semibold text-[var(--ink-muted)]">Page {safePage + 1} of {pages.length}</span><button type="button" onClick={() => setPreferences((current) => ({ ...current, page: (safePage + 1) % pages.length }))} className="quiet-shelf-icon-button h-11 w-11 shrink-0" aria-label="Next yearbook page"><ChevronRight /></button></div><div className={`inkbound-themed-preview relative flex w-full min-w-0 max-w-[620px] flex-col justify-between overflow-hidden rounded-[24px] border border-white/20 text-center shadow-2xl sm:rounded-[32px] ${previewCardPadding}`} style={{ aspectRatio: `${exportFormat.width} / ${exportFormat.height}`, background: previewBackground, color: theme.text, '--preview-theme-text': theme.text, boxShadow: '0 30px 80px rgba(0,0,0,.42), inset 0 0 80px rgba(0,0,0,.18)' } as React.CSSProperties}><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.24em] sm:text-xs sm:tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound</p><p className={`${isSquare ? 'mt-2' : isStory ? 'mt-3 sm:mt-4' : 'mt-3'} break-words text-[9px] font-bold uppercase tracking-[0.12em] opacity-80 sm:text-xs sm:tracking-[0.23em]`}>{page.kicker}</p></div><div className={`min-w-0 ${previewContentSpacing}`}><Trophy className={`${isSquare ? 'mb-3 h-6 w-6' : isStory ? 'mb-4 h-7 w-7 sm:mb-8 sm:h-10 sm:w-10' : 'mb-3 h-6 w-6 sm:mb-4 sm:h-7 sm:w-7'} mx-auto drop-shadow`} style={{ color: theme.accent }} /><h2 className={`max-w-full break-words font-serif font-bold leading-[1.08] drop-shadow-lg [overflow-wrap:anywhere] ${previewTitleClass}`}>{page.title}</h2><p className={`mx-auto max-w-full break-words opacity-90 drop-shadow [overflow-wrap:anywhere] sm:max-w-xl ${previewBodyClass}`}>{page.body}</p><div className={`mx-auto grid w-full min-w-0 max-w-xl grid-cols-2 gap-2 sm:gap-3 ${previewStatsMargin}`}>{page.stats.map(([label, value]) => <div key={label} className={`min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/[0.12] backdrop-blur-[2px] shadow-[0_8px_24px_rgba(0,0,0,0.12)] sm:rounded-2xl ${previewStatPadding} ${previewStatMinHeight}`}><p className="break-words text-[8px] uppercase tracking-[0.08em] opacity-75 [overflow-wrap:anywhere] sm:text-[11px] sm:tracking-[0.16em]">{label}</p><p className={`mt-1 break-words font-serif font-bold leading-tight drop-shadow-md [overflow-wrap:anywhere] sm:mt-2 ${previewStatValueClass}`}>{value}</p></div>)}</div></div><p className={`${isSquare ? 'text-[9px]' : 'text-[9px] sm:text-xs'} break-words font-semibold drop-shadow`} style={{ color: theme.accent }}>{safePage + 1} / {pages.length} · Created with Inkbound</p></div></section></div>
  </div>;
};