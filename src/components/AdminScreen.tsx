import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Gift, RefreshCw, Search, ShieldCheck, Star, Users } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAccountSync } from '../context/AccountSyncContext';

interface AdminUser {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
  emailVerified: boolean;
  lastSeenAt: string | null;
  basePlan: 'free' | 'premium';
  subscriptionStatus: string;
  vipEnabled: boolean;
  courtesyPremiumUntil: string | null;
  paidPremiumUntil: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  targetEmail: string;
  performedByEmail: string;
  reason: string;
  createdAt: string | null;
}

interface DashboardData {
  role: string;
  totals: { users: number; vip: number; courtesy: number; paid: number };
  users: AdminUser[];
  audit: AuditEntry[];
}

const OWNER_EMAILS = new Set(['blackdame494@gmail.com', 'inkbound@inkydameinteractive.com']);

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not available';

export const AdminScreen: React.FC = () => {
  const { user } = useAccountSync();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [courtesyDays, setCourtesyDays] = useState(7);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const approvedOwner = Boolean(user?.email && OWNER_EMAILS.has(user.email.toLowerCase()));

  const loadDashboard = useCallback(async (search = '') => {
    if (!functions || !approvedOwner) return;
    setLoading(true);
    setStatus('');
    try {
      const bootstrapOwner = httpsCallable(functions, 'bootstrapOwner');
      await bootstrapOwner();
      const getAdminDashboard = httpsCallable<{ query: string }, DashboardData>(functions, 'getAdminDashboard');
      const response = await getAdminDashboard({ query: search });
      setData(response.data);
      setSelectedUser((current) => response.data.users.find((item) => item.uid === current?.uid) ?? response.data.users[0] ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The admin dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [approvedOwner]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const runAction = async (action: 'grantVip' | 'revokeVip' | 'addCourtesyTime') => {
    if (!functions || !selectedUser || !reason.trim()) {
      setStatus('Choose a user and enter a reason before making an account change.');
      return;
    }

    setLoading(true);
    setStatus('');
    try {
      const callable = httpsCallable(functions, action);
      await callable({
        targetUserId: selectedUser.uid,
        targetEmail: selectedUser.email,
        reason: reason.trim(),
        ...(action === 'addCourtesyTime' ? { days: courtesyDays } : {}),
      });
      setReason('');
      setStatus('Account access updated successfully.');
      await loadDashboard(query);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The account change could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  const effectivePlan = useMemo(() => {
    if (!selectedUser) return 'Free';
    if (selectedUser.vipEnabled) return 'VIP Premium';
    if (selectedUser.subscriptionStatus === 'active' || selectedUser.subscriptionStatus === 'trialing') return 'Paid Premium';
    if (selectedUser.courtesyPremiumUntil && new Date(selectedUser.courtesyPremiumUntil).getTime() > Date.now()) return 'Courtesy Premium';
    return 'Free';
  }, [selectedUser]);

  if (!user) {
    return <section className="inkbound-panel mx-auto max-w-3xl p-8"><h1 className="font-serif text-3xl text-[var(--ink-ivory)]">Administration</h1><p className="mt-3 text-[var(--ink-muted)]">Sign in with an approved owner account to continue.</p></section>;
  }

  if (!approvedOwner) {
    return <section className="inkbound-panel mx-auto max-w-3xl p-8"><h1 className="font-serif text-3xl text-[var(--ink-ivory)]">Access denied</h1><p className="mt-3 text-[var(--ink-muted)]">This Google account is not approved for Inkbound administration.</p></section>;
  }

  return (
    <div className="space-y-6 pb-20">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ink-mauve)]">Owner tools</p><h1 className="font-serif text-4xl text-[var(--ink-ivory)]">Administration</h1><p className="mt-2 text-[var(--ink-muted)]">Manage complimentary access and review protected account activity.</p></div>
        <button type="button" onClick={() => void loadDashboard(query)} disabled={loading} className="quiet-shelf-secondary-action justify-center"><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
      </header>

      {data && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[['Readers', data.totals.users, Users], ['Paid Premium', data.totals.paid, Crown], ['VIP', data.totals.vip, Star], ['Courtesy', data.totals.courtesy, Gift]].map(([label, value, Icon]) => {
          const MetricIcon = Icon as React.ComponentType<{ className?: string }>;
          return <article key={label as string} className="inkbound-panel p-5"><MetricIcon className="h-5 w-5 text-[var(--ink-mauve)]" /><strong className="mt-4 block font-serif text-3xl text-[var(--ink-ivory)]">{value as number}</strong><span className="text-sm text-[var(--ink-muted)]">{label as string}</span></article>;
        })}
      </section>}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <div className="inkbound-panel p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Readers</h2><p className="text-sm text-[var(--ink-muted)]">Search by name, email, or Firebase UID.</p></div><form onSubmit={(event) => { event.preventDefault(); void loadDashboard(query); }} className="flex gap-2"><label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3"><Search className="h-4 w-4 text-[var(--ink-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search readers" className="min-w-0 bg-transparent text-sm text-[var(--ink-ivory)] outline-none" /></label><button className="quiet-shelf-primary-action" type="submit">Search</button></form></div>
          <div className="mt-5 grid gap-2">{data?.users.length ? data.users.map((reader) => <button key={reader.uid} type="button" onClick={() => setSelectedUser(reader)} className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${selectedUser?.uid === reader.uid ? 'border-[var(--ink-mauve)] bg-[var(--ink-surface-soft)]' : 'border-[var(--ink-border-subtle)] hover:bg-[var(--ink-surface-soft)]'}`}>{reader.photoUrl ? <img src={reader.photoUrl} alt="" className="h-11 w-11 rounded-full object-cover" /> : <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--ink-surface-raised)] font-serif text-[var(--ink-ivory)]">{(reader.displayName || reader.email).charAt(0).toUpperCase()}</span>}<span className="min-w-0 flex-1"><strong className="block truncate text-[var(--ink-ivory)]">{reader.displayName || 'Unnamed reader'}</strong><small className="block truncate text-[var(--ink-muted)]">{reader.email}</small></span>{reader.vipEnabled && <span className="quiet-shelf-premium-pill">VIP</span>}</button>) : <p className="py-8 text-center text-[var(--ink-muted)]">No matching readers found.</p>}</div>
        </div>

        <aside className="inkbound-panel p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[var(--ink-mauve)]" /><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Account access</h2></div>
          {selectedUser ? <div className="mt-5 space-y-5"><div><strong className="block text-lg text-[var(--ink-ivory)]">{selectedUser.displayName || selectedUser.email}</strong><span className="text-sm text-[var(--ink-muted)]">{selectedUser.email}</span></div><dl className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">Effective plan</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{effectivePlan}</dd></div><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">Last seen</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{formatDate(selectedUser.lastSeenAt)}</dd></div><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">VIP</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{selectedUser.vipEnabled ? 'Active' : 'Not active'}</dd></div><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">Courtesy until</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{selectedUser.courtesyPremiumUntil ? formatDate(selectedUser.courtesyPremiumUntil) : 'None'}</dd></div></dl><label className="block text-sm font-semibold text-[var(--ink-ivory)]">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)] outline-none" placeholder="Required for the audit log" /></label><div className="grid grid-cols-2 gap-2"><button type="button" disabled={loading} onClick={() => void runAction(selectedUser.vipEnabled ? 'revokeVip' : 'grantVip')} className="quiet-shelf-primary-action justify-center">{selectedUser.vipEnabled ? 'Revoke VIP' : 'Grant VIP'}</button><select value={courtesyDays} onChange={(event) => setCourtesyDays(Number(event.target.value))} className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value={1}>1 courtesy day</option><option value={3}>3 courtesy days</option><option value={7}>7 courtesy days</option><option value={14}>14 courtesy days</option><option value={30}>30 courtesy days</option><option value={90}>3 months</option><option value={180}>6 months</option><option value={365}>1 year</option></select><button type="button" disabled={loading} onClick={() => void runAction('addCourtesyTime')} className="quiet-shelf-secondary-action col-span-2 justify-center"><Gift />Add courtesy time</button></div></div> : <p className="mt-5 text-[var(--ink-muted)]">Select a reader to manage access.</p>}
          {status && <p className="mt-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]">{status}</p>}
        </aside>
      </section>

      <section className="inkbound-panel p-5"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Recent admin activity</h2><div className="mt-4 divide-y divide-[var(--ink-border-subtle)]">{data?.audit.length ? data.audit.map((entry) => <article key={entry.id} className="grid gap-1 py-3 md:grid-cols-[180px_1fr_1fr]"><span className="text-sm text-[var(--ink-muted)]">{formatDate(entry.createdAt)}</span><strong className="text-sm text-[var(--ink-ivory)]">{entry.action.replaceAll('_', ' ')} · {entry.targetEmail || 'Unknown reader'}</strong><span className="text-sm text-[var(--ink-muted)]">{entry.reason}</span></article>) : <p className="py-6 text-[var(--ink-muted)]">No admin activity yet.</p>}</div></section>
    </div>
  );
};
