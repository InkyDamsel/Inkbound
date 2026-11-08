import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Copy, Merge, Search, ShieldCheck } from 'lucide-react';
import type { Edition, UserBookRecord } from '../types';
import { readRuntimeJson } from '../platform/runtimeStorage';
import { usePersistentState } from '../hooks/usePersistentState';
import { getBookReadingState } from '../features/reading/bookReadingState';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../features/sync/storageKeys';
import { BookCover } from './BookCover';
import { ManualCoverRecoveryPanel } from './ManualCoverRecoveryPanel';
import { PaginationControls } from './PaginationControls';
import { TagManager } from './library/TagManager';
import { CustomOwnershipCategoryManager } from './ownership/CustomOwnershipCategoryManager';
import { OwnershipManager } from './ownership/OwnershipManager';
import { CustomReadingStatusManager } from './reading/CustomReadingStatusManager';
import {
  CUSTOM_READING_STATUSES_CHANGED_EVENT,
  readCustomReadingStatuses,
} from '../features/reading/customReadingStatuses';

export interface DuplicateMergeRequest {
  keepBookId: string;
  removeBookIds: string[];
  mergedBook: UserBookRecord;
}

interface DuplicateManagerScreenProps {
  books: UserBookRecord[];
  onMergeGroup: (request: DuplicateMergeRequest) => void;
  onSelectBook: (book: UserBookRecord) => void;
  onUpdateBook: (book: UserBookRecord) => void;
}

interface DuplicateGroup {
  id: string;
  reason: 'isbn' | 'title-author' | 'edition-variant';
  books: UserBookRecord[];
}

type DuplicateCandidate = { reason: 'isbn' | 'title-author' | 'edition-variant'; key: string; ids: string[] };
type MaintenanceSection = 'categories' | 'ownership' | 'statuses' | 'tags' | 'covers' | 'duplicates';

const IGNORED_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.ignoredDuplicateGroups;
const LEGACY_IGNORED_STORAGE_KEY = 'inkbound_duplicate_groups_ignored';
const MAINTENANCE_SECTIONS_KEY = 'inkbound_library_maintenance_collapsed_sections';
const DUPLICATE_PAGE_SIZE = 10;

const normalizeText = (value?: string) =>
  value?.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

const compactIsbn = (value?: string) => value?.toUpperCase().replace(/[^0-9X]/g, '') ?? '';

// Candidate discovery only: never merge automatically. Strip only recognizable
// series/edition decorations; retain the author's identity as a hard boundary.
const comparableWorkTitle = (value?: string): string => {
  // Parenthesized collection names are common in imports: Exposed (Wellard Asylum).
  let title = normalizeText(value?.replace(/\s*\([^)]{3,70}\)\s*$/, '') ?? '');
  title = title.replace(/\s+(?:the\s+)?[a-z0-9 ]+\s+series$/, '').trim();
  title = title.replace(/\s+(?:the\s+)?[a-z0-9 ]+\s+(?:book|volume|vol)\s+\d+$/, '').trim();
  return title;
};
const editionVariantKey = (book: UserBookRecord): string => {
  const title = comparableWorkTitle(book.work.title);
  const author = normalizeText(book.work.author);
  if (!title || !author || author === 'unknown author') return '';
  return `${title}::${author}`;
};

const activeEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

const allBookIsbns = (book: UserBookRecord) =>
  [...new Set(book.editions.flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn]).map(compactIsbn).filter((isbn) => isbn.length === 10 || isbn.length === 13))];

const uniqueText = (values: Array<string | undefined>) => {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    const trimmed = value?.trim();
    if (!trimmed) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const chooseBestEdition = (keeper: Edition, candidates: Edition[]): Edition => {
  const verified = candidates.find((edition) => edition.externalSource && !['import', 'manual'].includes(edition.externalSource));
  const richest = verified ?? candidates.find((edition) => edition.coverUrl && (edition.pageCount || edition.publisher)) ?? candidates[0];
  if (!richest) return keeper;
  return {
    ...richest,
    ...keeper,
    coverUrl: keeper.coverUrl || richest.coverUrl,
    pageCount: keeper.pageCount || richest.pageCount,
    audiobookDurationMins: keeper.audiobookDurationMins || richest.audiobookDurationMins,
    publisher: keeper.publisher || richest.publisher,
    publicationDate: keeper.publicationDate || richest.publicationDate,
    isbn: keeper.isbn || richest.isbn,
    isbn10: keeper.isbn10 || richest.isbn10,
    isbn13: keeper.isbn13 || richest.isbn13,
    id: keeper.id,
  };
};

const mergeDuplicateBooks = (keeper: UserBookRecord, group: UserBookRecord[]): UserBookRecord => {
  const others = group.filter((book) => book.id !== keeper.id);
  const editions = group.flatMap((book) => book.editions);
  const keeperEdition = activeEdition(keeper);
  const mergedActiveEdition = keeperEdition ? chooseBestEdition(keeperEdition, editions) : editions[0];
  const editionByKey = new Map<string, Edition>();
  editions.forEach((edition) => {
    const key = compactIsbn(edition.isbn13 || edition.isbn10 || edition.isbn) || `${edition.format}:${edition.id}`;
    if (!editionByKey.has(key)) editionByKey.set(key, edition);
  });
  if (mergedActiveEdition) editionByKey.set(compactIsbn(mergedActiveEdition.isbn13 || mergedActiveEdition.isbn10 || mergedActiveEdition.isbn) || `${mergedActiveEdition.format}:${mergedActiveEdition.id}`, mergedActiveEdition);

  const combinedReviews = uniqueText([keeper.review, ...others.map((book) => book.review)]);
  const combinedNotes = uniqueText([keeper.personalNotes, ...others.map((book) => book.personalNotes)]);
  const earliest = (values: Array<string | undefined>) => values.filter((value): value is string => Boolean(value)).sort()[0];
  const latest = (values: Array<string | undefined>) => values.filter((value): value is string => Boolean(value)).sort().at(-1);

  return {
    ...keeper,
    work: {
      ...keeper.work,
      subtitle: keeper.work.subtitle || group.find((book) => book.work.subtitle)?.work.subtitle,
      publisherSummary: keeper.work.publisherSummary || group.find((book) => book.work.publisherSummary)?.work.publisherSummary,
      personalSummary: keeper.work.personalSummary || group.find((book) => book.work.personalSummary)?.work.personalSummary,
      summary: keeper.work.personalSummary || keeper.work.summary || group.find((book) => book.work.summary)?.work.summary || 'Summary unavailable.',
      seriesName: keeper.work.seriesName || group.find((book) => book.work.seriesName)?.work.seriesName,
      seriesOrder: keeper.work.seriesOrder ?? group.find((book) => book.work.seriesOrder != null)?.work.seriesOrder,
      genres: [...new Set(group.flatMap((book) => book.work.genres))],
      tropes: [...new Set(group.flatMap((book) => book.work.tropes ?? []))],
      contentWarnings: [...new Set(group.flatMap((book) => book.work.contentWarnings ?? []))],
      originalLanguage: keeper.work.originalLanguage || group.find((book) => book.work.originalLanguage)?.work.originalLanguage,
      externalWorkId: keeper.work.externalWorkId || group.find((book) => book.work.externalWorkId)?.work.externalWorkId,
    },
    editions: [...editionByKey.values()],
    activeEditionId: mergedActiveEdition?.id ?? keeper.activeEditionId,
    progressPages: keeper.progressPages,
    progressMinutes: keeper.progressMinutes,
    progressPercentage: keeper.progressPercentage,
    status: keeper.status,
    rating: keeper.rating ?? group.find((book) => book.rating != null)?.rating,
    review: combinedReviews.length ? combinedReviews.join('\n\n---\n\n') : undefined,
    personalNotes: combinedNotes.length ? combinedNotes.join('\n\n---\n\n') : undefined,
    favoriteQuotes: Array.from(new Map(group.flatMap((book) => book.favoriteQuotes ?? []).map((quote) => [quote.id || quote.quote, quote])).values()),
    privateTags: [...new Set(group.flatMap((book) => book.privateTags))],
    moods: [...new Set(group.flatMap((book) => book.moods))],
    collections: [...new Set(group.flatMap((book) => book.collections))],
    whyIAddedThis: keeper.whyIAddedThis || group.find((book) => book.whyIAddedThis)?.whyIAddedThis,
    dateAdded: earliest(group.map((book) => book.dateAdded)) || keeper.dateAdded,
    dateStarted: keeper.dateStarted ?? earliest(group.map((book) => book.dateStarted)),
    dateFinished: keeper.status === 'finished' ? keeper.dateFinished : undefined,
    lastSessionDate: latest(group.map((book) => book.lastSessionDate)) ?? keeper.lastSessionDate,
    rereadCount: Math.max(...group.map((book) => book.rereadCount ?? 0)),
    importMetadataVerified: group.some((book) => book.importMetadataVerified),
    importMetadataReviewNeeded: group.every((book) => book.importMetadataReviewNeeded),
  };
};

const buildDuplicateCandidates = (books: UserBookRecord[]): DuplicateCandidate[] => {
  const candidateSets: DuplicateCandidate[] = [];
  const isbnMap = new Map<string, Set<string>>();
  books.forEach((book) => allBookIsbns(book).forEach((isbn) => {
    const ids = isbnMap.get(isbn) ?? new Set<string>();
    ids.add(book.id);
    isbnMap.set(isbn, ids);
  }));
  isbnMap.forEach((ids, isbn) => {
    if (ids.size < 2) return;
    // Identical ISBN metadata can be incorrectly attached to different formats.
    // A hardcover and an ebook are not safe automatic duplicate candidates.
    const byFormat = new Map<string, string[]>();
    [...ids].forEach((id) => {
      const book = books.find((item) => item.id === id);
      if (!book) return;
      const format = activeEdition(book)?.format ?? 'unknown';
      byFormat.set(format, [...(byFormat.get(format) ?? []), id]);
    });
    byFormat.forEach((formatIds, format) => {
      if (formatIds.length > 1) candidateSets.push({ reason: 'isbn', key: `${isbn}::${format}`, ids: formatIds });
    });
  });

  // Different ISBNs and formats are often editions of the same work.
  // Offer a manual review rather than suppressing these matches.
  const titleAuthorMap = new Map<string, Set<string>>();
  books.forEach((book) => {
    const key = editionVariantKey(book);
    if (!key) return;
    const ids = titleAuthorMap.get(key) ?? new Set<string>();
    ids.add(book.id);
    titleAuthorMap.set(key, ids);
  });
  titleAuthorMap.forEach((ids, key) => {
    if (ids.size < 2) return;
    candidateSets.push({ reason: 'edition-variant', key, ids: [...ids] });
  });
  return candidateSets;
};

const stableCandidateId = (candidate: DuplicateCandidate) => `${candidate.reason}:${candidate.key}`;
const legacyCandidateId = (candidate: DuplicateCandidate) => [...candidate.ids].sort().join('|');

const preferredDuplicateCandidates = (books: UserBookRecord[]) => {
  const byMembership = new Map<string, DuplicateCandidate>();
  buildDuplicateCandidates(books).forEach((candidate) => {
    const membership = legacyCandidateId(candidate);
    const existing = byMembership.get(membership);
    if (!existing || (candidate.reason === 'isbn' && existing.reason !== 'isbn')) byMembership.set(membership, candidate);
  });
  return [...byMembership.values()];
};

const migrateLegacyIgnoredGroups = (books: UserBookRecord[], legacyIgnored: Set<string>) => {
  if (!legacyIgnored.size) return [] as string[];
  return preferredDuplicateCandidates(books)
    .filter((candidate) => legacyIgnored.has(legacyCandidateId(candidate)))
    .map(stableCandidateId);
};

const findDuplicateGroups = (books: UserBookRecord[], ignored: Set<string>) => {
  const groups: DuplicateGroup[] = [];
  preferredDuplicateCandidates(books).forEach((candidate) => {
    const id = stableCandidateId(candidate);
    if (ignored.has(id)) return;
    const groupBooks = candidate.ids.map((bookId) => books.find((book) => book.id === bookId)).filter((book): book is UserBookRecord => Boolean(book));
    if (groupBooks.length < 2) return;
    groups.push({ id, reason: candidate.reason, books: groupBooks });
  });
  return groups.sort((a, b) => b.books.length - a.books.length || a.books[0].work.title.localeCompare(b.books[0].work.title));
};

export const DuplicateManagerScreen: React.FC<DuplicateManagerScreenProps> = ({ books, onMergeGroup, onSelectBook, onUpdateBook }) => {
  const [ignoredGroupIds, setIgnoredGroupIds] = usePersistentState<string[]>(IGNORED_STORAGE_KEY, []);
  const [collapsedSections, setCollapsedSections] = usePersistentState<Record<MaintenanceSection, boolean>>(MAINTENANCE_SECTIONS_KEY, {
    categories: false,
    ownership: false,
    statuses: true,
    tags: false,
    covers: false,
    duplicates: false,
  });
  const [customStatusCount, setCustomStatusCount] = useState(() => readCustomReadingStatuses().length);
  useEffect(() => {
    const refreshStatusCount = () => setCustomStatusCount(readCustomReadingStatuses().length);
    window.addEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refreshStatusCount);
    return () => window.removeEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refreshStatusCount);
  }, []);

  const [query, setQuery] = useState('');
  const [keeperByGroup, setKeeperByGroup] = useState<Record<string, string>>({});
  const [duplicatePage, setDuplicatePage] = useState(1);
  const ignoredGroupSet = useMemo(() => new Set(ignoredGroupIds), [ignoredGroupIds]);
  const groups = useMemo(() => findDuplicateGroups(books, ignoredGroupSet), [books, ignoredGroupSet]);
  const categoryCount = useMemo(() => new Set(books.map((book) => book.customOwnershipCategoryId).filter(Boolean)).size, [books]);
  const ownershipCustomCount = useMemo(() => books.filter((book) => book.ownership === 'custom').length, [books]);
  const tagCount = useMemo(() => new Set(books.flatMap((book) => (book.privateTags ?? []).map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))).size, [books]);
  const visibleGroups = useMemo(() => {
    const normalized = normalizeText(query);
    if (!normalized) return groups;
    return groups.filter((group) => group.books.some((book) => normalizeText(`${book.work.title} ${book.work.author}`).includes(normalized)));
  }, [groups, query]);
  const booksInGroups = new Set(groups.flatMap((group) => group.books.map((book) => book.id))).size;
  const duplicateTotalPages = Math.max(1, Math.ceil(visibleGroups.length / DUPLICATE_PAGE_SIZE));
  const safeDuplicatePage = Math.min(duplicatePage, duplicateTotalPages);
  const paginatedGroups = visibleGroups.slice((safeDuplicatePage - 1) * DUPLICATE_PAGE_SIZE, safeDuplicatePage * DUPLICATE_PAGE_SIZE);

  useEffect(() => { setDuplicatePage(1); }, [query]);
  useEffect(() => {
    if (duplicatePage > duplicateTotalPages) setDuplicatePage(duplicateTotalPages);
  }, [duplicatePage, duplicateTotalPages]);

  useEffect(() => {
    const legacyIgnored = new Set(readRuntimeJson<string[]>(LEGACY_IGNORED_STORAGE_KEY, []));
    const migrated = migrateLegacyIgnoredGroups(books, legacyIgnored);
    if (!migrated.length) return;
    setIgnoredGroupIds((current) => [...new Set([...current, ...migrated])]);
  }, [books, setIgnoredGroupIds]);

  const toggleSection = (section: MaintenanceSection) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const ignoreGroup = (groupId: string) => {
    setIgnoredGroupIds((current) => current.includes(groupId) ? current : [...current, groupId]);
  };

  const mergeGroup = (group: DuplicateGroup) => {
    const keepBookId = keeperByGroup[group.id] ?? group.books.find((book) => getBookReadingState(book).status === 'finished')?.id ?? group.books[0].id;
    const keeper = group.books.find((book) => book.id === keepBookId) ?? group.books[0];
    const removeBookIds = group.books.filter((book) => book.id !== keeper.id).map((book) => book.id);
    if (!window.confirm(`Merge ${group.books.length} records into "${keeper.work.title}"? All editions will remain available in Book Details. Reading sessions and other saved data will be preserved through the existing merge workflow.`)) return;
    onMergeGroup({ keepBookId: keeper.id, removeBookIds, mergedBook: mergeDuplicateBooks(keeper, group.books) });
  };

  const sectionToggle = (section: MaintenanceSection, eyebrow: string, title: string, description: string, meta?: string) => (
    <button
      type="button"
      onClick={() => toggleSection(section)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 py-3 text-left transition hover:border-[var(--ink-border-strong)] sm:px-5"
      aria-expanded={!collapsedSections[section]}
    >
      <span className="min-w-0">
        <span className="inkbound-kicker block">{eyebrow}</span>
        <span className="mt-1 block font-serif text-xl font-bold text-[var(--ink-ivory)] sm:text-2xl">{title}</span>
        {!collapsedSections[section] && <span className="mt-1 block max-w-3xl text-sm text-[var(--ink-muted)]">{description}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {meta && <span className="hidden text-xs text-[var(--ink-muted)] sm:inline">{meta}</span>}
        <ChevronDown className={`h-5 w-5 text-[var(--ink-mauve)] transition-transform ${collapsedSections[section] ? '-rotate-90' : ''}`} />
      </span>
    </button>
  );

  return <div className="space-y-6 pb-24">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><p className="inkbound-kicker">Library Maintenance</p><h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Keep your library tidy</h1><p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">Manage categories, ownership, reading statuses, tags, saved covers, and possible duplicate books from one place.</p></div>
      <div className="shrink-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm"><strong className="text-[var(--ink-ivory)]">{groups.length} duplicate groups</strong><span className="ml-2 text-[var(--ink-muted)]">· {booksInGroups} books involved</span></div>
    </header>

    <section className="space-y-3">
      {sectionToggle('categories', 'Category management', 'Category Manager', 'Create, review, rename, and remove reader-defined library categories.', `${categoryCount} in use`)}
      {!collapsedSections.categories && <CustomOwnershipCategoryManager books={books} />}
    </section>

    <section className="space-y-3">
      {sectionToggle('ownership', 'Ownership management', 'Ownership Manager', 'Review ownership usage and clean up books that still use custom ownership assignments.', `${ownershipCustomCount} custom`)}
      {!collapsedSections.ownership && <OwnershipManager books={books} />}
    </section>

    <section className="space-y-3">
      {sectionToggle('statuses', 'Status management', 'Status Manager', 'Create, rename, and remove your custom reading statuses.', `${customStatusCount} custom`)}
      {!collapsedSections.statuses && <CustomReadingStatusManager books={books} onUpdateBook={onUpdateBook} />}
    </section>

    <section className="space-y-3">
      {sectionToggle('tags', 'Tag management', 'Tag Manager', 'Browse, rename, and remove the tags already used across your library.', `${tagCount} tags`)}
      {!collapsedSections.tags && <TagManager books={books} />}
    </section>

    <section className="space-y-3">
      {sectionToggle('covers', 'Cover management', 'Manual Cover Library', 'Reuse saved covers, review your manually uploaded cover library, and manage cover recovery outside the import workflow.')}
      {!collapsedSections.covers && <div className="inkbound-panel rounded-3xl p-4 sm:p-6"><ManualCoverRecoveryPanel books={books} /></div>}
    </section>

    <section className="space-y-3">
      {sectionToggle('duplicates', 'Duplicate cleanup', 'Duplicate Management', 'Inkbound finds matching ISBNs and possible editions of the same work, even across formats or title decorations. Review every match; nothing merges automatically.', `${groups.length} groups`)}
      {!collapsedSections.duplicates && <div className="space-y-4">
        <section className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-gold)]" /><div className="min-w-0"><p className="font-semibold text-[var(--ink-ivory)]">Merge safely</p><p className="mt-1 text-sm text-[var(--ink-muted)]">The copy you choose to keep remains the source of current progress and status. Reading sessions from the removed copies are moved to it, while tags, collections, editions, notes, reviews, quotes, dates, and verified metadata are preserved where appropriate.</p></div></div></section>

        <div className="relative"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search duplicate groups by title or author" className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none" /></div>

        {visibleGroups.length === 0 ? <section className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" /><h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No duplicate groups to review</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">Your current library scan is clean, or the remaining groups were marked as separate books.</p></section> : <div className="space-y-5">{paginatedGroups.map((group) => {
          const selectedKeeper = keeperByGroup[group.id] ?? group.books.find((book) => getBookReadingState(book).status === 'finished')?.id ?? group.books[0].id;
          return <article key={group.id} className="inkbound-panel rounded-3xl p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><Copy className="h-4 w-4 shrink-0 text-[var(--ink-gold)]" /><h2 className="min-w-0 truncate font-serif text-xl font-bold text-[var(--ink-ivory)]">{group.books[0].work.title}</h2></div><p className="mt-1 text-xs text-[var(--ink-muted)]">{group.reason === 'isbn' ? 'Exact ISBN match' : group.reason === 'edition-variant' ? 'Possible editions — review before merging' : 'Exact normalized title + author'} · {group.books.length} copies</p></div><div className="flex flex-col gap-2 min-[430px]:flex-row"><button type="button" onClick={() => ignoreGroup(group.id)} className="quiet-shelf-secondary-action justify-center">Not Duplicates</button><button type="button" onClick={() => mergeGroup(group)} className="quiet-shelf-primary-action justify-center"><Merge className="h-4 w-4" /> Merge Group</button></div></div>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">{group.books.map((book) => {
              const readingState = getBookReadingState(book);
              const edition = readingState.activeEdition ?? activeEdition(book);
              const selected = selectedKeeper === book.id;
              return <label key={book.id} className={`flex min-w-0 cursor-pointer gap-3 rounded-2xl border p-3 sm:gap-4 sm:p-4 ${selected ? 'border-[var(--ink-gold)] bg-[var(--ink-gold)]/10' : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)]'}`}>
                <input type="radio" name={`keeper-${group.id}`} value={book.id} checked={selected} onChange={() => setKeeperByGroup((current) => ({ ...current, [group.id]: book.id }))} className="mt-1 h-5 w-5 shrink-0" />
                <BookCover work={book.work} edition={edition} size="sm" />
                <span className="min-w-0 flex-1"><strong className="block break-words text-sm text-[var(--ink-ivory)]">{book.work.title}</strong><small className="block break-words text-[var(--ink-muted)]">{book.work.author}</small><span className="mt-2 block text-xs text-[var(--ink-muted)]">{readingState.status} · {readingState.progressPercentage}% · {book.rating ? `${book.rating}★` : 'unrated'}</span><span className="mt-1 block break-words text-xs text-[var(--ink-faint)]">ISBN {edition?.isbn13 || edition?.isbn10 || edition?.isbn || 'unknown'} · {edition?.format || 'unknown format'}</span><button type="button" onClick={(event) => { event.preventDefault(); onSelectBook(book); }} className="mt-3 min-h-11 text-xs font-bold text-[var(--ink-mauve)]">Open book details</button>{selected && <span className="mt-2 block text-xs font-bold text-[var(--ink-gold)]">Keep this copy</span>}</span>
              </label>;
            })}</div>
          </article>;
        })}<PaginationControls page={safeDuplicatePage} totalItems={visibleGroups.length} pageSize={DUPLICATE_PAGE_SIZE} onPageChange={setDuplicatePage} itemLabel="duplicate groups" /></div>}
      </div>}
    </section>
  </div>;
};
