import React, { useEffect } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { HELP_SECTIONS } from '../content/helpContent';

export const FaqPage: React.FC = () => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Inkbound Help Center | FAQ';
    document.documentElement.dataset.siteSurface = 'help';

    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    description.content = 'Inkbound Help Center and frequently asked questions about your library, series, imports, reading sessions, syncing, privacy, and data.';

    return () => {
      document.title = previousTitle;
      delete document.documentElement.dataset.siteSurface;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-[#0b090d] text-[#f6edf0]">
      <div className="mx-auto w-[min(calc(100%-2rem),980px)] px-4 py-10 sm:px-0 sm:py-14">
        <a href="/app" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#392b3b] bg-[#151018] px-4 py-2 text-sm font-bold text-[#d2ab58] transition hover:border-[#d2ab58]/60">
          <ArrowLeft className="h-4 w-4" /> Back to Inkbound
        </a>

        <header className="mt-8">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#d8a3b9]">Inkbound Help Center</p>
          <h1 className="mt-3 font-serif text-4xl font-medium sm:text-6xl">Frequently asked questions</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#c6aebb] sm:text-base">Answers about your library, series, reading materials, imports, syncing, reading sessions, privacy, and your Inkbound data.</p>
        </header>

        <section className="mt-8 rounded-3xl border border-[#392b3b] bg-[#151018] p-5">
          <strong className="block text-[#f6edf0]">Looking for a quick answer inside Inkbound?</strong>
          <p className="mt-2 text-sm leading-6 text-[#c6aebb]">The in-app Help button keeps the most common answers close by. This page is the fuller reference when you need more detail.</p>
        </section>

        <div className="mt-12 space-y-12">
          {HELP_SECTIONS.map((section) => (
            <section key={section.id} id={section.id}>
              <h2 className="font-serif text-2xl font-medium sm:text-3xl">{section.title}</h2>
              <div className="mt-4 space-y-3">
                {section.items.map((item) => (
                  <details key={item.id} id={item.id} className="rounded-2xl border border-[#392b3b] bg-[#151018] px-5">
                    <summary className="min-h-14 cursor-pointer py-4 font-bold text-[#f6edf0]">{item.question}</summary>
                    <p className="pb-5 text-sm leading-7 text-[#c6aebb]">{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-14 rounded-3xl border border-[#d2ab58]/30 bg-[#1b141e] p-6">
          <div className="flex items-start gap-3">
            <Mail className="mt-1 h-5 w-5 shrink-0 text-[#d2ab58]" />
            <div>
              <h2 className="font-serif text-2xl">Still need help?</h2>
              <p className="mt-2 text-sm leading-7 text-[#c6aebb]">Email <a className="font-bold text-[#d2ab58] hover:underline" href="mailto:inkbound@inkydameinteractive.com">inkbound@inkydameinteractive.com</a>. If something is not working as expected, include a short description and a screenshot when possible.</p>
            </div>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#392b3b] pt-6 text-sm text-[#c6aebb]">
          <a href="/app" className="font-bold text-[#d2ab58] hover:underline">Back to Inkbound</a>
          <a href="/privacy.html" className="hover:text-[#f6edf0]">Privacy Policy</a>
          <a href="/terms.html" className="hover:text-[#f6edf0]">Terms of Service</a>
          <a href="/delete-account.html" className="hover:text-[#f6edf0]">Delete Account</a>
          <a href="/support.html" className="hover:text-[#f6edf0]">Support</a>
        </footer>
      </div>
    </main>
  );
};
