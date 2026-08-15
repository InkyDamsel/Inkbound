import React, { useMemo, useState } from 'react';
import { Download, Image, Lock, Share2, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { useUserPlan } from '../context/UserPlanContext';
import { getSessionDurationMinutes } from '../features/reading/sessionAnalytics';
import {
  exportRuntimeBinaryFile,
  shareRuntimeBinaryFile,
} from '../platform/runtimeExport';

interface InkboundStudioScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

type ShareFormat = 'story' | 'portrait' | 'square' | 'pinterest';
type ShareTheme = 'quiet-library' | 'cozy-autumn' | 'dark-academia' | 'celestial';

interface SharePreferences {
  format: ShareFormat;
  theme: ShareTheme;
  showName: boolean;
  showRating: boolean;
  showPages: boolean;
  showReadingTime: boolean;
  selectedBookId: string;
}

const STORAGE_KEY = 'inkbound_share_preferences';

const formats: Record<ShareFormat, { label: string; width: number; height: number }> = {
  story: { label: 'Story 9:16', width: 1080, height: 1920 },
  portrait: { label: 'Feed 4:5', width: 1080, height: 1350 },
  square: { label: 'Square 1:1', width: 1080, height: 1080 },
  pinterest: { label: 'Pinterest 2:3', width: 1000, height: 1500 },
};

const themes: Record<ShareTheme, { label: string; background: string; accent: string; text: string }> = {
  'quiet-library': { label: 'Quiet Library', background: '#171217', accent: '#9b7287', text: '#f2e9df' },
  'cozy-autumn': { label: 'Cozy Autumn', background: '#3a241d', accent: '#c58b61', text: '#fff1df' },
  'dark-academia': { label: 'Dark Academia', background: '#201b19', accent: '#9c8067', text: '#efe3d4' },
  celestial: { label: 'Celestial', background: '#17192f', accent: '#a8a3d4', text: '#f3f1ff' },
};

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const wrapTitle = (value: string, maxCharacters: number, maxLines: number): string[] => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharacters || !current) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? lines : [value];
};

export const InkboundStudioScreen: React.FC<InkboundStudioScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const shareableBooks = books.filter((book) => book.status === 'finished' || book.status === 'currently-reading');
  const firstBookId = shareableBooks[0]?.id ?? books[0]?.id ?? '';
  const [preferences, setPreferences] = usePersistentState<SharePreferences>(STORAGE_KEY, {
    format: 'portrait',
    theme: 'quiet-library',
    showName: false,
    showRating: true,
    showPages: true,
    showReadingTime: true,
    selectedBookId: firstBookId,
  });
  const [message, setMessage] = useState('');

  const selectedBook = books.find((book) => book.id === preferences.selectedBookId) ?? shareableBooks[0] ?? books[0];
  const completedBookSessions = sessions.filter(
    (session) => session.bookId === selectedBook?.id && getSessionDurationMinutes(session) > 0,
  );
  const readingMinutes = completedBookSessions.reduce(
    (sum, session) => sum + getSessionDurationMinutes(session),
    0,
  );
  const edition = selectedBook?.editions.find((item) => item.id === selectedBook.activeEditionId) ?? selectedBook?.editions[0];
  const format = formats[preferences.format];
  const theme = themes[preferences.theme];
  const isSquare = preferences.format === 'square';
  const lengthText = edition?.format === 'audiobook'
    ? edition.audiobookDurationMins && edition.audiobookDurationMins > 0
      ? `${Math.floor(edition.audiobookDurationMins / 60)}h ${edition.audiobookDurationMins % 60}m audio`
      : 'Audio length unavailable'
    : edition?.pageCount && edition.pageCount > 0
      ? `${edition.pageCount} pages`
      : 'Page count unavailable';

  const previewStyle = useMemo(() => ({
    aspectRatio: `${format.width} / ${format.height}`,
    background: `radial-gradient(circle at top right, ${theme.accent}55, transparent 42%), ${theme.background}`,
    color: theme.text,
  }), [format, theme]);

  const buildSvg = () => {
    if (!selectedBook) return '';
    const author = escapeXml(selectedBook.work.author);
    const titleLines = wrapTitle(selectedBook.work.title, isSquare ? 22 : 28, isSquare ? 3 : 4).map(escapeXml);
    const rating = selectedBook.rating
      ? `${'★'.repeat(Math.round(selectedBook.rating))}${'☆'.repeat(Math.max(0, 5 - Math.round(selectedBook.rating)))}`
      : '';
    const timeText = `${Math.floor(readingMinutes / 60)}h ${readingMinutes % 60}m reading`;
    const status = selectedBook.status === 'finished' ? 'FINISHED' : 'CURRENTLY READING';
    const titleFontSize = isSquare ? 58 : Math.max(48, format.width * 0.062);
    const titleStartY = isSquare ? 38 : 39;
    const titleLineGap = isSquare ? 6.5 : 6;
    const titleMarkup = titleLines
      .map((line, index) => `<tspan x="50%" y="${titleStartY + index * titleLineGap}%">${line}</tspan>`)
      .join('');
    const titleEndY = titleStartY + (titleLines.length - 1) * titleLineGap;
    const authorY = titleEndY + (isSquare ? 7 : 6.5);
    const ratingY = authorY + (isSquare ? 8 : 9);
    const pagesY = ratingY + (preferences.showRating && rating ? (isSquare ? 8 : 9) : 1);
    const readingTimeY = pagesY + (preferences.showPages ? (isSquare ? 5.5 : 6) : 0);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
      <defs><radialGradient id="glow" cx="85%" cy="5%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".55"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="${format.width * 0.08}" y="${format.height * 0.08}" width="${format.width * 0.84}" height="${format.height * 0.84}" rx="42" fill="none" stroke="${theme.accent}" stroke-opacity=".45" stroke-width="3"/>
      <text x="50%" y="14%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="28" letter-spacing="8">INKBOUND</text>
      <text x="50%" y="${isSquare ? 23 : 25}%" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="34" letter-spacing="5">${status}</text>
      <text text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="${titleFontSize}" font-weight="700">${titleMarkup}</text>
      <text x="50%" y="${authorY}%" text-anchor="middle" fill="${theme.text}" opacity=".72" font-family="Arial,sans-serif" font-size="30">${author}</text>
      ${preferences.showRating && rating ? `<text x="50%" y="${ratingY}%" text-anchor="middle" fill="${theme.accent}" font-size="45">${rating}</text>` : ''}
      ${preferences.showPages ? `<text x="50%" y="${pagesY}%" text-anchor="middle" fill="${theme.text}" opacity=".82" font-family="Arial,sans-serif" font-size="30">${escapeXml(lengthText)}</text>` : ''}
      ${preferences.showReadingTime ? `<text x="50%" y="${readingTimeY}%" text-anchor="middle" fill="${theme.text}" opacity=".82" font-family="Arial,sans-serif" font-size="30">${timeText}</text>` : ''}
      ${preferences.showName ? `<text x="50%" y="${isSquare ? 82 : 81}%" text-anchor="middle" fill="${theme.text}" opacity=".7" font-family="Georgia,serif" font-size="27">A reader's life, remembered.</text>` : ''}
      <text x="50%" y="89%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="24">Created with Inkbound</text>
    </svg>`;
  };

  const createPng = async () => {
    const svg = buildSvg();
    if (!svg) throw new Error('Choose a book before exporting.');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = format.width;
      canvas.height = format.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the share image.');
      context.drawImage(image, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error('Could not create image.')),
          'image/png',
          1,
        ),
      );
      const filename = `inkbound-${selectedBook?.work.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'share-card'}.png`;
      return { filename, blob: pngBlob };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const downloadImage = async () => {
    try {
      const { filename, blob } = await createPng();
      await exportRuntimeBinaryFile({ filename, mimeType: 'image/png', contents: blob });
      setMessage('Share image saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const shareImage = async () => {
    try {
      const { filename, blob } = await createPng();
      const result = await shareRuntimeBinaryFile({
        filename,
        mimeType: 'image/png',
        contents: blob,
        title: 'My Inkbound reading card',
        text: 'Made with Inkbound',
      });
      setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the image was saved instead.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.');
    }
  };

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Create & Share</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Inkbound Studio</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
          Turn your reading life into polished social cards without taking screenshots.
        </p>
      </header>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="inkbound-panel min-w-0 space-y-5 rounded-3xl p-5 sm:p-7">
          <label className="block text-sm font-semibold text-[var(--ink-ivory)]">
            Book
            <select
              value={selectedBook?.id ?? ''}
              onChange={(event) =>
                setPreferences((current) => ({ ...current, selectedBookId: event.target.value }))
              }
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]"
            >
              {shareableBooks.map((book) => (
                <option key={book.id} value={book.id}>{book.work.title}</option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Format</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.entries(formats) as [ShareFormat, typeof formats[ShareFormat]][]).map(([id, item]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreferences((current) => ({ ...current, format: id }))}
                  className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${
                    preferences.format === id
                      ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]'
                      : 'border-[var(--ink-border)] text-[var(--ink-muted)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.entries(themes) as [ShareTheme, typeof themes[ShareTheme]][]).map(([id, item]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreferences((current) => ({ ...current, theme: id }))}
                  className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${
                    preferences.theme === id
                      ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]'
                      : 'border-[var(--ink-border)] text-[var(--ink-muted)]'
                  }`}
                  style={{ background: item.background }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Privacy & details</p>
            {[
              ['showRating', 'Show rating'],
              ['showPages', 'Show page or audio length'],
              ['showReadingTime', 'Show reading time'],
              ['showName', 'Show personal footer'],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-[var(--ink-border-subtle)] px-4 text-sm text-[var(--ink-muted)]"
              >
                <span className="min-w-0">{label}</span>
                <input
                  type="checkbox"
                  checked={preferences[key as keyof SharePreferences] as boolean}
                  onChange={(event) =>
                    setPreferences((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!selectedBook}
              onClick={() => void shareImage()}
              className="quiet-shelf-primary-action min-h-12 justify-center disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button
              type="button"
              disabled={!selectedBook}
              onClick={() => void downloadImage()}
              className="quiet-shelf-secondary-action min-h-12 justify-center disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download className="h-4 w-4" /> Save PNG
            </button>
          </div>

          {userPlan === 'free' && (
            <button
              type="button"
              onClick={() =>
                openUpgradeModal(
                  'Premium adds Inkbound’s advanced creative and reflection tools.',
                )
              }
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--ink-border)] p-4 text-left text-sm text-[var(--ink-muted)]"
            >
              <Lock className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" />
              <span className="min-w-0">
                <strong className="block text-[var(--ink-ivory)]">More with Premium</strong>
                Explore Inkbound’s deeper creative and reading-history experiences.
              </span>
            </button>
          )}
          {message && <p role="status" className="break-words text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel flex min-h-[460px] min-w-0 items-center justify-center rounded-3xl p-4 sm:min-h-[640px] sm:p-8">
          {selectedBook ? (
            <div
              className={`relative flex w-full max-w-[520px] flex-col items-center justify-between overflow-hidden rounded-[24px] border border-white/15 text-center shadow-2xl sm:rounded-[32px] ${
                isSquare ? 'p-[6%]' : 'p-[8%]'
              }`}
              style={previewStyle}
            >
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.3em] sm:text-xs sm:tracking-[0.4em]"
                  style={{ color: theme.accent }}
                >
                  Inkbound
                </p>
                <p
                  className={`${isSquare ? 'mt-4 text-xs' : 'mt-6 text-xs sm:mt-8 sm:text-sm'} font-bold uppercase tracking-[0.2em] opacity-80 sm:tracking-[0.25em]`}
                >
                  {selectedBook.status === 'finished' ? 'Finished' : 'Currently Reading'}
                </p>
              </div>

              <div className={isSquare ? 'my-4 min-w-0' : 'my-8 min-w-0 sm:my-12'}>
                <Sparkles
                  className={`mx-auto ${isSquare ? 'mb-3 h-7 w-7' : 'mb-4 h-7 w-7 sm:mb-6 sm:h-8 sm:w-8'}`}
                  style={{ color: theme.accent }}
                />
                <h2
                  className={`break-words font-serif font-bold leading-tight ${
                    isSquare ? 'text-2xl sm:text-4xl' : 'text-3xl sm:text-5xl'
                  }`}
                >
                  {selectedBook.work.title}
                </h2>
                <p className={`${isSquare ? 'mt-2 text-sm' : 'mt-3 text-sm sm:mt-4 sm:text-base'} break-words opacity-70`}>
                  {selectedBook.work.author}
                </p>
                {preferences.showRating && selectedBook.rating && (
                  <p
                    className={`${isSquare ? 'mt-3 text-xl' : 'mt-5 text-xl sm:mt-7 sm:text-2xl'}`}
                    style={{ color: theme.accent }}
                  >
                    {'★'.repeat(Math.round(selectedBook.rating))}
                  </p>
                )}
                <div className={`${isSquare ? 'mt-3 space-y-1 text-xs' : 'mt-6 space-y-2 text-xs sm:mt-8 sm:text-sm'} opacity-80`}>
                  {preferences.showPages && <p>{lengthText}</p>}
                  {preferences.showReadingTime && (
                    <p>{Math.floor(readingMinutes / 60)}h {readingMinutes % 60}m reading</p>
                  )}
                </div>
              </div>

              <div>
                {preferences.showName && (
                  <p className={`${isSquare ? 'mb-1 text-xs' : 'mb-3 text-sm'} font-serif opacity-70`}>
                    A reader&apos;s life, remembered.
                  </p>
                )}
                <p
                  className={isSquare ? 'text-[10px] font-semibold' : 'text-xs font-semibold'}
                  style={{ color: theme.accent }}
                >
                  Created with Inkbound
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <Image className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                Add or start a book to create your first share card.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};