import React from 'react';
import { BookHeart, Flame, Image, Mail, Sparkles } from 'lucide-react';
import { LivingLibrarySceneState } from '../behavior/livingLibraryEngine';
import { MemoryShelf, MemoryShelfItem } from '../memories/memoryShelfResolver';
import { LibrarySanctuary } from '../model/librarySanctuary';

interface LivingLibraryRendererProps {
  sanctuary: LibrarySanctuary;
  scene: LivingLibrarySceneState;
  memoryShelf?: MemoryShelf;
  dragonName?: string;
  onSelectMemory?: (item: MemoryShelfItem) => void;
}

export const LivingLibraryRenderer: React.FC<LivingLibraryRendererProps> = ({
  sanctuary,
  scene,
  memoryShelf,
  dragonName = 'Lumis',
  onSelectMemory,
}) => {
  return (
    <div
      className="relative isolate min-h-[560px] overflow-hidden rounded-[1.75rem] border border-[var(--ink-border-subtle)] bg-[#17131a] shadow-[inset_0_0_110px_rgba(0,0,0,0.48)] sm:min-h-[660px]"
      data-room-tone={scene.roomTone}
      data-season={sanctuary.season}
      data-weather={sanctuary.weather}
    >
      <RoomTone tone={scene.roomTone} />
      <WallLayer />
      <WindowLayer sanctuary={sanctuary} scene={scene} />
      <CurtainLayer scene={scene} />
      <BookshelfLayer sanctuary={sanctuary} scene={scene} />
      <MemoryShelfLayer memoryShelf={memoryShelf} onSelectMemory={onSelectMemory} />
      <FireplaceLayer scene={scene} />
      <FloorLayer />
      <ReadingChairLayer />
      <LumisLayer scene={scene} dragonName={dragonName} />
      <CandleLayer scene={scene} />
      <DustLayer scene={scene} />
      <AmbientOverlay scene={scene} />
    </div>
  );
};

const RoomTone: React.FC<{ tone: LivingLibrarySceneState['roomTone'] }> = ({ tone }) => {
  const background = tone === 'warm'
    ? 'radial-gradient(circle at 20% 68%, rgba(207,139,78,0.2), transparent 30%), linear-gradient(180deg,#2a2229 0%,#1b171e 64%,#120f14 100%)'
    : tone === 'cool'
      ? 'radial-gradient(circle at 48% 18%, rgba(128,112,161,0.18), transparent 36%), linear-gradient(180deg,#22232c 0%,#191820 64%,#100f14 100%)'
      : 'radial-gradient(circle at 48% 18%, rgba(143,108,146,0.13), transparent 34%), linear-gradient(180deg,#25202a 0%,#1b171e 64%,#120f14 100%)';

  return <div className="absolute inset-0 -z-30 transition-[background] duration-1000" style={{ background }} />;
};

const WallLayer = () => (
  <div className="absolute inset-x-0 top-0 h-[71%] -z-20 border-b border-[#4a3a47]/30 bg-[linear-gradient(90deg,rgba(255,255,255,0.014)_1px,transparent_1px)] bg-[length:92px_100%]" />
);

const WindowLayer: React.FC<{
  sanctuary: LibrarySanctuary;
  scene: LivingLibrarySceneState;
}> = ({ sanctuary, scene }) => (
  <div className="absolute left-[6%] top-[8%] h-[39%] w-[27%] min-w-40 overflow-hidden rounded-t-[48%] border-[10px] border-[#49382f] bg-[#202431] shadow-[0_18px_45px_rgba(0,0,0,0.34)]" data-window-style={sanctuary.windowStyleId}>
    <div className="absolute inset-0 bg-[linear-gradient(180deg,#34394b_0%,#252a39_48%,#171d25_100%)]" />
    <div className="absolute bottom-0 left-0 right-0 h-[38%] bg-[linear-gradient(180deg,#1f2b27,#101814)]" />
    <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 bg-[#49382f]" />
    <div className="absolute left-0 right-0 top-1/2 h-1 bg-[#49382f]" />
    {scene.windowWeather.enabled && (
      <div
        className="absolute inset-0 opacity-70"
        data-motion-key={scene.windowWeather.motionKey}
        style={{
          backgroundImage: scene.windowWeather.motionKey.includes('snow')
            ? 'radial-gradient(circle, rgba(232,228,218,0.78) 0 2px, transparent 3px)'
            : 'repeating-linear-gradient(105deg, transparent 0 18px, rgba(174,183,197,0.42) 19px 20px, transparent 21px 40px)',
          backgroundSize: scene.windowWeather.motionKey.includes('snow') ? '44px 44px' : '100% 52px',
        }}
      />
    )}
  </div>
);

const CurtainLayer: React.FC<{ scene: LivingLibrarySceneState }> = ({ scene }) => (
  <>
    <div className="absolute left-[4.5%] top-[7%] h-[43%] w-[4%] rounded-b-[55%] bg-[linear-gradient(90deg,#3c2938,#69475f)] opacity-90" data-motion-key={scene.curtains.motionKey} />
    <div className="absolute left-[32%] top-[7%] h-[43%] w-[4%] rounded-b-[55%] bg-[linear-gradient(270deg,#3c2938,#69475f)] opacity-90" data-motion-key={scene.curtains.motionKey} />
  </>
);

const BookshelfLayer: React.FC<{
  sanctuary: LibrarySanctuary;
  scene: LivingLibrarySceneState;
}> = ({ sanctuary, scene }) => (
  <div className="absolute right-[4.5%] top-[7%] h-[62%] w-[43%] rounded-t-2xl border-[10px] border-[#3b2b26] bg-[#201713] p-3 shadow-[0_26px_60px_rgba(0,0,0,0.42)]" data-shelf-style={sanctuary.shelfStyleId}>
    <div className="grid h-full grid-rows-4 gap-3">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="relative flex items-end gap-1.5 border-b-[8px] border-[#4c342c] px-2 pb-1">
          {[22, 30, 18, 35, 25, 32, 20, 28].map((height, index) => (
            <span
              key={`${row}-${index}`}
              className="block rounded-t-sm border border-white/5 bg-[linear-gradient(90deg,#51344b,#79516d)] shadow-sm"
              data-motion-key={scene.shelfLife.motionKey}
              style={{ height: `${height + row * 2}px`, width: `${10 + (index % 3) * 3}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

const MemoryShelfLayer: React.FC<{
  memoryShelf?: MemoryShelf;
  onSelectMemory?: (item: MemoryShelfItem) => void;
}> = ({ memoryShelf, onSelectMemory }) => {
  const items = memoryShelf?.items.slice(0, 4) ?? [];
  if (items.length === 0) return null;

  return (
    <div className="absolute right-[7%] top-[16%] z-10 flex w-[37%] items-end justify-center gap-2 rounded-xl border border-[#8f6a82]/25 bg-[#241820]/85 px-3 py-3 shadow-[0_12px_26px_rgba(0,0,0,0.34)] backdrop-blur-sm">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelectMemory?.(item)}
          className="group relative flex min-w-0 flex-1 flex-col items-center text-center"
          aria-label={`${item.title}${item.bookTitle ? `: ${item.bookTitle}` : ''}`}
        >
          <span className="mb-1 flex h-5 w-5 items-center justify-center text-[var(--ink-mauve)]">
            <MemoryIcon item={item} />
          </span>
          <span
            className="block h-14 w-full max-w-8 rounded-t-sm border border-white/10 shadow-md transition group-hover:-translate-y-1"
            style={{ background: item.coverGradient ?? 'linear-gradient(160deg,#6f4d67,#30232f)' }}
          />
          <span className="mt-1 line-clamp-1 max-w-full text-[9px] text-[var(--ink-muted)]">
            {item.bookTitle ?? item.title}
          </span>
        </button>
      ))}
    </div>
  );
};

const MemoryIcon: React.FC<{ item: MemoryShelfItem }> = ({ item }) => {
  if (item.momentType === 'first-photo-memory') return <Image className="h-3.5 w-3.5" />;
  if (item.momentType === 'first-time-capsule') return <Mail className="h-3.5 w-3.5" />;
  if (item.momentType === 'highest-rated-book') return <Sparkles className="h-3.5 w-3.5" />;
  return <BookHeart className="h-3.5 w-3.5" />;
};

const FireplaceLayer: React.FC<{ scene: LivingLibrarySceneState }> = ({ scene }) => (
  <div className="absolute bottom-[17%] left-[7%] h-[28%] w-[27%] min-w-44 rounded-t-3xl border-[10px] border-[#514038] bg-[#251c18] shadow-[0_24px_52px_rgba(0,0,0,0.4)]">
    <div className="absolute inset-x-[15%] bottom-0 top-[20%] overflow-hidden rounded-t-[45%] border-4 border-[#31231e] bg-[#0d0b0c]">
      <div
        className="absolute bottom-2 left-1/2 h-[48%] w-[45%] -translate-x-1/2 rounded-[50%_50%_35%_35%] blur-[1px]"
        data-motion-key={scene.fireplace.motionKey}
        style={{
          opacity: scene.fireplace.enabled ? Math.max(0.35, scene.fireplace.intensity) : 0.18,
          background: 'radial-gradient(circle at 50% 70%,#d69b62,#9b6044 45%,transparent 72%)',
        }}
      />
      <div className="absolute bottom-1 left-[22%] right-[22%] h-3 rotate-3 rounded-full bg-[#51342a]" />
    </div>
    <div className="absolute -left-4 -right-4 -top-4 h-5 rounded-lg bg-[#685349] shadow-lg" />
  </div>
);

const FloorLayer = () => (
  <div className="absolute inset-x-0 bottom-0 h-[34%] -z-10 bg-[repeating-linear-gradient(90deg,#211815_0,#211815_54px,#291d19_55px,#291d19_108px)]">
    <div className="absolute bottom-[12%] left-1/2 h-[44%] w-[54%] -translate-x-1/2 rounded-[50%] border border-[#9b718d]/25 bg-[radial-gradient(ellipse,#6e4962,#3f2b3b_70%)] opacity-90 shadow-[0_18px_50px_rgba(0,0,0,0.32)]" />
  </div>
);

const ReadingChairLayer = () => (
  <div className="absolute bottom-[11%] left-[38%] h-[28%] w-[20%] min-w-36">
    <div className="absolute bottom-0 h-[62%] w-full rounded-[42%_42%_22%_22%] border-4 border-[#4f3944] bg-[linear-gradient(160deg,#72566d,#4d384a)] shadow-[0_20px_45px_rgba(0,0,0,0.34)]" />
    <div className="absolute left-[12%] top-[18%] h-[46%] w-[76%] rounded-[46%] bg-[#80647b] shadow-inner" />
    <div className="absolute -right-[34%] top-[25%] text-3xl" aria-hidden="true">☕</div>
  </div>
);

const LumisLayer: React.FC<{
  scene: LivingLibrarySceneState;
  dragonName: string;
}> = ({ scene, dragonName }) => {
  const positionClass = positionForLumis(scene.lumis.location);
  return (
    <div className={`absolute z-20 text-center transition-all duration-1000 ${positionClass}`} data-motion-key={scene.lumis.motionKey}>
      <div className="text-6xl drop-shadow-[0_14px_16px_rgba(0,0,0,0.45)] sm:text-7xl" role="img" aria-label={`${dragonName} is ${scene.lumis.activity.replaceAll('-', ' ')}`}>
        🐉
      </div>
      <span className="mt-1 block max-w-44 rounded-full bg-[#171219]/78 px-3 py-1 text-xs text-[var(--ink-muted)] backdrop-blur-sm">
        {scene.lumis.reason}
      </span>
    </div>
  );
};

function positionForLumis(location: LivingLibrarySceneState['lumis']['location']): string {
  switch (location) {
    case 'window-perch':
      return 'left-[15%] top-[37%]';
    case 'reading-chair':
      return 'left-[43%] bottom-[20%]';
    case 'newest-finished-book':
      return 'right-[16%] top-[38%]';
    case 'lower-shelf':
      return 'right-[18%] bottom-[22%]';
    case 'book-nest':
      return 'left-[20%] bottom-[8%]';
    case 'fireplace-rug':
    default:
      return 'left-[19%] bottom-[7%]';
  }
}

const CandleLayer: React.FC<{ scene: LivingLibrarySceneState }> = ({ scene }) => (
  <div className="absolute right-[11%] top-[10%] z-20 flex items-end gap-2" data-motion-key={scene.candlelight.motionKey}>
    <Flame className="h-5 w-5 text-[#c68d62]" style={{ opacity: scene.candlelight.enabled ? scene.candlelight.intensity : 0.25 }} />
    <span className="h-8 w-2 rounded-t bg-[#d7c9b1]/80" />
  </div>
);

const DustLayer: React.FC<{ scene: LivingLibrarySceneState }> = ({ scene }) => {
  if (!scene.dustMotes.enabled) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-motion-key={scene.dustMotes.motionKey}>
      {[18, 31, 46, 62, 76, 87].map((left, index) => (
        <span
          key={left}
          className="absolute h-1 w-1 rounded-full bg-[#ded4bf]"
          style={{ left: `${left}%`, top: `${18 + (index % 3) * 16}%`, opacity: scene.dustMotes.intensity }}
        />
      ))}
    </div>
  );
};

const AmbientOverlay: React.FC<{ scene: LivingLibrarySceneState }> = ({ scene }) => (
  <div
    className="pointer-events-none absolute inset-0 z-40 transition-opacity duration-1000"
    data-ambient-effect={scene.lumis.ambientEffect}
    style={{
      background: scene.lumis.ambientEffect === 'fire-glow'
        ? 'radial-gradient(circle at 20% 68%,rgba(213,151,94,0.18),transparent 27%)'
        : scene.lumis.ambientEffect === 'soft-sparkles'
          ? 'radial-gradient(circle at 52% 52%,rgba(180,143,185,0.1),transparent 32%)'
          : 'linear-gradient(180deg,transparent 58%,rgba(7,5,8,0.2))',
    }}
  />
);
