import React from 'react';
import { CloudDownload, CloudUpload, LogOut, ShieldCheck } from 'lucide-react';
import { useAccountSync } from '../../context/AccountSyncContext';

const formatLastSync = (value: string | null) => {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Previously synced' : date.toLocaleString();
};

export const AccountSyncCard: React.FC = () => {
  const sync = useAccountSync();
  const isWorking = sync.status === 'working';

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="inkbound-kicker">Optional Cloud Sync</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">
            Take Inkbound with you
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
            Connect your Google account to back up this device and restore your library, sessions,
            profile, goals, and preferences on another device. Inkbound still works locally without
            an account.
          </p>
        </div>
        <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--ink-gold)]" />
      </div>

      {!sync.isConfigured && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--ink-muted)]">
          Firebase credentials are missing from this deployment. Add the Inkbound Firebase values to
          the local environment file before using Google sign-in.
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
            Inkbound remembers the connected Google account on this browser until you sign out.
            Signing in does not automatically replace this device&apos;s local data.
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
                  Signed in persistently · Last sync: {formatLastSync(sync.lastSyncedAt)}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void sync.uploadSnapshot()}
              disabled={isWorking}
              className="quiet-shelf-primary-action min-h-12 justify-center disabled:cursor-wait disabled:opacity-60"
            >
              <CloudUpload className="h-4 w-4" />
              {isWorking ? 'Working...' : 'Sync this device'}
            </button>
            <button
              type="button"
              onClick={() => void sync.restoreSnapshot()}
              disabled={isWorking}
              className="quiet-shelf-secondary-action min-h-12 justify-center disabled:cursor-wait disabled:opacity-60"
            >
              <CloudDownload className="h-4 w-4" /> Restore from cloud
            </button>
          </div>

          <p className="text-xs text-[var(--ink-faint)]">
            Sync uploads the current device. Restore replaces this device&apos;s saved Inkbound data
            with the latest cloud backup for this Google account. Closing or refreshing Inkbound will
            not sign you out.
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
