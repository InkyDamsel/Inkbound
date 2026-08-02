import React, { useMemo, useState } from 'react';
import {
  Armchair,
  BookOpen,
  Check,
  Crown,
  LampDesk,
  Layers3,
  Lock,
  Paintbrush,
  Sparkles,
  TreePine,
} from 'lucide-react';
import {
  getSanctuaryAssetsByCategory,
  SanctuaryAssetCategory,
  SanctuaryAssetDefinition,
} from '../assets/sanctuaryAssetCatalog';
import {
  LibrarySanctuary,
  SanctuaryLightingStyle,
  SanctuarySeason,
} from '../model/librarySanctuary';
import { LibrarySanctuaryScreen } from './LibrarySanctuaryScreen';

type DesignerSection =
  | 'room'
  | 'shelves'
  | 'lighting'
  | 'decorations'
  | 'lumis'
  | 'seasons';

interface ShelfDesignerScreenProps {
  sanctuary: LibrarySanctuary;
  dragonName?: string;
  isPremium?: boolean;
  finishedBookCount?: number;
  onUpdateSanctuary: (changes: Partial<LibrarySanctuary>) => void;
  onClose?: () => void;
}

const sections: Array<{
  id: DesignerSection;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'room', label: 'Room', icon: <Paintbrush className="h-4 w-4" /> },
  { id: 'shelves', label: 'Shelves', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'lighting', label: 'Lighting', icon: <LampDesk className="h-4 w-4" /> },
  { id: 'decorations', label: 'Decor', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'lumis', label: 'Lumis', icon: <Armchair className="h-4 w-4" /> },
  { id: 'seasons', label: 'Seasons', icon: <TreePine className="h-4 w-4" /> },
];

const lightingOptions: Array<{
  id: SanctuaryLightingStyle;
  label: string;
  description: string;
}> = [
  { id: 'candlelight', label: 'Candlelight', description: 'Low, warm pools of light.' },
  { id: 'fireplace', label: 'Fireplace Glow', description: 'Soft amber light from the hearth.' },
  { id: 'moonlight', label: 'Moonlight', description: 'Cool lavender light through the window.' },
  { id: 'rainy-afternoon', label: 'Rainy Afternoon', description: 'Muted daylight and gentle shadows.' },
  { id: 'golden-hour', label: 'Golden Hour', description: 'Warm evening light across the shelves.' },
];

const seasonOptions: Array<{
  id: SanctuarySeason;
  label: string;
  description: string;
}> = [
  { id: 'spring', label: 'Spring', description: 'Pressed flowers and soft garden light.' },
  { id: 'summer', label: 'Summer', description: 'Open windows and warm afternoons.' },
  { id: 'autumn', label: 'Autumn', description: 'Rain, amber leaves, and long reading evenings.' },
  { id: 'winter', label: 'Winter', description: 'Snow outside and a closer seat by the fire.' },
];

export const ShelfDesignerScreen: React.FC<ShelfDesignerScreenProps> = ({
  sanctuary,
  dragonName = 'Lumis',
  isPremium = false,
  finishedBookCount = 0,
  onUpdateSanctuary,
  onClose,
}) => {
  const [activeSection, setActiveSection] = useState<DesignerSection>('room');

  return (
    <section className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inkbound-eyebrow">Shelf Designer</span>
          <h2 className="mt-2 font-serif text-4xl text-[var(--ink-ivory)] sm:text-5xl">
            Shape your reading sanctuary.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
            Make gentle changes and watch the room respond immediately. Every choice is saved through the sanctuary controller.
          </p>
        </div>

        {onClose && (
          <button type="button" onClick={onClose} className="quiet-shelf-secondary-action">
            Return to library
          </button>
        )}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <LibrarySanctuaryScreen sanctuary={sanctuary} dragonName={dragonName} />
        </div>

        <aside className="xl:sticky xl:top-5 xl:self-start">
          <div className="inkbound-panel overflow-hidden rounded-3xl">
            <div className="border-b border-[var(--ink-border-subtle)] p-4">
              <div className="flex items-center gap-2 text-[var(--ink-mauve)]">
                <Layers3 className="h-5 w-5" />
                <h3 className="font-serif text-2xl text-[var(--ink-ivory)]">Design Palette</h3>
              </div>
            </div>

            <nav className="flex gap-2 overflow-x-auto border-b border-[var(--ink-border-subtle)] p-3 xl:grid xl:grid-cols-3">
              {sections.map((section) => {
                const selected = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition ${
                      selected
                        ? 'bg-[var(--ink-mauve)] text-[#171219]'
                        : 'bg-[var(--ink-surface-soft)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'
                    }`}
                  >
                    {section.icon}
                    {section.label}
                  </button>
                );
              })}
            </nav>

            <div className="max-h-[640px] overflow-y-auto p-4 sm:p-5">
              <DesignerPanel
                section={activeSection}
                sanctuary={sanctuary}
                isPremium={isPremium}
                finishedBookCount={finishedBookCount}
                onUpdate={onUpdateSanctuary}
              />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};

interface DesignerPanelProps {
  section: DesignerSection;
  sanctuary: LibrarySanctuary;
  isPremium: boolean;
  finishedBookCount: number;
  onUpdate: (changes: Partial<LibrarySanctuary>) => void;
}

const DesignerPanel: React.FC<DesignerPanelProps> = ({
  section,
  sanctuary,
  isPremium,
  finishedBookCount,
  onUpdate,
}) => {
  if (section === 'lighting') {
    return (
      <OptionGrid
        title="Lighting"
        description="Choose how the room feels throughout the day."
        options={lightingOptions.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          selected: sanctuary.lightingStyle === option.id,
          locked: false,
        }))}
        onSelect={(id) => onUpdate({ lightingStyle: id as SanctuaryLightingStyle })}
      />
    );
  }

  if (section === 'seasons') {
    return (
      <OptionGrid
        title="Season"
        description="Seasonal changes stay quiet and atmospheric."
        options={seasonOptions.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          selected: sanctuary.season === option.id,
          locked: false,
        }))}
        onSelect={(id) => onUpdate({ season: id as SanctuarySeason })}
      />
    );
  }

  const categories = categoriesForSection(section);
  const assets = useMemo(
    () => categories.flatMap((category) => getSanctuaryAssetsByCategory(category)),
    [section],
  );

  return (
    <div>
      <h4 className="font-serif text-2xl text-[var(--ink-ivory)]">{sectionTitle(section)}</h4>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{sectionDescription(section)}</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {assets.map((asset) => {
          const lockedReason = getLockedReason(asset, isPremium, finishedBookCount);
          const selected = isAssetSelected(asset, sanctuary);

          return (
            <AssetCard
              key={asset.id}
              asset={asset}
              selected={selected}
              lockedReason={lockedReason}
              onSelect={() => {
                if (lockedReason) return;
                const changes = changesForAsset(asset, sanctuary);
                if (changes) onUpdate(changes);
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

interface AssetCardProps {
  asset: SanctuaryAssetDefinition;
  selected: boolean;
  lockedReason: string | null;
  onSelect: () => void;
}

const AssetCard: React.FC<AssetCardProps> = ({
  asset,
  selected,
  lockedReason,
  onSelect,
}) => (
  <button
    type="button"
    onClick={onSelect}
    disabled={Boolean(lockedReason)}
    className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition ${
      selected
        ? 'border-[var(--ink-mauve)] bg-[var(--ink-mauve)]/10'
        : 'border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] hover:border-[var(--ink-mauve)]/50'
    } ${lockedReason ? 'cursor-not-allowed opacity-70' : ''}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="font-serif text-lg text-[var(--ink-ivory)]">{asset.displayName}</strong>
          {asset.access === 'premium' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ink-mauve)]/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--ink-mauve)]">
              <Crown className="h-3 w-3" /> Premium
            </span>
          )}
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">{asset.description}</p>
      </div>

      <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        selected
          ? 'bg-[var(--ink-mauve)] text-[#171219]'
          : 'bg-[var(--ink-surface-raised)] text-[var(--ink-muted)]'
      }`}>
        {selected ? <Check className="h-4 w-4" /> : lockedReason ? <Lock className="h-3.5 w-3.5" /> : null}
      </span>
    </div>

    {lockedReason && (
      <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--ink-warning,#b99562)]">
        <Lock className="h-3.5 w-3.5" />
        {lockedReason}
      </p>
    )}
  </button>
);

interface OptionGridProps {
  title: string;
  description: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    selected: boolean;
    locked: boolean;
  }>;
  onSelect: (id: string) => void;
}

const OptionGrid: React.FC<OptionGridProps> = ({
  title,
  description,
  options,
  onSelect,
}) => (
  <div>
    <h4 className="font-serif text-2xl text-[var(--ink-ivory)]">{title}</h4>
    <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={option.locked}
          onClick={() => onSelect(option.id)}
          className={`rounded-2xl border p-4 text-left transition ${
            option.selected
              ? 'border-[var(--ink-mauve)] bg-[var(--ink-mauve)]/10'
              : 'border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] hover:border-[var(--ink-mauve)]/50'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong className="font-serif text-lg text-[var(--ink-ivory)]">{option.label}</strong>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{option.description}</p>
            </div>
            {option.selected && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink-mauve)] text-[#171219]">
                <Check className="h-4 w-4" />
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  </div>
);

function categoriesForSection(section: DesignerSection): SanctuaryAssetCategory[] {
  switch (section) {
    case 'room':
      return ['wall', 'floor', 'window', 'outdoor-scene', 'fireplace', 'rug'];
    case 'shelves':
      return ['shelf'];
    case 'decorations':
      return ['decoration'];
    case 'lumis':
      return ['dragon-furniture'];
    default:
      return [];
  }
}

function sectionTitle(section: DesignerSection): string {
  switch (section) {
    case 'room':
      return 'Room Foundations';
    case 'shelves':
      return 'Bookshelves';
    case 'decorations':
      return 'Quiet Decorations';
    case 'lumis':
      return 'Lumis’s Corner';
    default:
      return 'Sanctuary';
  }
}

function sectionDescription(section: DesignerSection): string {
  switch (section) {
    case 'room':
      return 'Choose the walls, floor, view, hearth, and rug that anchor the room.';
    case 'shelves':
      return 'Select the shelves that will hold a lifetime of books.';
    case 'decorations':
      return 'Add subtle objects connected to reading memories and seasons.';
    case 'lumis':
      return 'Create a comfortable place for Lumis to rest without interrupting your reading.';
    default:
      return '';
  }
}

function isAssetSelected(
  asset: SanctuaryAssetDefinition,
  sanctuary: LibrarySanctuary,
): boolean {
  switch (asset.category) {
    case 'wall':
      return sanctuary.wallStyleId === asset.id;
    case 'floor':
      return sanctuary.floorStyleId === asset.id;
    case 'window':
      return sanctuary.windowStyleId === asset.id;
    case 'outdoor-scene':
      return sanctuary.outdoorSceneId === asset.id;
    case 'shelf':
      return sanctuary.shelfStyleId === asset.id;
    case 'fireplace':
      return sanctuary.fireplaceStyleId === asset.id;
    case 'rug':
      return sanctuary.rugStyleId === asset.id;
    case 'dragon-furniture':
      return sanctuary.dragonFurnitureIds.includes(asset.id);
    case 'decoration':
      return sanctuary.decorationPlacements.some((placement) => placement.itemId === asset.id);
    default:
      return false;
  }
}

function changesForAsset(
  asset: SanctuaryAssetDefinition,
  sanctuary: LibrarySanctuary,
): Partial<LibrarySanctuary> | null {
  switch (asset.category) {
    case 'wall':
      return { wallStyleId: asset.id };
    case 'floor':
      return { floorStyleId: asset.id };
    case 'window':
      return { windowStyleId: asset.id };
    case 'outdoor-scene':
      return { outdoorSceneId: asset.id };
    case 'shelf':
      return { shelfStyleId: asset.id };
    case 'fireplace':
      return { fireplaceStyleId: asset.id };
    case 'rug':
      return { rugStyleId: asset.id };
    case 'dragon-furniture':
      return { dragonFurnitureIds: [asset.id] };
    case 'decoration': {
      const alreadyPlaced = sanctuary.decorationPlacements.some(
        (placement) => placement.itemId === asset.id,
      );

      if (alreadyPlaced) {
        return {
          decorationPlacements: sanctuary.decorationPlacements.filter(
            (placement) => placement.itemId !== asset.id,
          ),
        };
      }

      return {
        decorationPlacements: [
          ...sanctuary.decorationPlacements,
          {
            id: `placement-${asset.id}-${Date.now()}`,
            itemId: asset.id,
            surfaceId: asset.placementSurfaces[0] ?? 'room',
            positionX: 50,
            positionY: 50,
            scale: 1,
            rotation: 0,
            layer: 1,
          },
        ],
      };
    }
    default:
      return null;
  }
}

function getLockedReason(
  asset: SanctuaryAssetDefinition,
  isPremium: boolean,
  finishedBookCount: number,
): string | null {
  if (asset.access === 'premium' && !isPremium) {
    return 'Included with Inkbound Premium.';
  }

  const requirement = asset.unlockRequirement;

  switch (requirement.type) {
    case 'default':
      return null;
    case 'premium':
      return isPremium ? null : 'Included with Inkbound Premium.';
    case 'finished-books':
      return finishedBookCount >= requirement.count
        ? null
        : `Finish ${requirement.count} books to welcome this item home.`;
    case 'genre-books':
      return `Read ${requirement.count} ${requirement.genre} books to unlock.`;
    case 'completed-wrapped':
      return `Complete ${requirement.count} Wrapped ${requirement.count === 1 ? 'memory' : 'memories'} to unlock.`;
    case 'reading-season':
      return null;
    default:
      return null;
  }
}
