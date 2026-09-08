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

## Reading status and progress semantics

**Canonical resolver/mutation helpers:** `src/features/reading/bookReadingState.ts`

- `getActiveEdition()` is the shared active-edition resolver.
- `getBookReadingState()` is the canonical derived reading-state view.
- `withReadingStatus()` is the canonical status transition and owns the related started/finished-date and known-endpoint progress rules.
- `reconcileFinishedBookProgress()` is the narrow legacy/import reconciliation path.

New status-changing surfaces must call these helpers rather than inventing a second set of finish/start rules.

## Product / Free vs Premium policy

**Canonical policy:** `src/config/productPolicy.ts`

This owns library limits, subscription availability, planned pricing, and which features belong to Free or Premium. Marketing, Settings, upgrade UI, and entitlement consumers should read this policy rather than redefining the plan independently.

## Series

**Canonical series resolver:** `src/features/series/seriesLibrary.ts`

`resolveEffectiveSeriesMetadata()` is the authoritative answer to “what series does this library item belong to?” It applies manual corrections first, explicit metadata second, and safe imported-title inference last.

`buildSeriesLibrary()` is the canonical series grouping/summarization path. Other views that group by series should use the resolver instead of reading only `book.work.seriesName`.

Manual series corrections remain in `src/features/series/seriesOverrides.ts` and are inputs to the resolver, not a competing series database. Their persistence key comes from the canonical storage-key registry.

## Collections

**Canonical collection experience:** `src/components/CollectionsScreen.tsx`

- Manual membership is stored on `UserBookRecord.collections`.
- Collection definitions provide presentation metadata and smart-collection rules.
- The My Library → Collections tab embeds this same Collections screen. It must not maintain a second custom-list membership database.

Legacy `inkbound_library_custom_lists` / `inkbound_library_custom_list_members` keys are explicitly retired. They are not part of `AUXILIARY_ACCOUNT_KEYS`, are not synced, and must not be used for new collection reads or writes.

## Help / FAQ content

**Canonical copy:** `src/content/helpContent.ts`

The in-app Quick Help panel selects a subset from this content. The `/faq` page renders the full content. There must not be a separate static FAQ with independently maintained answers.

## Export semantics

**Canonical serializers:** `src/features/export/libraryExport.ts`

Settings should call these serializers. Export code must use the canonical series resolver and the current `UserBookRecord` fields rather than reimplementing metadata resolution itself.

Web and Android call the same serializers. `src/platform/runtimeExport.ts` is only the delivery boundary: browsers download/share the serialized file, while Android supplies Filesystem/Share through `initializeAndroidRuntime.ts`.

## Persistent storage keys

**Canonical key registry:** `src/features/sync/storageKeys.ts`

This registry owns core library/session/profile keys, account-owned auxiliary keys, theme, import-enrichment keys, and explicitly retired legacy keys. Sync bridges and feature persistence should consume the registry or a constant derived from it instead of redefining key strings.

`src/features/sync/auxiliaryAccountSyncConfig.ts` defines **which** registered account-data keys are eligible for auxiliary cloud sync. It does not own a second set of values.

## Cloud sync roles

The local runtime copy is the application working source. Cloud code has narrowly separated roles:

- `AdaptiveCloudPersistenceBridge` chooses the appropriate hydration/persistence strategy.
- `CostSafeCloudPersistenceBridge` persists local canonical changes.
- `OneShotCloudHydrationBridge` restores an empty/new local cache.
- `CrossDeviceDeltaSyncBridge` pulls changed books, sessions, profile data, and delete tombstones into an already-hydrated device.
- `AuxiliaryAccountSyncBridge` synchronizes registered account-owned state such as collection definitions, custom ownership categories, goals, and challenge state.
- `CloudServerRefreshBridge` handles explicit/recovery refreshes rather than acting as an everyday feature data source.
- Profile/media bridges persist their specific registered account-owned media.

Feature screens must not bypass these boundaries with their own independent Firestore-backed copy of library facts.

## Cross-device conflict policy

**Canonical conflict rule:** `src/features/sync/syncConflictPolicy.ts`

`shouldRemoteChangeReplacePending()` is the shared last-write rule for core and auxiliary sync. A durable local pending mutation represents known user intent. A remote change replaces it only when the remote change is demonstrably newer. Firestore server time is preferred when available; `clientUpdatedAt` is the fallback used across devices.

Startup code must never create a fresh “now” timestamp merely because cached local data differs from an old baseline *before* comparing that cache with cloud state. Doing that makes stale data appear newer simply because the stale device opened later.

## Foreground / resume behavior

**Canonical lifecycle boundary:** `src/platform/runtimeLifecycle.ts`

All cross-device retry/reconciliation behavior that depends on the app returning to the foreground must subscribe through `subscribeToRuntimeResume()`.

- Web installs visibility/pageshow/online behavior through the browser adapter.
- Android installs Capacitor `appStateChange` plus online behavior in `initializeAndroidRuntime.ts`.
- Feature and sync code must not assume browser `focus` is equivalent to Android app resume.

This keeps web and Android on the same sync path instead of maintaining separate platform-specific refresh behavior.

## Recovery

Recovery snapshots are versioned safety copies, **not** a second live source of truth.

- Automatic reader safety points are owned by `src/features/recovery/dataRecovery.ts` and `RecoverySafetyBridge.tsx`.
- Owner/admin full recovery is implemented by `functions/src/adminRecovery.ts`.
- Owner/admin selective recovery is implemented by `functions/src/adminSelectiveRecovery.ts` and the Administration recovery UI.
- Every admin restore creates a new safety copy of the state being replaced and records an audit entry.
- Collection recovery restores the collection definition and missing memberships without deleting newer memberships.
- A restore must clear the current core and auxiliary sync pending/baseline metadata before the bridges rebuild against the restored cloud state.

## Platform parity

The signed-in web app and Android app mount the same React `App`. Platform adapters may implement device capabilities differently, but shared feature components may not decide that a feature exists on web and disappears on Android.

The permanent parity/release contract lives in `docs/RELEASE_READINESS_AUDIT.md` and is enforced statically by `scripts/verify-cross-platform-parity.mjs` as part of `npm run release:verify`.

Legitimate platform implementations include:

- browser Firebase Google auth vs Android native credential acquisition feeding the same Firebase JS Auth authority,
- browser download/share vs Android Filesystem/Share,
- browser visibility lifecycle vs Android Capacitor App lifecycle,
- web billing vs the required Android store billing implementation once paid subscriptions are opened.

A different implementation is not permission to omit the capability.

## Derived screens are not data stores

Statistics, Insights, Timeline, Series, TBR, Achievements, Studio, Memories, and dashboard widgets can calculate different presentations from the canonical library/session data. They should not persist a second copy of facts such as status, ownership, progress, series assignment, or session history merely to render a screen.

## Rule for new features

Before adding a new persistent field or metadata source:

1. Identify the existing authoritative domain object/module.
2. Extend that source first.
3. Make import, export, sync, recovery, and UI consume it.
4. If migration is needed, migrate old data once rather than keeping both representations alive indefinitely.
5. Avoid direct Firestore collection reads inside feature screens; sync bridges own cloud persistence and hydration.
6. Add the feature to the web/Android parity matrix and release test cases.
7. If platform-specific device behavior is required, add it behind a platform adapter while keeping the shared capability visible and usable on both platforms.
