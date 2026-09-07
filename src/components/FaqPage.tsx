import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Mail, Search, X } from 'lucide-react';
import { HELP_SECTIONS } from '../content/helpContent';

export const FaqPage: React.FC = () => {
  const [query, setQuery] = useState('');

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

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return HELP_SECTIONS;
    return HELP_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => `${item.question} ${item.answer} ${section.title}`.toLowerCase().includes(normalizedQuery)),
    })).filter((section) => section.items.length > 0);
  }, [normalizedQuery]);
  const resultCount = visibleSections.reduce((total, section) => total + section.items.length, 0);

  return (
    <main className="min-h-[100dvh] bg-[#0b090d] text-[#f6edf0]">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <a href="/app" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#392b3b] bg-[#151018] px-4 py-2 text-sm font-bold text-[#d2ab58] transition hover:border-[#d2ab58]/60">
          <ArrowLeft className="h-4 w-4" /> Back to Inkbound
        </a>

        <header className="mx-auto mt-10 max-w-3xl text-center">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#d8a3b9]">Inkbound Help Center</p>
          <h1 className="mt-3 font-serif text-4xl font-medium sm:text-6xl">How can we help?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#c6aebb] sm:text-base">Search Inkbound help or browse by topic. Answers here cover your library, Series, ownership, imports, syncing, reading sessions, privacy, and data.</p>
        </header>

        <div className="mx-auto mt-8 max-w-3xl">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#a98b9b]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search questions, features, or keywords..."
              className="min-h-14 w-full rounded-2xl border border-[#49374d] bg-[#17111a] pl-12 pr-12 text-base text-[#f6edf0] outline-none transition placeholder:text-[#806c78] focus:border-[#d2ab58]/70"
              aria-label="Search Inkbound Help Center"
            />
            {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-[#c6aebb] hover:bg-[#251a29] hover:text-white" aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </label>
          {normalizedQuery && <p className="mt-3 text-center text-sm text-[#a98b9b]">{resultCount} {resultCount === 1 ? 'answer' : 'answers'} found</p>}
        </div>

        {!normalizedQuery && (
          <nav className="mx-auto mt-9 flex max-w-5xl flex-wrap justify-center gap-2" aria-label="Help topics">
            {HELP_SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="rounded-full border border-[#392b3b] bg-[#151018] px-4 py-2 text-sm font-semibold text-[#c6aebb] transition hover:border-[#d2ab58]/45 hover:text-[#f6edf0]">{section.title}</a>
            ))}
          </nav>
        )}

        <section className="mx-auto mt-10 max-w-5xl rounded-3xl border border-[#392b3b] bg-gradient-to-br from-[#19121c] to-[#120e15] p-5 sm:p-6">
          <strong className="block font-serif text-xl font-medium text-[#f6edf0]">Quick help lives inside Inkbound, too.</strong>
          <p className="mt-2 text-sm leading-6 text-[#c6aebb]">Use the in-app Help button for common answers without leaving your library. This page is the complete reference when you need more detail.</p>
        </section>

        {visibleSections.length === 0 ? (
          <section className="mx-auto mt-12 max-w-3xl rounded-3xl border border-dashed border-[#49374d] p-10 text-center">
            <Search className="mx-auto h-8 w-8 text-[#d2ab58]" />
            <h2 className="mt-4 font-serif text-2xl">No matching answers</h2>
            <p className="mt-2 text-sm leading-6 text-[#c6aebb]">Try a broader search, or email us below if you cannot find what you need.</p>
          </section>
        ) : (
          <div className={`mx-auto mt-12 max-w-5xl ${normalizedQuery ? 'space-y-8' : 'grid items-start gap-6 lg:grid-cols-2'}`}>
            {visibleSections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-6 rounded-3xl border border-[#2f2433] bg-[#100c12] p-4 sm:p-5">
                <div className="flex items-end justify-between gap-4 border-b border-[#2b202f] pb-4">
                  <h2 className="font-serif text-2xl font-medium">{section.title}</h2>
                  <span className="shrink-0 text-xs text-[#8f7785]">{section.items.length} {section.items.length === 1 ? 'answer' : 'answers'}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {section.items.map((item) => (
                    <details key={item.id} id={item.id} className="group rounded-2xl border border-[#392b3b] bg-[#171018] px-4 transition open:border-[#624767] open:bg-[#1a121d] sm:px-5" open={normalizedQuery ? true : undefined}>
                      <summary className="min-h-14 cursor-pointer list-none py-4 pr-4 font-semibold leading-6 text-[#f6edf0] marker:hidden">{item.question}</summary>
                      <p className="border-t border-[#2f2433] pb-5 pt-4 text-sm leading-7 text-[#c6aebb]">{item.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <section className="mx-auto mt-12 max-w-5xl rounded-3xl border border-[#d2ab58]/30 bg-[#1b141e] p-6 sm:p-7">
          <div className="flex items-start gap-3">
            <Mail className="mt-1 h-5 w-5 shrink-0 text-[#d2ab58]" />
            <div>
              <h2 className="font-serif text-2xl">Still need help?</h2>
              <p className="mt-2 text-sm leading-7 text-[#c6aebb]">Email <a className="font-bold text-[#d2ab58] hover:underline" href="mailto:inkbound@inkydameinteractive.com">inkbound@inkydameinteractive.com</a>. If something is not working as expected, include a short description and a screenshot when possible.</p>
            </div>
          </div>
        </section>

        <footer className="mx-auto mt-10 flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#392b3b] pt-6 text-sm text-[#c6aebb]">
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
