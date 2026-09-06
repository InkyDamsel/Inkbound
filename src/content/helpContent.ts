export interface HelpItem {
  id: string;
  question: string;
  answer: string;
}

export interface HelpSection {
  id: string;
  title: string;
  items: HelpItem[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'sync-devices',
    title: 'Sync & devices',
    items: [
      { id: 'cross-device', question: 'Does Inkbound work across devices?', answer: 'Yes. Sign in with the same Inkbound account and your synced library, reading sessions, profile information, and supported account data can follow you to another device.' },
      { id: 'sign-out', question: 'What happens when I sign out?', answer: 'Signing out removes signed-in account data from that device without deleting your Inkbound account or cloud library. Sign back into the same account to restore synced data.' },
      { id: 'offline', question: 'Can I use Inkbound offline?', answer: 'Inkbound keeps locally available data usable where possible. Changes that need the cloud can continue syncing after your connection returns.' },
      { id: 'sync-delay', question: 'Why can syncing sometimes take longer?', answer: 'A first sign-in, a fresh device, a very large library, or a slow connection can take longer to restore. Returning readers can keep working with saved local data while cloud updates catch up.' },
      { id: 'navigation-downloads', question: 'Will moving around the app repeatedly download my whole library?', answer: 'No. Normal navigation is designed to work from the library already available on your device. A fresh device may need an initial cloud restore, but ordinary screen changes should not rebuild your library from scratch.' },
      { id: 'stale-device', question: 'What should I do if another device looks out of date?', answer: 'Keep both devices online for a little while and make sure they are signed into the same Inkbound account. If a change still does not appear, close and reopen Inkbound before contacting support.' },
    ],
  },
  {
    id: 'library-ownership',
    title: 'Library, status & ownership',
    items: [
      { id: 'tbr-ownership', question: 'Is TBR the same as not owning an item?', answer: 'No. Reading status and ownership are separate. A TBR title can be owned, borrowed, available through a subscription, on a wishlist, or not owned at all.' },
      { id: 'unread-owned', question: 'Can something be unread even if I own it?', answer: 'Yes. Ownership describes access; reading status describes your progress. An unread or TBR item can still be owned.' },
      { id: 'ownership-options', question: 'What ownership options can Inkbound track?', answer: 'Inkbound can distinguish owned items, library loans, items borrowed from another person, subscription access, wishlist items, and reading material you do not own.' },
      { id: 'ownership-history', question: 'Will changing ownership change my reading history?', answer: 'No. Changing ownership does not erase reading sessions, ratings, reviews, notes, progress, or finished dates.' },
      { id: 'collections', question: 'Can I organize items into personal collections?', answer: 'Yes. Collections can be used alongside reading status, ownership, tags, ratings, and other library details.' },
      { id: 'library-filters', question: 'Can I search and filter a large library?', answer: 'Yes. Inkbound includes search and filters for reading state, reading material type, format, genre, ownership, rating, and other available metadata.' },
    ],
  },
  {
    id: 'reading-materials',
    title: 'Reading material types',
    items: [
      { id: 'material-types', question: 'Does Inkbound only track traditional books?', answer: 'No. Inkbound can classify books, manga, comics, graphic novels, magazines, light novels, novellas, short stories, and anthologies.' },
      { id: 'type-vs-format', question: 'Is reading material type the same as format?', answer: 'No. Type describes what you are reading; format describes the edition. A manga can be paperback or ebook, while a novella could be hardcover, paperback, ebook, or audiobook.' },
      { id: 'legacy-material-type', question: 'What happens to older records without a reading material type?', answer: 'They remain compatible and are treated as books unless you choose a more specific type later.' },
      { id: 'material-filter', question: 'Can I filter by reading material type?', answer: 'Yes. Reading type can be filtered independently from format, status, ownership, genre, and rating.' },
    ],
  },
  {
    id: 'series',
    title: 'Series',
    items: [
      { id: 'series-location', question: 'Where do I find Series?', answer: 'Series lives inside My Library as an internal tab alongside Books and Collections.' },
      { id: 'series-imports', question: 'Does Series work with imported books?', answer: 'Yes. Inkbound uses series metadata from imported and manually added records. Older imports with recognizable series information can also be grouped when that information can be identified reliably.' },
      { id: 'series-correction', question: 'What if imported series information is wrong?', answer: 'Use Correct series to fix or reorganize series information without deleting the item or losing your reading data.' },
      { id: 'series-order', question: 'How does Inkbound order a series?', answer: 'Inkbound uses the stored series position when available, including fractional positions such as 0.5 for prequels, novellas, or companion titles. Custom labels can be used when a simple number is not enough.' },
      { id: 'untitled-series', question: 'Why do I see an Untitled entry?', answer: 'Some sources include placeholders for announced future installments before an official title is available. Inkbound can keep that placeholder in order without treating an unpublished untitled entry as something you own.' },
      { id: 'series-progress', question: 'What does series progress mean?', answer: 'Series progress is based on known installments you have marked finished. Ownership is separate, so owning an unread installment does not increase completion.' },
      { id: 'series-core', question: 'What Series features are part of the core library?', answer: 'Core Series organization includes grouping, order, completion progress, ownership and access, unread counts, manual corrections, and the next known installment. Deeper journey analysis can be offered separately as Series Insights.' },
      { id: 'series-pagination', question: 'How does Inkbound handle hundreds of series?', answer: 'Series results are paginated so large imported libraries remain manageable instead of becoming one endless scrolling list.' },
    ],
  },
  {
    id: 'imports',
    title: 'Imports & library updates',
    items: [
      { id: 'large-imports', question: 'How does Inkbound handle large libraries?', answer: 'Inkbound is designed to import large libraries quickly, then fill in missing details gradually so you do not have to wait for every cover and summary before using your library.' },
      { id: 'metadata-updates', question: 'When are missing covers and summaries updated?', answer: 'Inkbound can check for missing details while the app is active. Very large libraries are handled in smaller batches so the app stays responsive.' },
      { id: 'closed-app-enrichment', question: 'Does Inkbound keep checking after I close the app?', answer: 'Not continuously. Phones, tablets, and browsers can pause background work. Unfinished detail checks can remain queued so you can continue later.' },
      { id: 'reimport', question: 'Do I need to re-import items with missing details?', answer: 'No. Missing covers and summaries can be retried without importing the library again.' },
      { id: 'metadata-personal-data', question: 'Will metadata updates overwrite my reading data?', answer: 'No. Filling in missing metadata is kept separate from your personal reading data. A cover or summary update does not replace your rating, review, status, dates, progress, notes, tags, collections, or ownership.' },
      { id: 'edit-imported', question: 'Can imported items be edited?', answer: 'Yes. Imported items become normal library records that you can review and correct when source metadata is missing or inaccurate.' },
      { id: 'data-ownership', question: 'Does importing mean Inkbound owns my data?', answer: 'No. Your reading records remain yours, and Inkbound provides export tools so you can keep a portable copy.' },
    ],
  },
  {
    id: 'sessions',
    title: 'Reading sessions',
    items: [
      { id: 'timer-priority', question: 'What happens to detail updates while I use the reading timer?', answer: 'Your reading session takes priority. Large-library detail updates can pause while the timer is active and continue later.' },
      { id: 'session-offline', question: 'What if my connection drops during a session?', answer: 'The timer and session experience are designed to continue locally instead of requiring a constant connection. Cloud updates can catch up later.' },
      { id: 'background-timer', question: 'What if I background Inkbound during a timer?', answer: 'Your active timer draft is preserved. When Inkbound becomes active again, elapsed time is restored from saved session timing.' },
      { id: 'correct-progress', question: 'Can I correct my reading progress later?', answer: 'Yes. Session history and reading progress are editable so mistakes can be corrected without deleting the library item.' },
      { id: 'sessions-stats', question: 'Do sessions affect statistics and streaks?', answer: 'Yes. Recorded Inkbound reading activity helps build reading history, streaks, goals, and activity-based insights. Imported library metadata does not pretend to be an Inkbound reading session.' },
    ],
  },
  {
    id: 'privacy-data',
    title: 'Privacy, exports & your data',
    items: [
      { id: 'export-library', question: 'Can I export my library?', answer: 'Yes. Inkbound provides JSON backup and spreadsheet-friendly CSV export tools in Settings. Exporting your own data is part of data ownership, not a Premium lock.' },
      { id: 'csv-json', question: 'What is the difference between CSV and JSON export?', answer: 'CSV is convenient for viewing and working with library fields in spreadsheet tools. JSON is intended as the richer Inkbound backup format for preserving supported app data and structure.' },
      { id: 'clear-vs-delete', question: 'What is the difference between clearing this device and deleting my account?', answer: 'Clearing a device removes local Inkbound data while keeping your cloud account. Deleting your account permanently removes the account and its associated Inkbound cloud data.' },
      { id: 'support-secrets', question: 'Should I email my password or sign-in code to support?', answer: 'No. Inkbound support will never need your password or a sign-in verification code.' },
    ],
  },
];

export const QUICK_HELP_IDS = [
  'cross-device',
  'offline',
  'large-imports',
  'tbr-ownership',
  'series-imports',
  'material-types',
  'export-library',
  'metadata-personal-data',
] as const;

const HELP_ITEMS_BY_ID = new Map(
  HELP_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, item] as const)),
);

export const QUICK_HELP_ITEMS = QUICK_HELP_IDS.map((id) => HELP_ITEMS_BY_ID.get(id)).filter((item): item is HelpItem => Boolean(item));
