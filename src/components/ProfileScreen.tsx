import React, { useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Camera, Mail, MapPin, Save, UserRound } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { ResponsiveGrid } from '../layout/responsive';

interface ProfileScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ books, sessions }) => {
  const { userPlan } = useUserPlan();
  const [displayName, setDisplayName] = useState('Jamie Lee');
  const [email, setEmail] = useState('jamie@example.com');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('A lifelong reader building a quiet, personal record of every book.');
  const [saved, setSaved] = useState(false);

  const completedBooks = useMemo(
    () => books.filter((book) => book.status === 'finished').length,
    [books],
  );
  const totalMinutes = useMemo(
    () => sessions.reduce((total, session) => total + session.durationMinutes, 0),
    [sessions],
  );

  const handleSave = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6 pb-20">
      <section className="inkbound-panel overflow-hidden rounded-3xl">
        <div className="h-32 bg-gradient-to-r from-[#38243d] via-[#6d425f] to-[#34243a] sm:h-40" />
        <div className="px-5 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="relative grid h-24 w-24 place-items-center rounded-full border-4 border-[var(--ink-surface)] bg-gradient-to-br from-[#78566e] to-[#2b1c30] font-serif text-3xl font-bold text-[var(--ink-ivory)] shadow-xl sm:h-28 sm:w-28">
                JL
                <button
                  type="button"
                  className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] text-[var(--ink-gold)]"
                  aria-label="Change profile photo"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>
              <div className="pb-1">
                <p className="inkbound-kicker">Reader Profile</p>
                <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">{displayName}</h1>
                <p className="text-sm text-[var(--ink-muted)]">
                  {userPlan === 'premium' ? 'Inkbound Premium' : 'Free Plan'}
                </p>
              </div>
            </div>

            <button type="button" onClick={handleSave} className="quiet-shelf-primary-action px-5">
              <Save className="h-4 w-4" />
              {saved ? 'Saved' : 'Save Profile'}
            </button>
          </div>
        </div>
      </section>

      <ResponsiveGrid minItemWidth={190} maxColumns={3} gap={16}>
        <div className="inkbound-panel rounded-2xl p-5">
          <BookOpen className="h-5 w-5 text-[var(--ink-gold)]" />
          <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{completedBooks}</p>
          <p className="text-sm text-[var(--ink-muted)]">Books completed</p>
        </div>
        <div className="inkbound-panel rounded-2xl p-5">
          <CalendarDays className="h-5 w-5 text-[var(--ink-gold)]" />
          <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{sessions.length}</p>
          <p className="text-sm text-[var(--ink-muted)]">Reading sessions</p>
        </div>
        <div className="inkbound-panel rounded-2xl p-5">
          <UserRound className="h-5 w-5 text-[var(--ink-gold)]" />
          <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">
            {Math.round(totalMinutes / 60)}h
          </p>
          <p className="text-sm text-[var(--ink-muted)]">Time recorded</p>
        </div>
      </ResponsiveGrid>

      <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
        <div className="mb-6">
          <p className="inkbound-kicker">Personal Details</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Profile & account</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Manage the reader identity shown throughout Inkbound.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)]">
            Display name
            <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4">
              <UserRound className="h-4 w-4 text-[var(--ink-gold)]" />
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[var(--ink-ivory)] outline-none"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)]">
            Email address
            <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4">
              <Mail className="h-4 w-4 text-[var(--ink-gold)]" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[var(--ink-ivory)] outline-none"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)] md:col-span-2">
            Location
            <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4">
              <MapPin className="h-4 w-4 text-[var(--ink-gold)]" />
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Optional"
                className="min-w-0 flex-1 bg-transparent text-[var(--ink-ivory)] outline-none placeholder:text-[var(--ink-faint)]"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)] md:col-span-2">
            Reader bio
            <textarea
              rows={4}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              className="w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-[var(--ink-ivory)] outline-none"
            />
          </label>
        </div>
      </section>
    </div>
  );
};
