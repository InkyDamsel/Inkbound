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
      ['Does Inkbound work across devices?', 'Yes. Sign in with the same Inkbound account and your cloud library, reading sessions, and synced profile information can follow you to another device.'],
      ['What happens when I sign out?', 'Inkbound removes signed-in account data from that device while keeping your cloud account and library intact. Sign back into the same account to restore your synced data.'],
      ['Can I use Inkbound offline?', 'Inkbound keeps local data available where possible. Changes that need the cloud will continue syncing after your connection returns.'],
      ['Why can syncing sometimes take longer?', 'A first sign-in, a fresh device, a very large library, or a slow connection can require extra time. Returning readers should be able to use verified local data while cloud updates continue in the background.'],
    ],
  },
  {
    title: 'Imports & library maintenance',
    items: [
      ['How does Inkbound handle large libraries?', 'Inkbound is designed to import large libraries quickly, then fill in missing book details gradually so you do not have to wait for every cover and summary before using your library.'],
      ['When are missing covers and summaries updated?', 'Inkbound performs light maintenance while the app is active and gives larger repair jobs priority during quieter hours on your device.'],
      ['Does maintenance keep running after I close Inkbound?', 'Not continuously. Mobile operating systems and browsers can pause background work. Inkbound safely resumes queued maintenance the next time the app becomes active and conditions allow it.'],
      ['Do I need to re-import books with missing details?', 'No. Inkbound can keep missing covers and summaries queued for repair without requiring you to import the library again.'],
      ['Will metadata repair overwrite my reading data?', 'No. Library maintenance is intended to fill missing book metadata, not replace your ratings, reviews, reading status, dates, progress, notes, tags, collections, or ownership information.'],
      ['What if Inkbound cannot find a cover or summary?', 'The book remains in your library. Inkbound can retry missing metadata later instead of treating your reading record as disposable.'],
    ],
  },
  {
    title: 'Reading sessions',
    items: [
      ['What happens to maintenance while I use the reading timer?', 'Your reading session takes priority. Large-library metadata maintenance pauses while the timer is active and resumes later.'],
      ['What if my connection drops during a session?', 'The reading timer and session experience are designed to continue locally rather than depending on a constant internet connection. Cloud updates can catch up when connectivity returns.'],
      ['What if I background Inkbound during a timer?', 'Your active timer draft is preserved. When Inkbound becomes active again, elapsed time is reconciled from the saved session timestamps instead of relying only on foreground timer ticks.'],
    ],
  },
  {
    title: 'Profile & data',
    items: [
      ['Will my profile banner and avatar appear on another device?', 'When signed into the same account, synced profile information is intended to restore across devices.'],
      ['Can I export my library?', 'Yes. Inkbound provides a complete JSON backup and a spreadsheet-friendly CSV export from Settings.'],
      ['What is the difference between clearing this device and deleting my account?', 'Clearing a device removes its local Inkbound data and keeps your cloud account. Deleting your account permanently removes the account and its associated Inkbound cloud data.'],
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
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Quick answers about syncing, imports, large libraries, reading sessions, and your Inkbound data.</p>
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
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">If you cannot find the answer you are looking for, email us. For a technical issue, include a short description of what happened and a screenshot when possible.</p>
                  <a href="mailto:inkbound@inkydameinteractive.com" className="mt-4 inline-flex min-h-11 max-w-full items-center py-2 font-bold text-[var(--ink-gold)] hover:underline">
                    <span className="break-all">inkbound@inkydameinteractive.com</span>
                  </a>
                  <p className="text-xs text-[var(--ink-muted)]">Account, sync, import, privacy, billing, and technical support</p>
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
