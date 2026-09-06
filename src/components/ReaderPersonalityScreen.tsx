import React, { useMemo } from 'react';
import { BookOpen, Clock3, Compass, Headphones, Moon, Sparkles, Sunrise, Layers3, Repeat2, Flame } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';

type PersonalityView = 'overview' | 'traits' | 'evidence';
type ConfidenceLevel = 'Still learning' | 'Emerging' | 'Good confidence' | 'High confidence';
type EvidenceSource = 'Inkbound activity' | 'Library metadata' | 'Verified import history';

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
  sampleSize: number;
  confidence: ConfidenceLevel;
  source: EvidenceSource;
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

const validSessionHour = (session: ReadingSession) => {
  const hour = Number(session.startTime?.split(':')[0]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
};

const confidenceFor = (sampleSize: number, medium = 8, high = 20): ConfidenceLevel => {
  if (sampleSize < 3) return 'Still learning';
  if (sampleSize < medium) return 'Emerging';
  if (sampleSize < high) return 'Good confidence';
  return 'High confidence';
};

const dayKey = (session: ReadingSession) => {
  const candidate = (session as unknown as Record<string, unknown>).date
    ?? (session as unknown as Record<string, unknown>).startedAt
    ?? (session as unknown as Record<string, unknown>).createdAt;
  if (typeof candidate !== 'string') return null;
  const match = candidate.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
};

const isImportedBook = (book: UserBookRecord) =>
  Boolean(book.sourceOfImport)
  || book.editions.some((edition) => edition.externalSource === 'import');

const hasTrustworthyImportedMetadata = (book: UserBookRecord) =>
  isImportedBook(book)
  && book.importMetadataVerified === true
  && book.importMetadataReviewNeeded !== true;

export const ReaderPersonalityScreen: React.FC<ReaderPersonalityScreenProps> = ({ books, sessions }) => {
  const [view, setView] = usePersistentState<PersonalityView>(VIEW_KEY, 'overview');
  const [hiddenTraits, setHiddenTraits] = usePersistentState<string[]>(HIDDEN_KEY, []);

  const profile = useMemo(() => {
    const completedSessions = sessions.filter((session) => getSessionDurationMinutes(session) > 0);
    const sessionBookIds = new Set(completedSessions.map((session) => session.bookId).filter(Boolean));

    const readingLifecycleBooks = books.filter((book) => ['currently-reading', 'finished', 'paused', 'dnf'].includes(book.status));
    const reviewNeededImports = books.filter((book) => isImportedBook(book) && book.importMetadataReviewNeeded === true);

    // Taste can use library metadata, including verified imports, but records explicitly
    // marked for review are excluded so questionable imported metadata cannot dominate traits.
    const tasteBooks = books.filter((book) => book.importMetadataReviewNeeded !== true);
    const genres = tasteBooks.flatMap((book) => book.work.genres).filter(Boolean);
    const genreLeader = topEntry(countBy(genres));
    const distinctGenres = new Set(genres.map((genre) => genre.toLowerCase())).size;

    // Behavioral traits come only from completed Inkbound sessions.
    const locations = completedSessions.map((session) => session.location?.trim()).filter((value): value is string => Boolean(value));
    const locationLeader = topEntry(countBy(locations));
    const sessionHours = completedSessions.map(validSessionHour).filter((hour): hour is number => hour !== null);
    const eveningSessions = sessionHours.filter((hour) => hour >= 18 || hour < 5).length;
    const morningSessions = sessionHours.filter((hour) => hour >= 5 && hour < 11).length;
    const totalSessionMinutes = completedSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const averageMinutes = completedSessions.length ? Math.round(totalSessionMinutes / completedSessions.length) : 0;
    const sessionDays = new Set(completedSessions.map(dayKey).filter(Boolean)).size;

    // Format preference is a taste signal, so reviewed/usable library metadata is allowed.
    const audioBooks = tasteBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook').length;

    // Completion behavior must not be inferred from an unverified imported status. We trust
    // native/manual Inkbound records, books with actual Inkbound sessions, and verified imports
    // only when the source export supplied a real historical finished date.
    const completionBooks = readingLifecycleBooks.filter((book) => {
      if (!isImportedBook(book)) return true;
      if (sessionBookIds.has(book.id)) return true;
      return hasTrustworthyImportedMetadata(book)
        && book.importFinishedDateProvided === true
        && Boolean(book.dateFinished);
    });
    const finished = completionBooks.filter((book) => book.status === 'finished');
    const completionRate = completionBooks.length ? Math.round((finished.length / completionBooks.length) * 100) : 0;

    // Parallel-reading behavior should reflect books Inkbound has actually seen in active use,
    // not a bulk-imported currently-reading shelf.
    const activeBooks = readingLifecycleBooks.filter((book) =>
      book.status === 'currently-reading'
      && (!isImportedBook(book) || sessionBookIds.has(book.id)),
    ).length;

    const repeatSessionBooks = completedSessions.reduce<Record<string, number>>((counts, session) => {
      const id = session.bookId;
      if (id) counts[id] = (counts[id] ?? 0) + 1;
      return counts;
    }, {});
    const repeatBooks = Object.values(repeatSessionBooks).filter((count) => count >= 3).length;

    const trustedImportedHistory = completionBooks.filter((book) => hasTrustworthyImportedMetadata(book)).length;
    const nativeLifecycleBooks = completionBooks.filter((book) => !isImportedBook(book)).length;

    const traits: TraitResult[] = [
      {
        id: 'night-reader', name: 'Night Reader',
        description: 'Your reading life comes alive after the day quiets down.',
        score: sessionHours.length ? Math.round((eveningSessions / sessionHours.length) * 100) : 0,
        evidence: sessionHours.length ? `${eveningSessions} of ${sessionHours.length} timed Inkbound reading sessions began between 6 PM and 5 AM.` : 'No completed Inkbound sessions with a valid start time have been recorded yet.',
        sampleSize: sessionHours.length, confidence: confidenceFor(sessionHours.length), source: 'Inkbound activity', icon: Moon,
      },
      {
        id: 'morning-reader', name: 'Morning Chapter Reader',
        description: 'Books are part of how you ease into the day.',
        score: sessionHours.length ? Math.round((morningSessions / sessionHours.length) * 100) : 0,
        evidence: sessionHours.length ? `${morningSessions} of ${sessionHours.length} timed Inkbound sessions began between 5 AM and 11 AM.` : 'Log timed Inkbound reading sessions to reveal whether mornings are part of your reading rhythm.',
        sampleSize: sessionHours.length, confidence: confidenceFor(sessionHours.length), source: 'Inkbound activity', icon: Sunrise,
      },
      {
        id: 'story-explorer', name: `${genreLeader?.[0] ?? 'Story'} Explorer`,
        description: 'You repeatedly return to the worlds and themes that feel most like home.',
        score: genres.length && genreLeader ? Math.round((genreLeader[1] / genres.length) * 100) : 0,
        evidence: genreLeader ? `${genreLeader[0]} appears across ${genreLeader[1]} of ${genres.length} usable genre tags. Imported records marked for review are excluded.` : 'Not enough trustworthy genre metadata yet.',
        sampleSize: tasteBooks.length, confidence: confidenceFor(tasteBooks.length, 10, 30), source: 'Library metadata', icon: Compass,
      },
      {
        id: 'genre-hopper', name: 'Genre Hopper',
        description: 'You like moving between different kinds of stories instead of staying in one lane.',
        score: tasteBooks.length ? Math.min(100, Math.round((distinctGenres / Math.max(1, Math.min(tasteBooks.length, 10))) * 100)) : 0,
        evidence: tasteBooks.length ? `${distinctGenres} distinct genres appear across ${tasteBooks.length} books with usable metadata. Imported records marked for review are excluded.` : 'Add books with trustworthy genre metadata to reveal how widely you roam.',
        sampleSize: tasteBooks.length, confidence: confidenceFor(tasteBooks.length, 10, 30), source: 'Library metadata', icon: Layers3,
      },
      {
        id: 'session-style', name: averageMinutes >= 35 ? 'Immersive Savorer' : 'Quick Chapter Reader',
        description: averageMinutes >= 35 ? 'You settle into stories for long, absorbing stretches.' : 'You keep books close through short, steady reading moments.',
        score: completedSessions.length ? Math.min(100, Math.round((averageMinutes / 60) * 100)) : 0,
        evidence: completedSessions.length ? `Your average completed Inkbound reading session lasts ${averageMinutes} minutes across ${completedSessions.length} sessions.` : 'Complete an Inkbound reading session to reveal your session style.',
        sampleSize: completedSessions.length, confidence: confidenceFor(completedSessions.length), source: 'Inkbound activity', icon: Clock3,
      },
      {
        id: 'completionist', name: completionRate >= 60 ? 'Story Completionist' : 'Curious Sampler',
        description: completionRate >= 60 ? 'You like seeing the journeys you begin through to the final page.' : 'You give yourself permission to explore widely and move on when needed.',
        score: completionRate,
        evidence: completionBooks.length ? `${finished.length} of ${completionBooks.length} books with trustworthy reading-history evidence are finished. Unverified imported finish statuses are excluded.` : 'Inkbound needs tracked reading activity or verified historical finish dates before estimating your completion pattern.',
        sampleSize: completionBooks.length, confidence: confidenceFor(completionBooks.length, 10, 30), source: trustedImportedHistory > 0 ? 'Verified import history' : 'Inkbound activity', icon: BookOpen,
      },
      {
        id: 'audio-companion', name: 'Audiobook Companion',
        description: 'Stories travel with you beyond the page.',
        score: tasteBooks.length ? Math.round((audioBooks / tasteBooks.length) * 100) : 0,
        evidence: `${audioBooks} ${audioBooks === 1 ? 'book uses' : 'books use'} an audiobook active edition among ${tasteBooks.length} books with usable format metadata.`,
        sampleSize: tasteBooks.length, confidence: confidenceFor(tasteBooks.length, 10, 30), source: 'Library metadata', icon: Headphones,
      },
      {
        id: 'reading-place', name: `${locationLeader?.[0] ?? 'Cozy'} Reader`,
        description: 'Your favorite reading environment is part of the ritual.',
        score: locations.length && locationLeader ? Math.round((locationLeader[1] / locations.length) * 100) : 0,
        evidence: locationLeader ? `${locationLeader[0]} is your most-recorded reading place across ${locations.length} completed Inkbound sessions with locations.` : 'No completed Inkbound session locations have been recorded yet.',
        sampleSize: locations.length, confidence: confidenceFor(locations.length), source: 'Inkbound activity', icon: Sparkles,
      },
      {
        id: 'multi-book', name: 'Parallel Reader',
        description: 'You are comfortable keeping more than one story in motion at a time.',
        score: Math.min(100, activeBooks * 25),
        evidence: `${activeBooks} ${activeBooks === 1 ? 'book is' : 'books are'} currently active in Inkbound reading behavior. Bulk-imported currently-reading statuses do not count until Inkbound sees activity.`,
        sampleSize: activeBooks, confidence: confidenceFor(activeBooks, 4, 7), source: 'Inkbound activity', icon: Repeat2,
      },
      {
        id: 'reading-rhythm', name: 'Reading Regular',
        description: 'Reading keeps finding its way back into your routine.',
        score: Math.min(100, sessionDays * 5),
        evidence: sessionDays ? `Your completed Inkbound sessions span ${sessionDays} distinct recorded reading days.` : 'Log Inkbound sessions on different days to reveal your reading rhythm.',
        sampleSize: sessionDays, confidence: confidenceFor(sessionDays, 8, 20), source: 'Inkbound activity', icon: Flame,
      },
    ];

    return {
      traits,
      completedSessions: completedSessions.length,
      trackedBooks: readingLifecycleBooks.length,
      trustworthyReadingBooks: completionBooks.length,
      nativeLifecycleBooks,
      trustedImportedHistory,
      reviewNeededImports: reviewNeededImports.length,
      tasteBooks: tasteBooks.length,
      sessionDays,
      repeatBooks,
    };
  }, [books, sessions]);

  const visibleTraits = profile.traits.filter((trait) => !hiddenTraits.includes(trait.id));
  const eligiblePrimaryTraits = visibleTraits.filter((trait) => trait.sampleSize >= 3);
  const primaryTrait = [...eligiblePrimaryTraits].sort((a, b) => b.score - a.score)[0];

  // Overall personality confidence is intentionally anchored to observed Inkbound behavior.
  // A giant imported library can strengthen taste traits, but it cannot make the user's
  // behavioral profile "High confidence" by itself.
  const behaviorEvidencePoints = profile.completedSessions
    + profile.sessionDays
    + Math.min(profile.nativeLifecycleBooks, 5)
    + Math.min(profile.trustedImportedHistory, 3);
  const profileConfidence = confidenceFor(behaviorEvidencePoints, 12, 30);

  return (
    <div className="space-y-7 pb-24">
      <header>
        <p className="inkbound-kicker">Your Reading Identity</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Reader Personality</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">Inkbound separates library taste from reading behavior. Imported metadata can help describe what you like, while habit-based traits grow from reading activity Inkbound can actually observe.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(['overview', 'traits', 'evidence'] as PersonalityView[]).map((item) => (
          <button key={item} type="button" onClick={() => setView(item)} className={`min-h-11 rounded-full border px-4 text-sm font-semibold capitalize ${view === item ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{item}</button>
        ))}
      </div>

      {view === 'overview' && (
        <>
          <section className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-9">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--ink-gold)]">{primaryTrait ? 'Your leading trait' : 'Your personality is forming'}</p>
                <h2 className="mt-4 break-words font-serif text-3xl font-bold text-[var(--ink-ivory)] sm:text-4xl">{primaryTrait?.name ?? 'Inkbound needs a little more reading evidence'}</h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">{primaryTrait?.description ?? 'Track at least a few books or complete a few reading sessions before Inkbound names a leading trait.'}</p>
                {primaryTrait && <p className="mt-5 text-sm text-[var(--ink-muted)]">{primaryTrait.evidence}</p>}
                <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-[var(--ink-border)] px-3 py-2 text-[var(--ink-gold)]">{profileConfidence}</span>
                  <span className="rounded-full border border-[var(--ink-border)] px-3 py-2 text-[var(--ink-muted)]">{profile.tasteBooks} usable library books</span>
                  <span className="rounded-full border border-[var(--ink-border)] px-3 py-2 text-[var(--ink-muted)]">{profile.completedSessions} completed sessions</span>
                </div>
              </div>
              <div className="mx-auto flex aspect-square w-full max-w-[280px] flex-col items-center justify-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]">
                <span className="font-serif text-5xl font-bold text-[var(--ink-gold)] sm:text-6xl">{primaryTrait?.score ?? '—'}{primaryTrait ? '%' : ''}</span>
                <span className="mt-2 text-xs font-semibold text-[var(--ink-muted)]">{primaryTrait?.confidence ?? 'Still learning'}</span>
              </div>
            </div>
          </section>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="inkbound-panel rounded-2xl p-5"><p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Behavior evidence</p><p className="mt-2 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{profile.completedSessions}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">completed Inkbound sessions</p></div>
            <div className="inkbound-panel rounded-2xl p-5"><p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Reading days</p><p className="mt-2 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{profile.sessionDays}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">days represented by sessions</p></div>
            <div className="inkbound-panel rounded-2xl p-5"><p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Profile status</p><p className="mt-2 font-serif text-xl font-bold text-[var(--ink-ivory)]">{profileConfidence}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">confidence grows with observed activity</p></div>
          </section>
        </>
      )}

      {(view === 'traits' || view === 'overview') && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleTraits.map((trait) => {
            const Icon = trait.icon;
            return (
              <article key={trait.id} className="inkbound-panel min-w-0 rounded-3xl p-6">
                <div className="flex items-start justify-between gap-4"><span className="rounded-2xl bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-gold)]"><Icon className="h-6 w-6" /></span><button type="button" onClick={() => setHiddenTraits((current) => current.includes(trait.id) ? current : [...current, trait.id])} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--ink-surface-soft)] hover:text-[var(--ink-ivory)]" aria-label={`Hide ${trait.name} trait`}>Hide</button></div>
                <h3 className="mt-5 break-words font-serif text-xl font-bold text-[var(--ink-ivory)]">{trait.name}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{trait.description}</p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]"><span className="block h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${trait.score}%` }} /></div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold"><span className="text-[var(--ink-muted)]">{trait.confidence} · {trait.sampleSize} signals</span><span className="text-[var(--ink-gold)]">{trait.score}% match</span></div>
              </article>
            );
          })}
        </section>
      )}

      {view === 'evidence' && (
        <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">How Inkbound reached this profile</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">Taste traits may use trustworthy library metadata. Habit traits use completed Inkbound sessions. Imported records marked for review do not strengthen personality confidence or behavior claims.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-[var(--ink-border)] px-3 py-2 text-[var(--ink-muted)]">{profile.completedSessions} Inkbound sessions</span>
            <span className="rounded-full border border-[var(--ink-border)] px-3 py-2 text-[var(--ink-muted)]">{profile.trustworthyReadingBooks} trustworthy reading-history books</span>
            <span className="rounded-full border border-[var(--ink-border)] px-3 py-2 text-[var(--ink-muted)]">{profile.trustedImportedHistory} verified imported finishes</span>
            {profile.reviewNeededImports > 0 && <span className="rounded-full border border-[var(--ink-gold)] px-3 py-2 text-[var(--ink-gold)]">{profile.reviewNeededImports} imported records excluded pending review</span>}
          </div>
          <div className="mt-5 space-y-3">
            {profile.traits.map((trait) => (
              <div key={trait.id} className="rounded-2xl border border-[var(--ink-border-subtle)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-4"><strong className="break-words text-[var(--ink-ivory)]">{trait.name}</strong><span className="text-sm text-[var(--ink-gold)]">{trait.score}% · {trait.confidence}</span></div>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{trait.evidence}</p>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">Evidence source: {trait.source} · Sample: {trait.sampleSize}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {hiddenTraits.length > 0 && <button type="button" onClick={() => setHiddenTraits([])} className="quiet-shelf-secondary-action min-h-11 w-full justify-center sm:w-auto">Restore hidden traits</button>}
    </div>
  );
};