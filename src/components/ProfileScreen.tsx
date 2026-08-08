import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { ReadingSession, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { useAccountSync } from '../context/AccountSyncContext';
import { ResponsiveGrid } from '../layout/responsive';
import { notifyLocalDataChanged } from '../features/sync/cloudSyncEvents';
import { db, storage } from '../lib/firebase';
import { AccountSyncCard } from './account/AccountSyncCard';

interface ProfileScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const PROFILE_STORAGE_KEY = 'inkbound_reader_profile';
const IMAGE_UPLOAD_TIMEOUT_MS = 15000;
const PROFILE_WRITE_TIMEOUT_MS = 8000;

interface StoredProfile {
  displayName: string;
  email: string;
  favoriteQuote: string;
  bio: string;
  avatarImage?: string;
  bannerImage?: string;
}

const DEFAULT_PROFILE: StoredProfile = {
  displayName: 'Jamie Lee',
  email: 'jamie@example.com',
  favoriteQuote: 'A reader lives a thousand lives before they die.',
  bio: 'A lifelong reader building a quiet, personal record of every book.',
};

const isTemporaryImageUrl = (value?: string) =>
  Boolean(value?.startsWith('data:image/') || value?.startsWith('blob:'));

const readStoredProfile = (): StoredProfile => {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (stored) return { ...DEFAULT_PROFILE, ...(JSON.parse(stored) as Partial<StoredProfile>) };
  } catch {
    // Fall back to defaults when stored profile data is invalid.
  }
  return DEFAULT_PROFILE;
};

const saveStoredProfile = (profile: StoredProfile) => {
  const storedProfile: StoredProfile = {
    ...profile,
    avatarImage: isTemporaryImageUrl(profile.avatarImage) ? undefined : profile.avatarImage,
    bannerImage: isTemporaryImageUrl(profile.bannerImage) ? undefined : profile.bannerImage,
  };

  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(storedProfile));
    notifyLocalDataChanged([PROFILE_STORAGE_KEY]);
  } catch (error) {
    console.error('Inkbound could not store the reader profile on this device.', error);
  }
};

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function optimizeProfileBlob(source: Blob, kind: 'avatar' | 'banner'): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return source;

  try {
    const bitmap = await createImageBitmap(source);
    const maximumWidth = kind === 'avatar' ? 384 : 1200;
    const maximumHeight = kind === 'avatar' ? 384 : 480;
    const scale = Math.min(1, maximumWidth / bitmap.width, maximumHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      bitmap.close();
      return source;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ?? source),
        'image/webp',
        kind === 'avatar' ? 0.78 : 0.68,
      );
    });
  } catch {
    return source;
  }
}

async function uploadProfileFile(
  uid: string,
  kind: 'avatar' | 'banner',
  file: File,
): Promise<string> {
  if (!storage) throw new Error('Profile image storage is unavailable.');

  const optimized = await optimizeProfileBlob(file, kind);
  const extension = optimized.type === 'image/webp' ? 'webp' : 'jpg';
  const fingerprint = `${file.size}-${file.lastModified}-${Date.now()}`;
  const imageRef = ref(storage, `users/${uid}/profile/${kind}-${fingerprint}.${extension}`);

  await withTimeout(
    uploadBytes(imageRef, optimized, {
      contentType: optimized.type || 'image/jpeg',
      cacheControl: 'public,max-age=31536000,immutable',
    }),
    IMAGE_UPLOAD_TIMEOUT_MS,
    `${kind} upload timed out.`,
  );

  return withTimeout(
    getDownloadURL(imageRef),
    IMAGE_UPLOAD_TIMEOUT_MS,
    `${kind} download URL timed out.`,
  );
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ books, sessions }) => {
  const { userPlan } = useUserPlan();
  const sync = useAccountSync();
  const initialProfile = useMemo(readStoredProfile, []);
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [email, setEmail] = useState(initialProfile.email);
  const [favoriteQuote, setFavoriteQuote] = useState(initialProfile.favoriteQuote);
  const [bio, setBio] = useState(initialProfile.bio);
  const [avatarImage, setAvatarImage] = useState<string | undefined>(initialProfile.avatarImage);
  const [bannerImage, setBannerImage] = useState<string | undefined>(initialProfile.bannerImage);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [imageSyncStatus, setImageSyncStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const avatarPreviewUrlRef = useRef<string | null>(null);
  const bannerPreviewUrlRef = useRef<string | null>(null);
  const imageRequestRef = useRef(0);

  const releasePreviewUrl = (previewRef: React.MutableRefObject<string | null>) => {
    if (!previewRef.current) return;
    URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  };

  useEffect(() => {
    if (!sync.user) return;

    const restoredProfile = readStoredProfile();
    const nextDisplayName = sync.user.displayName?.trim() || restoredProfile.displayName;
    const nextEmail = sync.user.email?.trim() || restoredProfile.email;
    const nextAvatarImage = restoredProfile.avatarImage || sync.user.photoURL || undefined;

    setDisplayName(nextDisplayName);
    setEmail(nextEmail);
    setFavoriteQuote(restoredProfile.favoriteQuote);
    setBio(restoredProfile.bio);
    setAvatarImage(nextAvatarImage);
    setBannerImage(restoredProfile.bannerImage);

    saveStoredProfile({
      ...restoredProfile,
      displayName: nextDisplayName,
      email: nextEmail,
      avatarImage: nextAvatarImage,
    });
  }, [sync.user?.uid]);

  useEffect(
    () => () => {
      releasePreviewUrl(avatarPreviewUrlRef);
      releasePreviewUrl(bannerPreviewUrlRef);
    },
    [],
  );

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

  const durableProfileFromState = (): StoredProfile => {
    const persisted = readStoredProfile();
    return {
      displayName,
      email,
      favoriteQuote,
      bio,
      avatarImage: isTemporaryImageUrl(avatarImage) ? persisted.avatarImage : avatarImage,
      bannerImage: isTemporaryImageUrl(bannerImage) ? persisted.bannerImage : bannerImage,
    };
  };

  const writeCloudProfile = async (profile: StoredProfile) => {
    if (!sync.user || !db) return;
    await withTimeout(
      setDoc(
        doc(db, 'users', sync.user.uid, 'profile', 'current'),
        {
          data: profile,
          updatedAt: serverTimestamp(),
          clientUpdatedAt: new Date().toISOString(),
        },
        { merge: true },
      ),
      PROFILE_WRITE_TIMEOUT_MS,
      'Profile cloud write timed out.',
    );
  };

  const selectProfileImage = (file: File, kind: 'avatar' | 'banner') => {
    if (!file.type.startsWith('image/')) return;

    const requestId = imageRequestRef.current + 1;
    imageRequestRef.current = requestId;
    setImageSyncStatus('uploading');
    setSaveStatus('idle');

    if (kind === 'avatar') {
      releasePreviewUrl(avatarPreviewUrlRef);
      const previewUrl = URL.createObjectURL(file);
      avatarPreviewUrlRef.current = previewUrl;
      setAvatarImage(previewUrl);
    } else {
      releasePreviewUrl(bannerPreviewUrlRef);
      const previewUrl = URL.createObjectURL(file);
      bannerPreviewUrlRef.current = previewUrl;
      setBannerImage(previewUrl);
    }

    if (!sync.user || !db || !storage) {
      setImageSyncStatus('error');
      return;
    }

    // Image persistence is independent from Save Profile. The upload starts as
    // soon as the reader chooses a file, then writes the durable URL to the profile.
    void uploadProfileFile(sync.user.uid, kind, file)
      .then(async (url) => {
        if (imageRequestRef.current !== requestId) return;

        const profile = readStoredProfile();
        const nextProfile: StoredProfile = {
          ...profile,
          displayName,
          email,
          favoriteQuote,
          bio,
          ...(kind === 'avatar' ? { avatarImage: url } : { bannerImage: url }),
        };

        saveStoredProfile(nextProfile);
        await writeCloudProfile(nextProfile);

        if (imageRequestRef.current !== requestId) return;
        if (kind === 'avatar') {
          releasePreviewUrl(avatarPreviewUrlRef);
          setAvatarImage(url);
        } else {
          releasePreviewUrl(bannerPreviewUrlRef);
          setBannerImage(url);
        }
        setImageSyncStatus('idle');
      })
      .catch((error) => {
        console.error(`Inkbound could not save the ${kind}.`, error);
        if (imageRequestRef.current === requestId) setImageSyncStatus('error');
      });
  };

  const handleSave = () => {
    const profile = durableProfileFromState();

    // Save locally immediately. Cloud work is intentionally background-only so
    // the button never waits on a network round trip or image upload.
    saveStoredProfile(profile);
    setSaveStatus('saved');
    window.setTimeout(() => setSaveStatus('idle'), 1800);

    if (!sync.user || !db) return;
    void writeCloudProfile(profile).catch((error) => {
      console.error('Inkbound could not sync the reader profile.', error);
      setSaveStatus('error');
    });
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
              if (file) selectProfileImage(file, 'banner');
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
                  <img
                    src={avatarImage}
                    alt={`${displayName} profile`}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
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
                    if (file) selectProfileImage(file, 'avatar');
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

            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <button type="button" onClick={handleSave} className="quiet-shelf-primary-action px-5">
                <Save className="h-4 w-4" />
                {saveStatus === 'saved' ? 'Saved' : 'Save Profile'}
              </button>
              {imageSyncStatus === 'uploading' ? (
                <p className="text-xs text-[var(--ink-muted)]">Finishing image sync in the background…</p>
              ) : null}
              {imageSyncStatus === 'error' ? (
                <p className="text-xs text-rose-400">Image could not sync. Choose it again to retry.</p>
              ) : null}
              {saveStatus === 'error' ? (
                <p className="text-xs text-rose-400">Saved on this device. Cloud sync will retry.</p>
              ) : null}
            </div>
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
            Email
            <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4">
              <Mail className="h-4 w-4 text-[var(--ink-gold)]" />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[var(--ink-ivory)] outline-none"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)] md:col-span-2">
            Favorite quote
            <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4">
              <Quote className="h-4 w-4 text-[var(--ink-gold)]" />
              <input
                value={favoriteQuote}
                onChange={(event) => setFavoriteQuote(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[var(--ink-ivory)] outline-none"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)] md:col-span-2">
            Bio
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 py-3 text-[var(--ink-ivory)] outline-none"
            />
          </label>
        </div>
      </section>
    </div>
  );
};
