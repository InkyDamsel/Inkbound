# Inkbound Sources of Truth

Inkbound should have one authoritative owner for each kind of information. Screens may derive views from these sources, but they should not maintain competing copies of the same facts.

## Reader library and reading activity

**Canonical working data:** the `books` and `sessions` collections owned by `App.tsx`, persisted under the canonical keys in `src/features/sync/storageKeys.ts`.

- UI screens receive `books` and `sessions` and derive their views from them.
- Firestore is persistence/restore for the same records. It is **not** a second UI data source.
- Existing devices work local-first. Cloud bridges hydrate or persist the canonical local records rather than giving individual screens their own Firestore queries.
- A library item stores reading status and ownership separately. TBR must never be inferred to mean either owned or not owned.

## Domain types

**Canonical definitions:** `src/types.ts`

Types such as `ReadingStatus`, `OwnershipStatus`, `ReadingMaterialType`, `Format`, `UserBookRecord`, and `ReadingSession` are defined here. Feature code should not create incompatible parallel versions of these domain values.

## Library labels and selectable values

**Canonical display taxonomy:** `src/domain/libraryTaxonomy.ts`

Use this module for status, ownership, reading-material type, format, priority, and subscription-service labels/options. Do not hardcode alternate option lists in individual screens.

## Product / Free vs Premium policy

**Canonical policy:** `src/config/productPolicy.ts`

This owns library limits, subscription availability, planned pricing, and which features belong to Free or Premium. Marketing, Settings, upgrade UI, and entitlement consumers should read this policy rather than redefining the plan independently.

## Series

**Canonical series resolver:** `src/features/series/seriesLibrary.ts`

`resolveEffectiveSeriesMetadata()` is the authoritative answer to “what series does this library item belong to?” It applies manual corrections first, explicit metadata second, and safe imported-title inference last.

`buildSeriesLibrary()` is the canonical series grouping/summarization path. Other views that group by series should use the resolver instead of reading only `book.work.seriesName`.

Manual series corrections remain in `src/features/series/seriesOverrides.ts` and are inputs to the resolver, not a competing series database.

## Collections

**Canonical collection experience:** `src/components/CollectionsScreen.tsx`

- Manual membership is stored on `UserBookRecord.collections`.
- Collection definitions provide presentation metadata and smart-collection rules.
- The My Library → Collections tab embeds this same Collections screen. It must not maintain a second custom-list membership database.

Legacy `inkbound_library_custom_lists` / `inkbound_library_custom_list_members` keys are not authoritative and must not be used for new collection writes.

## Help / FAQ content

**Canonical copy:** `src/content/helpContent.ts`

The in-app Quick Help panel selects a subset from this content. The `/faq` page renders the full content. There must not be a separate static FAQ with independently maintained answers.

## Export semantics

**Canonical serializers:** `src/features/export/libraryExport.ts`

Settings should call these serializers. Export code must use the canonical series resolver and the current `UserBookRecord` fields rather than reimplementing metadata resolution itself.

## Sync storage keys

**Canonical key registry:** `src/features/sync/storageKeys.ts`

Cloud/local persistence bridges should import these keys. Adding another hardcoded `inkbound_books`, `inkbound_sessions`, or `inkbound_reader_profile` constant creates drift risk.

## Derived screens are not data stores

Statistics, Insights, Timeline, Series, TBR, Achievements, Studio, Memories, and dashboard widgets can calculate different presentations from the canonical library/session data. They should not persist a second copy of facts such as status, ownership, progress, series assignment, or session history merely to render a screen.

## Rule for new features

Before adding a new persistent field or metadata source:

1. Identify the existing authoritative domain object/module.
2. Extend that source first.
3. Make import, export, sync, and UI consume it.
4. If migration is needed, migrate old data once rather than keeping both representations alive indefinitely.
5. Avoid direct Firestore collection reads inside feature screens; sync bridges own cloud persistence and hydration.
