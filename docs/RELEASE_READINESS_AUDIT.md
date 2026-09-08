# Inkbound release-readiness audit

This is the permanent release matrix for the signed-in Inkbound product. It replaces informal "looks good" audits.

## Non-negotiable rules

1. **One application, one source of truth.** Web and Android mount the same React `App`. Platform code may provide a capability (native auth, sharing, app lifecycle, billing), but a feature component may not maintain a second Android-only or web-only copy of user data.
2. **Web feature = Android feature.** If a signed-in reader can view, create, edit, delete, filter, export, restore, or manage something on web, the same operation must be reachable in Android. Mobile may stack or compact the layout; it may not silently remove the operation.
3. **Canonical state first.** Books and sessions flow through the canonical runtime collections. Firestore is persistence/sync/recovery, not a competing UI database. Collections live on `UserBookRecord.collections`; auxiliary collection definitions describe the collection, not a second membership store.
4. **Platform differences live behind adapters.** Auth, export/share, lifecycle, reauthentication, App Check, and store billing may use different implementations while preserving the same product capability.
5. **A release is not ready because it builds.** `npm run release:verify` must pass, and the manual parity cases below must be exercised on both web and Android.

## Canonical owners

| Concern | Canonical owner |
| --- | --- |
| Book/session domain types | `src/types.ts` |
| Book/session working state | shared `src/App.tsx` state + canonical storage keys |
| Storage key registry | `src/features/sync/storageKeys.ts` |
| Reading status/progress rules | `src/features/reading/bookReadingState.ts` |
| Library taxonomy | `src/domain/libraryTaxonomy.ts` |
| Collections membership | `UserBookRecord.collections` |
| Collection definitions | `AUXILIARY_ACCOUNT_KEYS.collectionDefinitions` |
| Series metadata | `src/features/series/seriesLibrary.ts` + explicit overrides |
| Product/free-premium policy | `src/config/productPolicy.ts` |
| Export schema | `src/features/export/libraryExport.ts` |
| Cross-device book/session pulls | `CrossDeviceDeltaSyncBridge` |
| Auxiliary account sync | `AuxiliaryAccountSyncBridge` |
| Runtime foreground/resume | `src/platform/runtimeLifecycle.ts` |
| Reader recovery | `functions/src/adminRecovery.ts` + selective recovery functions |

## Signed-in feature parity matrix

The UI below is shared React code. "Shared" means there must not be a platform conditional that removes the feature on Android.

| Feature / operation | Web | Android | Persistence / source | Audit status |
| --- | --- | --- | --- | --- |
| Home dashboard | Shared | Shared | derived from canonical books/sessions | guarded |
| Library grid/list/filter/search | Shared | Shared | canonical books | guarded |
| Add reading material | Shared | Shared | canonical books | guarded |
| Book details | Shared | Shared | canonical book record | guarded |
| Edit/delete book | Shared | Shared | canonical books + related sessions | guarded |
| Covers: search/upload/remove | Shared | Shared | canonical edition + media/ledger | guarded |
| Editions | Shared | Shared | canonical book editions | guarded |
| Reading status/dates/progress | Shared | Shared | canonical reading rules | guarded |
| Reading sessions: create | Shared | Shared | canonical sessions | guarded |
| Reading sessions: edit/delete | Shared | Shared | canonical sessions | guarded; Android parity bug fixed |
| Batch edit | Shared | Shared | canonical books | guarded |
| Custom ownership categories | Shared | Shared | auxiliary category definitions + book category id | guarded |
| Collections create/edit/membership | Shared | Shared | collection definitions + book membership | guarded |
| Series tracker/overrides | Shared | Shared | canonical resolver + overrides | guarded |
| TBR | Shared | Shared | derived canonical books | guarded |
| Duplicate maintenance/merge | Shared | Shared | canonical books/sessions | guarded |
| Imports CSV/XLSX/JSON | Shared | Shared | canonical import pipeline | guarded |
| Import history / retry | Shared | Shared | canonical import history/queue | guarded |
| Statistics | Shared | Shared | derived canonical books/sessions | guarded |
| Reading activity / insights | Shared | Shared | derived canonical data | guarded |
| Challenges | Shared | Shared | auxiliary challenge state | guarded |
| Achievements | Shared | Shared | auxiliary achievement state | guarded |
| Timeline | Shared | Shared | canonical/auxiliary reading state | guarded |
| Reading Memories | Shared | Shared | per-book memory sync | guarded |
| Photo Memories | Shared | Shared | photo-memory store + cloud sync | guarded |
| Time Capsules | Shared | Shared | auxiliary account state | guarded |
| My Dragon | Shared | Shared | auxiliary account state | guarded |
| Reader Personality | Shared | Shared | derived/account state | guarded |
| Monthly Wrapped | Shared | Shared | derived canonical data | guarded |
| Year in Books | Shared | Shared | derived canonical data | guarded |
| Bookshelf Through Time | Shared | Shared | derived canonical data | guarded |
| Inkbound Studio | Shared | Shared | canonical reader/library data | guarded |
| Profile/account | Shared | Shared | canonical profile + auth | guarded |
| Settings/goals/theme | Shared | Shared | auxiliary/runtime state | guarded |
| JSON/CSV export | browser download | native Filesystem + Share | same export builder | guarded |
| Google/email auth | browser Firebase flow | native credential -> same Firebase JS auth | same account authority | guarded |
| Account reauthentication/deletion | browser adapter | native adapter | same secure functions | guarded |
| Library loan reminders | in-app | in-app + native reminders | canonical loan fields | guarded |
| Admin integrity/recovery | Shared owner UI | Shared owner UI | owner-only functions | guarded |
| Selective recovery | Shared owner UI | Shared owner UI | safety snapshot + audit | guarded |
| Premium entitlement display | Shared | Shared | secure entitlement service | guarded |
| Paid checkout / subscription management | web billing provider | Google Play required | entitlement service | **release blocker when subscriptions open** |

## Cross-device data matrix

Every row must work in both directions without requiring the user to recreate data.

| Data | Web -> Android | Android -> Web | Conflict behavior |
| --- | --- | --- | --- |
| Books | delta pull | persistence upload | newer remote beats stale pending local state |
| Reading status/progress/dates | delta pull | persistence upload | same book record rules |
| Reading sessions | delta pull | persistence upload | timestamp-aware pending conflict |
| Deletes | tombstone pull | tombstone upload | newer delete wins stale state |
| Collection definitions | auxiliary snapshot | auxiliary upload | timestamp-aware |
| Collection membership | book record delta | book record upload | membership travels with book |
| Custom ownership categories | auxiliary snapshot | auxiliary upload | timestamp-aware |
| Goals/theme/account auxiliaries | auxiliary snapshot | auxiliary upload | timestamp-aware |
| Reading Memories | dedicated bridge | dedicated bridge | per-book merge |
| Photo Memories | dedicated bridge | dedicated bridge | record-level sync |
| Profile | shared account sync | shared account sync | server/account authority |

## Manual release cases

Run these on a real web session and a real Android device using the same test account.

1. Add a book on web; resume Android; book appears without sign-out/reinstall.
2. Change that book's status/date/progress on Android; web reflects it.
3. Create a collection on web and add several books; Android shows both definition and membership.
4. Change collection membership on Android; web reflects it without the collection disappearing/reappearing.
5. Create a custom ownership category; verify single-book and Batch Edit expose it on both platforms.
6. Create a reading session on Android; edit and delete it from Book Details on Android; web totals update.
7. Create/edit/delete a reading session on web; Android receives the change on resume.
8. Import a small CSV on web and verify Android receives the imported books, dates, page counts, covers supplied by the file, and statuses.
9. Import a small CSV on Android and verify web receives the same records.
10. Export JSON and CSV from both platforms; Android must use the native share sheet rather than losing the feature.
11. Exercise every Book Details tab in portrait and landscape; Cover, Sync Metadata, Delete, Edit Session, Delete Session, save actions, and close controls remain reachable.
12. Exercise every top-level nav destination on Android and web. Mobile navigation may place destinations under More, but it may not omit them.
13. Background Android, make a web edit, then resume Android. The runtime lifecycle event must trigger a delta pull.
14. Simulate offline Android edits, reconnect, and verify local changes upload without overwriting a newer cloud change made afterward.
15. From Administration, inspect recovery history and preview selective recovery. Do not perform a destructive full restore for routine support cases.

## Release gates

`npm run release:verify` now includes `verify:parity` in addition to TypeScript, critical regressions, source-of-truth verification, production build, function security, Android config/branding/native checks, and Firebase Functions compilation.

The parity gate intentionally fails if:

- a shared UI component branches directly on Android/web runtime,
- a shared UI component imports Capacitor directly instead of a platform adapter,
- a feature screen reads Firestore directly as a second UI source,
- responsive CSS globally hides shared primary/secondary feature actions,
- a declared navigation destination is not handled by the shared App,
- Android is missing a required runtime capability adapter,
- session edit/delete parity disappears,
- custom ownership categories disappear from Batch Edit,
- selective recovery disappears from Administration,
- paid subscriptions are opened before Android gets store-owned subscription management.

This file is part of the release contract. New signed-in features must be added to the matrix when they are introduced.
