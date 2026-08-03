import React from 'react';
import { Cloud, LogOut, ShieldCheck } from 'lucide-react';
import { useAccountSync } from '../../context/AccountSyncContext';

const formatLastSync = (value: string | null) => {
  if (!value) return 'Automatic sync will begin after sign-in';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Previously synchronized' : date.toLocaleString();
};

export const AccountSyncCard: React.FC = () => {
  const sync = useAccountSync();
  const isWorking = sync.status === 'working';

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="inkbound-kicker">Cross-device persistence</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">
            Take Inkbound with you
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
            Sign in with Google to synchronize books, sessions, profile details, and profile images
            across your devices. Changes are stored as individual records so one device cannot replace
            an entire library with an older copy.
          </p>
        </div>
        <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--ink-gold)]" />
      </div>

      {!sync.isConfigured && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--ink-muted)]">
          Firebase credentials are missing from this deployment. Add the Inkbound Firebase values to
          the environment before using Google synchronization.
        </div>
      )}

      {!sync.isAuthReady ? (
        <div className="mt-6 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">
          Restoring your saved Google session...
        </div>
      ) : !sync.user ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => void sync.signInWithGoogle()}
            disabled={!sync.isConfigured || isWorking}
            className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-sm font-semibold text-[var(--ink-ivory)] transition hover:border-[var(--ink-border-strong)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-64"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-bold text-[#4285f4]">
              G
            </span>
            {isWorking ? 'Connecting...' : 'Continue with Google'}
          </button>

          <p className="mt-3 text-xs text-[var(--ink-faint)]">
            Your local library remains available while signed out. After sign-in, Inkbound safely
            merges this device with the Google-connected library.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {sync.user.photoURL ? (
                <img
                  src={sync.user.photoURL}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-base font-bold text-[#4285f4]">
                  G
                </span>
              )}
              <div>
                <p className="text-sm font-bold text-[var(--ink-ivory)]">
                  {sync.user.displayName || 'Connected reader'}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {sync.user.email || 'Google account connected'}
                </p>
                <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
                  Signed in persistently · {formatLastSync(sync.lastSyncedAt)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void sync.signOutAccount()}
              disabled={isWorking}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--ink-border)] px-4 text-xs font-semibold text-[var(--ink-muted)] disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-4">
            <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <p className="text-sm font-bold text-[var(--ink-ivory)]">Automatic synchronization is active</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                Books and sessions synchronize as separate cloud records. Profile images are stored in
                protected Firebase Storage. Offline changes remain on this device and synchronize after
                the connection returns.
              </p>
            </div>
          </div>

          <p className="text-xs text-[var(--ink-faint)]">
            There is no device-wide overwrite button. Signing into another device merges the cloud
            library before that device is allowed to send deletions.
          </p>
        </div>
      )}

      {sync.message && (
        <p
          className={`mt-4 text-sm ${
            sync.status === 'error' ? 'text-rose-500' : 'text-[var(--ink-muted)]'
          }`}
          role="status"
        >
          {sync.message}
        </p>
      )}
    </section>
  );
};
