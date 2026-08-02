import React, { useMemo, useState } from 'react';
import { Download, Image, Lock, Share2, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { useUserPlan } from '../context/UserPlanContext';

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
  const bookSessions = sessions.filter((session) => session.bookId === selectedBook?.id);
  const readingMinutes = bookSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const edition = selectedBook?.editions.find((item) => item.id === selectedBook.activeEditionId) ?? selectedBook?.editions[0];
  const format = formats[preferences.format];
  const theme = themes[preferences.theme];

  const previewStyle = useMemo(() => ({
    aspectRatio: `${format.width} / ${format.height}`,
    background: `radial-gradient(circle at top right, ${theme.accent}55, transparent 42%), ${theme.background}`,
    color: theme.text,
  }), [format, theme]);

  const buildSvg = () => {
    if (!selectedBook) return '';
    const title = escapeXml(selectedBook.work.title);
    const author = escapeXml(selectedBook.work.author);
    const rating = selectedBook.rating ? `${'★'.repeat(Math.round(selectedBook.rating))}${'☆'.repeat(Math.max(0, 5 - Math.round(selectedBook.rating)))}` : '';
    const pageText = edition?.format === 'audiobook'
      ? `${Math.floor((edition.audiobookDurationMins ?? 0) / 60)} hours`
      : `${edition?.pageCount ?? selectedBook.progressPages ?? 0} pages`;
    const timeText = `${Math.floor(readingMinutes / 60)}h ${readingMinutes % 60}m reading`;
    const status = selectedBook.status === 'finished' ? 'FINISHED' : 'CURRENTLY READING';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
      <defs><radialGradient id="glow" cx="85%" cy="5%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".55"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="${format.width * .08}" y="${format.height * .08}" width="${format.width * .84}" height="${format.height * .84}" rx="42" fill="none" stroke="${theme.accent}" stroke-opacity=".45" stroke-width="3"/>
      <text x="50%" y="14%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="28" letter-spacing="8">INKBOUND</text>
      <text x="50%" y="25%" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="34" letter-spacing="5">${status}</text>
      <text x="50%" y="42%" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="${Math.max(48, format.width * .065)}" font-weight="700">${title.slice(0, 34)}</text>
      <text x="50%" y="48%" text-anchor="middle" fill="${theme.text}" opacity=".72" font-family="Arial,sans-serif" font-size="30">${author}</text>
      ${preferences.showRating && rating ? `<text x="50%" y="58%" text-anchor="middle" fill="${theme.accent}" font-size="45">${rating}</text>` : ''}
      ${preferences.showPages ? `<text x="50%" y="67%" text-anchor="middle" fill="${theme.text}" opacity=".82" font-family="Arial,sans-serif" font-size="30">${pageText}</text>` : ''}
      ${preferences.showReadingTime ? `<text x="50%" y="72%" text-anchor="middle" fill="${theme.text}" opacity=".82" font-family="Arial,sans-serif" font-size="30">${timeText}</text>` : ''}
      ${preferences.showName ? `<text x="50%" y="81%" text-anchor="middle" fill="${theme.text}" opacity=".7" font-family="Georgia,serif" font-size="27">A reader's life, remembered.</text>` : ''}
      <text x="50%" y="89%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="24">Created with Inkbound</text>
    </svg>`;
  };

  const createPngFile = async () => {
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
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create image.')), 'image/png', 1),
      );
      return new File([pngBlob], `inkbound-${selectedBook?.work.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'share-card'}.png`, { type: 'image/png' });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const downloadImage = async () => {
    try {
      const file = await createPngFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Share image downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const shareImage = async () => {
    try {
      const file = await createPngFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'My Inkbound reading card', text: 'Made with Inkbound', files: [file] });
        setMessage('Share sheet opened.');
      } else {
        await downloadImage();
        setMessage('Direct sharing is not supported here, so the image was downloaded instead.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.');
    }
  };

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Create & Share</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Inkbound Studio</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">Turn your reading life into polished social cards without taking screenshots.</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="inkbound-panel space-y-5 rounded-3xl p-5 sm:p-7">
          <label className="block text-sm font-semibold text-[var(--ink-ivory)]">Book
            <select value={selectedBook?.id ?? ''} onChange={(event) => setPreferences((current) => ({ ...current, selectedBookId: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">
              {shareableBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}
            </select>
          </label>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Format</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.entries(formats) as [ShareFormat, typeof formats[ShareFormat]][]).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, format: id }))} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${preferences.format === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item.label}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.entries(themes) as [ShareTheme, typeof themes[ShareTheme]][]).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`} style={{ background: item.background }}>{item.label}</button>
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
              <label key={key} className="flex min-h-11 items-center justify-between rounded-xl border border-[var(--ink-border-subtle)] px-4 text-sm text-[var(--ink-muted)]">
                {label}
                <input type="checkbox" checked={preferences[key as keyof SharePreferences] as boolean} onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))} />
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => void shareImage()} className="quiet-shelf-primary-action min-h-12 justify-center"><Share2 className="h-4 w-4" /> Share</button>
            <button type="button" onClick={() => void downloadImage()} className="quiet-shelf-secondary-action min-h-12 justify-center"><Download className="h-4 w-4" /> Download PNG</button>
          </div>

          {userPlan === 'free' && (
            <button type="button" onClick={() => openUpgradeModal('Unlock high-resolution exports, animated cards, PDF keepsakes, and premium Studio themes')} className="flex w-full items-center gap-3 rounded-xl border border-[var(--ink-border)] p-4 text-left text-sm text-[var(--ink-muted)]">
              <Lock className="h-4 w-4 text-[var(--ink-gold)]" /><span><strong className="block text-[var(--ink-ivory)]">More in Premium</strong>Animated cards, PDF keepsakes, exclusive themes, and transparent exports.</span>
            </button>
          )}
          {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel flex min-h-[640px] items-center justify-center rounded-3xl p-5 sm:p-8">
          {selectedBook ? (
            <div className="relative flex w-full max-w-[520px] flex-col items-center justify-between overflow-hidden rounded-[32px] border border-white/15 p-[8%] text-center shadow-2xl" style={previewStyle}>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: theme.accent }}>Inkbound</p>
                <p className="mt-8 text-sm font-bold uppercase tracking-[0.25em] opacity-80">{selectedBook.status === 'finished' ? 'Finished' : 'Currently Reading'}</p>
              </div>
              <div className="my-12">
                <Sparkles className="mx-auto mb-6 h-8 w-8" style={{ color: theme.accent }} />
                <h2 className="font-serif text-4xl font-bold leading-tight sm:text-5xl">{selectedBook.work.title}</h2>
                <p className="mt-4 text-base opacity-70">{selectedBook.work.author}</p>
                {preferences.showRating && selectedBook.rating && <p className="mt-7 text-2xl" style={{ color: theme.accent }}>{'★'.repeat(Math.round(selectedBook.rating))}</p>}
                <div className="mt-8 space-y-2 text-sm opacity-80">
                  {preferences.showPages && <p>{edition?.format === 'audiobook' ? `${Math.floor((edition.audiobookDurationMins ?? 0) / 60)} hours` : `${edition?.pageCount ?? selectedBook.progressPages} pages`}</p>}
                  {preferences.showReadingTime && <p>{Math.floor(readingMinutes / 60)}h {readingMinutes % 60}m reading</p>}
                </div>
              </div>
              <div>
                {preferences.showName && <p className="mb-3 font-serif text-sm opacity-70">A reader&apos;s life, remembered.</p>}
                <p className="text-xs font-semibold" style={{ color: theme.accent }}>Created with Inkbound</p>
              </div>
            </div>
          ) : (
            <div className="text-center"><Image className="mx-auto h-10 w-10 text-[var(--ink-gold)]" /><p className="mt-3 text-sm text-[var(--ink-muted)]">Add a book to create your first share card.</p></div>
          )}
        </section>
      </div>
    </div>
  );
};
