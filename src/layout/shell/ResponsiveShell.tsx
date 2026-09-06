import { useState, type ReactNode } from 'react';
import { ExternalLink, HelpCircle, Mail, X } from 'lucide-react';
import { QUICK_HELP_ITEMS } from '../../content/helpContent';
import { useBreakpoint } from '../responsive/BreakpointProvider';

interface ResponsiveShellProps {
  navigation: ReactNode;
  children?: ReactNode;
}

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
                <h2 id="inkbound-help-title" className="mt-2 font-serif text-3xl text-[var(--ink-ivory)]">Quick help</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Common answers without leaving Inkbound. For detailed help, visit the full FAQ.</p>
              </div>
              <button type="button" onClick={() => setHelpOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--ink-surface-soft)] text-[var(--ink-muted)]" aria-label="Close help">
                <X className="h-5 w-5" />
              </button>
            </div>

            <section className="mt-8">
              <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Quick answers</h3>
              <div className="mt-3 space-y-2">
                {QUICK_HELP_ITEMS.map((item) => (
                  <details key={item.id} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3">
                    <summary className="min-h-11 cursor-pointer select-none py-2 font-semibold text-[var(--ink-ivory)]">{item.question}</summary>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>

            <a
              href="/faq"
              className="mt-7 flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/10 px-5 py-3 font-bold text-[var(--ink-gold)] transition hover:border-[var(--ink-gold)]/60"
            >
              View full Help Center
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>

            <section className="mt-7 rounded-3xl border border-[var(--ink-gold)]/25 bg-[var(--ink-gold)]/5 p-5">
              <div className="flex items-start gap-3">
                <Mail className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
                <div className="min-w-0">
                  <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Still need help?</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">If you cannot find the answer you are looking for, email us. If something is not working as expected, include a short description and a screenshot when possible.</p>
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
                  <a key={link.href} href={link.href} className="inline-flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--ink-ivory)] hover:border-[var(--ink-gold)]/40">
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
