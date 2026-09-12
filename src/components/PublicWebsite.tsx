import React, { useEffect } from 'react';
import { ArrowRight, BarChart3, BookOpen, Check, Clock3, Layers3, LibraryBig, ShieldCheck, Sparkles } from 'lucide-react';
import { PREMIUM_FEATURE_SUMMARY } from '../config/productPolicy';

const APP_PATH = '/app';

const features = [
  { icon: LibraryBig, title: 'A library that stays yours', text: 'Track unlimited reading material, editions, ownership, status, collections, tags, ratings, and reading progress in one private reading home.' },
  { icon: Clock3, title: 'Your reading sessions tell the story', text: 'Log reading time and progress, then let Inkbound turn those sessions into streaks, goals, timelines, and meaningful reading history.' },
  { icon: Layers3, title: 'Built for large libraries', text: 'Import, organize, find duplicates, fill in missing details, and manage large collections without forcing you into a phone-only workflow.' },
  { icon: BarChart3, title: 'Insights without losing the journal', text: 'See statistics, reading patterns, yearly reflections, achievements, and deeper Premium insights while keeping the focus on your reading life.' },
];

export const PublicWebsite: React.FC = () => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Inkbound — Your Personal Reading Journal';
    document.documentElement.dataset.siteSurface = 'marketing';
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) { description = document.createElement('meta'); description.name = 'description'; document.head.appendChild(description); }
    description.content = 'Inkbound is a private personal reading journal and library tracker for books, manga, comics, reading sessions, imports, collections, series, goals, memories, and reading insights.';
    return () => { document.title = previousTitle; delete document.documentElement.dataset.siteSurface; };
  }, []);

  return (
    <div className="inkbound-public-site">
      <header className="inkbound-public-nav" aria-label="Primary navigation">
        <a className="inkbound-public-brand" href="/" aria-label="Inkbound home"><img src="/assets/branding/pwa/icon-192.png" alt="" width="42" height="42" /><span>Inkbound</span></a>
        <nav className="inkbound-public-links" aria-label="Website sections"><a href="#features">Features</a><a href="#premium">Premium</a><a href="/faq">FAQ</a><a href="/privacy.html">Privacy</a><a href="/support.html">Support</a></nav>
        <a className="inkbound-public-open" href={APP_PATH}>Open Inkbound <ArrowRight className="h-4 w-4" /></a>
      </header>

      <main>
        <section className="inkbound-public-hero" aria-labelledby="inkbound-hero-title">
          <div className="inkbound-public-hero-copy">
            <p className="inkbound-public-kicker"><Sparkles className="h-4 w-4" /> Your reading life, kept beautifully</p>
            <h1 id="inkbound-hero-title">A reading journal built for the stories you actually live with.</h1>
            <p className="inkbound-public-lede">Inkbound brings your library, series, reading sessions, progress, memories, collections, goals, and insights together in one private home — on the web and on Android.</p>
            <div className="inkbound-public-actions"><a className="inkbound-public-cta" href={APP_PATH}>Start with Inkbound <ArrowRight className="h-5 w-5" /></a><a className="inkbound-public-secondary" href="#features">Explore features</a></div>
            <div className="inkbound-public-trust" aria-label="Product highlights"><span><Check className="h-4 w-4" /> Unlimited library</span><span><ShieldCheck className="h-4 w-4" /> Private account data</span><span><BookOpen className="h-4 w-4" /> Web + Android</span></div>
          </div>
          <div className="inkbound-public-hero-card" aria-label="Inkbound product preview">
            <div className="inkbound-public-preview-head"><div><p>Tonight's shelf</p><h2>Your reading, in one place.</h2></div><img src="/assets/branding/pwa/icon-192.png" alt="Inkbound" width="64" height="64" /></div>
            <div className="inkbound-public-preview-grid"><article><strong>Library</strong><span>Reading material, series, tags & collections</span></article><article><strong>Sessions</strong><span>Time, pages, streaks & goals</span></article><article><strong>Memories</strong><span>Timeline, photos & reflections</span></article><article><strong>Insights</strong><span>Patterns, reports & yearbooks</span></article></div>
          </div>
        </section>

        <section className="inkbound-public-section" id="features" aria-labelledby="features-title">
          <p className="inkbound-public-kicker">Made for readers who keep stories</p><h2 id="features-title">More than a list of titles.</h2><p className="inkbound-public-section-intro">Inkbound keeps your library, sessions, progress, editions, and series organization connected, so changes show up throughout your reading history instead of living in separate notes.</p>
          <div className="inkbound-public-feature-grid">{features.map(({ icon: Icon, title, text }) => <article key={title} className="inkbound-public-feature-card"><Icon className="h-6 w-6" aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div>
        </section>

        <section className="inkbound-public-section inkbound-public-premium" id="premium" aria-labelledby="premium-title">
          <div><p className="inkbound-public-kicker">Free at the core</p><h2 id="premium-title">Your library is not the paywall.</h2><p>Every reader can keep an unlimited library, import reading material, organize collections, track progress, and export supported library data. Premium adds deeper analysis, richer reflections, historical reading views, and enhanced insights.</p></div>
          <div className="inkbound-public-premium-card"><p className="inkbound-public-plan-name">Inkbound Premium</p><ul>{PREMIUM_FEATURE_SUMMARY.map((feature) => <li key={feature}><Check className="h-4 w-4" /> {feature}</li>)}</ul><p>$6.99/month or $59.99/year in the U.S. Eligible accounts can try Premium for 7 days with no card required; the Inkbound trial does not auto-renew or automatically become a paid subscription.</p><a href={APP_PATH}>See Premium inside Inkbound <ArrowRight className="h-4 w-4" /></a></div>
        </section>

        <section className="inkbound-public-section inkbound-public-callout" aria-labelledby="callout-title">
          <div><p className="inkbound-public-kicker">One account, all your reading</p><h2 id="callout-title">Organize on desktop. Log wherever you read.</h2><p>Use the larger web workspace for imports, cleanup, and library management, then continue with the same Inkbound account on Android. Supported library and reading-history data sync with the same Inkbound account across your devices when they are connected.</p></div>
          <a className="inkbound-public-cta" href={APP_PATH}>Open the web app <ArrowRight className="h-5 w-5" /></a>
        </section>
      </main>

      <footer className="inkbound-public-footer"><div><strong>Inkbound</strong><p>A personal reading journal by Inky Dame Interactive.</p></div><nav aria-label="Legal and support"><a href="/faq">FAQ</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/support.html">Support</a><a href="/delete-account.html">Delete account</a></nav><p>© {new Date().getFullYear()} Inky Dame Interactive.</p></footer>
    </div>
  );
};
