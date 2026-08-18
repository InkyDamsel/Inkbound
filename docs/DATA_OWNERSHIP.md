# Inkbound Data Ownership

Inkbound uses one canonical source for each domain. Local/runtime storage is an offline working copy and transport layer; sync metadata must never become product/domain truth.

| Domain | Canonical owner | Derived/transport copies |
| --- | --- | --- |
| Library book | `UserBookRecord` | React state, runtime cache, Firestore envelope |
| Active edition | `activeEditionId` resolved against the book's `editions` | UI display values |
| Reading progress | Canonical book progress reconciled from explicit reader changes and session endpoints | Progress percentage |
| Reading activity | `ReadingSession` records | Statistics, streaks, goals, pace |
| Session page/audio amount | Session start/end endpoints when present | Legacy `pagesRead` / `minutesListened` compatibility fields |
| Statistics | Derived from canonical books + sessions | UI cards/charts |
| Profile | Canonical reader profile record | Runtime cache and uploaded media URLs |
| Premium access | Server-authoritative entitlement | Client `UserPlanContext` view only |
| Import history | Operational import metadata | Not canonical library data |
| Sync pending queue | Transport intent only | Never user-visible domain truth |
| Sync baseline | Last-known sync fingerprint only | Never user-visible domain truth |

## Conflict rules

1. A local mutation captured in the durable pending queue represents explicit local intent and is retried until acknowledged.
2. A local record missing from the cloud with **no previous baseline entry** is a legitimate offline/local create and may be uploaded.
3. A local record missing from the cloud that **did exist in the previous baseline** is treated as remotely deleted when there is no pending local mutation. It must not be resurrected merely because a stale cache still contains it.
4. Account UID transitions clear account-owned runtime state before another account is allowed to hydrate.
5. UI components derive state from canonical records; they must not introduce independent copies of status, progress, edition, session, or entitlement truth.

## Change rule

Before adding a new persisted field or storage key, identify which row above owns the value. If an existing canonical owner can derive the value, do not persist another competing copy.
