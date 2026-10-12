# Inkbound independent backups — release gate

This is a **staged recovery plan**, not proof that production is backed up.

## First: full-platform managed Firestore export

Run these commands from an authorized workstation with the Google Cloud SDK. Use a
**dedicated backup bucket**, separate from the application's default Firebase Storage
bucket. Enable uniform bucket-level access, public access prevention, versioning,
retention protection and restricted backup-service permissions. Never put service
account keys in Git.

```bash
gcloud auth login
gcloud config set project YOUR_FIREBASE_PROJECT_ID
gcloud firestore databases describe --database='(default)' --format='value(locationId)'
gcloud firestore export gs://YOUR_DEDICATED_BACKUP_BUCKET/inkbound/full/2026-10-12-pre-release --database='(default)'
```

The export command is **asynchronous**: a successful command response is not proof
of a completed backup. Wait for the export operation to report DONE with no error;
then verify its export metadata exists in the destination bucket. Preserve the
operation ID and immutable manifest. Exporting Firestore does **not** back up
Firebase Authentication users, Cloud Storage files, or external billing state.

## Individual reader recovery

The current in-app `users/{uid}/recoverySnapshots` is **not independent**:
it lives in the operational Firestore database. A user backup must preserve
`users/{uid}` and **all nested subcollections**, plus user-linked documents in
top-level collections (such as entitlements and userDirectory), relevant Storage
objects, and a manifest recording counts, checksums and capture time.

Do not implement a restore by overwriting `users/{uid}` directly. Restore into
an isolated project first; compare document counts and checksums; generate a
read-only preview of additions/conflicts/deletions; require explicit approval for
any production restore. Prefer additive recovery for missing records.

## Automated retention and testing

- Schedule managed exports through a dedicated backup identity and Cloud
  Scheduler / supported Google Cloud backup schedules.
- Set a documented retention policy and confirm lifecycle deletion cannot
  remove the most recent known-good recovery point.
- Restrict export, import, object deletion, and key management permissions.
- Perform a **test import into a separate Firebase/GCP project** and compare
  representative books, sessions, editions, quotes, auxiliary records and
  nested recovery snapshots.
- Record backup job state, export operation completion, inventory/checksums,
  and restore-drill outcomes. Alert on missed/failed jobs.
- Verify that recovery respects account deletion and applicable retention rules.

## Release hold

Do **not** ship Build 18 / Android 2919 based only on creating a backup script.
First confirm a completed independent full export, a verified test restore,
and the separate non-destructive synchronization regression tests.
