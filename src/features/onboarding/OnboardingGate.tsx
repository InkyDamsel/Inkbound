import React, { useMemo, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CloudRain,
  Egg,
  Import,
  Library,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';
import {
  DEFAULT_LIBRARY_SANCTUARY,
  LibrarySanctuary,
} from '../sanctuary/model/librarySanctuary';

const ONBOARDING_KEY = 'inkbound_onboarding_complete_v1';
const ONBOARDING_PROFILE_KEY = 'inkbound_onboarding_profile_v1';
const SANCTUARY_KEY = 'inkbound_library_sanctuary_v1';

const readerStyles = [
  'I always have a book going',
  'I read when life slows down',
  'I mostly read at night',
  'I listen to audiobooks',
  'I am getting back into reading',
];

const genres = [
  'Fantasy',
  'Romance',
  'Mystery',
  'Horror',
  'Science Fiction',
  'Historical Fiction',
  'Literary Fiction',
  'Cozy Reads',
  'Nonfiction',
  'Manga & Graphic Novels',
];

const steps = [
  'Welcome',
  'Reader',
  'Genres',
  'Lumis',
  'Library',
  'Sanctuary',
  'Accessibility',
  'Home',
] as const;

type Step = (typeof steps)[number];

interface OnboardingProfile {
  readerStyle: string | null;
  genres: string[];
  libraryStart: 'import' | 'search' | 'empty' | null;
  accessibility: {
    textSize: 'standard' | 'large';
    reduceMotion: boolean;
    highContrast: boolean;
    dyslexiaFriendly: boolean;
  };
  completedAt: string;
}

export const OnboardingGate: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [isComplete, setIsComplete] = useState(
    () => window.localStorage.getItem(ONBOARDING_KEY) === 'true',
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [readerStyle, setReaderStyle] = useState<string | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [libraryStart, setLibraryStart] = useState<OnboardingProfile['libraryStart']>(null);
  const [sanctuary, setSanctuary] = useState<LibrarySanctuary>({
    ...DEFAULT_LIBRARY_SANCTUARY,
    updatedAt: new Date().toISOString(),
  });
  const [textSize, setTextSize] = useState<'standard' | 'large'>('standard');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [dyslexiaFriendly, setDyslexiaFriendly] = useState(false);

  const currentStep: Step = steps[stepIndex];
  const canContinue = useMemo(() => {
    if (currentStep === 'Reader') return Boolean(readerStyle);
    if (currentStep === 'Genres') return selectedGenres.length > 0;
    if (currentStep === 'Library') return Boolean(libraryStart);
    return true;
  }, [currentStep, libraryStart, readerStyle, selectedGenres.length]);

  if (isComplete) return <>{children}</>;

  const next = () => {
    if (!canContinue) return;
    setStepIndex((current) => Math.min(steps.length - 1, current + 1));
  };

  const back = () => setStepIndex((current) => Math.max(0, current - 1));

  const complete = () => {
    const profile: OnboardingProfile = {
      readerStyle,
      genres: selectedGenres,
      libraryStart,
      accessibility: {
        textSize,
        reduceMotion,
        highContrast,
        dyslexiaFriendly,
      },
      completedAt: new Date().toISOString(),
    };

    const finalSanctuary = {
      ...sanctuary,
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(ONBOARDING_PROFILE_KEY, JSON.stringify(profile));
    window.localStorage.setItem(SANCTUARY_KEY, JSON.stringify(finalSanctuary));
    window.localStorage.setItem(ONBOARDING_KEY, 'true');
    document.documentElement.dataset.textSize = textSize;
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    document.documentElement.classList.toggle('high-contrast', highContrast);
    document.documentElement.classList.toggle('dyslexia-friendly', dyslexiaFriendly);
    setIsComplete(true);
  };

  return (
    <main className="min-h-screen bg-[#100d12] px-4 py-6 text-[#eee5da] sm:px-8 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-[#6d5263]/25 bg-[radial-gradient(circle_at_50%_0%,rgba(116,82,101,0.18),transparent_38%),linear-gradient(180deg,#1c171e,#121014)] shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4 sm:px-8">
          <div>
            <span className="font-serif text-xl">Inkbound</span>
            <span className="ml-3 text-[10px] uppercase tracking-[0.24em] text-[#a999a3]">Welcome Home</span>
          </div>
          <span className="text-xs text-[#8f8189]">{stepIndex + 1} of {steps.length}</span>
        </div>

        <div className="h-1 bg-[#1f1920]">
          <div
            className="h-full bg-[linear-gradient(90deg,#75546a,#b39aaf)] transition-all duration-500"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="flex flex-1 items-center justify-center p-5 sm:p-10">
          <div className="w-full max-w-4xl">
            {currentStep === 'Welcome' && (
              <CenteredStep
                icon={<CloudRain className="h-10 w-10" />}
                eyebrow="A quiet library is waiting"
                title="Welcome to Inkbound"
                body="A lifelong home for your books, memories, and reading journey. Every story you bring here will find its place."
              />
            )}

            {currentStep === 'Reader' && (
              <ChoiceStep title="What kind of reader are you?" body="Choose the description that feels closest today. It can always change.">
                {readerStyles.map((style) => (
                  <ChoiceButton key={style} selected={readerStyle === style} onClick={() => setReaderStyle(style)}>{style}</ChoiceButton>
                ))}
              </ChoiceStep>
            )}

            {currentStep === 'Genres' && (
              <ChoiceStep title="Which stories feel like home?" body="Choose as many as you like. These help Inkbound understand your reading life and shape Lumis’s personality.">
                {genres.map((genre) => (
                  <ChoiceButton
                    key={genre}
                    selected={selectedGenres.includes(genre)}
                    onClick={() => setSelectedGenres((current) => current.includes(genre) ? current.filter((item) => item !== genre) : [...current, genre])}
                  >
                    {genre}
                  </ChoiceButton>
                ))}
              </ChoiceStep>
            )}

            {currentStep === 'Lumis' && (
              <CenteredStep
                icon={<Egg className="h-12 w-12" />}
                eyebrow="Meet your library dragon"
                title="This is Lumis"
                body="Library Dragons have protected stories for centuries. Lumis will live quietly inside your sanctuary and grow alongside your reading journey. The egg will hatch after your first finished book."
              />
            )}

            {currentStep === 'Library' && (
              <ChoiceStep title="How would you like to begin?" body="You can bring an existing library, search for a first book, or start with quiet empty shelves.">
                <ChoiceButton selected={libraryStart === 'import'} onClick={() => setLibraryStart('import')} icon={<Import className="h-5 w-5" />}>Import my library</ChoiceButton>
                <ChoiceButton selected={libraryStart === 'search'} onClick={() => setLibraryStart('search')} icon={<BookOpen className="h-5 w-5" />}>Search for books</ChoiceButton>
                <ChoiceButton selected={libraryStart === 'empty'} onClick={() => setLibraryStart('empty')} icon={<Library className="h-5 w-5" />}>Start with an empty library</ChoiceButton>
              </ChoiceStep>
            )}

            {currentStep === 'Sanctuary' && (
              <SanctuaryStep sanctuary={sanctuary} onChange={setSanctuary} />
            )}

            {currentStep === 'Accessibility' && (
              <ChoiceStep title="Make Inkbound comfortable" body="Accessibility belongs at the beginning, not buried in settings.">
                <ToggleChoice label="Larger text" selected={textSize === 'large'} onClick={() => setTextSize((value) => value === 'large' ? 'standard' : 'large')} />
                <ToggleChoice label="Reduce motion" selected={reduceMotion} onClick={() => setReduceMotion((value) => !value)} />
                <ToggleChoice label="Higher contrast" selected={highContrast} onClick={() => setHighContrast((value) => !value)} />
                <ToggleChoice label="Dyslexia-friendly font" selected={dyslexiaFriendly} onClick={() => setDyslexiaFriendly((value) => !value)} />
              </ChoiceStep>
            )}

            {currentStep === 'Home' && (
              <CenteredStep
                icon={<Sparkles className="h-11 w-11" />}
                eyebrow="Your library is ready"
                title="Welcome Home"
                body="The shelves are quiet. The fireplace is warm. Lumis waits patiently by the hearth. Every story you read from this day forward will become part of this place."
              >
                <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-[#75546a]/25 bg-[#171219]/80 p-5 text-left">
                  <p className="font-serif text-xl">The Beginning</p>
                  <p className="mt-3 text-sm leading-7 text-[#b9abb2]">Today your library opened its doors. One day these rooms will hold years of stories and countless quiet evenings. But every library begins with a single book.</p>
                </div>
              </CenteredStep>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/5 px-5 py-4 sm:px-8">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-[#a99aa3] transition hover:text-[#eee5da] disabled:invisible"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {currentStep === 'Home' ? (
            <button type="button" onClick={complete} className="inline-flex items-center gap-2 rounded-xl bg-[#75546a] px-5 py-3 text-sm font-semibold text-[#f2e9de] transition hover:bg-[#876177]">
              Enter your library <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={next} disabled={!canContinue} className="inline-flex items-center gap-2 rounded-xl bg-[#75546a] px-5 py-3 text-sm font-semibold text-[#f2e9de] transition hover:bg-[#876177] disabled:cursor-not-allowed disabled:opacity-40">
              {currentStep === 'Welcome' ? 'Begin my library' : 'Continue'} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </main>
  );
};

const CenteredStep: React.FC<React.PropsWithChildren<{ icon: React.ReactNode; eyebrow: string; title: string; body: string }>> = ({ icon, eyebrow, title, body, children }) => (
  <section className="text-center">
    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[#75546a]/30 bg-[#75546a]/10 text-[#bda5b8]">{icon}</div>
    <p className="mt-6 text-xs uppercase tracking-[0.22em] text-[#9f8798]">{eyebrow}</p>
    <h1 className="mt-3 font-serif text-4xl sm:text-6xl">{title}</h1>
    <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#b8aab2]">{body}</p>
    {children}
  </section>
);

const ChoiceStep: React.FC<React.PropsWithChildren<{ title: string; body: string }>> = ({ title, body, children }) => (
  <section>
    <h1 className="font-serif text-4xl sm:text-5xl">{title}</h1>
    <p className="mt-4 max-w-2xl text-sm leading-7 text-[#b8aab2]">{body}</p>
    <div className="mt-8 grid gap-3 sm:grid-cols-2">{children}</div>
  </section>
);

const ChoiceButton: React.FC<React.PropsWithChildren<{ selected: boolean; onClick: () => void; icon?: React.ReactNode }>> = ({ selected, onClick, icon, children }) => (
  <button type="button" onClick={onClick} className={`flex min-h-16 items-center gap-3 rounded-2xl border p-4 text-left transition ${selected ? 'border-[#9e758f] bg-[#75546a]/20 text-[#f0e6dc]' : 'border-white/8 bg-[#171319] text-[#b9abb2] hover:border-[#75546a]/45'}`}>
    {icon}
    <span className="flex-1">{children}</span>
    {selected && <Check className="h-4 w-4 text-[#c7afc0]" />}
  </button>
);

const ToggleChoice: React.FC<{ label: string; selected: boolean; onClick: () => void }> = ({ label, selected, onClick }) => (
  <button type="button" onClick={onClick} className="flex items-center justify-between rounded-2xl border border-white/8 bg-[#171319] p-4 text-left">
    <span className="inline-flex items-center gap-3"><Accessibility className="h-5 w-5 text-[#9e758f]" />{label}</span>
    <span className={`h-6 w-11 rounded-full p-1 transition ${selected ? 'bg-[#75546a]' : 'bg-[#312832]'}`}><span className={`block h-4 w-4 rounded-full bg-[#eee5da] transition ${selected ? 'translate-x-5' : ''}`} /></span>
  </button>
);

const SanctuaryStep: React.FC<{ sanctuary: LibrarySanctuary; onChange: (value: LibrarySanctuary) => void }> = ({ sanctuary, onChange }) => (
  <section>
    <h1 className="font-serif text-4xl sm:text-5xl">Shape your first sanctuary</h1>
    <p className="mt-4 max-w-2xl text-sm leading-7 text-[#b8aab2]">Choose only the foundations. You can redesign every detail later from the Hearth.</p>
    <div className="mt-8 grid gap-5 md:grid-cols-2">
      <OptionGroup title="Shelves" options={[['walnut','Walnut'],['mahogany','Mahogany'],['oak','Oak']]} selected={sanctuary.shelfStyleId} onSelect={(shelfStyleId) => onChange({ ...sanctuary, shelfStyleId })} />
      <OptionGroup title="Lighting" options={[['rainy-afternoon','Rainy Afternoon'],['candlelight','Candlelight'],['moonlight','Moonlight'],['golden-hour','Golden Hour']]} selected={sanctuary.lightingStyle} onSelect={(lightingStyle) => onChange({ ...sanctuary, lightingStyle: lightingStyle as LibrarySanctuary['lightingStyle'] })} />
      <OptionGroup title="Window" options={[['rainy-garden','Rainy Garden'],['moonlit-garden','Moonlit Garden'],['autumn-woods','Autumn Woods']]} selected={sanctuary.outdoorSceneId} onSelect={(outdoorSceneId) => onChange({ ...sanctuary, outdoorSceneId })} />
      <OptionGroup title="Season" options={[['spring','Spring'],['summer','Summer'],['autumn','Autumn'],['winter','Winter']]} selected={sanctuary.season} onSelect={(season) => onChange({ ...sanctuary, season: season as LibrarySanctuary['season'] })} />
    </div>
  </section>
);

const OptionGroup: React.FC<{ title: string; options: string[][]; selected: string; onSelect: (value: string) => void }> = ({ title, options, selected, onSelect }) => (
  <div className="rounded-2xl border border-white/8 bg-[#171319] p-5">
    <p className="font-serif text-xl">{title}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {options.map(([value, label]) => (
        <button key={value} type="button" onClick={() => onSelect(value)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition ${selected === value ? 'border-[#a77e98] bg-[#75546a]/25 text-[#f0e6dc]' : 'border-white/8 text-[#aa9ca5]'}`}>
          {title === 'Lighting' && (value === 'moonlight' ? <Moon className="h-3.5 w-3.5" /> : value === 'golden-hour' ? <Sun className="h-3.5 w-3.5" /> : null)}
          {label}
        </button>
      ))}
    </div>
  </div>
);
