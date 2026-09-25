import React, { useMemo, useState } from 'react';
import { AlertTriangle, Crown, Gift, RefreshCw, Search, ShieldCheck, Star, Trash2, Users, X } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAccountSync } from '../context/AccountSyncContext';
import { AdminDataSafetyPanel } from './admin/AdminDataSafetyPanel';
import { AdminCatalogContributionsPanel } from './admin/AdminCatalogContributionsPanel';

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
const READER_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 10;

let cachedDashboard: DashboardData | null = null;
let cachedSelectedUserId: string | null = null;

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not available';

function isDashboardData(value: unknown): value is DashboardData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DashboardData>;
  const totals = candidate.totals as DashboardData['totals'] | undefined;
  return typeof candidate.role === 'string'
    && Array.isArray(candidate.users)
    && Array.isArray(candidate.audit)
    && Boolean(totals)
    && typeof totals?.users === 'number'
    && typeof totals?.vip === 'number'
    && typeof totals?.courtesy === 'number'
    && typeof totals?.paid === 'number';
}

function normalizeDashboardPayload(value: unknown): DashboardData {
  if (isDashboardData(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (isDashboardData(record.result)) return record.result;
    if (isDashboardData(record.data)) return record.data;
  }
  throw new Error('The Administration service returned an unexpected response shape.');
}

const PaginationControls: React.FC<{
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}> = ({ page, pageCount, onPageChange }) => {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-[var(--ink-border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs text-[var(--ink-muted)]">Page {page} of {pageCount}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="quiet-shelf-secondary-action min-h-10 justify-center px-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="quiet-shelf-secondary-action min-h-10 justify-center px-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
};

export const AdminScreen: React.FC = () => {
  const { user } = useAccountSync();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<DashboardData | null>(() => cachedDashboard);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(() => {
    if (!cachedDashboard) return null;
    return cachedDashboard.users.find((item) => item.uid === cachedSelectedUserId)
      ?? cachedDashboard.users[0]
      ?? null;
  });
  const [reason, setReason] = useState('');
  const [correctedEmail, setCorrectedEmail] = useState('');
  const [mergeTargetEmail, setMergeTargetEmail] = useState('');
  const [mergeConfirmation, setMergeConfirmation] = useState('');
  const [accountRepairReason, setAccountRepairReason] = useState('');
  const [accountRepairBusy, setAccountRepairBusy] = useState(false);
  const [courtesyDays, setCourtesyDays] = useState(7);
  const [status, setStatus] = useState(() => cachedDashboard ? 'Owner data loaded.' : '');
  const [loading, setLoading] = useState(false);
  const [eraseDialogOpen, setEraseDialogOpen] = useState(false);
  const [eraseConfirmation, setEraseConfirmation] = useState('');
  const [eraseReason, setEraseReason] = useState('');
  const [erasing, setErasing] = useState(false);
  const [readerPage, setReaderPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);

  const approvedOwner = Boolean(user?.email && OWNER_EMAILS.has(user.email.toLowerCase()));

  const readerPageCount = Math.max(1, Math.ceil((data?.users.length ?? 0) / READER_PAGE_SIZE));
  const safeReaderPage = Math.min(readerPage, readerPageCount);
  const readerStartIndex = (safeReaderPage - 1) * READER_PAGE_SIZE;
  const visibleReaders = data?.users.slice(readerStartIndex, readerStartIndex + READER_PAGE_SIZE) ?? [];

  const auditPageCount = Math.max(1, Math.ceil((data?.audit.length ?? 0) / AUDIT_PAGE_SIZE));
  const safeAuditPage = Math.min(auditPage, auditPageCount);
  const auditStartIndex = (safeAuditPage - 1) * AUDIT_PAGE_SIZE;
  const visibleAudit = data?.audit.slice(auditStartIndex, auditStartIndex + AUDIT_PAGE_SIZE) ?? [];

  const selectReader = (reader: AdminUser) => {
    cachedSelectedUserId = reader.uid;
    setSelectedUser(reader);
  };

  const loadDashboard = async (search = '') => {
    setStatus('Refresh requested…');

    if (!user) {
      setStatus('Sign in with an approved owner account before loading Administration.');
      return;
    }
    if (!approvedOwner) {
      setStatus('This account is not approved for Inkbound administration.');
      return;
    }
    if (!functions) {
      setStatus('Firebase Functions are unavailable in this Inkbound runtime. Check the Firebase environment configuration and reload the app.');
      return;
    }

    setLoading(true);
    setStatus('Loading owner data…');
    try {
      const getAdminDashboard = httpsCallable<{ query: string }, unknown>(functions, 'getAdminDashboard');
      const response = await getAdminDashboard({ query: search });
      const dashboard = normalizeDashboardPayload(response.data);
      const nextSelected = dashboard.users.find((item) => item.uid === (selectedUser?.uid ?? cachedSelectedUserId))
        ?? dashboard.users[0]
        ?? null;

      cachedDashboard = dashboard;
      cachedSelectedUserId = nextSelected?.uid ?? null;
      setData(dashboard);
      setSelectedUser(nextSelected);
      setReaderPage(1);
      setAuditPage(1);
      setStatus('Owner data refreshed.');
    } catch (error) {
      setStatus(error instanceof Error ? `Administration refresh failed: ${error.message}` : 'The admin dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

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

  const correctSelectedEmail = async () => {
    if (!functions || !selectedUser || !correctedEmail.trim() || !accountRepairReason.trim() || accountRepairBusy) return;
    setAccountRepairBusy(true);
    setStatus('');
    try {
      const callable = httpsCallable(functions, 'correctAdminUserEmail');
      await callable({
        targetUserId: selectedUser.uid,
        currentEmail: selectedUser.email,
        newEmail: correctedEmail.trim(),
        reason: accountRepairReason.trim(),
      });
      setCorrectedEmail('');
      setAccountRepairReason('');
      setStatus('Reader email corrected. They will need to verify the corrected email address.');
      await loadDashboard(query);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The reader email could not be corrected.');
    } finally {
      setAccountRepairBusy(false);
    }
  };

  const expectedMergePhrase = selectedUser && mergeTargetEmail.trim()
    ? `MERGE ${selectedUser.email} INTO ${mergeTargetEmail.trim().toLowerCase()}`
    : '';

  const mergeSelectedAccount = async () => {
    if (!functions || !selectedUser || !mergeTargetEmail.trim() || !accountRepairReason.trim() || accountRepairBusy) return;
    if (mergeConfirmation.trim().toLowerCase() !== expectedMergePhrase.toLowerCase()) return;
    setAccountRepairBusy(true);
    setStatus('');
    try {
      const callable = httpsCallable(functions, 'mergeAdminUserAccounts');
      await callable({
        sourceUserId: selectedUser.uid,
        sourceEmail: selectedUser.email,
        targetEmail: mergeTargetEmail.trim(),
        confirmation: mergeConfirmation.trim(),
        reason: accountRepairReason.trim(),
      });
      setMergeTargetEmail('');
      setMergeConfirmation('');
      setAccountRepairReason('');
      cachedSelectedUserId = null;
      setSelectedUser(null);
      setStatus('Accounts merged successfully. The source login was removed after its Inkbound data was copied.');
      await loadDashboard(query);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The accounts could not be merged.');
    } finally {
      setAccountRepairBusy(false);
    }
  };

  const effectivePlan = useMemo(() => {
    if (!selectedUser) return 'Free';
    if (selectedUser.vipEnabled) return 'VIP Premium';
    if (selectedUser.subscriptionStatus === 'active' || selectedUser.subscriptionStatus === 'trialing') return 'Paid Premium';
    if (selectedUser.courtesyPremiumUntil && new Date(selectedUser.courtesyPremiumUntil).getTime() > Date.now()) return 'Courtesy Premium';
    return 'Free';
  }, [selectedUser]);

  const selectedHasPaidAccess = Boolean(selectedUser && (
    selectedUser.subscriptionStatus === 'active' ||
    selectedUser.subscriptionStatus === 'trialing' ||
    (selectedUser.paidPremiumUntil && new Date(selectedUser.paidPremiumUntil).getTime() > Date.now())
  ));
  const selectedIsCurrentAdmin = Boolean(selectedUser && user && selectedUser.uid === user.uid);
  const selectedIsProtectedOwner = Boolean(selectedUser?.email && OWNER_EMAILS.has(selectedUser.email.toLowerCase()));
  const expectedErasePhrase = selectedUser ? `ERASE ${selectedUser.email}` : '';
  const canEraseSelected = Boolean(selectedUser && !selectedHasPaidAccess && !selectedIsCurrentAdmin && !selectedIsProtectedOwner);

  const openEraseDialog = () => {
    if (!selectedUser || !canEraseSelected) return;
    setEraseConfirmation('');
    setEraseReason('');
    setStatus('');
    setEraseDialogOpen(true);
  };

  const eraseSelectedUser = async () => {
    if (!functions || !selectedUser || !canEraseSelected || erasing) return;
    if (eraseConfirmation.trim() !== expectedErasePhrase || !eraseReason.trim()) return;

    setErasing(true);
    setStatus('');
    try {
      const eraseUser = httpsCallable(functions, 'eraseUserAccountByAdmin');
      await eraseUser({
        targetUserId: selectedUser.uid,
        targetEmail: selectedUser.email,
        confirmation: eraseConfirmation.trim(),
        reason: eraseReason.trim(),
      });
      setEraseDialogOpen(false);
      setEraseConfirmation('');
      setEraseReason('');
      cachedSelectedUserId = null;
      setSelectedUser(null);
      setStatus('Reader account and Inkbound data permanently erased.');
      await loadDashboard(query);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The reader account could not be erased.');
    } finally {
      setErasing(false);
    }
  };

  if (!user) {
    return <section className="inkbound-panel mx-auto max-w-3xl p-8"><h1 className="font-serif text-3xl text-[var(--ink-ivory)]">Administration</h1><p className="mt-3 text-[var(--ink-muted)]">Sign in with an approved owner account to continue.</p></section>;
  }

  if (!approvedOwner) {
    return <section className="inkbound-panel mx-auto max-w-3xl p-8"><h1 className="font-serif text-3xl text-[var(--ink-ivory)]">Access denied</h1><p className="mt-3 text-[var(--ink-muted)]">This Google account is not approved for Inkbound administration.</p></section>;
  }

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden pb-20">
      <header className="flex min-w-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ink-mauve)]">Owner tools</p><h1 className="font-serif text-4xl text-[var(--ink-ivory)]">Administration</h1><p className="mt-2 text-[var(--ink-muted)]">Manage complimentary access, protected account actions, reader data requests, and catalog metadata review.</p></div>
        <button type="button" onClick={() => void loadDashboard(query)} className="quiet-shelf-secondary-action w-full shrink-0 justify-center md:w-auto"><RefreshCw className={loading ? 'animate-spin' : ''} />{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      {status && <p className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]" role="status">{status}</p>}

      {data && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[['Readers', data.totals.users, Users], ['Paid Premium', data.totals.paid, Crown], ['VIP', data.totals.vip, Star], ['Courtesy', data.totals.courtesy, Gift]].map(([label, value, Icon]) => {
          const MetricIcon = Icon as React.ComponentType<{ className?: string }>;
          return <article key={label as string} className="inkbound-panel min-w-0 p-5"><MetricIcon className="h-5 w-5 text-[var(--ink-mauve)]" /><strong className="mt-4 block font-serif text-3xl text-[var(--ink-ivory)]">{value as number}</strong><span className="text-sm text-[var(--ink-muted)]">{label as string}</span></article>;
        })}
      </section>}

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <div className="inkbound-panel min-w-0 p-5">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Readers</h2><p className="text-sm text-[var(--ink-muted)]">Search by name, email, or Firebase UID.</p></div><form onSubmit={(event) => { event.preventDefault(); setReaderPage(1); void loadDashboard(query); }} className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row"><label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3"><Search className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" /><input id="admin-reader-search" name="adminReaderSearch" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search readers" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink-ivory)] outline-none" /></label><button className="quiet-shelf-primary-action w-full justify-center sm:w-auto" type="submit" disabled={loading}>Search</button></form></div>
          {data && data.users.length > 0 && <p className="mt-4 text-xs text-[var(--ink-muted)]">Showing {readerStartIndex + 1}–{Math.min(readerStartIndex + READER_PAGE_SIZE, data.users.length)} of {data.users.length} readers</p>}
          <div className="mt-4 grid gap-2">{data === null ? <p className="py-8 text-center text-[var(--ink-muted)]">Press Refresh to load owner data.</p> : data.users.length ? visibleReaders.map((reader) => <button key={reader.uid} type="button" onClick={() => selectReader(reader)} className={`flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition ${selectedUser?.uid === reader.uid ? 'border-[var(--ink-mauve)] bg-[var(--ink-surface-soft)]' : 'border-[var(--ink-border-subtle)] hover:bg-[var(--ink-surface-soft)]'}`}>{reader.photoUrl ? <img src={reader.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--ink-surface-raised)] font-serif text-[var(--ink-ivory)]">{(reader.displayName || reader.email).charAt(0).toUpperCase()}</span>}<span className="min-w-0 flex-1"><strong className="block truncate text-[var(--ink-ivory)]">{reader.displayName || 'Unnamed reader'}</strong><small className="block truncate text-[var(--ink-muted)]">{reader.email}</small></span>{reader.vipEnabled && <span className="quiet-shelf-premium-pill shrink-0">VIP</span>}</button>) : <p className="py-8 text-center text-[var(--ink-muted)]">No matching readers found.</p>}</div>
          <PaginationControls page={safeReaderPage} pageCount={readerPageCount} onPageChange={setReaderPage} />
        </div>

        <aside className="inkbound-panel min-w-0 p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 shrink-0 text-[var(--ink-mauve)]" /><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Account access</h2></div>
          {selectedUser ? <div className="mt-5 space-y-5">
            <div className="min-w-0"><strong className="block break-words text-lg text-[var(--ink-ivory)]">{selectedUser.displayName || selectedUser.email}</strong><span className="block break-all text-sm text-[var(--ink-muted)]">{selectedUser.email}</span></div>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">Effective plan</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{effectivePlan}</dd></div><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">Last seen</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{formatDate(selectedUser.lastSeenAt)}</dd></div><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">VIP</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{selectedUser.vipEnabled ? 'Active' : 'Not active'}</dd></div><div className="rounded-xl bg-[var(--ink-surface-soft)] p-3"><dt className="text-[var(--ink-muted)]">Courtesy until</dt><dd className="mt-1 font-semibold text-[var(--ink-ivory)]">{selectedUser.courtesyPremiumUntil ? formatDate(selectedUser.courtesyPremiumUntil) : 'None'}</dd></div></dl>
            <label className="block text-sm font-semibold text-[var(--ink-ivory)]" htmlFor="admin-reason">Reason</label><textarea id="admin-reason" name="adminReason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)] outline-none" placeholder="Required for the audit log" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" disabled={loading} onClick={() => void runAction(selectedUser.vipEnabled ? 'revokeVip' : 'grantVip')} className="quiet-shelf-primary-action justify-center">{selectedUser.vipEnabled ? 'Revoke VIP' : 'Grant VIP'}</button><select id="admin-courtesy-days" name="adminCourtesyDays" value={courtesyDays} onChange={(event) => setCourtesyDays(Number(event.target.value))} className="min-h-11 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value={1}>1 courtesy day</option><option value={3}>3 courtesy days</option><option value={7}>7 courtesy days</option><option value={14}>14 courtesy days</option><option value={30}>30 courtesy days</option><option value={60}>2 months</option><option value={90}>3 months</option><option value={180}>6 months</option><option value={365}>1 year</option></select><button type="button" disabled={loading} onClick={() => void runAction('addCourtesyTime')} className="quiet-shelf-secondary-action justify-center sm:col-span-2"><Gift />Add courtesy time</button></div>

            <div className="border-t border-[var(--ink-border-subtle)] pt-5">
              <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Account repair</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Owner-only tools for correcting a mistyped login email or combining an accidental duplicate account. Every action is written to the admin audit log.</p>

              <div className="mt-4 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
                <p className="font-semibold text-[var(--ink-ivory)]">Correct email address</p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">Updates the Firebase login and reader directory. The corrected address is marked unverified until the reader verifies it.</p>
                <input
                  value={correctedEmail}
                  onChange={(event) => setCorrectedEmail(event.target.value)}
                  type="email"
                  autoComplete="off"
                  placeholder="Correct email address"
                  className="mt-3 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[#0d0910] px-3 text-sm text-[var(--ink-ivory)] outline-none"
                />
                <button type="button" disabled={accountRepairBusy || !correctedEmail.trim() || !accountRepairReason.trim()} onClick={() => void correctSelectedEmail()} className="quiet-shelf-secondary-action mt-3 w-full justify-center disabled:opacity-40">
                  Correct email
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4">
                <p className="font-semibold text-amber-200">Merge duplicate account</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">The selected reader is the source account. Enter the email for the account that should remain. Inkbound copies non-conflicting reader data first and deletes the source login only after the copy succeeds. Paid source subscriptions must be resolved before merging.</p>
                <input
                  value={mergeTargetEmail}
                  onChange={(event) => { setMergeTargetEmail(event.target.value); setMergeConfirmation(''); }}
                  type="email"
                  autoComplete="off"
                  placeholder="Destination account email"
                  className="mt-3 min-h-11 w-full rounded-xl border border-amber-400/25 bg-[#0d0910] px-3 text-sm text-[var(--ink-ivory)] outline-none"
                />
                {expectedMergePhrase && <>
                  <label className="mt-3 block text-xs font-semibold text-[var(--ink-ivory)]">Type <span className="break-all font-mono text-amber-200">{expectedMergePhrase}</span></label>
                  <input
                    value={mergeConfirmation}
                    onChange={(event) => setMergeConfirmation(event.target.value)}
                    autoComplete="off"
                    placeholder={expectedMergePhrase}
                    className="mt-2 min-h-11 w-full rounded-xl border border-amber-400/25 bg-[#0d0910] px-3 text-sm text-[var(--ink-ivory)] outline-none"
                  />
                </>}
                <button type="button" disabled={accountRepairBusy || !expectedMergePhrase || !accountRepairReason.trim() || mergeConfirmation.trim().toLowerCase() !== expectedMergePhrase.toLowerCase()} onClick={() => void mergeSelectedAccount()} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-400/35 px-4 text-sm font-bold text-amber-200 disabled:cursor-not-allowed disabled:opacity-40">
                  Merge into destination account
                </button>
              </div>

              <label className="mt-4 block text-sm font-semibold text-[var(--ink-ivory)]">Account repair reason</label>
              <textarea value={accountRepairReason} onChange={(event) => setAccountRepairReason(event.target.value)} rows={3} placeholder="Required for email corrections and account merges" className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)] outline-none" />
            </div>

            <div className="border-t border-[var(--ink-border-subtle)] pt-5">
              <div className="flex items-start gap-3 rounded-2xl border border-[#c97b7b]/30 bg-[#c97b7b]/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#e9b2b2]" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#e9b2b2]">Permanent data erasure</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Removes this reader's Inkbound cloud data, uploaded files, entitlements, admin record, and Firebase login. This cannot be undone.</p>
                  {selectedHasPaidAccess && <p className="mt-2 text-xs font-semibold text-amber-300">Cancel the paid subscription before erasing this account.</p>}
                  {selectedIsCurrentAdmin && <p className="mt-2 text-xs font-semibold text-amber-300">You cannot erase the account you are currently using from the admin dashboard.</p>}
                  {selectedIsProtectedOwner && <p className="mt-2 text-xs font-semibold text-amber-300">Protected owner accounts cannot be erased here.</p>}
                  <button type="button" onClick={openEraseDialog} disabled={!canEraseSelected || loading || erasing} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#c97b7b]/40 px-4 text-sm font-bold text-[#e9b2b2] hover:bg-[#c97b7b]/10 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"><Trash2 className="h-4 w-4" />Erase reader account & data</button>
                </div>
              </div>
            </div>
          </div> : <p className="mt-5 text-[var(--ink-muted)]">Select a reader to manage access.</p>}
        </aside>
      </section>

      <AdminDataSafetyPanel
        targetUserId={selectedUser?.uid ?? null}
        targetLabel={selectedUser?.displayName || selectedUser?.email || ''}
      />

      <AdminCatalogContributionsPanel />

      <section className="inkbound-panel min-w-0 p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Recent admin activity</h2>
            {data && data.audit.length > 0 && <p className="mt-1 text-xs text-[var(--ink-muted)]">Showing {auditStartIndex + 1}–{Math.min(auditStartIndex + AUDIT_PAGE_SIZE, data.audit.length)} of {data.audit.length} entries</p>}
          </div>
        </div>
        <div className="mt-4 divide-y divide-[var(--ink-border-subtle)]">{data?.audit.length ? visibleAudit.map((entry) => <article key={entry.id} className="grid min-w-0 gap-1 py-3 md:grid-cols-[180px_1fr_1fr]"><span className="text-sm text-[var(--ink-muted)]">{formatDate(entry.createdAt)}</span><strong className="break-words text-sm text-[var(--ink-ivory)]">{entry.action.replaceAll('_', ' ')} · {entry.targetEmail || 'Unknown reader'}</strong><span className="break-words text-sm text-[var(--ink-muted)]">{entry.reason}</span></article>) : <p className="py-6 text-[var(--ink-muted)]">No admin activity yet.</p>}</div>
        <PaginationControls page={safeAuditPage} pageCount={auditPageCount} onPageChange={setAuditPage} />
      </section>

      {eraseDialogOpen && selectedUser && (
        <div className="fixed inset-0 z-[280] grid place-items-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm" onClick={() => !erasing && setEraseDialogOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="admin-erase-title" className="relative my-auto w-full max-w-xl rounded-3xl border border-[#c97b7b]/45 bg-[#17101b] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button type="button" disabled={erasing} onClick={() => setEraseDialogOpen(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-[var(--ink-muted)] disabled:opacity-40" aria-label="Close erasure confirmation"><X className="h-5 w-5" /></button>
            <div className="flex items-start gap-3 pr-12"><AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-[#e9b2b2]" /><div className="min-w-0"><h3 id="admin-erase-title" className="font-serif text-3xl text-[var(--ink-ivory)]">Erase this reader permanently?</h3><p className="mt-3 break-words text-sm leading-6 text-[var(--ink-muted)]">You are about to permanently erase <strong className="break-all text-[var(--ink-ivory)]">{selectedUser.email}</strong> from Inkbound. Their library, sessions, profile, uploaded files, entitlements, and Firebase login will be removed. This cannot be undone.</p></div></div>
            <label className="mt-5 block text-sm font-semibold text-[var(--ink-ivory)]" htmlFor="admin-erase-reason">Administrative reason</label><textarea id="admin-erase-reason" name="adminEraseReason" value={eraseReason} onChange={(event) => setEraseReason(event.target.value)} rows={3} disabled={erasing} placeholder="Required. Explain why this erasure is being performed." className="mt-2 w-full rounded-xl border border-[#c97b7b]/35 bg-[#0d0910] p-3 text-sm text-[var(--ink-ivory)] outline-none disabled:opacity-45" />
            <label className="mt-5 block break-words text-sm font-semibold text-[var(--ink-ivory)]" htmlFor="admin-erase-confirmation">Type <span className="break-all font-mono text-[#e9b2b2]">{expectedErasePhrase}</span> exactly</label><input id="admin-erase-confirmation" name="adminEraseConfirmation" autoComplete="off" value={eraseConfirmation} onChange={(event) => setEraseConfirmation(event.target.value)} disabled={erasing} placeholder={expectedErasePhrase} className="mt-2 min-h-12 w-full rounded-xl border border-[#c97b7b]/40 bg-[#0d0910] px-4 text-[var(--ink-ivory)] outline-none disabled:opacity-45" />
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={erasing} onClick={() => setEraseDialogOpen(false)} className="quiet-shelf-secondary-action w-full justify-center disabled:opacity-40 sm:w-auto">Keep reader account</button><button type="button" onClick={() => void eraseSelectedUser()} disabled={erasing || !eraseReason.trim() || eraseConfirmation.trim() !== expectedErasePhrase} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#a65050] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"><Trash2 className="h-4 w-4" />{erasing ? 'Erasing reader…' : 'Permanently erase reader'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
};