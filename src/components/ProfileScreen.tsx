import React, { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Camera,
  ImagePlus,
  Mail,
  Quote,
  Save,
  UserRound,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { ResponsiveGrid } from '../layout/responsive';
import { AccountSyncCard } from './account/AccountSyncCard';

interface ProfileScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const PROFILE_STORAGE_KEY = 'inkbound_reader_profile';

interface StoredProfile {
  displayName: string;
  email: string;
  favoriteQuote: string;
  bio: string;
  avatarImage?: string;
  bannerImage?: string;
}

const readStoredProfile = (): StoredProfile => {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as StoredProfile;
  } catch {
    // Fall back to defaults when stored profile data is invalid.
  }

  return {
    displayName: 'Jamie Lee',
    email: 'jamie@example.com',
    favoriteQuote: 'A reader lives a thousand lives before they die.',
    bio: 'A lifelong reader building a quiet, personal record of every book.',
  };
};

const readImageFile = (file: File, onLoad: (dataUrl: string) => void) => {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') onLoad(reader.result);
  };
  reader.readAsDataURL(file);
};

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ books, sessions }) => {
  const { userPlan } = useUserPlan();
  const initialProfile = useMemo(readStoredProfile, []);
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [email, setEmail] = useState(initialProfile.email);
  const [favoriteQuote, setFavoriteQuote] = useState(initialProfile.favoriteQuote);
  const [bio, setBio] = useState(initialProfile.bio);
  const [avatarImage, setAvatarImage] = useState<string | undefined>(initialProfile.avatarImage);
  const [bannerImage, setBannerImage] = useState<string | undefined>(initialProfile.bannerImage);
  const [saved, setSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const completedBooks = useMemo(
    () => books.filter((book) => book.status === 'finished').length,
    [books],
  );
  const totalMinutes = useMemo(
    () => sessions.reduce((total, session) => total + session.durationMinutes, 0),
    [sessions],
  );

  const initials =
    displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'JL';

  const handleSave = () => {
    const profile: StoredProfile = {
      displayName,
      email,
      favoriteQuote,
      bio,
      avatarImage,
      bannerImage,
    };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6 pb-20">
      <section className="inkbound-panel overflow-hidden rounded-3xl">
        <div
          className="relative h-40 bg-gradient-to-r from-[#38243d] via-[#6d425f] to-[#34243a] sm:h-52"
          style={
            bannerImage
              ? {
                  backgroundImage: `linear-gradient(rgba(20, 12, 22, 0.2), rgba(20, 12, 22, 0.35)), url(${bannerImage})`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                }
              : undefined
          }
        >
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readImageFile(file, setBannerImage);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => bannerInputRef.current?.click()}
            className="absolute right-4 top-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/20 bg-black/45 px-4 text-xs font-bold text-white backdrop-blur-sm transition hover:bg-black/60"
          >
            <ImagePlus className="h-4 w-4" />
            {bannerImage ? 'Change banner' : 'Add banner'}
          </button>
        </div>

        <div className="px-5 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-[var(--ink-surface)] bg-gradient-to-br from-[#78566e] to-[#2b1c30] font-serif text-3xl font-bold text-[var(--ink-ivory)] shadow-xl sm:h-28 sm:w-28">
                {avatarImage ? (
                  <img src={avatarImage} alt={`${displayName} profile`} className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) readImageFile(file, setAvatarImage);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] text-[var(--ink-gold)] shadow-lg"
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

      <AccountSyncCard />

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
            Favorite quote
            <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4">
              <Quote className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" />
              <input
                value={favoriteQuote}
                onChange={(event) => setFavoriteQuote(event.target.value)}
                placeholder="A line that stays with you"
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
