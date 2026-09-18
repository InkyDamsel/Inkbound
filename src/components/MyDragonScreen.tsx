import React, { useMemo, useState } from 'react';
import { BookHeart, Feather, Pencil, Sparkles } from 'lucide-react';
import { Format, ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { isInkboundFinishedBook } from '../features/reading/inkboundActivity';

interface DragonProfile { id: string; name: string; }
interface MyDragonScreenProps { books: UserBookRecord[]; sessions: ReadingSession[]; }

const DRAGON_KEY = 'inkbound_dragon';
const AWAKE_LUMIS_ASSET = '/assets/lumis/lumis-awake.svg';
const SLEEPING_LUMIS_ASSET = '/assets/lumis/lumis-sleeping.svg';
const LUMIS_BANNER_ASSET = '/assets/lumis/cozy-lumis-background.png';
const RECENT_READING_WINDOW_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DRAGON: DragonProfile = { id: 'library-dragon', name: 'Lumis' };
const FORMAT_LABELS: Record<Format, string> = { hardcover: 'Hardcover', paperback: 'Paperback', ebook: 'eBook', audiobook: 'Audiobook' };

const timeToMinutes = (value?: string): number | null => {
  if (!value) return null;
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText); const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};
const getSessionTimestamp = (session: ReadingSession): number => {
  const dateMatch = session.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return Number.NEGATIVE_INFINITY;
  const [, y, m, d] = dateMatch; const year = Number(y); const month = Number(m); const day = Number(d);
  if (![year, month, day].every(Number.isFinite)) return Number.NEGATIVE_INFINITY;
  const startMinutes = timeToMinutes(session.startTime); const endMinutes = timeToMinutes(session.endTime);
  const selectedMinutes = endMinutes ?? startMinutes ?? 720;
  const timestamp = new Date(year, month - 1, day, Math.floor(selectedMinutes / 60), selectedMinutes % 60, 0, 0);
  if (endMinutes !== null && startMinutes !== null && endMinutes < startMinutes) timestamp.setDate(timestamp.getDate() + 1);
  return Number.isFinite(timestamp.getTime()) ? timestamp.getTime() : Number.NEGATIVE_INFINITY;
};
const getReadingDaypart = (startTime: string): string => {
  const hour = Number.parseInt(startTime.split(':')[0] ?? '', 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return 'Still discovering';
  if (hour >= 5 && hour < 12) return 'Mornings'; if (hour < 17) return 'Afternoons'; if (hour < 21) return 'Evenings'; return 'Nights';
};
const formatSessionDuration = (minutes: number): string => {
  if (minutes <= 0) return 'No sessions yet'; const hours = Math.floor(minutes / 60); const remaining = minutes % 60;
  if (hours === 0) return `${remaining} min`; if (remaining === 0) return `${hours} hr`; return `${hours} hr ${remaining} min`;
};

export const MyDragonScreen: React.FC<MyDragonScreenProps> = ({ books, sessions }) => {
  const [dragon, setDragon] = usePersistentState<DragonProfile>(DRAGON_KEY, DEFAULT_DRAGON);
  const [isRenaming, setIsRenaming] = useState(false); const [draftName, setDraftName] = useState(dragon.name);
  const completedSessions = useMemo(() => sessions.filter((session) => getSessionDurationMinutes(session) > 0 && Number.isFinite(getSessionTimestamp(session))), [sessions]);
  const trackedBookIds = useMemo(() => new Set(completedSessions.map((session) => session.bookId)), [completedSessions]);
  const finishedBooks = useMemo(() => books.filter((book) => isInkboundFinishedBook(book, trackedBookIds)), [books, trackedBookIds]);
  const totalPages = completedSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
  const favoriteGenre = useMemo(() => { const counts = new Map<string, number>(); finishedBooks.flatMap((book) => book.work.genres).forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1)); return [...counts.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? 'Still discovering'; }, [finishedBooks]);
  const favoriteFormat = useMemo(() => { const counts = new Map<Format, number>(); finishedBooks.forEach((book) => { const edition = getActiveEdition(book); if (edition) counts.set(edition.format, (counts.get(edition.format) ?? 0) + 1); }); const format = [...counts.entries()].sort((a,b) => b[1]-a[1])[0]?.[0]; return format ? FORMAT_LABELS[format] : 'Still discovering'; }, [finishedBooks]);
  const favoriteReadingTime = useMemo(() => { const counts = new Map<string, number>(); completedSessions.forEach((session) => { const part = getReadingDaypart(session.startTime); if (part !== 'Still discovering') counts.set(part, (counts.get(part) ?? 0) + 1); }); return [...counts.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? 'Still discovering'; }, [completedSessions]);
  const longestReadingSession = useMemo(() => formatSessionDuration(Math.max(0, ...completedSessions.map(getSessionDurationMinutes))), [completedSessions]);
  const recentSession = useMemo(() => [...completedSessions].sort((a,b) => getSessionTimestamp(b)-getSessionTimestamp(a))[0], [completedSessions]);
  const recentTimestamp = recentSession ? getSessionTimestamp(recentSession) : Number.NEGATIVE_INFINITY;
  const isAwakePose = Number.isFinite(recentTimestamp) && recentTimestamp <= Date.now() && Date.now() - recentTimestamp <= RECENT_READING_WINDOW_MS;
  const lumisPortrait = isAwakePose ? { src: AWAKE_LUMIS_ASSET, alt: `${dragon.name}, an alert purple library dragon`, title: `${dragon.name} is curled up by your newest book`, detail: 'Eager for your next adventure.' } : { src: SLEEPING_LUMIS_ASSET, alt: `${dragon.name}, a sleeping purple library dragon`, title: `${dragon.name} is resting after a day of stories`, detail: "Dreaming of tomorrow's adventures." };
  const saveName = () => { const name = draftName.trim(); if (!name) return; setDragon((current) => ({ ...current, name })); setIsRenaming(false); };

  return <section className="space-y-6 pb-12">
    <header className="inkbound-artwork-hero relative overflow-hidden rounded-3xl border border-[var(--ink-border-subtle)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
      <div aria-hidden="true" className="pointer-events-none absolute -inset-3 scale-[1.035] bg-cover bg-center bg-no-repeat blur-[3px]" style={{ backgroundImage: `url("${LUMIS_BANNER_ASSET}")` }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,8,18,.86)_0%,rgba(9,8,18,.68)_42%,rgba(9,8,18,.30)_72%,rgba(9,8,18,.18)_100%)]" />
      <div className="relative z-10 grid min-h-[430px] gap-7 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,430px)] lg:items-center lg:p-10">
        <div className="max-w-3xl rounded-[1.75rem] border border-white/10 bg-black/25 p-5 backdrop-blur-[3px] sm:p-7">
          <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#e0c77c]">Project Lumis · Your reading companion</span>
          <div className="mt-3 flex flex-wrap items-center gap-3">{isRenaming ? <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><input value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={28} className="min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-white outline-none sm:w-auto" autoFocus/><button type="button" onClick={saveName} className="quiet-shelf-primary-action w-full justify-center sm:w-auto">Save name</button></div> : <><h2 className="font-serif text-4xl text-white sm:text-5xl">{dragon.name}</h2><button type="button" onClick={() => setIsRenaming(true)} className="quiet-shelf-icon-button border border-white/10 bg-black/20 text-white" aria-label="Rename your dragon"><Pencil /></button></>}</div>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/80 sm:text-base">Every Inkbound library is entrusted with a young dragon. {dragon.name} shares your reading life, quietly keeping company with every book, quote, and memory you bring home.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">{[['Reading Together', `${finishedBooks.length} books`], ['Sessions Shared', `${completedSessions.length}`], ['Pages Read Together', totalPages.toLocaleString()]].map(([label,value]) => <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur-[2px]"><span className="text-xs uppercase tracking-wider text-white/60">{label}</span><strong className="mt-2 block font-serif text-xl text-white">{value}</strong></div>)}</div>
        </div>
        <div className="relative mx-auto w-full max-w-[430px] overflow-hidden rounded-[2rem] border border-white/15 bg-[rgba(12,10,18,.34)] shadow-[0_24px_60px_rgba(0,0,0,0.30)] backdrop-blur-[3px]"><img src={lumisPortrait.src} alt={lumisPortrait.alt} className="block h-auto w-full object-contain"/><div className="border-t border-white/10 bg-black/35 px-5 py-4 text-center backdrop-blur-[3px]"><p className="font-serif text-xl leading-snug text-[#f1e8df] sm:text-2xl">{lumisPortrait.title}</p><p className="mt-1.5 text-sm text-white/65">{lumisPortrait.detail}</p></div></div>
      </div>
    </header>
    <section className="inkbound-panel rounded-3xl p-6 sm:p-8"><div className="flex items-center gap-3"><Sparkles className="text-[var(--ink-mauve)]"/><h3 className="font-serif text-2xl text-[var(--ink-ivory)]">About {dragon.name}</h3></div><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">{dragon.name} quietly reflects the reading habits you've built together.</p><dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{[['Favorite genre',favoriteGenre],['Favorite format',favoriteFormat],['Favorite reading time',favoriteReadingTime],['Longest reading session',longestReadingSession]].map(([label,value]) => <div key={label} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5"><dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">{label}</dt><dd className="mt-2 break-words font-serif text-xl text-[var(--ink-ivory)]">{value}</dd></div>)}</dl></section>
    <section className="inkbound-panel rounded-3xl p-6 sm:p-8"><div className="flex items-center gap-3"><Feather className="text-[var(--ink-mauve)]"/><h3 className="font-serif text-2xl text-[var(--ink-ivory)]">The Inkbound Promise</h3></div><blockquote className="mt-4 max-w-3xl font-serif text-2xl leading-10 text-[var(--ink-ivory)]">“Inkbound doesn’t reward readers with points. It rewards them with memories.”</blockquote><p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]"><BookHeart className="h-4 w-4 text-[var(--ink-mauve)]"/>Lumis never interrupts reading, creates guilt, or asks for attention.</p></section>
  </section>;
};