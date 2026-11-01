import React, { useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import type { ReadingSession, UserBookRecord } from '../types';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { getSessionDurationMinutes, getSessionPagesRead, isRecordedReadingActivity } from '../features/reading/sessionAnalytics';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';

type Style = 'classic' | 'collectible';
type Format = 'square' | 'feed' | 'story';
interface Props { month: string; books: UserBookRecord[]; sessions: ReadingSession[]; }
const formats: Record<Format, [number, number]> = { square: [1200, 1200], feed: [1200, 1500], story: [1080, 1920] };
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatMinutes = (n: number) => `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + 'T12:00:00'));
const coverImage = async (url: string): Promise<HTMLImageElement | null> => {
  if (!/^https?:\/\//i.test(url)) return null;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  return new Promise((resolve) => {
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url.replace(/^http:\/\//i, 'https://');
  });
};
const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) => {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
};
const write = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, font = 'Georgia, serif') => {
  ctx.fillStyle = color; ctx.font = `${size}px ${font}`; ctx.fillText(text, x, y);
};
const makePng = async (month: string, books: UserBookRecord[], sessions: ReadingSession[], style: Style, format: Format): Promise<Blob> => {
  const [width, height] = formats[format];
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable.');
  const collectible = style === 'collectible';
  ctx.fillStyle = collectible ? '#140f1c' : '#17111e'; ctx.fillRect(0, 0, width, height);
  if (collectible) {
    const glow = ctx.createRadialGradient(width / 2, height * .25, 0, width / 2, height * .25, width);
    glow.addColorStop(0, '#3c263d'); glow.addColorStop(1, '#140f1c'); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#b99b68'; ctx.lineWidth = 2; ctx.strokeRect(28, 28, width - 56, height - 56);
    ctx.strokeStyle = '#6e5268'; ctx.strokeRect(38, 38, width - 76, height - 76);
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const label = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  ctx.textAlign = 'center';
  write(ctx, collectible ? 'INKBOUND  •  READING JOURNAL' : 'INKBOUND READING SESSIONS', width / 2, 108, 20, '#d2b67c', 'Arial, sans-serif');
  write(ctx, label, width / 2, 170, format === 'story' ? 57 : 53, '#f8eae0');
  if (collectible) write(ctx, 'A month written in pages', width / 2, 209, 21, '#d2b9c9');
  const monthSessions = sessions.filter(s => validDate(s.date) && s.date.startsWith(month) && isRecordedReadingActivity(s));
  const grouped = new Map<string, ReadingSession[]>();
  monthSessions.forEach(s => grouped.set(s.date, [...(grouped.get(s.date) ?? []), s]));
  const bookMap = new Map(books.map(b => [b.id, b]));
  const allBooks = [...new Set(monthSessions.map(s => s.bookId))].map(id => bookMap.get(id)).filter((b): b is UserBookRecord => Boolean(b));
  const covers = new Map<string, HTMLImageElement | null>();
  await Promise.all(allBooks.map(async book => {
    const url = getActiveEdition(book)?.coverUrl?.trim();
    covers.set(book.id, url ? await coverImage(url) : null);
  }));
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const count = new Date(year, monthNumber, 0).getDate();
  const rows = Math.ceil((firstWeekday + count) / 7);
  const inset = format === 'story' ? 65 : 52;
  const gap = 7;
  const cellWidth = (width - inset * 2 - gap * 6) / 7;
  const gridTop = format === 'story' ? 345 : 268;
  const gridBottom = format === 'story' ? 1435 : format === 'feed' ? 1120 : 975;
  const cellHeight = Math.min(cellWidth * 1.45, (gridBottom - gridTop - 55 - gap * (rows - 1)) / rows);
  const dayHeader = gridTop + 27;
  days.forEach((day, index) => write(ctx, day.toUpperCase(), inset + index * (cellWidth + gap) + cellWidth / 2, dayHeader, 17, '#c8b6c6', 'Arial, sans-serif'));
  const cellsTop = gridTop + 45;
  for (let day = 1; day <= count; day++) {
    const index = firstWeekday + day - 1, col = index % 7, row = Math.floor(index / 7);
    const x = inset + col * (cellWidth + gap), y = cellsTop + row * (cellHeight + gap);
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const activity = grouped.get(date) ?? [];
    rounded(ctx, x, y, cellWidth, cellHeight, 12);
    ctx.fillStyle = activity.length ? '#302435' : '#211a27'; ctx.fill();
    ctx.strokeStyle = activity.length ? '#70546e' : '#3d3042'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; write(ctx, String(day), x + 10, y + 24, 18, '#f7edf0', 'Arial, sans-serif');
    const bookIds = [...new Set(activity.map(s => s.bookId))].filter(id => bookMap.has(id));
    const visible = bookIds.slice(0, 3);
    const coverTop = y + 33, coverBottom = y + cellHeight - (activity.length ? 28 : 10);
    const coverGap = 3, coverWidth = (cellWidth - 16 - coverGap * (visible.length - 1)) / Math.max(1, visible.length);
    visible.forEach((id, i) => {
      const bx = x + 8 + i * (coverWidth + coverGap), bh = Math.max(0, coverBottom - coverTop);
      rounded(ctx, bx, coverTop, coverWidth, bh, 4); ctx.save(); ctx.clip();
      const image = covers.get(id);
      if (image) {
        const scale = Math.max(coverWidth / image.width, bh / image.height);
        ctx.drawImage(image, bx + (coverWidth - image.width * scale) / 2, coverTop + (bh - image.height * scale) / 2, image.width * scale, image.height * scale);
      } else {
        ctx.fillStyle = '#68465d'; ctx.fillRect(bx, coverTop, coverWidth, bh);
        ctx.textAlign = 'center'; write(ctx, 'BOOK', bx + coverWidth / 2, coverTop + bh / 2, 11, '#f8eae0', 'Arial, sans-serif');
      }
      ctx.restore();
    });
    if (activity.length) {
      ctx.textAlign = 'left'; write(ctx, formatMinutes(activity.reduce((n, s) => n + getSessionDurationMinutes(s), 0)), x + 8, y + cellHeight - 8, 13, '#f4e8ee', 'Arial, sans-serif');
      if (bookIds.length > 3) { ctx.textAlign = 'right'; write(ctx, `+${bookIds.length - 3}`, x + cellWidth - 7, y + cellHeight - 8, 13, '#e7c27f', 'Arial, sans-serif'); }
    }
  }
  const minutes = monthSessions.reduce((n, s) => n + getSessionDurationMinutes(s), 0);
  const pages = monthSessions.reduce((n, s) => n + getSessionPagesRead(s), 0);
  const readingDays = grouped.size;
  const statsY = Math.max(cellsTop + rows * (cellHeight + gap) + 65, format === 'story' ? 1550 : format === 'feed' ? 1230 : 1070);
  const stats = [`${readingDays} reading days`, `${pages.toLocaleString()} session pages`, formatMinutes(minutes)];
  ctx.textAlign = 'center'; write(ctx, stats.join('   •   '), width / 2, statsY, format === 'story' ? 24 : 22, '#f4e9ef', 'Arial, sans-serif');
  if (collectible) write(ctx, 'Every page is part of your story', width / 2, statsY + 48, 23, '#c9a97a');
  ctx.textAlign = 'center'; write(ctx, 'Created with Inkbound', width / 2, height - 66, 18, '#bca4b7', 'Arial, sans-serif');
  return new Promise<Blob>((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create calendar PNG.')), 'image/png'); }
    catch (error) { reject(error); }
  });
};
export const ShareReadingCalendar: React.FC<Props> = ({ month, books, sessions }) => {
  const [style, setStyle] = useState<Style>('classic');
  const [format, setFormat] = useState<Format>('square');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const perform = async (share: boolean) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const blob = await makePng(month, books, sessions, style, format);
      const filename = `inkbound-reading-calendar-${month}-${style}-${format}.png`;
      if (share) {
        const result = await shareRuntimeBinaryFile({ filename, mimeType: 'image/png', contents: blob });
        setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing unavailable; calendar saved instead.');
      } else {
        await exportRuntimeBinaryFile({ filename, mimeType: 'image/png', contents: blob });
        setMessage('Calendar PNG saved.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Calendar export failed.'); }
    finally { setBusy(false); }
  };
  return <div className="inkbound-panel flex flex-wrap items-end gap-3 rounded-2xl p-4">
    <label className="flex flex-col gap-1 text-xs text-[var(--ink-text-secondary)]">Calendar style
      <select aria-label="Calendar export style" value={style} onChange={e => setStyle(e.target.value as Style)} className="min-h-11 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] px-3 text-sm text-[var(--ink-ivory)]">
        <option value="classic">Classic Calendar</option><option value="collectible">Collectible Calendar</option>
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-[var(--ink-text-secondary)]">Export size
      <select aria-label="Calendar export size" value={format} onChange={e => setFormat(e.target.value as Format)} className="min-h-11 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] px-3 text-sm text-[var(--ink-ivory)]">
        <option value="square">Square 1:1</option><option value="feed">Feed 4:5</option><option value="story">Story 9:16</option>
      </select>
    </label>
    <button type="button" disabled={busy} onClick={() => void perform(true)} className="quiet-shelf-primary-action"><Share2 className="h-4 w-4" />Share Calendar</button>
    <button type="button" disabled={busy} onClick={() => void perform(false)} className="quiet-shelf-secondary-action"><Download className="h-4 w-4" />Save PNG</button>
    {message && <p role="status" className="w-full text-xs text-[var(--ink-text-secondary)]">{message}</p>}
  </div>;
};
