import React, { useMemo, useState } from 'react';
import { Download, Image, Lock, MessageSquareQuote, Share2, Sparkles, Star } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { useUserPlan } from '../context/UserPlanContext';
import { getSessionDurationMinutes } from '../features/reading/sessionAnalytics';
import { exportRuntimeBinaryFile, shareRuntimeBinaryFile } from '../platform/runtimeExport';

interface InkboundStudioScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

type ShareFormat = 'story' | 'portrait' | 'square' | 'pinterest';
type ShareTheme = 'quiet-library' | 'cozy-autumn' | 'dark-academia' | 'celestial';
type CardTemplate = 'reading-card' | 'quote-card' | 'review-card' | 'reading-update';
type CardLayout = 'editorial' | 'cover-focus' | 'minimal';

interface SharePreferences {
  format: ShareFormat;
  theme: ShareTheme;
  template: CardTemplate;
  layout: CardLayout;
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

const templates: Record<CardTemplate, { label: string; description: string }> = {
  'reading-card': { label: 'Book Card', description: 'A polished finished or currently-reading card.' },
  'quote-card': { label: 'Favorite Quote', description: 'Turn a saved quote into something worth sharing.' },
  'review-card': { label: 'Mini Review', description: 'Pair your rating with a short review excerpt.' },
  'reading-update': { label: 'Reading Update', description: 'Share progress, pages and time without a screenshot.' },
};

const layouts: Record<CardLayout, { label: string; description: string }> = {
  editorial: { label: 'Editorial', description: 'Cover + typography with a magazine-like composition.' },
  'cover-focus': { label: 'Cover Focus', description: 'Let the book art lead the card.' },
  minimal: { label: 'Minimal', description: 'A quiet text-first Inkbound card.' },
};

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const truncate = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1).trim()}…` : value;

const fileToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error ?? new Error('Could not read cover image.'));
  reader.readAsDataURL(blob);
});

export const InkboundStudioScreen: React.FC<InkboundStudioScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const shareableBooks = books.filter((book) => book.status === 'finished' || book.status === 'currently-reading');
  const firstBookId = shareableBooks[0]?.id ?? books[0]?.id ?? '';
  const [preferences, setPreferences] = usePersistentState<SharePreferences>(STORAGE_KEY, {
    format: 'portrait',
    theme: 'quiet-library',
    template: 'reading-card',
    layout: 'editorial',
    showRating: true,
    showPages: true,
    showReadingTime: true,
    selectedBookId: firstBookId,
  });
  const [message, setMessage] = useState('');

  const selectedBook = books.find((book) => book.id === preferences.selectedBookId) ?? shareableBooks[0] ?? books[0];
  const bookSessions = sessions.filter((session) => session.bookId === selectedBook?.id && getSessionDurationMinutes(session) > 0);
  const readingMinutes = bookSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
  const edition = selectedBook?.editions.find((item) => item.id === selectedBook.activeEditionId) ?? selectedBook?.editions[0];
  const coverUrl = edition?.coverUrl?.trim() ?? '';
  const format = formats[preferences.format] ?? formats.portrait;
  const theme = themes[preferences.theme] ?? themes['quiet-library'];
  const template = templates[preferences.template] ?? templates['reading-card'];
  const layout = layouts[preferences.layout] ?? layouts.editorial;
  const favoriteQuote = selectedBook?.favoriteQuotes?.[0]?.quote?.trim() ?? '';
  const review = selectedBook?.review?.trim() ?? '';
  const progress = Math.max(0, Math.min(100, Math.round(selectedBook?.progressPercentage ?? 0)));
  const lengthText = edition?.format === 'audiobook'
    ? edition.audiobookDurationMins ? `${Math.floor(edition.audiobookDurationMins / 60)}h ${edition.audiobookDurationMins % 60}m audio` : 'Audiobook'
    : edition?.pageCount ? `${edition.pageCount} pages` : 'Book details';
  const timeText = `${Math.floor(readingMinutes / 60)}h ${readingMinutes % 60}m reading`;
  const ratingText = selectedBook?.rating ? `${selectedBook.rating} / 5` : 'Not rated yet';

  const cardCopy = useMemo(() => {
    if (!selectedBook) return { kicker: '', title: '', body: '', footer: '' };
    switch (preferences.template) {
      case 'quote-card':
        return {
          kicker: 'A LINE I KEPT',
          title: favoriteQuote ? `“${truncate(favoriteQuote, 180)}”` : 'Save a favorite quote to make this card yours.',
          body: selectedBook.work.title,
          footer: selectedBook.work.author,
        };
      case 'review-card':
        return {
          kicker: selectedBook.rating ? `${ratingText} · MY REVIEW` : 'MY REVIEW',
          title: selectedBook.work.title,
          body: review ? truncate(review, 220) : 'Write a review in Inkbound and your words will appear here.',
          footer: selectedBook.work.author,
        };
      case 'reading-update':
        return {
          kicker: 'CURRENTLY READING',
          title: selectedBook.work.title,
          body: `${progress}% complete${preferences.showReadingTime ? ` · ${timeText}` : ''}`,
          footer: selectedBook.work.author,
        };
      default:
        return {
          kicker: selectedBook.status === 'finished' ? 'FINISHED READING' : 'CURRENTLY READING',
          title: selectedBook.work.title,
          body: selectedBook.work.author,
          footer: [preferences.showRating && selectedBook.rating ? ratingText : '', preferences.showPages ? lengthText : '', preferences.showReadingTime ? timeText : ''].filter(Boolean).join(' · '),
        };
    }
  }, [favoriteQuote, lengthText, preferences.showPages, preferences.showRating, preferences.showReadingTime, preferences.template, progress, ratingText, review, selectedBook, timeText]);

  const previewStyle = useMemo(() => ({
    aspectRatio: `${format.width} / ${format.height}`,
    background: `radial-gradient(circle at 82% 8%, ${theme.accent}66, transparent 38%), linear-gradient(145deg, ${theme.background}, ${theme.background} 70%, ${theme.accent}22)`,
    color: theme.text,
  }), [format, theme]);

  const fetchCoverDataUrl = async () => {
    if (!coverUrl || preferences.layout === 'minimal') return '';
    try {
      const response = await fetch(coverUrl, { mode: 'cors' });
      if (!response.ok) return '';
      return await fileToDataUrl(await response.blob());
    } catch {
      return '';
    }
  };

  const buildSvg = (embeddedCover = '') => {
    if (!selectedBook) return '';
    const isSquare = preferences.format === 'square';
    const coverMarkup = embeddedCover
      ? `<defs><clipPath id="coverClip"><rect x="${preferences.layout === 'cover-focus' ? '17%' : '10%'}" y="${preferences.layout === 'cover-focus' ? '22%' : '27%'}" width="${preferences.layout === 'cover-focus' ? '66%' : '30%'}" height="${preferences.layout === 'cover-focus' ? '45%' : '47%'}" rx="28"/></clipPath><radialGradient id="glow" cx="82%" cy="8%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".62"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>`
      : `<defs><radialGradient id="glow" cx="82%" cy="8%"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".62"/><stop offset="1" stop-color="${theme.background}" stop-opacity="0"/></radialGradient></defs>`;

    if (preferences.layout === 'cover-focus') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
        ${coverMarkup}
        <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
        <text x="50%" y="10%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="26" letter-spacing="8">INKBOUND</text>
        <text x="50%" y="16%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="22" font-weight="700" letter-spacing="5">${escapeXml(cardCopy.kicker)}</text>
        ${embeddedCover ? `<image href="${embeddedCover}" x="17%" y="22%" width="66%" height="45%" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)"/>` : `<rect x="17%" y="22%" width="66%" height="45%" rx="28" fill="${theme.accent}" opacity=".18"/><text x="50%" y="45%" text-anchor="middle" fill="${theme.text}" opacity=".45" font-family="Georgia,serif" font-size="34">Cover unavailable</text>`}
        <foreignObject x="12%" y="70%" width="76%" height="10%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};font:700 ${isSquare ? 34 : 42}px Georgia,serif;text-align:center;line-height:1.15">${escapeXml(cardCopy.title)}</div></foreignObject>
        <foreignObject x="14%" y="81%" width="72%" height="6%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.accent};font:600 22px Arial,sans-serif;text-align:center">${escapeXml(cardCopy.footer || cardCopy.body)}</div></foreignObject>
        <text x="50%" y="92%" text-anchor="middle" fill="${theme.text}" opacity=".52" font-family="Arial,sans-serif" font-size="19">Created with Inkbound · ${escapeXml(template.label)}</text>
      </svg>`;
    }

    if (preferences.layout === 'editorial') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
        ${coverMarkup}
        <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
        <rect x="7%" y="6%" width="86%" height="88%" rx="44" fill="none" stroke="${theme.accent}" stroke-opacity=".38" stroke-width="3"/>
        <text x="12%" y="13%" fill="${theme.accent}" font-family="Georgia,serif" font-size="25" letter-spacing="7">INKBOUND</text>
        <text x="12%" y="20%" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="22" font-weight="700" letter-spacing="4">${escapeXml(cardCopy.kicker)}</text>
        ${embeddedCover ? `<image href="${embeddedCover}" x="10%" y="27%" width="30%" height="47%" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)"/>` : `<rect x="10%" y="27%" width="30%" height="47%" rx="28" fill="${theme.accent}" opacity=".17"/>`}
        <foreignObject x="46%" y="29%" width="43%" height="27%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};font:700 ${isSquare ? 39 : 48}px Georgia,serif;line-height:1.1;display:flex;height:100%;align-items:center">${escapeXml(cardCopy.title)}</div></foreignObject>
        <foreignObject x="46%" y="58%" width="41%" height="16%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};opacity:.76;font:${isSquare ? 22 : 26}px Arial,sans-serif;line-height:1.45">${escapeXml(cardCopy.body)}</div></foreignObject>
        <foreignObject x="10%" y="80%" width="80%" height="7%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.accent};font:600 22px Arial,sans-serif;text-align:center">${escapeXml(cardCopy.footer)}</div></foreignObject>
        <text x="50%" y="91%" text-anchor="middle" fill="${theme.text}" opacity=".52" font-family="Arial,sans-serif" font-size="19">Created with Inkbound · ${escapeXml(template.label)}</text>
      </svg>`;
    }

    const titleSize = preferences.template === 'quote-card' ? (isSquare ? 43 : 48) : (isSquare ? 54 : 62);
    const bodySize = preferences.template === 'review-card' ? 30 : 28;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}">
      ${coverMarkup}
      <rect width="100%" height="100%" fill="${theme.background}"/><rect width="100%" height="100%" fill="url(#glow)"/>
      <rect x="8%" y="7%" width="84%" height="86%" rx="44" fill="none" stroke="${theme.accent}" stroke-opacity=".45" stroke-width="3"/>
      <circle cx="50%" cy="16%" r="5" fill="${theme.accent}"/><text x="50%" y="12%" text-anchor="middle" fill="${theme.accent}" font-family="Georgia,serif" font-size="27" letter-spacing="8">INKBOUND</text>
      <text x="50%" y="25%" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="5">${escapeXml(cardCopy.kicker)}</text>
      <foreignObject x="13%" y="31%" width="74%" height="30%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};font:700 ${titleSize}px Georgia,serif;text-align:center;line-height:1.15;display:flex;height:100%;align-items:center;justify-content:center">${escapeXml(cardCopy.title)}</div></foreignObject>
      <foreignObject x="15%" y="63%" width="70%" height="15%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.text};opacity:.78;font:${bodySize}px Arial,sans-serif;text-align:center;line-height:1.45">${escapeXml(cardCopy.body)}</div></foreignObject>
      <foreignObject x="14%" y="80%" width="72%" height="8%"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${theme.accent};font:600 23px Arial,sans-serif;text-align:center;line-height:1.4">${escapeXml(cardCopy.footer)}</div></foreignObject>
      <text x="50%" y="90%" text-anchor="middle" fill="${theme.text}" opacity=".55" font-family="Arial,sans-serif" font-size="20">Created with Inkbound · ${escapeXml(template.label)}</text>
    </svg>`;
  };

  const createPng = async () => {
    const embeddedCover = await fetchCoverDataUrl();
    const svg = buildSvg(embeddedCover);
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
      const pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create image.')), 'image/png', 1));
      const slug = selectedBook?.work.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'share-card';
      return { filename: `inkbound-${preferences.template}-${preferences.layout}-${slug}.png`, blob: pngBlob };
    } finally { URL.revokeObjectURL(url); }
  };

  const downloadImage = async () => {
    try {
      const { filename, blob } = await createPng();
      await exportRuntimeBinaryFile({ filename, mimeType: 'image/png', contents: blob });
      setMessage('Studio card saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); }
  };

  const shareImage = async () => {
    try {
      const { filename, blob } = await createPng();
      const result = await shareRuntimeBinaryFile({ filename, mimeType: 'image/png', contents: blob, title: 'My Inkbound reading card', text: 'Made with Inkbound' });
      setMessage(result === 'shared' ? 'Share sheet opened.' : 'Sharing is unavailable here, so the card was saved instead.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sharing was cancelled.'); }
  };

  const templateIcon = preferences.template === 'quote-card'
    ? <MessageSquareQuote className="mx-auto mb-5 h-8 w-8" style={{ color: theme.accent }} />
    : preferences.template === 'review-card'
      ? <Star className="mx-auto mb-5 h-8 w-8" style={{ color: theme.accent }} />
      : <Sparkles className="mx-auto mb-5 h-8 w-8" style={{ color: theme.accent }} />;

  const copyPreview = (
    <div className="min-w-0">
      {templateIcon}
      <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.accent }}>{cardCopy.kicker}</p>
      <h2 className={`${preferences.template === 'quote-card' ? 'text-2xl sm:text-4xl' : 'text-3xl sm:text-5xl'} mt-5 break-words font-serif font-bold leading-tight`}>{cardCopy.title}</h2>
      <p className="mx-auto mt-5 max-w-[95%] break-words text-sm leading-relaxed opacity-75 sm:text-base">{cardCopy.body}</p>
      <p className="mt-5 break-words text-xs font-semibold sm:text-sm" style={{ color: theme.accent }}>{cardCopy.footer}</p>
      {preferences.template === 'reading-update' && <div className="mx-auto mt-6 h-2 w-[80%] overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${progress}%`, background: theme.accent }} /></div>}
    </div>
  );

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Create & Share</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Inkbound Studio</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">Turn the reading life you already track into polished cards made to share.</p>
      </header>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
        <section className="inkbound-panel min-w-0 space-y-5 rounded-3xl p-5 sm:p-7">
          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Card style</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.entries(templates) as [CardTemplate, typeof templates[CardTemplate]][]).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, template: id }))} className={`rounded-xl border p-3 text-left ${preferences.template === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)]' : 'border-[var(--ink-border)]'}`}>
                  <span className="block text-xs font-bold text-[var(--ink-ivory)]">{item.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-[var(--ink-muted)]">{item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Layout</p>
            <div className="mt-2 grid gap-2">
              {(Object.entries(layouts) as [CardLayout, typeof layouts[CardLayout]][]).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, layout: id }))} className={`rounded-xl border p-3 text-left ${preferences.layout === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)]' : 'border-[var(--ink-border)]'}`}>
                  <span className="block text-xs font-bold text-[var(--ink-ivory)]">{item.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-[var(--ink-muted)]">{item.description}</span>
                </button>
              ))}
            </div>
            {preferences.layout !== 'minimal' && !coverUrl && <p className="mt-2 text-xs text-[var(--ink-muted)]">This edition has no saved cover yet, so Studio will use a tasteful placeholder.</p>}
          </div>

          <label className="block text-sm font-semibold text-[var(--ink-ivory)]">Book
            <select value={selectedBook?.id ?? ''} onChange={(event) => setPreferences((current) => ({ ...current, selectedBookId: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">
              {shareableBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}
            </select>
          </label>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Format</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{(Object.entries(formats) as [ShareFormat, typeof formats[ShareFormat]][]).map(([id, item]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, format: id }))} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${preferences.format === id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item.label}</button>)}</div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Theme</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{(Object.entries(themes) as [ShareTheme, typeof themes[ShareTheme]][]).map(([id, item]) => <button key={id} type="button" onClick={() => setPreferences((current) => ({ ...current, theme: id }))} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${preferences.theme === id ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`} style={{ background: item.background }}>{item.label}</button>)}</div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--ink-ivory)]">Details</p>
            {([['showRating', 'Show rating'], ['showPages', 'Show page or audio length'], ['showReadingTime', 'Show reading time']] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-[var(--ink-border-subtle)] px-4 text-sm text-[var(--ink-muted)]"><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))} /></label>)}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!selectedBook} onClick={() => void shareImage()} className="quiet-shelf-primary-action min-h-12 justify-center disabled:opacity-45"><Share2 className="h-4 w-4" /> Share</button>
            <button type="button" disabled={!selectedBook} onClick={() => void downloadImage()} className="quiet-shelf-secondary-action min-h-12 justify-center disabled:opacity-45"><Download className="h-4 w-4" /> Save PNG</button>
          </div>

          {userPlan === 'free' && <button type="button" onClick={() => openUpgradeModal('Premium adds Inkbound’s advanced creative and reflection tools.')} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--ink-border)] p-4 text-left text-sm text-[var(--ink-muted)]"><Lock className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" /><span><strong className="block text-[var(--ink-ivory)]">More with Premium</strong>Build beautiful reading cards, recaps and memories from the library you already keep.</span></button>}
          {message && <p role="status" className="break-words text-sm text-[var(--ink-muted)]">{message}</p>}
        </section>

        <section className="inkbound-panel flex min-h-[460px] min-w-0 items-center justify-center rounded-3xl p-4 sm:min-h-[640px] sm:p-8">
          {selectedBook ? (
            <div className="relative flex w-full max-w-[520px] flex-col overflow-hidden rounded-[28px] border border-white/15 p-[8%] text-center shadow-2xl" style={previewStyle}>
              <div className="w-full">
                <p className="text-[10px] font-bold uppercase tracking-[0.4em] sm:text-xs" style={{ color: theme.accent }}>Inkbound</p>
                <div className="mx-auto mt-5 h-1 w-1 rounded-full" style={{ background: theme.accent }} />
              </div>

              {preferences.layout === 'cover-focus' ? (
                <div className="flex flex-1 flex-col justify-center py-6">
                  <p className="mb-5 text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.accent }}>{cardCopy.kicker}</p>
                  {coverUrl ? <img src={coverUrl} alt="" className="mx-auto max-h-[54%] w-[70%] rounded-2xl object-cover shadow-2xl" /> : <div className="mx-auto flex aspect-[2/3] w-[70%] items-center justify-center rounded-2xl border border-white/10 bg-white/5 font-serif text-sm opacity-50">Cover unavailable</div>}
                  <h2 className="mt-6 break-words font-serif text-2xl font-bold leading-tight sm:text-4xl">{cardCopy.title}</h2>
                  <p className="mt-3 text-xs font-semibold sm:text-sm" style={{ color: theme.accent }}>{cardCopy.footer || cardCopy.body}</p>
                </div>
              ) : preferences.layout === 'editorial' ? (
                <div className="grid flex-1 grid-cols-[34%_1fr] items-center gap-6 py-7 text-left">
                  {coverUrl ? <img src={coverUrl} alt="" className="w-full rounded-2xl object-cover shadow-2xl" /> : <div className="flex aspect-[2/3] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-3 text-center font-serif text-xs opacity-50">Cover unavailable</div>}
                  <div>{copyPreview}</div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center py-8 text-center">{copyPreview}</div>
              )}

              <p className="text-[10px] font-semibold opacity-60 sm:text-xs">Created with Inkbound · {template.label} · {layout.label}</p>
            </div>
          ) : (
            <div className="text-center"><Image className="mx-auto h-10 w-10 text-[var(--ink-gold)]" /><p className="mt-3 text-sm text-[var(--ink-muted)]">Add or start a book to create your first share card.</p></div>
          )}
        </section>
      </div>
    </div>
  );
};