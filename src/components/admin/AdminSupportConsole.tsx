import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, KeyRound, MailCheck, MessageSquareText, ShieldAlert, UserRound } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

export interface AdminSupportUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  authProviderIds: string[];
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  lastPlatform: string;
  lastAppVersion: string;
  lastBuildNumber: string;
  lastUserAgent: string;
  basePlan: 'free' | 'premium';
  subscriptionStatus: string;
  vipEnabled: boolean;
  courtesyPremiumUntil: string | null;
  paidPremiumUntil: string | null;
}

export interface AdminSupportAuditEntry {
  id: string;
  action: string;
  targetUserId: string;
  targetEmail: string;
  performedByEmail: string;
  reason: string;
  createdAt: string | null;
}

interface Props {
  reader: AdminSupportUser | null;
  audit: AdminSupportAuditEntry[];
  onRefresh: () => Promise<void> | void;
}

const formatDate = (value: string | null) => {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

const providerLabel = (provider: string) => {
  if (provider === 'google.com') return 'Google';
  if (provider === 'password') return 'Email + password';
  if (provider === 'apple.com') return 'Apple';
  return provider;
};

const SupportMetric = ({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) => (
  <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">
    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span>
    <strong className="mt-1 block break-words text-sm text-[var(--ink-ivory)]">{value}</strong>
    {note && <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">{note}</p>}
  </div>
);

export const AdminSupportConsole: React.FC<Props> = ({ reader, audit, onRefresh }) => {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'verify' | 'reset' | 'note' | null>(null);
  const [status, setStatus] = useState('');

  const readerHistory = useMemo(() => {
    if (!reader) return [];
    return audit
      .filter((entry) => entry.targetUserId === reader.uid || (!entry.targetUserId && entry.targetEmail.toLowerCase() === reader.email.toLowerCase()))
      .slice(0, 12);
  }, [audit, reader]);

  if (!reader) {
    return (
      <section className="inkbound-panel p-5">
        <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Support snapshot</h2>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Select a reader to see account identity, login status, and support tools.</p>
      </section>
    );
  }

  const runAccountEmailAction = async (kind: 'verify' | 'reset') => {
    if (!functions || busy || !reason.trim()) {
      if (!reason.trim()) setStatus('Add a support reason first so the action is recorded.');
      return;
    }

    setBusy(kind);
    setStatus('');
    try {
      if (kind === 'verify') {
        const callable = httpsCallable(functions, 'resendAdminVerificationEmail');
        const response = await callable({ targetUserId: reader.uid, reason: reason.trim() });
        const result = response.data as { alreadyVerified?: boolean; notificationSent?: boolean; notificationError?: string | null };
        setStatus(result.alreadyVerified
          ? 'This email is already verified. No verification message was needed.'
          : result.notificationSent === false
            ? `Verification action completed, but email delivery failed${result.notificationError ? `: ${result.notificationError}` : '.'}`
            : 'A fresh verification email was sent.');
      } else {
        const callable = httpsCallable(functions, 'sendAdminPasswordResetEmail');
        const response = await callable({ targetUserId: reader.uid, reason: reason.trim() });
        const result = response.data as { notificationSent?: boolean; notificationError?: string | null };
        setStatus(result.notificationSent === false
          ? `Password-reset action completed, but email delivery failed${result.notificationError ? `: ${result.notificationError}` : '.'}`
          : 'A branded password reset email was sent.');
      }
      setReason('');
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The support action could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  const addSupportNote = async () => {
    if (!functions || busy || !note.trim()) return;
    setBusy('note');
    setStatus('');
    try {
      const callable = httpsCallable(functions, 'addAdminSupportNote');
      await callable({ targetUserId: reader.uid, note: note.trim() });
      setNote('');
      setStatus('Support note added to this reader’s admin history.');
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The support note could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied.`);
    } catch {
      setStatus(`Could not copy ${label.toLowerCase()}. Select and copy it manually.`);
    }
  };

  const providers = reader.authProviderIds.length
    ? reader.authProviderIds.map(providerLabel).join(', ')
    : 'Unknown';

  return (
    <section className="inkbound-panel p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><UserRound className="h-5 w-5 text-[var(--ink-mauve)]" /><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Support snapshot</h2></div>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Account identity and common support actions for <strong className="text-[var(--ink-ivory)]">{reader.displayName || reader.email}</strong>.</p>
        </div>
        <div className={`inline-flex min-h-9 items-center gap-2 self-start rounded-full border px-3 text-xs font-bold ${reader.emailVerified ? 'border-emerald-300/30 bg-emerald-300/5 text-emerald-200' : 'border-amber-300/30 bg-amber-300/5 text-amber-200'}`}>
          {reader.emailVerified ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {reader.emailVerified ? 'Email verified' : 'Email not verified'}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SupportMetric label="Email" value={reader.email} />
        <SupportMetric label="Sign-in methods" value={providers} />
        <SupportMetric label="Account created" value={formatDate(reader.accountCreatedAt)} />
        <SupportMetric label="Last Firebase sign-in" value={formatDate(reader.lastSignInAt)} />
        <SupportMetric label="Last Inkbound check-in" value={formatDate(reader.lastSeenAt)} />
        <SupportMetric label="Last platform" value={reader.lastPlatform || 'Not recorded yet'} note={reader.lastAppVersion ? `Inkbound ${reader.lastAppVersion}${reader.lastBuildNumber ? ` · build ${reader.lastBuildNumber}` : ''}` : 'Older check-ins may not include app version.'} />
        <SupportMetric label="Firebase UID" value={<span className="font-mono text-xs">{reader.uid}</span>} />
        <SupportMetric label="Plan" value={reader.vipEnabled ? 'VIP Premium' : reader.basePlan === 'premium' ? 'Premium' : 'Free'} />
        <SupportMetric label="Subscription" value={reader.subscriptionStatus || 'none'} note={reader.paidPremiumUntil ? `Paid through ${formatDate(reader.paidPremiumUntil)}` : undefined} />
        <SupportMetric label="Courtesy access" value={reader.courtesyPremiumUntil ? formatDate(reader.courtesyPremiumUntil) : 'None'} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copyText('Email', reader.email)} className="quiet-shelf-secondary-action"><Clipboard className="h-4 w-4" />Copy email</button>
        <button type="button" onClick={() => void copyText('Firebase UID', reader.uid)} className="quiet-shelf-secondary-action"><Clipboard className="h-4 w-4" />Copy UID</button>
        <button
          type="button"
          onClick={() => void copyText('Support summary', [
            `Reader: ${reader.displayName || 'Unnamed reader'}`,
            `Email: ${reader.email}`,
            `Email verified: ${reader.emailVerified ? 'Yes' : 'No'}`,
            `Firebase UID: ${reader.uid}`,
            `Sign-in methods: ${providers}`,
            `Account created: ${formatDate(reader.accountCreatedAt)}`,
            `Last Firebase sign-in: ${formatDate(reader.lastSignInAt)}`,
            `Last Inkbound check-in: ${formatDate(reader.lastSeenAt)}`,
            `Last platform: ${reader.lastPlatform || 'Not recorded'}`,
            `App version: ${reader.lastAppVersion || 'Not recorded'}`,
            `Build: ${reader.lastBuildNumber || 'Not recorded'}`,
            `Plan: ${reader.vipEnabled ? 'VIP Premium' : reader.basePlan === 'premium' ? 'Premium' : 'Free'}`,
            `Subscription status: ${reader.subscriptionStatus || 'none'}`,
          ].join('\n'))}
          className="quiet-shelf-secondary-action"
        ><Clipboard className="h-4 w-4" />Copy support summary</button>
      </div>

      {!reader.emailVerified && (
        <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-[var(--ink-muted)]">
          <strong className="text-amber-200">Recommended first step:</strong> resend the verification email before changing the account identity. If the address itself is wrong, use Account repair instead.
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
          <h3 className="font-semibold text-[var(--ink-ivory)]">Login help</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">These send branded Inkbound messages to the reader’s current Firebase email. A reason is required and written to the audit log.</p>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Example: Reader cannot verify corrected address" className="mt-3 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 text-sm text-[var(--ink-ivory)] outline-none" />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={Boolean(busy) || reader.emailVerified || !reason.trim()} onClick={() => void runAccountEmailAction('verify')} className="quiet-shelf-secondary-action justify-center disabled:opacity-40"><MailCheck className="h-4 w-4" />{busy === 'verify' ? 'Sending…' : 'Resend verification'}</button>
            <button type="button" disabled={Boolean(busy) || !reason.trim()} onClick={() => void runAccountEmailAction('reset')} className="quiet-shelf-secondary-action justify-center disabled:opacity-40"><KeyRound className="h-4 w-4" />{busy === 'reset' ? 'Sending…' : 'Send password reset'}</button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
          <h3 className="font-semibold text-[var(--ink-ivory)]">Support note</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Record what the reader reported, what you checked, or what you asked them to try. This does not change their account.</p>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Example: Reader reports 22 books missing after Sep 21. Asked them not to reinstall while investigating." className="mt-3 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 text-sm text-[var(--ink-ivory)] outline-none" />
          <button type="button" disabled={Boolean(busy) || !note.trim()} onClick={() => void addSupportNote()} className="quiet-shelf-primary-action mt-3 w-full justify-center disabled:opacity-40"><MessageSquareText className="h-4 w-4" />{busy === 'note' ? 'Saving…' : 'Save support note'}</button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
        <h3 className="font-semibold text-[var(--ink-ivory)]">Reader support history</h3>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">Recent admin actions and notes for this Firebase account.</p>
        <div className="mt-3 divide-y divide-[var(--ink-border-subtle)]">
          {readerHistory.length ? readerHistory.map((entry) => (
            <article key={entry.id} className="grid gap-1 py-3 md:grid-cols-[170px_190px_1fr]">
              <span className="text-xs text-[var(--ink-muted)]">{formatDate(entry.createdAt)}</span>
              <strong className="text-xs capitalize text-[var(--ink-ivory)]">{entry.action.replaceAll('_', ' ')}</strong>
              <span className="text-xs leading-5 text-[var(--ink-muted)]">{entry.reason || 'No reason recorded.'}</span>
            </article>
          )) : <p className="py-4 text-sm text-[var(--ink-muted)]">No support history recorded for this reader yet.</p>}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-300/5 p-4 text-xs leading-5 text-[var(--ink-muted)]">
        <strong className="text-[var(--ink-ivory)]">Missing books, sessions, covers, or collections?</strong> Run the Data safety &amp; recovery integrity check below before asking the reader to reinstall, clear data, or re-enter anything.
      </div>

      {status && <p className="mt-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]" role="status">{status}</p>}
    </section>
  );
};
