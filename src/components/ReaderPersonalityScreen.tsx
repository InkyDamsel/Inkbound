import React, { useMemo } from 'react';
import { BookOpen, Clock3, Compass, Headphones, Moon, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

type PersonalityView = 'overview' | 'traits' | 'evidence';

interface ReaderPersonalityScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

interface TraitResult {
  id: string;
  name: string;
  description: string;
  score: number;
  evidence: string;
  icon: React.ComponentType<{ className?: string }>;
}

const VIEW_KEY = 'inkbound_reader_personality_view';
const HIDDEN_KEY = 'inkbound_reader_personality_hidden_traits';

const countBy = (values: string[]) =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});

const topEntry = (counts: Record<string, number>) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

export const ReaderPersonalityScreen: React.FC<ReaderPersonalityScreenProps> = ({ books, sessions }) => {
  const [view, setView] = usePersistentState<PersonalityView>(VIEW_KEY, 'overview');
  const [hiddenTraits, setHiddenTraits] = usePersistentState<string[]>(HIDDEN_KEY, []);

  const traits = useMemo<TraitResult[]>(() => {
    const finished = books.filter((book) => book.status === 'finished');
    const genres = books.flatMap((book) => book.work.genres);
    const genreLeader = topEntry(countBy(genres));
    const locations = sessions.map((session) => session.location).filter((value): value is string => Boolean(value));
    const locationLeader = topEntry(countBy(locations));
    const sessionHours = sessions.map((session) => Number(session.startTime?.split(':')[0] ?? 12));
    const eveningSessions = sessionHours.filter((hour) => hour >= 18 || hour < 5).length;
    const audioBooks = books.filter((book) => {
      const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
      return edition?.format === 'audiobook';
    }).length;
    const averageMinutes = sessions.length
      ? Math.round(sessions.reduce((sum, session) => sum + session.durationMinutes, 0) / sessions.length)
      : 0;
    const completionRate = books.length ? Math.round((finished.length / books.length) * 100) : 0;

    return [
      {
        id: 'night-reader',
        name: 'Night Reader',
        description: 'Your reading life comes alive after the day quiets down.',
        score: sessions.length ? Math.round((eveningSessions / sessions.length) * 100) : 0,
        evidence: `${eveningSessions} of ${sessions.length} sessions began in the evening or overnight.`,
        icon: Moon,
      },
      {
        id: 'story-explorer',
        name: `${genreLeader?.[0] ?? 'Story'} Explorer`,
        description: 'You repeatedly return to the worlds and themes that feel most like home.',
        score: genres.length && genreLeader ? Math.round((genreLeader[1] / genres.length) * 100) : 0,
        evidence: `${genreLeader?.[0] ?? 'Your leading genre'} appears across ${genreLeader?.[1] ?? 0} library records.`,
        icon: Compass,
      },
      {
        id: 'slow-savorer',
        name: averageMinutes >= 35 ? 'Immersive Savorer' : 'Quick Chapter Reader',
        description: averageMinutes >= 35
          ? 'You settle into stories for long, absorbing stretches.'
          : 'You keep books close through short, steady reading moments.',
        score: Math.min(100, Math.round((averageMinutes / 60) * 100)),
        evidence: `Your average reading session lasts ${averageMinutes} minutes.`,
        icon: Clock3,
      },
      {
        id: 'completionist',
        name: completionRate >= 60 ? 'Story Completionist' : 'Curious Sampler',
        description: completionRate >= 60
          ? 'You like seeing the journeys you begin through to the final page.'
          : 'You give yourself permission to explore widely and move on when needed.',
        score: completionRate,
        evidence: `${finished.length} of ${books.length} tracked books are finished.`,
        icon: BookOpen,
      },
      {
        id: 'audio-companion',
        name: 'Audiobook Companion',
        description: 'Stories travel with you beyond the page.',
        score: books.length ? Math.round((audioBooks / books.length) * 100) : 0,
        evidence: `${audioBooks} books in your library use the audiobook format.`,
        icon: Headphones,
      },
      {
        id: 'reading-place',
        name: `${locationLeader?.[0] ?? 'Cozy'} Reader`,
        description: 'Your favorite reading environment is part of the ritual.',
        score: locations.length && locationLeader ? Math.round((locationLeader[1] / locations.length) * 100) : 0,
        evidence: `${locationLeader?.[0] ?? 'No location yet'} is your most-recorded reading place.`,
        icon: Sparkles,
      },
    ];
  }, [books, sessions]);

  const visibleTraits = traits.filter((trait) => !hiddenTraits.includes(trait.id));
  const primaryTrait = [...visibleTraits].sort((a, b) => b.score - a.score)[0];

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Your Reading Identity</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Reader Personality</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
          Inkbound learns from your real reading habits. Your personality evolves as you log books and sessions.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(['overview', 'traits', 'evidence'] as PersonalityView[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setView(item)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold capitalize ${
              view === item
                ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]'
                : 'border-[var(--ink-border)] text-[var(--ink-muted)]'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <section className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--ink-gold)]">Your leading trait</p>
              <h2 className="mt-4 font-serif text-4xl font-bold text-[var(--ink-ivory)]">
                {primaryTrait?.name ?? 'Your reading personality is still forming'}
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">
                {primaryTrait?.description ?? 'Log a few reading sessions and Inkbound will begin finding your patterns.'}
              </p>
              {primaryTrait && <p className="mt-5 text-sm text-[var(--ink-muted)]">{primaryTrait.evidence}</p>}
            </div>
            <div className="flex aspect-square items-center justify-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]">
              <span className="font-serif text-6xl font-bold text-[var(--ink-gold)]">{primaryTrait?.score ?? 0}%</span>
            </div>
          </div>
        </section>
      )}

      {(view === 'traits' || view === 'overview') && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleTraits.map((trait) => {
            const Icon = trait.icon;
            return (
              <article key={trait.id} className="inkbound-panel rounded-3xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-2xl bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-gold)]"><Icon className="h-6 w-6" /></span>
                  <button
                    type="button"
                    onClick={() => setHiddenTraits((current) => [...current, trait.id])}
                    className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]"
                  >
                    Hide
                  </button>
                </div>
                <h3 className="mt-5 font-serif text-xl font-bold text-[var(--ink-ivory)]">{trait.name}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{trait.description}</p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
                  <span className="block h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${trait.score}%` }} />
                </div>
                <p className="mt-2 text-right text-xs font-semibold text-[var(--ink-muted)]">{trait.score}% match</p>
              </article>
            );
          })}
        </section>
      )}

      {view === 'evidence' && (
        <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">How Inkbound reached this profile</h2>
          <div className="mt-5 space-y-3">
            {traits.map((trait) => (
              <div key={trait.id} className="rounded-2xl border border-[var(--ink-border-subtle)] p-4">
                <div className="flex items-center justify-between gap-4">
                  <strong className="text-[var(--ink-ivory)]">{trait.name}</strong>
                  <span className="text-sm text-[var(--ink-gold)]">{trait.score}%</span>
                </div>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{trait.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {hiddenTraits.length > 0 && (
        <button type="button" onClick={() => setHiddenTraits([])} className="quiet-shelf-secondary-action">
          Restore hidden traits
        </button>
      )}
    </div>
  );
};
