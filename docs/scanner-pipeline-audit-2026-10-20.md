# Inkbound Stack Scanner audit — 2026-10-20

Scope: development branch `fix/preserve-corrected-book-metadata`. Inspected `src/components/AddBookModal.tsx`, `src/platform/runtimeBarcodeScanner.ts`, `src/features/book-search/data/googleBooksApi.ts`, `src/features/book-search/isbnResolution.ts`, `src/features/book-search/mapping/bookSearchMapper.ts`, and `scripts/isbn-resolution-regressions.ts`. No change to protected Search. No AI.

## P0 — Incorrect identity / unsafe edition selection
1. `lookupScannedIsbn` adds a batch entry keyed by the **scanned ISBN** even when `resolveCatalogIsbn` returns `exactIsbn:false` and the actual persisted `book.editions[0].isbn` is a *different* catalog edition. This is a dual-identity invariant violation; batch review can display an ISBN not owned by the selected edition. Require explicit user confirmation of work-level alternatives, key by chosen edition ISBN, and store scanned/unresolved ISBN as separate context only.
2. `resolveCatalogIsbn` accepts `groups.length===1` from Google's ISBN search even without matching ISBN, and its final plain-barcode query returns `response.groups[0]` without independent work verification. Never auto-add these fallback results. Return `candidate` state, not `verified` state, and demand explicit selection.
3. Cover selection currently permits `compactCover.includes(word)`, allowing substring matches in unrelated OCR tokens; title verification counts only words of length >=4. A false positive can still occur with short titles/partial text. Require token-boundary evidence and independent author/title verification.

## P1 — Recognition recall and latency
4. Cover candidates are built from every OCR line and concatenations of up to four lines, then ranked by word-count heuristics. This can prioritize series labels, blurbs, endorsements, or combinations over the true title; only 24 candidates are queried. Use a structured OCR candidate extractor: distinguish title, author, series and marketing text; test on real OCR line fixtures.
5. Cover title match requires >=65% of long title words, with no typo-tolerant alignment. Stylized lettering, `STONE` split into letters, and title OCR mistakes produce hard failures. Add deterministic word/character edit-distance and line grouping with strict author confirmation.
6. Initialed author names such as A. J. Lake lose initials in normalization and may have only one long token. Latest fix allows surname-only if full title matches; test collisions and title recognition on OCR fixtures before shipping.
7. Up to 24 sequential `searchGoogleBooks` calls can be expensive/slow and trigger provider backoff; no scanner-specific candidate budget, timeout or instrumentation. Use staged title candidates, deduplicate queries, and stop only after independently verified title+author.
8. Cover photo is scaled to 2000px and JPEG quality .82; tiny text, curved text, glare and low-contrast covers remain vulnerable. Native OCR input should be evaluated against cropped/contrast-enhanced variants before additional catalog calls.

## P1 — OCR ISBN handling and state
9. Printed ISBN extraction regex expects a single OCR line with ISBN label adjacent to digits. OCR may split label and digits across lines or return multiple ISBNs on a copyright page. Introduce pure line-aware ISBN parsing with checksums, equivalence handling and edition-choice UI.
10. `unresolvedIsbn`, `scannerEditionOptions`, `scannerRecoveryTitle` and `scannerRecoveryAuthor` are independent React state values. They are not associated with a unique scan attempt, and asynchronous catalog/OCR results can overwrite later attempts. Introduce a scan-session/attempt ID and discard stale completions. Treat barcode→cover association as explicit rather than implicit.
11. `lookupScannedIsbn` uses `scannerBusy` state as concurrency guard, which may be stale across overlapping event callbacks. A ref-based lock/attempt ID is safer.
12. `chooseScannerAlternative` chooses the first available catalog ISBN or a synthetic key; ensure the persisted edition identity and displayed batch identity remain consistent after `enrichSelectedCatalogEdition` transforms metadata.

## P2 — Persistence and test coverage
13. Draft storage is directly in localStorage; `readScannerDraft` checks shape and identified title/author but not that `item.isbn` agrees with the actual edition. Add draft validation/migration without deleting legitimate unsaved work.
14. `addScannedBatch` awaits storage flush after invoking `onAddMultipleBooks`; investigate transaction durability/rollback semantics and confirm a failed flush cannot lead to duplicates on retry.
15. Existing `scripts/isbn-resolution-regressions.ts` checks checksum/equivalent ISBN/provider selection but **not cover OCR candidate ranking, author verification, scanner state isolation, ISBN mismatch on batch records, or end-to-end native camera**. Passing `release:verify` therefore cannot establish scanner reliability.
16. Native `InkboundBarcodeScanner` implementation was not located in this targeted audit; Android/iOS native OCR and barcode behavior still require code inspection and device instrumentation.

## Release gates — required before production
- Fixture-based tests using recorded OCR lines for Circle of Stone / A. J. Lake; Adversary to the Villain / Hannah Nicole Maehrer; Stoneheart / Charlie Fletcher; and unrelated Darkest Age / Eric Staggs.
- Correct title + author or a clear unresolved state; never an unrelated candidate.
- Retailer-exclusive ISBN remains a separate unverified identifier until exact edition verified.
- Two consecutive unrelated scans cannot exchange ISBN, title, author, cover, or edition.
- Batch draft survives restart, is not erased on failures, and clears after confirmed save.
- Instrument native OCR lines and ranked candidates in debug builds only; no user photos or sensitive OCR data in production logs.
- `npm run release:verify`, `npm run android:sync`, Android Studio fresh install, and physical-device test. Version bump and release only after these gates.

Status: **Audit completed; scanner is NOT release-ready.** Findings are source-review results, not proof that each issue reproduces on every device. Do not deploy this branch based solely on existing green checks.
