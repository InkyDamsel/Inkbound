import React, { useState } from 'react';
import type { SeriesRosterEntry } from '../../features/series/seriesDetectiveRoster';
import { summarizeSeriesRoster } from '../../features/series/seriesDetectiveRoster';
import { getCanonicalProgressPercentage } from '../../features/reading/bookReadingState';
import { readingStatusLabelForBook } from '../../features/reading/customReadingStatuses';
import { ownershipLabel } from '../../domain/libraryTaxonomy';

interface Props {
  entries: SeriesRosterEntry[];
  /** Opens an in-library book. Omit where no navigation is available. */
  onOpenBook?: (entry: SeriesRosterEntry) => void;
}

const positionLabel = (position: number | null) => (position === null ? 'Order unverified' : `Book ${position}`);

const addEvent = (entries: SeriesRosterEntry[]) => {
  const candidates = entries.flatMap((entry) => (entry.candidate?.verification === 'verified' ? [entry.candidate] : []));
  if (!candidates.length) return;
  // Detective never writes to the library. The canonical add path in App.tsx
  // receives this event and owns validation and persistence.
  window.dispatchEvent(new CustomEvent('inkbound:series-detective-save', { detail: { candidates } }));
};

const Facts: React.FC<{ entry: SeriesRosterEntry }> = ({ entry }) => {
  const facts = [
    entry.year ? String(entry.year) : null,
    entry.pageCount ? `${entry.pageCount} pages` : null,
    entry.publisher ?? null,
    entry.isbn ? `ISBN ${entry.isbn}` : null,
  ].filter(Boolean);
  return facts.length ? <p className="mt-1 text-[11px] text-stone-400">{facts.join(' · ')}</p> : null;
};

const RosterRow: React.FC<{ entry: SeriesRosterEntry; onOpenBook?: Props['onOpenBook'] }> = ({ entry, onOpenBook }) => {
  const [reviewOpen, setReviewOpen] = useState(false);
  const missing = entry.kind === 'missing';
  const reviewOnly = missing && entry.candidate?.verification !== 'verified';
  const book = entry.book;

  return (
    <li className={`rounded-xl border p-3 ${missing ? 'border-[#c5a059]/30 bg-[#150d1b]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-start gap-3">
        {entry.coverUrl
          ? <img src={entry.coverUrl} alt="" loading="lazy" className="h-20 w-14 shrink-0 rounded-md object-cover shadow-lg" />
          : <div aria-hidden="true" className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-white/5 text-[10px] text-stone-500">No cover</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#e5c158]">{positionLabel(entry.position)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${missing ? 'bg-[#c5a059]/20 text-[#f3dbad]' : 'bg-emerald-400/15 text-emerald-200'}`}>
              {missing ? (reviewOnly ? 'Review series evidence' : 'Not in your library') : 'In your library'}
            </span>
          </div>
          <p className="mt-1 font-serif text-base text-[#f3dbad]">{entry.title}</p>
          {entry.subtitle && <p className="text-xs text-stone-300">{entry.subtitle}</p>}
          <p className="text-xs text-stone-400">{entry.authors || 'Author unverified'}</p>
          <Facts entry={entry} />
          {book && (
            <p className="mt-1 text-[11px] text-stone-300">
              {readingStatusLabelForBook(book)} · {ownershipLabel(book.ownership)} · {getCanonicalProgressPercentage(book)}% read
            </p>
          )}

        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {reviewOnly && <button type="button" onClick={() => setReviewOpen(true)} className="rounded-xl border border-[#c5a059]/60 px-3 py-2 text-xs font-bold text-[#e5c158] hover:bg-[#c5a059]/10">Review</button>}
          {missing && !reviewOnly && (
            <button type="button" onClick={() => addEvent([entry])} className="rounded-xl bg-[#c5a059] px-3 py-2 text-xs font-bold text-[#211128] transition hover:bg-[#e4c47c]">Add Book</button>
          )}
          {book && onOpenBook && (
            <button type="button" onClick={() => onOpenBook(entry)} className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-stone-100 hover:bg-white/10">View</button>
          )}
        </div>
      </div>
      {reviewOpen && entry.candidate && (
        <div role="dialog" aria-modal="true" aria-label={`Review series evidence for ${entry.title}`} className="mt-3 rounded-xl border border-[#c5a059]/50 bg-[#211628] p-4 text-sm text-stone-200">
          <p className="font-serif text-lg text-[#f3dbad]">Review series membership</p>
          <p className="mt-2 font-semibold">{entry.title}</p>
          <p>{entry.authors || 'Author unverified'}</p>
          <p className="mt-2">Proposed series: <strong>{entry.candidate.seriesName}</strong></p>
          <p>Proposed order: {entry.position === null ? 'Unverified' : entry.position}</p>
          <p>Catalog source: {entry.candidate.edition.source}</p>
          {entry.isbn && <p>ISBN: {entry.isbn}</p>}
          <p className="mt-2 text-[11px] text-stone-400">The catalog source is a discovery provider, not proof of series membership. Direct source links will appear only when a verified record URL is available.</p>
          <p className="mt-3 text-amber-200">The catalog has not independently verified this membership. Confirm it using a trusted publisher or author source before adding. Accepting adds this book through Inkbound's normal library save path; it does not verify other candidates.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold">Close / Reject</button>
            <button type="button" onClick={() => {
              const candidate = entry.candidate;
              if (!candidate || !window.confirm(`I independently verified that "${entry.title}" belongs to "${candidate.seriesName}". Add this book to my library?`)) return;
              window.dispatchEvent(new CustomEvent('inkbound:series-detective-save', { detail: { candidates: [candidate] } }));
              setReviewOpen(false);
            }} className="rounded-xl bg-[#c5a059] px-3 py-2 text-xs font-bold text-[#211128]">Confirm membership &amp; Add Book</button>
          </div>
        </div>
      )}
    </li>
  );
};

/** Read-only roster: every book in the series, owned or missing, with its details. */
export const SeriesDetectiveRoster: React.FC<Props> = ({ entries, onOpenBook }) => {
  const summary = summarizeSeriesRoster(entries);
  const missingEntries = entries.filter((entry) => entry.kind === 'missing' && entry.candidate?.verification === 'verified');
  const reviewCount = entries.filter((entry) => entry.kind === 'missing' && entry.candidate?.verification !== 'verified').length;
  const disconnectedEntries = entries.filter((entry) => entry.kind === 'owned' && entry.book && entry.candidate && !entry.book.work.seriesName?.trim());

  if (!entries.length) {
    return <p className="mt-3 text-sm text-stone-300">No books verified by available catalog evidence.</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-300">
          {summary.total} book(s): {summary.inLibrary} in your library, {summary.missing} not found in your library.
        </p>
        {reviewCount > 0 && <p className="text-xs text-amber-200">{reviewCount} candidate(s) need independent series verification before adding.</p>}
        {disconnectedEntries.length > 0 && <button type="button" onClick={() => {
          const books = disconnectedEntries.map((entry) => ({
            bookId: entry.book!.id,
            seriesName: entry.candidate!.seriesName,
            position: entry.candidate!.position,
          }));
          if (!window.confirm(`Connect ${books.length} existing book(s) to their verified series? Only empty series fields will be filled. No books will be added or removed.`)) return;
          window.dispatchEvent(new CustomEvent('inkbound:series-detective-connect', { detail: { books } }));
        }} className="rounded-xl border border-[#c5a059]/60 px-3 py-2 text-xs font-bold text-[#e5c158] hover:bg-[#c5a059]/10">Connect {disconnectedEntries.length} existing book(s) to series</button>}
        {missingEntries.length > 1 && (
          <button type="button" onClick={() => addEvent(missingEntries)} className="rounded-xl bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#211128] hover:bg-[#e4c47c]">Add All Missing</button>
        )}
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => <RosterRow key={entry.key} entry={entry} onOpenBook={onOpenBook} />)}
      </ul>
    </div>
  );
};
