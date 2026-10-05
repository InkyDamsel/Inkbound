import React from 'react';
import type { ReadingRotationRow, ReadingRotationSelections, ReadingRotationSlot } from '../../features/studio/readingRotation';
import { getActiveEdition } from '../../features/reading/bookReadingState';
import type { UserBookRecord } from '../../types';

interface StudioTheme {
  background: string;
  accent: string;
  text: string;
}

interface StudioFormat {
  width: number;
  height: number;
}

interface ReadingRotationControlsProps {
  rows: ReadingRotationRow[];
  selections: ReadingRotationSelections;
  onChange: (next: ReadingRotationSelections) => void;
}

interface ReadingRotationPreviewProps {
  rows: ReadingRotationRow[];
  theme: StudioTheme;
  format: StudioFormat;
  backgroundImage: string;
}

interface CreateReadingRotationPngOptions {
  rows: ReadingRotationRow[];
  theme: StudioTheme;
  format: StudioFormat;
  backgroundDataUrl: string;
  fetchDataUrl: (url: string) => Promise<string>;
}

const slots: Array<{ id: ReadingRotationSlot; label: string }> = [
  { id: 'last', label: 'Last' },
  { id: 'current', label: 'Current' },
  { id: 'next', label: 'Next' },
];

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const trimTitle = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, Math.max(1, limit - 1)).trim()}…` : value;

const coverFor = (book?: UserBookRecord) => {
  const edition = book ? getActiveEdition(book) : undefined;
  return edition?.coverUrl?.trim() ?? '';
};

const selectionFor = (
  selections: ReadingRotationSelections,
  row: ReadingRotationRow,
  slot: ReadingRotationSlot,
) => selections[row.format]?.[slot] ?? '';

export const ReadingRotationControls: React.FC<ReadingRotationControlsProps> = ({
  rows,
  selections,
  onChange,
}) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--ink-border)] p-4 text-xs leading-5 text-[var(--ink-muted)]">
        Reading Rotation will appear once Inkbound can find a finished, current, or next book in your library.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--ink-ivory)]">Reading Rotation</p>
        <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
          Inkbound fills Last, Current, and Next from your library automatically. Choose a different book only when you want to override a slot.
        </p>
      </div>

      {rows.map((row) => (
        <section key={row.format} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-gold)]">{row.label}</p>
          <div className="mt-3 grid gap-3">
            {slots.map(({ id, label }) => {
              const slotState = row[id];
              const manualValue = selectionFor(selections, row, id);
              const automaticBook = slotState.automaticBookId
                ? row.selectableBooks.find((book) => book.id === slotState.automaticBookId)
                : undefined;
              return (
                <label key={id} className="text-xs font-semibold text-[var(--ink-ivory)]">
                  {label}
                  <select
                    value={manualValue}
                    onChange={(event) => {
                      const nextRow = { ...(selections[row.format] ?? {}) };
                      if (event.target.value) nextRow[id] = event.target.value;
                      else delete nextRow[id];
                      onChange({ ...selections, [row.format]: nextRow });
                    }}
                    className="inkbound-select mt-1 w-full"
                  >
                    <option value="">
                      {automaticBook ? `Automatic — ${automaticBook.work.title}` : 'Automatic — no match'}
                    </option>
                    {row.selectableBooks.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.work.title}{book.work.author ? ` — ${book.work.author}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

export const ReadingRotationPreview: React.FC<ReadingRotationPreviewProps> = ({
  rows,
  theme,
  format,
  backgroundImage,
}) => {
  const compact = format.height <= 1350;
  return (
    <div
      className="inkbound-studio-preview relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-[28px] border border-white/15 p-[7%] text-center shadow-2xl"
      style={{
        aspectRatio: `${format.width} / ${format.height}`,
        backgroundImage: `linear-gradient(180deg, ${theme.background}33, ${theme.background}aa), url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: theme.text,
      }}
    >
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative z-10 flex min-h-full flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/45 p-4 backdrop-blur-[2px] sm:p-5">
        <div className="shrink-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.38em] sm:text-[10px]" style={{ color: theme.accent }}>Inkbound Studio</p>
          <h2 className={`mt-2 font-serif font-bold ${compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}`}>Reading Rotation</h2>
          <div className="mt-3 grid grid-cols-[60px_repeat(3,minmax(0,1fr))] gap-2 text-[8px] font-bold uppercase tracking-wider sm:grid-cols-[78px_repeat(3,minmax(0,1fr))] sm:text-[9px]" style={{ color: theme.accent }}>
            <span />
            <span>Last</span>
            <span>Current</span>
            <span>Next</span>
          </div>
        </div>

        <div className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-3">
          {rows.map((row) => (
            <div key={row.format} className="grid min-h-0 grid-cols-[60px_repeat(3,minmax(0,1fr))] items-start gap-2 sm:grid-cols-[78px_repeat(3,minmax(0,1fr))]">
              <div className="pt-2 text-left text-[8px] font-bold uppercase tracking-wider sm:text-[9px]" style={{ color: theme.accent }}>{row.label}</div>
              {slots.map(({ id }) => {
                const book = row[id].book;
                const cover = coverFor(book);
                return (
                  <div key={id} className="min-w-0">
                    {book ? (
                      <>
                        {cover ? (
                          <img src={cover} alt="" className="mx-auto aspect-[2/3] w-full max-w-[94px] rounded-lg object-cover shadow-lg" />
                        ) : (
                          <div className="mx-auto flex aspect-[2/3] w-full max-w-[94px] items-center justify-center rounded-lg border border-white/10 bg-white/5 px-1 text-[8px] opacity-60">Cover unavailable</div>
                        )}
                        <p className="mt-1 line-clamp-2 text-[8px] font-semibold leading-tight sm:text-[9px]">{book.work.title}</p>
                        <p className="mt-0.5 truncate text-[7px] opacity-60 sm:text-[8px]">{book.work.author}</p>
                      </>
                    ) : (
                      <div className="mx-auto flex aspect-[2/3] w-full max-w-[94px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.03] px-1 text-[8px] opacity-40">No match</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <p className="mt-3 shrink-0 text-[8px] font-semibold opacity-60 sm:text-[9px]">Created with Inkbound · Reading Rotation</p>
      </div>
    </div>
  );
};

export async function createReadingRotationPng({
  rows,
  theme,
  format,
  backgroundDataUrl,
  fetchDataUrl,
}: CreateReadingRotationPngOptions): Promise<{ filename: string; blob: Blob }> {
  if (rows.length === 0) throw new Error('Reading Rotation needs at least one book before exporting.');

  const width = format.width;
  const height = format.height;
  const panelX = width * 0.06;
  const panelY = height * 0.055;
  const panelW = width * 0.88;
  const panelH = height * 0.89;
  const innerX = panelX + width * 0.04;
  const innerW = panelW - width * 0.08;
  const headerH = height * 0.15;
  const footerH = height * 0.06;
  const gridTop = panelY + headerH;
  const gridBottom = panelY + panelH - footerH;
  const gridH = gridBottom - gridTop;
  const rowH = gridH / rows.length;
  const labelW = innerW * 0.13;
  const colW = (innerW - labelW) / 3;
  const coverW = Math.min(colW * 0.67, rowH * 0.39);
  const coverH = coverW * 1.5;
  const titleSize = Math.max(12, Math.round(width * 0.0125));
  const authorSize = Math.max(10, Math.round(width * 0.0095));
  const rowLabelSize = Math.max(12, Math.round(width * 0.012));
  const slotLabelSize = Math.max(11, Math.round(width * 0.0105));

  const coverEntries: Array<{ book: UserBookRecord; dataUrl: string }> = [];
  const seenCoverUrls = new Map<string, string>();
  for (const row of rows) {
    for (const { id } of slots) {
      const book = row[id].book;
      const url = coverFor(book);
      if (!book || !url) continue;
      let dataUrl = seenCoverUrls.get(url);
      if (!dataUrl) {
        dataUrl = await fetchDataUrl(url);
        if (dataUrl) seenCoverUrls.set(url, dataUrl);
      }
      if (dataUrl) coverEntries.push({ book, dataUrl });
    }
  }

  const coverMap = new Map(coverEntries.map((item) => [item.book.id, item.dataUrl]));

  let grid = '';
  slots.forEach(({ label }, index) => {
    const x = innerX + labelW + colW * (index + 0.5);
    grid += `<text x="${x}" y="${gridTop - height * 0.012}" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="${slotLabelSize}" font-weight="700" letter-spacing="2">${escapeXml(label.toUpperCase())}</text>`;
  });

  rows.forEach((row, rowIndex) => {
    const rowY = gridTop + rowH * rowIndex;
    const centerY = rowY + rowH * 0.5;
    grid += `<text x="${innerX}" y="${centerY}" text-anchor="start" dominant-baseline="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="${rowLabelSize}" font-weight="700" letter-spacing="2">${escapeXml(row.label.toUpperCase())}</text>`;

    slots.forEach(({ id }, colIndex) => {
      const book = row[id].book;
      const cellX = innerX + labelW + colW * colIndex;
      const coverX = cellX + (colW - coverW) / 2;
      const coverY = rowY + Math.max(2, rowH * 0.07);
      const image = book ? coverMap.get(book.id) : undefined;

      if (image) {
        grid += `<image href="${image}" x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" preserveAspectRatio="xMidYMid slice"/>`;
      } else {
        grid += `<rect x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" rx="12" fill="#ffffff" fill-opacity=".05" stroke="#ffffff" stroke-opacity=".12"/>`;
      }

      if (book) {
        const title = trimTitle(book.work.title, width <= 1000 ? 28 : 34);
        const author = trimTitle(book.work.author, 30);
        const textY = Math.min(rowY + rowH - authorSize * 2.2, coverY + coverH + titleSize * 1.45);
        grid += `<text x="${cellX + colW / 2}" y="${textY}" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="${titleSize}" font-weight="700">${escapeXml(title)}</text>`;
        grid += `<text x="${cellX + colW / 2}" y="${textY + authorSize * 1.55}" text-anchor="middle" fill="${theme.text}" fill-opacity=".62" font-family="Arial,sans-serif" font-size="${authorSize}">${escapeXml(author)}</text>`;
      }
    });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <image href="${backgroundDataUrl}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/>
    <rect width="100%" height="100%" fill="${theme.background}" opacity=".34"/>
    <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="42" fill="${theme.background}" opacity=".86" stroke="${theme.accent}" stroke-opacity=".48" stroke-width="3"/>
    <text x="50%" y="${panelY + height * 0.055}" text-anchor="middle" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="${Math.max(18, Math.round(width * 0.017))}" font-weight="700" letter-spacing="7">INKBOUND STUDIO</text>
    <text x="50%" y="${panelY + height * 0.103}" text-anchor="middle" fill="${theme.text}" font-family="Georgia,serif" font-size="${Math.max(30, Math.round(width * 0.041))}" font-weight="700">Reading Rotation</text>
    ${grid}
    <text x="50%" y="${panelY + panelH - height * 0.025}" text-anchor="middle" fill="${theme.text}" fill-opacity=".62" font-family="Arial,sans-serif" font-size="${Math.max(12, Math.round(width * 0.013))}">Created with Inkbound · Reading Rotation</text>
  </svg>`;

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the Reading Rotation image.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not create the Reading Rotation PNG.')), 'image/png', 1);
    });
    return { filename: 'inkbound-reading-rotation.png', blob };
  } finally {
    URL.revokeObjectURL(url);
  }
}
