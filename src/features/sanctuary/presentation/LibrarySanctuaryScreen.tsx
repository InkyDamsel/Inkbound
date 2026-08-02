import React from 'react';
import { BookOpen, CloudRain, Flame, Paintbrush, Sparkles } from 'lucide-react';
import { LibrarySanctuary } from '../model/librarySanctuary';

interface LibrarySanctuaryScreenProps {
  sanctuary: LibrarySanctuary;
  dragonName?: string;
  onOpenDesigner?: () => void;
}

export const LibrarySanctuaryScreen: React.FC<LibrarySanctuaryScreenProps> = ({
  sanctuary,
  dragonName = 'Lumis',
  onOpenDesigner,
}) => {
  const weatherLabel = sanctuary.weather === 'automatic'
    ? 'Weather follows your world'
    : sanctuary.weather.replace('-', ' ');

  return (
    <section className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inkbound-eyebrow">Your living library</span>
          <h2 className="mt-2 font-serif text-4xl text-[var(--ink-ivory)] sm:text-5xl">
            A quiet place for every story.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
            Your sanctuary grows gently alongside your reading life. Nothing here demands attention; it simply remembers what you love.
          </p>
        </div>

        {onOpenDesigner && (
          <button type="button" onClick={onOpenDesigner} className="quiet-shelf-primary-action">
            <Paintbrush className="h-4 w-4" />
            Design your sanctuary
          </button>
        )}
      </header>

      <div className="inkbound-panel overflow-hidden rounded-[2rem] p-3 sm:p-5">
        <div className="relative isolate min-h-[560px] overflow-hidden rounded-[1.5rem] border border-[var(--ink-border-subtle)] bg-[#17131a] shadow-[inset_0_0_100px_rgba(0,0,0,0.42)] sm:min-h-[640px]">
          <SanctuaryAtmosphere sanctuary={sanctuary} />
          <SanctuaryWall />
          <SanctuaryWindow weather={sanctuary.weather} season={sanctuary.season} />
          <SanctuaryShelves shelfStyleId={sanctuary.shelfStyleId} />
          <SanctuaryFireplace />
          <SanctuaryFloor rugStyleId={sanctuary.rugStyleId} />
          <SanctuaryReadingCorner />
          <SanctuaryDragon dragonName={dragonName} />
          <SanctuaryLighting lightingStyle={sanctuary.lightingStyle} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SanctuaryDetail
          icon={<CloudRain className="h-5 w-5" />}
          label="Outside the window"
          value={weatherLabel}
        />
        <SanctuaryDetail
          icon={<Flame className="h-5 w-5" />}
          label="Room lighting"
          value={sanctuary.lightingStyle.replace('-', ' ')}
        />
        <SanctuaryDetail
          icon={<Sparkles className="h-5 w-5" />}
          label="Quiet companion"
          value={`${dragonName} is resting nearby`}
        />
      </div>
    </section>
  );
};

const SanctuaryAtmosphere: React.FC<{ sanctuary: LibrarySanctuary }> = ({ sanctuary }) => (
  <div
    className="absolute inset-0 -z-20"
    data-wall-style={sanctuary.wallStyleId}
    data-wall-color={sanctuary.wallColorId}
    data-season={sanctuary.season}
    style={{
      background:
        'radial-gradient(circle at 48% 18%, rgba(143,108,146,0.16), transparent 34%), linear-gradient(180deg, #25202a 0%, #1b171e 62%, #120f14 100%)',
    }}
  />
);

const SanctuaryWall = () => (
  <div className="absolute inset-x-0 top-0 h-[70%] -z-10 border-b border-[#4a3a47]/30 bg-[linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[length:90px_100%]" />
);

const SanctuaryWindow: React.FC<{
  weather: LibrarySanctuary['weather'];
  season: LibrarySanctuary['season'];
}> = ({ weather, season }) => {
  const isSnow = weather === 'snow' || (weather === 'automatic' && season === 'winter');

  return (
    <div className="absolute left-[7%] top-[8%] h-[38%] w-[27%] min-w-40 overflow-hidden rounded-t-[48%] border-[10px] border-[#49382f] bg-[#202431] shadow-[0_18px_45px_rgba(0,0,0,0.34)]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#34394b_0%,#252a39_48%,#171d25_100%)]" />
      <div className="absolute bottom-0 left-0 right-0 h-[38%] bg-[linear-gradient(180deg,#1f2b27,#101814)]" />
      <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 bg-[#49382f]" />
      <div className="absolute left-0 right-0 top-1/2 h-1 bg-[#49382f]" />
      {[18, 36, 55, 72, 86].map((left, index) => (
        <span
          key={left}
          className={`absolute top-[-12%] h-16 w-px rotate-[18deg] ${isSnow ? 'rounded-full bg-[#e1ddd2]/70' : 'bg-[#aab2bf]/45'}`}
          style={{ left: `${left}%`, animationDelay: `${index * 240}ms` }}
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(196,181,207,0.16),transparent_48%)]" />
    </div>
  );
};

const SanctuaryShelves: React.FC<{ shelfStyleId: string }> = ({ shelfStyleId }) => (
  <div className="absolute right-[5%] top-[8%] h-[61%] w-[42%] rounded-t-2xl border-[10px] border-[#3b2b26] bg-[#201713] p-3 shadow-[0_26px_60px_rgba(0,0,0,0.4)]" data-shelf-style={shelfStyleId}>
    <div className="grid h-full grid-rows-4 gap-3">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="relative flex items-end gap-1.5 border-b-[8px] border-[#4c342c] px-2 pb-1">
          {[22, 30, 18, 35, 25, 32, 20, 28].map((height, index) => (
            <span
              key={`${row}-${index}`}
              className="block rounded-t-sm border border-white/5 bg-[linear-gradient(90deg,#51344b,#79516d)] shadow-sm"
              style={{ height: `${height + row * 2}px`, width: `${10 + (index % 3) * 3}px` }}
            />
          ))}
          {row === 1 && <span className="ml-auto mb-1 text-2xl" aria-hidden="true">🕯️</span>}
          {row === 2 && <span className="ml-auto mb-1 text-2xl" aria-hidden="true">🌿</span>}
        </div>
      ))}
    </div>
  </div>
);

const SanctuaryFireplace = () => (
  <div className="absolute bottom-[18%] left-[8%] h-[27%] w-[27%] min-w-44 rounded-t-3xl border-[10px] border-[#514038] bg-[#251c18] shadow-[0_24px_52px_rgba(0,0,0,0.38)]">
    <div className="absolute inset-x-[15%] bottom-0 top-[20%] overflow-hidden rounded-t-[45%] border-4 border-[#31231e] bg-[#0d0b0c]">
      <div className="absolute bottom-2 left-1/2 h-[48%] w-[45%] -translate-x-1/2 rounded-[50%_50%_35%_35%] bg-[radial-gradient(circle_at_50%_70%,#d69b62,#9b6044_45%,transparent_72%)] blur-[1px]" />
      <div className="absolute bottom-1 left-[22%] right-[22%] h-3 rotate-3 rounded-full bg-[#51342a]" />
    </div>
    <div className="absolute -left-4 -right-4 -top-4 h-5 rounded-lg bg-[#685349] shadow-lg" />
  </div>
);

const SanctuaryFloor: React.FC<{ rugStyleId: string }> = ({ rugStyleId }) => (
  <div className="absolute inset-x-0 bottom-0 h-[34%] -z-10 bg-[repeating-linear-gradient(90deg,#211815_0,#211815_54px,#291d19_55px,#291d19_108px)]" data-rug-style={rugStyleId}>
    <div className="absolute bottom-[12%] left-1/2 h-[44%] w-[54%] -translate-x-1/2 rounded-[50%] border border-[#9b718d]/25 bg-[radial-gradient(ellipse,#6e4962,#3f2b3b_70%)] opacity-90 shadow-[0_18px_50px_rgba(0,0,0,0.32)]" />
  </div>
);

const SanctuaryReadingCorner = () => (
  <div className="absolute bottom-[12%] left-[37%] h-[28%] w-[20%] min-w-36">
    <div className="absolute bottom-0 h-[62%] w-full rounded-[42%_42%_22%_22%] border-4 border-[#4f3944] bg-[linear-gradient(160deg,#72566d,#4d384a)] shadow-[0_20px_45px_rgba(0,0,0,0.34)]" />
    <div className="absolute left-[12%] top-[18%] h-[46%] w-[76%] rounded-[46%] bg-[#80647b] shadow-inner" />
    <div className="absolute bottom-0 left-[14%] h-[16%] w-3 rounded-b bg-[#372923]" />
    <div className="absolute bottom-0 right-[14%] h-[16%] w-3 rounded-b bg-[#372923]" />
    <div className="absolute -right-[28%] bottom-[3%] h-[46%] w-[26%] rounded-t-full bg-[#3e2e28]" />
    <div className="absolute -right-[36%] top-[24%] text-3xl" aria-hidden="true">☕</div>
  </div>
);

const SanctuaryDragon: React.FC<{ dragonName: string }> = ({ dragonName }) => (
  <div className="absolute bottom-[8%] left-[19%] text-center">
    <div className="text-6xl drop-shadow-[0_14px_16px_rgba(0,0,0,0.45)] sm:text-7xl" role="img" aria-label={`${dragonName}, a sleeping library dragon`}>
      🐉
    </div>
    <span className="mt-1 block rounded-full bg-[#171219]/75 px-3 py-1 text-xs text-[var(--ink-muted)] backdrop-blur-sm">
      {dragonName} is dreaming of stories
    </span>
  </div>
);

const SanctuaryLighting: React.FC<{ lightingStyle: LibrarySanctuary['lightingStyle'] }> = ({ lightingStyle }) => (
  <div
    className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_68%,rgba(213,151,94,0.18),transparent_24%),radial-gradient(circle_at_50%_26%,rgba(164,132,171,0.08),transparent_46%),linear-gradient(180deg,transparent_55%,rgba(7,5,8,0.2))]"
    data-lighting-style={lightingStyle}
  />
);

const SanctuaryDetail: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="inkbound-panel rounded-2xl p-5">
    <div className="flex items-center gap-3 text-[var(--ink-mauve)]">
      {icon}
      <span className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{label}</span>
    </div>
    <p className="mt-3 font-serif text-xl capitalize text-[var(--ink-ivory)]">{value}</p>
  </div>
);
