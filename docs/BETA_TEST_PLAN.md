# Inkbound Beta Test Plan

This checklist is the release gate for the pre-payment Inkbound beta. Billing is intentionally out of scope until the beta proves account, library, session, import, and sync reliability.

## Release rule

Do not promote a beta build when any P0/P1 scenario below fails or when `npm run release:verify` fails.

## P0 — data-loss and account-isolation tests

- [ ] Sign in with a new account and confirm another reader's books, sessions, profile, memories, import history, and preferences never appear.
- [ ] Switch Account A -> Account B -> Account A and verify each account restores only its own data.
- [ ] Add/edit/delete a book offline, reconnect, reload, and verify the final state survives.
- [ ] Add/edit/delete a reading session offline, reconnect, reload, and verify book progress and statistics reconcile.
- [ ] Delete a book on Device A while Device B has an older cached copy. Reconnect/reload Device B and verify the deleted book does not resurrect unless Device B made a genuine pending edit to that record.
- [ ] Repeat the remote-deletion test for reading sessions.
- [ ] Change avatar/banner, immediately sign out, sign back in, and verify the media survives.
- [ ] Close/kill the app with pending changes, reopen online, and verify pending changes flush.
- [ ] Lose connectivity during initial hydration and verify Inkbound opens the last verified cache for the same UID without exposing another account's cache.
- [ ] Clear this device and verify cloud data remains intact.
- [ ] Permanently delete a test account and verify authentication, cloud records, profile media, and local account data are removed.

## P1 — canonical reading behavior

- [ ] Active edition, not `editions[0]`, controls page/audio totals.
- [ ] Marking a known-length book Finished resolves progress to 100%.
- [ ] Correcting an accidental finish removes the finish date without destroying valid progress.
- [ ] Editing the latest session updates book progress and all dependent statistics.
- [ ] Moving a session to another book reconciles both books.
- [ ] Deleting the latest session reconciles progress without erasing manually-entered progress that was ahead of the session.
- [ ] Zero-duration placeholders do not create streak days.
- [ ] First valid session of a day updates the streak and daily goal once.
- [ ] Audiobook endpoint timestamps drive listening statistics when present.

## P1 — large-library/import tests

- [ ] Import the 703-book regression fixture and verify accepted + duplicate/skipped counts equal the source count.
- [ ] Reload immediately after import and verify every accepted fallback book remains present before enrichment finishes.
- [ ] Interrupt enrichment, reopen Inkbound, and verify missing metadata remains queued rather than losing books.
- [ ] Retry missing details while online and verify cover/summary updates never change the number of library records.
- [ ] Import the same source again and verify duplicates are not silently added.
- [ ] Merge duplicates and verify sessions move to the kept record.
- [ ] Undo a destructive batch operation and verify books and related sessions return together.

## P1 — device/runtime tests

- [ ] Android cold start restores the signed-in account.
- [ ] Android process kill/relaunch restores library and pending sync state.
- [ ] Google sign-in works in the signed release-like build.
- [ ] App Check succeeds in the release-like build.
- [ ] Back navigation does not discard an active reading/session edit unexpectedly.
- [ ] Timer survives expected foreground/background transitions without creating duplicate sessions.
- [ ] JSON and CSV exports open successfully on-device.

## P2 — usability smoke tests

- [ ] Home, Library, TBR, Sessions, Statistics, Collections, Import, Profile, and Settings render with a 700+ book library.
- [ ] Search/filter/sort remain responsive with 700+ books.
- [ ] Light and dark themes retain readable contrast.
- [ ] Mobile portrait and landscape layouts do not hide destructive confirmations or primary actions.
- [ ] Empty states and offline states explain what the reader can do next.

## Automated gate

Run before every beta build:

```bash
npm run release:verify
```

The critical suite must include reading-state, session analytics, account isolation, and sync-conflict regressions.

## Beta exit criteria

Payment work may begin after:

1. all P0 scenarios pass;
2. all P1 scenarios pass or have a documented non-data-loss workaround;
3. `npm run release:verify` passes on the beta candidate;
4. at least one 700+ book library completes the import/sync/restart cycle successfully;
5. at least two accounts have completed the account-switch isolation test;
6. no unresolved issue can delete, duplicate, leak, or silently overwrite reader data.

## Future billing policy

Billing is intentionally not part of this beta. When store billing is added later, Inkbound account deletion remains separate from store subscription management: deleting an Inkbound account does **not** automatically cancel an App Store or Google Play subscription. The deletion UI must clearly disclose that policy and require acknowledgement for an active paid subscription.
