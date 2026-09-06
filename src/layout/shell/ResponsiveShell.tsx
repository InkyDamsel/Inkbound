import { useState, type ReactNode } from 'react';
import { ExternalLink, HelpCircle, Mail, X } from 'lucide-react';
import { useBreakpoint } from '../responsive/BreakpointProvider';

interface ResponsiveShellProps {
  navigation: ReactNode;
  children?: ReactNode;
}

const faqSections = [
  {
    title: 'Sync & devices',
    items: [
      ['Does Inkbound work across devices?', 'Yes. Sign in with the same Inkbound account and your synced library, reading sessions, profile information, and supported account data can follow you to another device.'],
      ['What happens when I sign out?', 'Signing out removes signed-in account data from that device without deleting your Inkbound account or cloud library. Sign back into the same account to restore synced data.'],
      ['Can I use Inkbound offline?', 'Inkbound keeps locally available data usable where possible. Changes that need the cloud can continue syncing after your connection returns.'],
      ['Why can syncing sometimes take longer?', 'A first sign-in, a fresh device, a very large library, or a slow connection can take longer to restore. Inkbound is designed so returning readers can keep working with saved local data while cloud updates catch up.'],
      ['Will moving around the app repeatedly download my whole library?', 'Inkbound is designed to work from the library already available on your device during normal navigation. A fresh device may need an initial cloud restore, but ordinary screen changes should not require rebuilding your library from scratch.'],
      ['What should I do if another device looks out of date?', 'Keep both devices online for a little while and make sure they are signed into the same Inkbound account. If a change still does not appear, close and reopen Inkbound before contacting support.'],
    ],
  },
  {
    title: 'Library, status & ownership',
    items: [
      ['Is TBR the same as not owning a book?', 'No. Reading status and ownership are separate. A TBR title can be owned, borrowed, available through a subscription, on a wishlist, or not owned at all.'],
      ['Can a book be unread even if I own it?', 'Yes. Inkbound keeps ownership separate from reading progress, so unread books can still be marked as owned.'],
      ['What ownership options can Inkbound track?', 'Inkbound can distinguish owned books, library loans, books borrowed from another person, subscription access, wishlist items, and books you do not own.'],
      ['Will changing ownership change my reading history?', 'No. Ownership describes access to the book. Changing it does not erase reading sessions, ratings, reviews, notes, progress, or finished dates.'],
      ['Can I organize books into personal collections?', 'Yes. Collections are for your own organization and can be used alongside reading status, ownership, tags, ratings, and other library details.'],
      ['Can I search and filter a large library?', 'Yes. Inkbound includes library search and filters so you can narrow a large collection by reading state, format, genre, ownership, rating, and other available metadata.'],
    ],
  },
  {
    title: 'Imports & library updates',
    items: [
      ['How does Inkbound handle large libraries?', 'Inkbound is designed to import large libraries quickly, then fill in missing book details gradually so you do not have to wait for every cover and summary before using your library.'],
      ['When are missing covers and summaries updated?', 'Inkbound can check for missing book details while the app is active. Very large libraries are handled in smaller batches so the app stays responsive.'],
      ['Does Inkbound keep checking after I close the app?', 'Not continuously. Phones, tablets, and browsers can pause background work. Inkbound keeps unfinished detail checks queued so you can continue later.'],
      ['Do I need to re-import books with missing details?', 'No. Missing covers and summaries can remain queued for another attempt without requiring you to import the library again.'],
      ['Will adding book details overwrite my reading data?', 'No. Filling in missing metadata is kept separate from your personal reading data. Inkbound does not use a cover or summary update as a reason to replace your rating, review, status, dates, progress, notes, tags, collections, or ownership.'],
      ['What if Inkbound cannot find a cover or summary?', 'The book stays in your library. You can keep using it normally and try the missing-detail check again later.'],
      ['Can imported books be edited after import?', 'Yes. Imported books become normal library records that you can review and correct when source metadata is missing or inaccurate.'],
      ['Does importing a library mean Inkbound owns my data?', 'No. Your reading records remain yours. Inkbound provides export tools so you can keep a portable copy of your library and reading data.'],
    ],
  },
  {
    title: 'Reading sessions',
    items: [
      ['What happens to book-detail updates while I use the reading timer?', 'Your reading session takes priority. Large-library detail updates can pause while the timer is active and continue later.'],
      ['What if my connection drops during a session?', 'The reading timer and session experience are designed to continue locally rather than depending on a constant internet connection. Cloud updates can catch up when connectivity returns.'],
      ['What if I background Inkbound during a timer?', 'Your active timer draft is preserved. When Inkbound becomes active again, elapsed time is restored from saved session timing instead of relying only on what stayed visible on screen.'],
      ['Can I edit my reading progress later?', 'Yes. Inkbound keeps session history and book progress as editable reading data, so mistakes can be corrected without deleting the book.'],
      ['Do reading sessions affect my statistics and streaks?', 'Yes. Inkbound uses recorded reading sessions and progress to build reading history, streaks, goals, and other activity-based insights.'],
    ],
  },
  {
    title: 'Profile, privacy & your data',
    items: [
      ['Will my profile banner and avatar appear on another device?', 'When signed into the same account, synced profile information is intended to restore across devices.'],
      ['Can I export my library?', 'Yes. Settings includes a complete JSON backup and a spreadsheet-friendly CSV library export.'],
      ['What is included in the complete JSON backup?', 'The complete backup is intended for portability and includes your Inkbound library and reading-session data together with supported preferences stored by the app.'],
      ['What is the difference between clearing this device and deleting my account?', 'Clearing a device removes its local Inkbound data and keeps your cloud account. Deleting your account permanently removes the account and its associated Inkbound cloud data.'],
      ['Should I email my password or sign-in code to support?', 'No. Inkbound support will never need your password or a sign-in verification code. For import or sync problems, send a description of what happened and a screenshot when helpful.'],
    ],
  },
];

const legalLinks = [
  { href: '/privacy.html', label: 'Privacy Policy' },
  { href: '/terms.html', label: 'Terms of Service' },
  { href: '/delete-account.html', label: 'Delete Account' },
  { href: '/support.html', label: 'Support' },
];

export function ResponsiveShell({ navigation, children }: ResponsiveShellProps) {
  const { viewport } = useBreakpoint();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="inkbound-app-shell pb-24 md:pb-20" data-viewport={viewport}>
      {navigation}
      {children}

      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[110] grid h-11 w-11 place-items-center rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-0 text-[var(--ink-ivory)] shadow-xl transition hover:border-[var(--ink-gold)]/50 md:bottom-[max(1.25rem,env(safe-area-inset-bottom))] md:right-[max(1.25rem,env(safe-area-inset-right))] md:z-[180]"
        aria-label="Open Inkbound help and frequently asked questions"
        title="Help"
      >
        <HelpCircle className="h-5 w-5 text-[var(--ink-gold)]" />
        <span className="sr-only">Help</span>
      </button>

      {helpOpen && (
        <div className="fixed inset-0 z-[300] flex justify-end bg-black/70 backdrop-blur-sm" onClick={() => setHelpOpen(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="inkbound-help-title"
            className="h-[100dvh] w-full max-w-2xl overflow-y-auto overscroll-contain border-l border-[var(--ink-border)] bg-[var(--ink-surface)] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:px-8 sm:pb-[max(2rem,env(safe-area-inset-bottom))] sm:pt-[max(2rem,env(safe-area-inset-top))]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-kicker">Help center</p>
                <h2 id="inkbound-help-title" className="mt-2 font-serif text-3xl text-[var(--ink-ivory)]">Frequently asked questions</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Quick answers about syncing, library organization, imports, reading sessions, privacy, and your Inkbound data.</p>
              </div>
              <button type="button" onClick={() => setHelpOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--ink-surface-soft)] text-[var(--ink-muted)]" aria-label="Close help">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-8 space-y-8">
              {faqSections.map((section) => (
                <section key={section.title}>
                  <h3 className="font-serif text-xl text-[var(--ink-ivory)]">{section.title}</h3>
                  <div className="mt-3 space-y-2">
                    {section.items.map(([question, answer]) => (
                      <details key={question} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3">
                        <summary className="min-h-11 cursor-pointer select-none py-2 font-semibold text-[var(--ink-ivory)]">{question}</summary>
                        <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{answer}</p>
                      </details>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <section className="mt-9 rounded-3xl border border-[var(--ink-gold)]/25 bg-[var(--ink-gold)]/5 p-5">
              <div className="flex items-start gap-3">
                <Mail className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
                <div className="min-w-0">
                  <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Still need help?</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">If you cannot find the answer you are looking for, email us. If something is not working as expected, include a short description of what happened and a screenshot when possible.</p>
                  <a href="mailto:inkbound@inkydameinteractive.com" className="mt-4 inline-flex min-h-11 max-w-full items-center py-2 font-bold text-[var(--ink-gold)] hover:underline">
                    <span className="break-all">inkbound@inkydameinteractive.com</span>
                  </a>
                  <p className="text-xs text-[var(--ink-muted)]">Account, sync, import, privacy, billing, and app support</p>
                </div>
              </div>
            </section>

            <nav className="mt-6 border-t border-[var(--ink-border-subtle)] pt-5" aria-label="Inkbound privacy, legal, and account resources">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Privacy & account resources</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {legalLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="inline-flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--ink-ivory)] hover:border-[var(--ink-gold)]/40"
                  >
                    {link.label}
                    <ExternalLink className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                  </a>
                ))}
              </div>
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
