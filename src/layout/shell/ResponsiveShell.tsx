import { useState, type ReactNode } from 'react';
import { HelpCircle, Mail, X } from 'lucide-react';
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
      ['When are missing covers and summaries updated?', 'Inkbound performs light maintenance during the day and gives larger repair jobs priority between 11 PM and 5 AM in your device’s local timezone while Inkbound is open.'],
      ['Does overnight maintenance work if Inkbound is closed?', 'Not reliably. A web app cannot wake a closed browser or sleeping computer. Inkbound resumes maintenance the next time it is open and conditions allow it.'],
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

export function ResponsiveShell({ navigation, children }: ResponsiveShellProps) {
  const { viewport } = useBreakpoint();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="inkbound-app-shell" data-viewport={viewport}>
      {navigation}
      {children}

      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="fixed bottom-5 right-5 z-[180] inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 text-sm font-bold text-[var(--ink-ivory)] shadow-xl transition hover:border-[var(--ink-gold)]/50"
        aria-label="Open Inkbound help and frequently asked questions"
      >
        <HelpCircle className="h-4 w-4 text-[var(--ink-gold)]" /> Help
      </button>

      {helpOpen && (
        <div className="fixed inset-0 z-[300] flex justify-end bg-black/70 backdrop-blur-sm" onClick={() => setHelpOpen(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="inkbound-help-title"
            className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--ink-border)] bg-[var(--ink-surface)] p-5 shadow-2xl sm:p-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-kicker">Help center</p>
                <h2 id="inkbound-help-title" className="mt-2 font-serif text-3xl text-[var(--ink-ivory)]">Frequently asked questions</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Quick answers about syncing, imports, large libraries, reading sessions, and your Inkbound data.</p>
              </div>
              <button type="button" onClick={() => setHelpOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--ink-surface-soft)] text-[var(--ink-muted)]" aria-label="Close help">
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
                        <summary className="cursor-pointer select-none font-semibold text-[var(--ink-ivory)]">{question}</summary>
                        <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{answer}</p>
                      </details>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <section className="mt-9 rounded-3xl border border-[var(--ink-gold)]/25 bg-[var(--ink-gold)]/5 p-5">
              <div className="flex items-start gap-3">
                <Mail className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
                <div>
                  <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Still need help?</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">If you cannot find the answer you are looking for, email us. For a technical issue, include a short description of what happened and a screenshot when possible.</p>
                  <div className="mt-4 flex flex-col gap-2 text-sm">
                    <a href="mailto:inkbound_support@inkydameinteractive.com" className="font-bold text-[var(--ink-gold)] hover:underline">inkbound_support@inkydameinteractive.com</a>
                    <span className="text-xs text-[var(--ink-muted)]">Support and technical help</span>
                    <a href="mailto:inkbound@inkydameinteractive.com" className="mt-2 font-bold text-[var(--ink-gold)] hover:underline">inkbound@inkydameinteractive.com</a>
                    <span className="text-xs text-[var(--ink-muted)]">General Inkbound inquiries</span>
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
