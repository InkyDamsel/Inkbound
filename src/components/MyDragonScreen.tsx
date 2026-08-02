import React, { useMemo, useState } from 'react';
import { BookHeart, CalendarDays, Eye, Feather, Moon, Pencil, Sparkles, Sun } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

type DragonMotion = 'full' | 'reduced' | 'static';
type DragonVisibility = 'visible' | 'minimal' | 'hidden';

interface DragonProfile {
  id: string;
  name: string;
  hatchDay: string;
  motion: DragonMotion;
  visibility: DragonVisibility;
  ambientEffects: boolean;
  favoriteSleepingSpot: string;
}

interface MyDragonScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const DRAGON_KEY = 'inkbound_dragon';
const DEFAULT_DRAGON: DragonProfile = {
  id: 'library-dragon',
  name: 'Lumis',
  hatchDay: new Date().toISOString().slice(0, 10),
  motion: 'full',
  visibility: 'visible',
  ambientEffects: true,
  favoriteSleepingSpot: 'By the fireplace',
};

const stageForBooks = (finishedBooks: number) => {
  if (finishedBooks >= 500) return { name: 'Elder Library Dragon', next: null, threshold: 500 };
  if (finishedBooks >= 250) return { name: 'Ancient Book Dragon', next: 500, threshold: 250 };
  if (finishedBooks >= 100) return { name: 'Scholar Dragon', next: 250, threshold: 100 };
  if (finishedBooks >= 25) return { name: 'Young Dragon', next: 100, threshold: 25 };
  return { name: 'Hatchling', next: 25, threshold: 0 };
};

export const MyDragonScreen: React.FC<MyDragonScreenProps> = ({ books, sessions }) => {
  const [dragon, setDragon] = usePersistentState<DragonProfile>(DRAGON_KEY, DEFAULT_DRAGON);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(dragon.name);

  const finishedBooks = books.filter((book) => book.status === 'finished');
  const stage = stageForBooks(finishedBooks.length);
  const totalPages = finishedBooks.reduce((sum, book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    return sum + (edition?.pageCount ?? book.progressPages ?? 0);
  }, 0);
  const favoriteGenre = useMemo(() => {
    const counts = new Map<string, number>();
    finishedBooks.flatMap((book) => book.work.genres).forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Waiting for your first story';
  }, [finishedBooks]);
  const recentSession = [...sessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const currentMood = recentSession ? 'Content after reading together' : 'Curled up with a tiny book';
  const progress = stage.next ? Math.min(100, Math.round(((finishedBooks.length - stage.threshold) / (stage.next - stage.threshold)) * 100)) : 100;

  const saveName = () => {
    const name = draftName.trim();
    if (!name) return;
    setDragon((current) => ({ ...current, name }));
    setIsRenaming(false);
  };

  return (
    <section className="space-y-6 pb-12">
      <header className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <span className="inkbound-eyebrow">Project Lumis · Your reading companion</span>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {isRenaming ? (
                <div className="flex flex-wrap gap-2">
                  <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={28} className="min-h-11 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)] outline-none" autoFocus />
                  <button type="button" onClick={saveName} className="quiet-shelf-primary-action">Save name</button>
                </div>
              ) : (
                <>
                  <h2 className="font-serif text-4xl text-[var(--ink-ivory)] sm:text-5xl">{dragon.name}</h2>
                  <button type="button" onClick={() => setIsRenaming(true)} className="quiet-shelf-icon-button" aria-label="Rename your dragon"><Pencil /></button>
                </>
              )}
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
              Every Inkbound library is entrusted with a young dragon. {dragon.name} grows beside your reading life, quietly guarding every book, quote, and memory you bring home.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Growth stage</span><strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">{stage.name}</strong></div>
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Books together</span><strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">{finishedBooks.length}</strong></div>
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Pages guarded</span><strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">{totalPages.toLocaleString()}</strong></div>
            </div>
          </div>

          <div className="relative mx-auto flex min-h-72 w-full max-w-sm items-end justify-center overflow-hidden rounded-[2rem] border border-[var(--ink-border-subtle)] bg-[radial-gradient(circle_at_50%_25%,rgba(126,91,130,0.28),transparent_42%),linear-gradient(180deg,var(--ink-surface-raised),var(--ink-surface-soft))] p-6">
            {dragon.ambientEffects && <><span className="absolute left-[18%] top-[20%] h-1.5 w-1.5 rounded-full bg-[var(--ink-mauve)] opacity-70" /><span className="absolute right-[22%] top-[31%] h-2 w-2 rounded-full bg-[var(--ink-mauve)] opacity-50" /></>}
            {dragon.visibility !== 'hidden' ? (
              <div className={`${dragon.visibility === 'minimal' ? 'scale-75 opacity-80' : ''} text-center transition-all`}>
                <div className="select-none text-[8rem] leading-none drop-shadow-2xl" role="img" aria-label="A sleeping purple library dragon">🐉</div>
                <p className="mt-3 font-serif text-xl text-[var(--ink-ivory)]">{currentMood}</p>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{dragon.favoriteSleepingSpot}</p>
              </div>
            ) : <p className="text-center text-sm text-[var(--ink-muted)]">Your dragon is hidden, but your reading journey still helps it grow.</p>}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="inkbound-panel rounded-3xl p-6">
          <div className="flex items-center gap-3"><Sparkles className="text-[var(--ink-mauve)]" /><h3 className="font-serif text-2xl text-[var(--ink-ivory)]">Growing Together</h3></div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]"><span className="block h-full rounded-full bg-[var(--ink-mauve)]" style={{ width: `${progress}%` }} /></div>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">{stage.next ? `${stage.next - finishedBooks.length} more finished books until the next gentle growth stage.` : `${dragon.name} has reached the eldest known Library Dragon stage.`}</p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Favorite genre</dt><dd className="mt-1 text-[var(--ink-ivory)]">{favoriteGenre}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Hatch Day</dt><dd className="mt-1 text-[var(--ink-ivory)]">{new Date(`${dragon.hatchDay}T12:00:00`).toLocaleDateString()}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Favorite spot</dt><dd className="mt-1 text-[var(--ink-ivory)]">{dragon.favoriteSleepingSpot}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Sessions shared</dt><dd className="mt-1 text-[var(--ink-ivory)]">{sessions.length}</dd></div>
          </dl>
        </section>

        <section className="inkbound-panel rounded-3xl p-6">
          <div className="flex items-center gap-3"><Eye className="text-[var(--ink-mauve)]" /><h3 className="font-serif text-2xl text-[var(--ink-ivory)]">Comfort & Accessibility</h3></div>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Lumis never interrupts reading. Choose how quietly your companion lives in the library.</p>
          <label className="mt-5 block"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Motion</span><select value={dragon.motion} onChange={(event) => setDragon((current) => ({ ...current, motion: event.target.value as DragonMotion }))} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]"><option value="full">Full gentle motion</option><option value="reduced">Reduced motion</option><option value="static">Static</option></select></label>
          <label className="mt-4 block"><span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Dragon visibility</span><select value={dragon.visibility} onChange={(event) => setDragon((current) => ({ ...current, visibility: event.target.value as DragonVisibility }))} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]"><option value="visible">Visible</option><option value="minimal">Minimal</option><option value="hidden">Hidden</option></select></label>
          <button type="button" onClick={() => setDragon((current) => ({ ...current, ambientEffects: !current.ambientEffects }))} className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 text-left text-sm text-[var(--ink-ivory)]"><span className="inline-flex items-center gap-2">{dragon.ambientEffects ? <Moon className="h-4 w-4 text-[var(--ink-mauve)]" /> : <Sun className="h-4 w-4 text-[var(--ink-muted)]" />}Ambient room effects</span><strong>{dragon.ambientEffects ? 'On' : 'Off'}</strong></button>
        </section>
      </div>

      <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
        <div className="flex items-center gap-3"><Feather className="text-[var(--ink-mauve)]" /><h3 className="font-serif text-2xl text-[var(--ink-ivory)]">The Inkbound Promise</h3></div>
        <blockquote className="mt-4 max-w-3xl font-serif text-2xl leading-10 text-[var(--ink-ivory)]">“Inkbound doesn’t reward readers with points. It rewards them with memories.”</blockquote>
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]"><BookHeart className="h-4 w-4 text-[var(--ink-mauve)]" />Lumis never interrupts reading, creates guilt, or asks for attention.</p>
      </section>
    </section>
  );
};
