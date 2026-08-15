import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ReadingSession, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { useAccountSync } from '../context/AccountSyncContext';
import { ResponsiveGrid } from '../layout/responsive';
import { getSessionDurationMinutes } from '../features/reading/sessionAnalytics';
import { readRuntimeJson, writeRuntimeJson } from '../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  notifyLocalDataChanged,
  type CloudDataUpdatedDetail,
} from '../features/sync/cloudSyncEvents';
import { db } from '../lib/firebase';
import { AccountSyncCard } from './account/AccountSyncCard';

interface ProfileScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const PROFILE_STORAGE_KEY = 'inkbound_reader_profile';
const PROFILE_WRITE_TIMEOUT_MS = 8000;
const MAX_AVATAR_DATA_LENGTH = 140_000;
const MAX_BANNER_DATA_LENGTH = 475_000;
const MAX_PROFILE_SOURCE_BYTES = 12 * 1024 * 1024;

interface StoredProfile {
  displayName: string;
  email: string;
  favoriteQuote: string;
  bio: string;
  avatarImage?: string;
  bannerImage?: string;
  avatarImageData?: string;
  bannerImageData?: string;
}

const EMPTY_PROFILE: StoredProfile = {
  displayName: '',
  email: '',
  favoriteQuote: '',
  bio: '',
};

const isTemporaryImageUrl = (value?: string) => Boolean(value?.startsWith('blob:'));

const readStoredProfile = (): StoredProfile => ({
  ...EMPTY_PROFILE,
  ...readRuntimeJson<Partial<StoredProfile>>(PROFILE_STORAGE_KEY, {}),
});

const saveStoredProfile = (profile: StoredProfile) => {
  const storedProfile: StoredProfile = {
    ...profile,
    avatarImage: isTemporaryImageUrl(profile.avatarImage) ? undefined : profile.avatarImage,
    bannerImage: isTemporaryImageUrl(profile.bannerImage) ? undefined : profile.bannerImage,
  };

  if (!writeRuntimeJson(PROFILE_STORAGE_KEY, storedProfile)) {
    console.error('Inkbound could not store the reader profile on this device.');
    return;
  }
  notifyLocalDataChanged([PROFILE_STORAGE_KEY]);
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

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The selected image could not be read.'));
    image.src = objectUrl;
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(objectUrl),
  };
}

async function prepareProfileImage(file: File, kind: 'avatar' | 'banner'): Promise<string> {
  const decoded = await decodeImage(file);

  try {
    const maxLength = kind === 'avatar' ? MAX_AVATAR_DATA_LENGTH : MAX_BANNER_DATA_LENGTH;
    let maximumWidth = kind === 'avatar' ? 360 : 1100;
    let maximumHeight = kind === 'avatar' ? 360 : 440;
    let quality = kind === 'avatar' ? 0.74 : 0.62;
    let bestResult = '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, maximumWidth / decoded.width, maximumHeight / decoded.height);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Inkbound could not prepare the selected image.');

      context.drawImage(decoded.source, 0, 0, width, height);
      const result = canvas.toDataURL('image/webp', quality);
      bestResult = result;
      if (result.length <= maxLength) return result;

      maximumWidth = Math.round(maximumWidth * 0.82);
      maximumHeight = Math.round(maximumHeight * 0.82);
      quality = Math.max(0.42, quality - 0.08);
    }

    if (bestResult.length > maxLength) {
      throw new Error('The selected image is still too large after optimization.');
    }
    return bestResult;
  } finally {
    decoded.release();
  }
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ books, sessions }) => {
  const { userPlan } = useUserPlan();
  const sync = useAccountSync();
  const initialProfile = useMemo(readStoredProfile, []);
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [email, setEmail] = useState(initialProfile.email);
  const [favoriteQuote, setFavoriteQuote] = useState(initialProfile.favoriteQuote);
  const [bio, setBio] = useState(initialProfile.bio);
  const [avatarImage, setAvatarImage] = useState<string | undefined>(
    initialProfile.avatarImageData || initialProfile.avatarImage,
  );
  const [bannerImage, setBannerImage] = useState<string | undefined>(
    initialProfile.bannerImageData || initialProfile.bannerImage,
  );
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [imageStatus, setImageStatus] = useState<'idle' | 'preparing' | 'error'>('idle');
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

  const loadProfileIntoState = useCallback(() => {
    if (!sync.user) return;

    const restoredProfile = readStoredProfile();
    const storedDisplayName = restoredProfile.displayName.trim();
    const authDisplayName = sync.user.displayName?.trim() || '';
    const nextDisplayName = storedDisplayName || authDisplayName || 'Reader';
    const nextEmail = sync.user.email?.trim() || restoredProfile.email;
    const nextAvatarImage =
      restoredProfile.avatarImageData || restoredProfile.avatarImage || sync.user.photoURL || undefined;

    setDisplayName(nextDisplayName);
    setEmail(nextEmail);
    setFavoriteQuote(restoredProfile.favoriteQuote);
    setBio(restoredProfile.bio);
    setAvatarImage(nextAvatarImage);
    setBannerImage(restoredProfile.bannerImageData || restoredProfile.bannerImage);
  }, [sync.user]);

  useEffect(() => {
    if (!sync.user) return undefined;

    const restoredProfile = readStoredProfile();
    const storedDisplayName = restoredProfile.displayName.trim();
    const authDisplayName = sync.user.displayName?.trim() || '';
    const authEmail = sync.user.email?.trim() || '';
    const authPhoto = sync.user.photoURL || undefined;

    const identityProfile: StoredProfile = {
      ...restoredProfile,
      displayName: storedDisplayName || authDisplayName,
      email: restoredProfile.email || authEmail,
      avatarImage: restoredProfile.avatarImage || authPhoto,
    };

    if (JSON.stringify(identityProfile) !== JSON.stringify(restoredProfile)) {
      saveStoredProfile(identityProfile);
    }
    loadProfileIntoState();

    const handleCloudProfileUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (detail?.keys?.includes(PROFILE_STORAGE_KEY)) loadProfileIntoState();
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudProfileUpdate);
    return () => window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudProfileUpdate);
  }, [loadProfileIntoState, sync.user]);

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
    () => sessions.reduce((total, session) => total + getSessionDurationMinutes(session), 0),
    [sessions],
  );

  const initials =
    displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'R';

  const profileFromState = (): StoredProfile => {
    const persisted = readStoredProfile();
    return {
      ...persisted,
      displayName: displayName === 'Reader' ? persisted.displayName : displayName,
      email,
      favoriteQuote,
      bio,
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

  const persistPreparedImage = (kind: 'avatar' | 'banner', dataUrl: string) => {
    const profile = profileFromState();
    const nextProfile: StoredProfile = {
      ...profile,
      ...(kind === 'avatar' ? { avatarImageData: dataUrl } : { bannerImageData: dataUrl }),
    };

    saveStoredProfile(nextProfile);

    if (kind === 'avatar') {
      releasePreviewUrl(avatarPreviewUrlRef);
      setAvatarImage(dataUrl);
    } else {
      releasePreviewUrl(bannerPreviewUrlRef);
      setBannerImage(dataUrl);
    }

    if (sync.user && db) {
      void writeCloudProfile(nextProfile).catch((error) => {
        console.error(`Inkbound could not sync the ${kind} yet.`, error);
      });
    }
  };

  const selectProfileImage = (file: File, kind: 'avatar' | 'banner') => {
    if (!file.type.startsWith('image/')) {
      setImageStatus('error');
      return;
    }
    if (file.size > MAX_PROFILE_SOURCE_BYTES) {
      setImageStatus('error');
      return;
    }

    const requestId = imageRequestRef.current + 1;
    imageRequestRef.current = requestId;
    setImageStatus('preparing');
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

    void prepareProfileImage(file, kind)
      .then((dataUrl) => {
        if (imageRequestRef.current !== requestId) return;
        persistPreparedImage(kind, dataUrl);
        setImageStatus('idle');
      })
      .catch((error) => {
        console.error(`Inkbound could not prepare the ${kind}.`, error);
        if (imageRequestRef.current === requestId) setImageStatus('error');
      });
  };

  const handleSave = () => {
    const profile = profileFromState();

    saveStoredProfile(profile);
    setSaveStatus('saved');
    window.setTimeout(() => setSaveStatus('idle'), 1800);

    if (!sync.user || !db) return;
    void writeCloudProfile(profile).catch((error) => {
      console.error('Inkbound could not sync the reader profile yet.', error);
      setSaveStatus('error');
    });
  };

  if (!sync.user) {
    return (
      <div className="space-y-6 pb-20">
        <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-gold)]">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <p className="inkbound-kicker">Reader Profile</p>
              <h1 className="mt-2 font-serif text-3xl font-bold text-[var(--ink-ivory)]">Sign in to view your profile</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
                Your name, profile photo, banner, reading stats, and personal details belong to your Inkbound account and stay hidden while you are signed out.
              </p>
            </div>
          </div>
        </section>

        <AccountSyncCard />
      </div>
    );
  }

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
            className="absolute right-[max(1rem,env(safe-area-inset-right))] top-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 bg-black/45 px-4 text-xs font-bold text-white backdrop-blur-sm transition hover:bg-black/60"
          >
            <ImagePlus className="h-4 w-4" />
            {bannerImage ? 'Change banner' : 'Add banner'}
          </button>
        </div>

        <div className="px-5 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="relative grid h-24 w-24 shrink-0 place-items-center overflow-visible rounded-full border-4 border-[var(--ink-surface)] bg-gradient-to-br from-[#78566e] to-[#2b1c30] font-serif text-3xl font-bold text-[var(--ink-ivory)] shadow-xl sm:h-28 sm:w-28">
                <div className="h-full w-full overflow-hidden rounded-full">
                  {avatarImage ? (
                    <img
                      src={avatarImage}
                      alt={`${displayName} profile`}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center">{initials}</span>
                  )}
                </div>
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
                  className="absolute bottom-0 right-0 grid h-11 w-11 translate-x-1 translate-y-1 place-items-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] text-[var(--ink-gold)] shadow-lg"
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
              {imageStatus === 'preparing' ? (
                <p className="text-xs text-[var(--ink-muted)]">Preparing image…</p>
              ) : null}
              {imageStatus === 'error' ? (
                <p className="text-xs text-rose-400">Choose an image under 12 MB and try again.</p>
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
                value={displayName === 'Reader' ? '' : displayName}
                placeholder="Add your display name"
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
                readOnly
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
                placeholder="Add a favorite quote"
                onChange={(event) => setFavoriteQuote(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[var(--ink-ivory)] outline-none"
              />
            </div>
          </label>

          <label className="space-y-2 text-sm font-semibold text-[var(--ink-ivory)] md:col-span-2">
            Bio
            <textarea
              value={bio}
              placeholder="Tell readers a little about yourself"
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