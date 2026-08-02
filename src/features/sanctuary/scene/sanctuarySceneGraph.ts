import { LivingLibrarySceneState } from '../behavior/livingLibraryEngine';
import { MemoryShelf } from '../memories/memoryShelfResolver';
import { LibrarySanctuary } from '../model/librarySanctuary';

export type SanctuarySceneNodeType =
  | 'root'
  | 'background'
  | 'window'
  | 'outdoor-scene'
  | 'weather'
  | 'curtains'
  | 'shelves'
  | 'shelf-section'
  | 'fireplace'
  | 'fire'
  | 'mantel'
  | 'reading-corner'
  | 'chair'
  | 'reading-table'
  | 'book'
  | 'tea'
  | 'lumis'
  | 'decoration'
  | 'ambient-effect';

export type SanctuarySceneNodeVisibility = 'visible' | 'hidden';
export type SanctuarySceneNodeInteraction = 'none' | 'select' | 'drag';

export interface SanctuarySceneTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

export interface SanctuarySceneAccessibility {
  label?: string;
  description?: string;
  decorative: boolean;
  reduceMotionFallback?: string;
}

export interface SanctuarySceneBinding {
  source:
    | 'sanctuary'
    | 'living-library'
    | 'memory-shelf'
    | 'reading-data'
    | 'static';
  key: string;
}

export interface SanctuarySceneNode {
  id: string;
  type: SanctuarySceneNodeType;
  visibility: SanctuarySceneNodeVisibility;
  interaction: SanctuarySceneNodeInteraction;
  transform: SanctuarySceneTransform;
  accessibility: SanctuarySceneAccessibility;
  bindings: SanctuarySceneBinding[];
  metadata: Record<string, string | number | boolean | null>;
  children: SanctuarySceneNode[];
}

export interface SanctuarySceneGraph {
  schemaVersion: 1;
  root: SanctuarySceneNode;
  generatedAt: string;
}

export interface SanctuarySceneGraphContext {
  sanctuary: LibrarySanctuary;
  scene: LivingLibrarySceneState;
  memoryShelf?: MemoryShelf;
  currentBookId?: string | null;
  currentBookTitle?: string | null;
  dragonName?: string;
  editorEnabled?: boolean;
  now?: Date;
}

export function buildSanctuarySceneGraph(
  context: SanctuarySceneGraphContext,
): SanctuarySceneGraph {
  const editorEnabled = context.editorEnabled ?? false;
  const dragonName = context.dragonName ?? 'Lumis';

  const root = node({
    id: 'sanctuary-root',
    type: 'root',
    transform: transform(0, 0, 100, 100, 0),
    accessibility: { decorative: true },
    children: [
      node({
        id: 'background',
        type: 'background',
        transform: transform(0, 0, 100, 100, 0),
        accessibility: { decorative: true },
        bindings: [
          binding('sanctuary', 'wallStyleId'),
          binding('sanctuary', 'wallColorId'),
          binding('living-library', 'roomTone'),
        ],
        metadata: {
          wallStyleId: context.sanctuary.wallStyleId,
          wallColorId: context.sanctuary.wallColorId,
          roomTone: context.scene.roomTone,
        },
      }),
      buildWindowNode(context),
      buildShelvesNode(context, editorEnabled),
      buildFireplaceNode(context),
      buildReadingCornerNode(context, editorEnabled),
      node({
        id: 'lumis',
        type: 'lumis',
        transform: lumisTransform(context.scene.lumis.location),
        accessibility: {
          decorative: false,
          label: dragonName,
          description: context.scene.lumis.reason,
          reduceMotionFallback: 'static-resting-pose',
        },
        bindings: [binding('living-library', 'lumis')],
        metadata: {
          name: dragonName,
          activity: context.scene.lumis.activity,
          location: context.scene.lumis.location,
          motionKey: context.scene.lumis.motionKey,
          ambientEffect: context.scene.lumis.ambientEffect,
        },
      }),
      ...buildDecorationNodes(context, editorEnabled),
      buildAmbientEffectsNode(context),
    ],
  });

  return {
    schemaVersion: 1,
    root,
    generatedAt: (context.now ?? new Date()).toISOString(),
  };
}

export function flattenSanctuarySceneGraph(
  graph: SanctuarySceneGraph,
): SanctuarySceneNode[] {
  const result: SanctuarySceneNode[] = [];

  const visit = (current: SanctuarySceneNode) => {
    result.push(current);
    current.children.forEach(visit);
  };

  visit(graph.root);
  return result.sort((a, b) => a.transform.zIndex - b.transform.zIndex);
}

export function findSanctuarySceneNode(
  graph: SanctuarySceneGraph,
  id: string,
): SanctuarySceneNode | undefined {
  return flattenSanctuarySceneGraph(graph).find((item) => item.id === id);
}

function buildWindowNode(context: SanctuarySceneGraphContext): SanctuarySceneNode {
  return node({
    id: 'window',
    type: 'window',
    transform: transform(6, 8, 27, 39, 20),
    accessibility: {
      decorative: false,
      label: 'Library window',
      description: `The window shows ${context.sanctuary.weather} weather in ${context.sanctuary.season}.`,
    },
    bindings: [binding('sanctuary', 'windowStyleId')],
    metadata: { windowStyleId: context.sanctuary.windowStyleId },
    children: [
      node({
        id: 'outdoor-scene',
        type: 'outdoor-scene',
        transform: transform(0, 0, 100, 100, 21),
        accessibility: { decorative: true },
        bindings: [binding('sanctuary', 'outdoorSceneId')],
        metadata: { outdoorSceneId: context.sanctuary.outdoorSceneId },
      }),
      node({
        id: 'window-weather',
        type: 'weather',
        visibility: context.scene.windowWeather.enabled ? 'visible' : 'hidden',
        transform: transform(0, 0, 100, 100, 22),
        accessibility: {
          decorative: true,
          reduceMotionFallback: `${context.scene.windowWeather.motionKey}-static`,
        },
        bindings: [binding('living-library', 'windowWeather')],
        metadata: {
          motionKey: context.scene.windowWeather.motionKey,
          intensity: context.scene.windowWeather.intensity,
        },
      }),
      node({
        id: 'curtains',
        type: 'curtains',
        transform: transform(-6, -2, 112, 108, 23),
        accessibility: {
          decorative: true,
          reduceMotionFallback: 'curtain-static',
        },
        bindings: [binding('living-library', 'curtains')],
        metadata: {
          motionKey: context.scene.curtains.motionKey,
          intensity: context.scene.curtains.intensity,
        },
      }),
    ],
  });
}

function buildShelvesNode(
  context: SanctuarySceneGraphContext,
  editorEnabled: boolean,
): SanctuarySceneNode {
  const memoryItems = context.memoryShelf?.items ?? [];

  return node({
    id: 'bookshelves',
    type: 'shelves',
    interaction: editorEnabled ? 'select' : 'none',
    transform: transform(52, 7, 43, 62, 30),
    accessibility: {
      decorative: false,
      label: 'Library bookshelves',
      description: 'Shelves holding current books, memories, favorites, and legacy volumes.',
    },
    bindings: [binding('sanctuary', 'shelfStyleId')],
    metadata: { shelfStyleId: context.sanctuary.shelfStyleId },
    children: [
      shelfSection('currently-reading-shelf', 'Currently Reading', 0, {
        currentBookId: context.currentBookId ?? null,
        currentBookTitle: context.currentBookTitle ?? null,
      }),
      shelfSection('favorites-shelf', 'Favorites', 1),
      shelfSection('memory-shelf', 'Memory Shelf', 2, {
        memoryCount: memoryItems.length,
        itemIds: memoryItems.map((item) => item.id).join(','),
      }),
      shelfSection('legacy-shelf', 'Legacy Collection', 3),
    ],
  });
}

function buildFireplaceNode(context: SanctuarySceneGraphContext): SanctuarySceneNode {
  return node({
    id: 'fireplace',
    type: 'fireplace',
    transform: transform(7, 55, 27, 28, 35),
    accessibility: {
      decorative: false,
      label: 'Fireplace',
      description: 'A quiet hearth with room for candles and keepsakes.',
    },
    bindings: [binding('sanctuary', 'fireplaceStyleId')],
    metadata: { fireplaceStyleId: context.sanctuary.fireplaceStyleId },
    children: [
      node({
        id: 'fire',
        type: 'fire',
        visibility: context.scene.fireplace.enabled ? 'visible' : 'hidden',
        transform: transform(15, 20, 70, 78, 36),
        accessibility: {
          decorative: true,
          reduceMotionFallback: 'fire-static',
        },
        bindings: [binding('living-library', 'fireplace')],
        metadata: {
          motionKey: context.scene.fireplace.motionKey,
          intensity: context.scene.fireplace.intensity,
        },
      }),
      node({
        id: 'mantel',
        type: 'mantel',
        transform: transform(-5, -6, 110, 18, 37),
        accessibility: { decorative: true },
        bindings: [binding('reading-data', 'sanctuary-aging.mantelKeepsakes')],
      }),
    ],
  });
}

function buildReadingCornerNode(
  context: SanctuarySceneGraphContext,
  editorEnabled: boolean,
): SanctuarySceneNode {
  return node({
    id: 'reading-corner',
    type: 'reading-corner',
    transform: transform(36, 52, 26, 34, 40),
    accessibility: {
      decorative: false,
      label: 'Reading corner',
      description: 'A chair, table, tea, and the book currently waiting for you.',
    },
    children: [
      node({
        id: 'reading-chair',
        type: 'chair',
        interaction: editorEnabled ? 'select' : 'none',
        transform: transform(4, 10, 72, 88, 41),
        accessibility: { decorative: true },
        bindings: [binding('reading-data', 'sanctuary-aging.chairWearLevel')],
      }),
      node({
        id: 'reading-table',
        type: 'reading-table',
        transform: transform(76, 42, 28, 50, 42),
        accessibility: { decorative: true },
        children: [
          node({
            id: 'current-book',
            type: 'book',
            visibility: context.currentBookId ? 'visible' : 'hidden',
            transform: transform(8, 8, 74, 42, 43),
            accessibility: {
              decorative: false,
              label: context.currentBookTitle ?? 'Current book',
            },
            bindings: [binding('reading-data', 'currentBook')],
            metadata: {
              bookId: context.currentBookId ?? null,
              title: context.currentBookTitle ?? null,
            },
          }),
          node({
            id: 'tea',
            type: 'tea',
            transform: transform(58, 54, 28, 28, 44),
            accessibility: { decorative: true },
            bindings: [binding('static', 'tea-cup')],
          }),
        ],
      }),
    ],
  });
}

function buildDecorationNodes(
  context: SanctuarySceneGraphContext,
  editorEnabled: boolean,
): SanctuarySceneNode[] {
  return context.sanctuary.decorationPlacements.map((placement) => node({
    id: placement.id,
    type: 'decoration',
    interaction: editorEnabled ? 'drag' : 'select',
    transform: {
      x: placement.positionX,
      y: placement.positionY,
      width: 10,
      height: 10,
      scale: placement.scale,
      rotation: placement.rotation,
      zIndex: 50 + placement.layer,
    },
    accessibility: {
      decorative: false,
      label: placement.itemId.replaceAll('-', ' '),
    },
    bindings: [binding('sanctuary', `decorationPlacements.${placement.id}`)],
    metadata: {
      itemId: placement.itemId,
      surfaceId: placement.surfaceId,
    },
  }));
}

function buildAmbientEffectsNode(context: SanctuarySceneGraphContext): SanctuarySceneNode {
  return node({
    id: 'ambient-effects',
    type: 'ambient-effect',
    transform: transform(0, 0, 100, 100, 100),
    accessibility: {
      decorative: true,
      reduceMotionFallback: 'ambient-static',
    },
    bindings: [
      binding('living-library', 'candlelight'),
      binding('living-library', 'dustMotes'),
      binding('living-library', 'shelfLife'),
      binding('living-library', 'soundscape'),
    ],
    metadata: {
      candlelightEnabled: context.scene.candlelight.enabled,
      dustMotesEnabled: context.scene.dustMotes.enabled,
      shelfLifeEnabled: context.scene.shelfLife.enabled,
      soundscape: context.scene.soundscape,
    },
  });
}

function shelfSection(
  id: string,
  label: string,
  row: number,
  metadata: Record<string, string | number | boolean | null> = {},
): SanctuarySceneNode {
  return node({
    id,
    type: 'shelf-section',
    transform: transform(3, row * 25, 94, 23, 31 + row),
    accessibility: {
      decorative: false,
      label,
    },
    metadata: { label, ...metadata },
  });
}

function lumisTransform(
  location: LivingLibrarySceneState['lumis']['location'],
): SanctuarySceneTransform {
  switch (location) {
    case 'window-perch':
      return transform(15, 37, 16, 18, 60);
    case 'reading-chair':
      return transform(43, 62, 16, 18, 60);
    case 'newest-finished-book':
      return transform(70, 38, 16, 18, 60);
    case 'lower-shelf':
      return transform(70, 64, 16, 18, 60);
    case 'book-nest':
      return transform(20, 74, 16, 18, 60);
    case 'fireplace-rug':
    default:
      return transform(19, 75, 16, 18, 60);
  }
}

function node(input: {
  id: string;
  type: SanctuarySceneNodeType;
  visibility?: SanctuarySceneNodeVisibility;
  interaction?: SanctuarySceneNodeInteraction;
  transform: SanctuarySceneTransform;
  accessibility: SanctuarySceneAccessibility;
  bindings?: SanctuarySceneBinding[];
  metadata?: Record<string, string | number | boolean | null>;
  children?: SanctuarySceneNode[];
}): SanctuarySceneNode {
  return {
    id: input.id,
    type: input.type,
    visibility: input.visibility ?? 'visible',
    interaction: input.interaction ?? 'none',
    transform: input.transform,
    accessibility: input.accessibility,
    bindings: input.bindings ?? [],
    metadata: input.metadata ?? {},
    children: input.children ?? [],
  };
}

function transform(
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
): SanctuarySceneTransform {
  return {
    x,
    y,
    width,
    height,
    scale: 1,
    rotation: 0,
    zIndex,
  };
}

function binding(
  source: SanctuarySceneBinding['source'],
  key: string,
): SanctuarySceneBinding {
  return { source, key };
}
