import React, { useMemo, useState } from 'react';
import { BookOpen, Eye, EyeOff, MessageCircle, Music2, Search, Send, ShieldCheck, Sparkles, TriangleAlert, Tv2 } from 'lucide-react';
import { UserBookRecord } from '../types';
import { useAccountSync } from '../context/AccountSyncContext';
import { useReaderProfileIdentity } from '../hooks/useReaderProfileIdentity';
import { usePersistentState } from '../hooks/usePersistentState';
import { hasCommunityAccount } from '../features/community/communityAccess';
import { getActiveEdition } from '../features/reading/bookReadingState';
import {
  COMMUNITY_CATEGORY_LABELS,
  COMMUNITY_POST_CATEGORIES,
  CommunityPostCategory,
  CommunityPostDraft,
  EMPTY_COMMUNITY_POST_DRAFT,
} from '../features/community/communityTypes';

interface CommunityScreenProps {
  books: UserBookRecord[];
}

const categoryIcon = (category: CommunityPostCategory) => {
  if (category === 'music') return Music2;
  if (category === 'tv' || category === 'movie') return Tv2;
  if (category === 'discussion' || category === 'general') return MessageCircle;
  return BookOpen;
};

export const CommunityScreen: React.FC<CommunityScreenProps> = ({ books }) => {
  const { user } = useAccountSync();
  const hasAccess = hasCommunityAccount(user);
  const { displayName, avatarImage, initials } = useReaderProfileIdentity();
  const [draft, setDraft] = useState<CommunityPostDraft>(EMPTY_COMMUNITY_POST_DRAFT);
  const [previewPosted, setPreviewPosted] = useState(false);
  const [rulesAccepted, setRulesAccepted] = usePersistentState(
    `inkbound_community_rules_accepted_${user?.uid ?? 'signed-out'}`,
    false,
  );
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [bookSearch, setBookSearch] = useState('');

  const selectedBook = useMemo(
    () => books.find((book) => book.id === draft.bookId),
    [books, draft.bookId],
  );
  const selectedBookCover = selectedBook ? getActiveEdition(selectedBook)?.coverUrl : undefined;
  const normalizedBookSearch = bookSearch.trim().toLowerCase();
  const filteredBooks = useMemo(
    () => books
      .filter((book) => {
        if (!normalizedBookSearch) return true;
        return book.work.title.toLowerCase().includes(normalizedBookSearch)
          || book.work.author.toLowerCase().includes(normalizedBookSearch)
          || book.work.seriesName?.toLowerCase().includes(normalizedBookSearch);
      })
      .sort((a, b) => a.work.title.localeCompare(b.work.title))
      .slice(0, 50),
    [books, normalizedBookSearch],
  );

  const canPost = Boolean(user && draft.body.trim().length > 0 && rulesAccepted);
  const showSpoilerControl = draft.category !== 'music' && draft.category !== 'general';
  const selectedCategoryLabel = COMMUNITY_CATEGORY_LABELS[draft.category];
  const SelectedCategoryIcon = categoryIcon(draft.category);

  const updateDraft = <K extends keyof CommunityPostDraft>(key: K, value: CommunityPostDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreviewPosted(false);
  };

  const updateCategory = (category: CommunityPostCategory) => {
    setDraft((current) => ({
      ...current,
      category,
      containsSpoilers: category === 'music' || category === 'general' ? false : current.containsSpoilers,
      bookId: category === 'book' || category === 'recommendation' || category === 'discussion'
        ? current.bookId
        : undefined,
    }));
    setPreviewPosted(false);
  };

  const submitPreview = () => {
    if (!canPost) return;
    setPreviewPosted(true);
  };

  if (!hasAccess) {
    return (
      <div className="mx-auto max-w-2xl pb-24">
        <section className="inkbound-panel rounded-3xl p-6 text-center sm:p-10">
          <ShieldCheck className="mx-auto h-8 w-8 text-[var(--ink-mauve)]" />
          <h1 className="mt-4 font-serif text-3xl font-bold text-[var(--ink-ivory)]">Inkbound Community is account-only</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--ink-muted)]">
            Sign in with Google or create an Inkbound account with your email to join the Community. This helps keep posts tied to real accounts and gives moderation tools something reliable to act on.
          </p>
          <p className="mt-5 text-xs text-[var(--ink-muted)]">Open Profile & account to sign in or create an account.</p>
        </section>
      </div>
    );
  }

  if (!rulesAccepted) {
    return (
      <div className="mx-auto max-w-3xl pb-24">
        <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <ShieldCheck className="mt-1 h-8 w-8 shrink-0 text-[var(--ink-mauve)]" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-mauve)]">Before you join</p>
              <h1 className="mt-2 font-serif text-3xl font-bold text-[var(--ink-ivory)] sm:text-4xl">Inkbound Community Rules</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
                Inkbound is a place to share thoughts, recommendations, disagreements, and pieces of life while helping everyone feel safe enough to join the conversation.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
              <h2 className="text-sm font-bold text-[var(--ink-ivory)]">Be kind</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Discuss ideas without attacking the person behind them.</p>
            </div>
            <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
              <h2 className="text-sm font-bold text-[var(--ink-ivory)]">Respect people</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Respect different identities, backgrounds, bodies, lived experiences, and opinions.</p>
            </div>
            <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
              <h2 className="text-sm font-bold text-[var(--ink-ivory)]">Protect privacy</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Do not share someone else's personal information or private conversations without permission.</p>
            </div>
            <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
              <h2 className="text-sm font-bold text-[var(--ink-ivory)]">Respect boundaries & consent</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Keep interactions appropriate, safe, and free from exploitation or predatory behavior.</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
            <p className="text-xs leading-5 text-[var(--ink-muted)]">
              Community is text-only. Posts do not accept photo or image uploads, video, live chat, location sharing, direct messages, or anonymous posting.
            </p>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
            <input
              type="checkbox"
              checked={rulesConfirmed}
              onChange={(event) => setRulesConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--ink-mauve)]"
            />
            <span className="text-sm leading-6 text-[var(--ink-ivory)]">
              I understand and agree to follow the Inkbound Community Rules.
            </span>
          </label>

          <button
            type="button"
            disabled={!rulesConfirmed}
            onClick={() => setRulesAccepted(true)}
            className="quiet-shelf-primary-action mt-5 min-h-12 w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldCheck className="h-4 w-4" /> Agree & Enter Community
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-6 pb-24">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ink-mauve)]/25 bg-[var(--ink-mauve)]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-mauve)]">
          <Sparkles className="h-3.5 w-3.5" /> Community Preview
        </div>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)] sm:text-4xl">The Inkbound Community</h1>
        <p className="max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          A place for readers to talk about books, music, TV, movies, fandoms, recommendations, and whatever else has them obsessed.
        </p>
      </header>

      <section className="inkbound-panel overflow-hidden rounded-3xl">
        <div className="border-b border-[var(--ink-border-subtle)] px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {avatarImage ? (
              <img src={avatarImage} alt="" className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--ink-mauve)]/15 font-bold text-[var(--ink-mauve)]">{initials}</div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--ink-ivory)]">{displayName}</p>
              <p className="text-xs text-[var(--ink-muted)]">Share something with the community</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <textarea
            value={draft.body}
            onChange={(event) => updateDraft('body', event.target.value.slice(0, 2000))}
            placeholder="What are you reading, watching, listening to, loving, hating, or recommending?"
            rows={5}
            className="w-full resize-y rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--ink-ivory)] outline-none transition placeholder:text-[var(--ink-muted)] focus:border-[var(--ink-mauve)]"
          />

          <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
            <span>{draft.body.length.toLocaleString()} / 2,000</span>
            <span>Text-only foundation for now</span>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Topic</p>
            <div className="flex flex-wrap gap-2">
              {COMMUNITY_POST_CATEGORIES.map((category) => {
                const Icon = categoryIcon(category);
                const selected = draft.category === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => updateCategory(category)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${selected ? 'border-[var(--ink-mauve)] bg-[var(--ink-mauve)]/15 text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)] hover:border-[var(--ink-border)] hover:text-[var(--ink-ivory)]'}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {COMMUNITY_CATEGORY_LABELS[category]}
                  </button>
                );
              })}
            </div>
          </div>

          {(draft.category === 'book' || draft.category === 'recommendation' || draft.category === 'discussion') && (
            <div className="space-y-3">
              <div>
                <label htmlFor="community-book-search" className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Attach a book from your library</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
                  <input
                    id="community-book-search"
                    type="search"
                    value={bookSearch}
                    onChange={(event) => setBookSearch(event.target.value)}
                    placeholder="Search title, author, or series"
                    className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-10 pr-3 text-sm text-[var(--ink-ivory)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink-mauve)]"
                  />
                </div>
              </div>

              <select
                id="community-book-attachment"
                value={draft.bookId ?? ''}
                onChange={(event) => updateDraft('bookId', event.target.value || undefined)}
                className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"
              >
                <option value="">No book attached</option>
                {filteredBooks.map((book) => (
                  <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>
                ))}
              </select>

              {normalizedBookSearch && filteredBooks.length === 0 && (
                <p className="text-xs text-[var(--ink-muted)]">No books in your library match “{bookSearch.trim()}”.</p>
              )}
            </div>
          )}

          {selectedBook && (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">
              <div className="grid h-20 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--ink-surface-raised)]">
                {selectedBookCover
                  ? <img src={selectedBookCover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  : <BookOpen className="h-5 w-5 text-[var(--ink-mauve)]" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--ink-ivory)]">{selectedBook.work.title}</p>
                <p className="truncate text-xs text-[var(--ink-muted)]">{selectedBook.work.author}</p>
                {selectedBook.work.seriesName && (
                  <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{selectedBook.work.seriesName}{selectedBook.work.seriesOrder ? ` · Book ${selectedBook.work.seriesOrder}` : ''}</p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {showSpoilerControl && (
              <button
                type="button"
                onClick={() => updateDraft('containsSpoilers', !draft.containsSpoilers)}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${draft.containsSpoilers ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'}`}
              >
                {draft.containsSpoilers ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {draft.containsSpoilers ? 'Spoiler warning on' : 'Mark as spoilers'}
              </button>
            )}

            <button
              type="button"
              onClick={() => updateDraft('containsNsfw', !draft.containsNsfw)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${draft.containsNsfw ? 'border-rose-400/40 bg-rose-400/10 text-rose-200' : 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'}`}
            >
              <TriangleAlert className="h-4 w-4" />
              {draft.containsNsfw ? 'NSFW warning on' : 'Mark NSFW / sensitive'}
            </button>

            <select
              value={draft.visibility}
              onChange={(event) => updateDraft('visibility', event.target.value as CommunityPostDraft['visibility'])}
              className="min-h-12 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] sm:col-span-2"
              aria-label="Post visibility"
            >
              <option value="public">Public</option>
              <option value="followers">Followers only</option>
            </select>
          </div>



          <div className="flex flex-col gap-3 border-t border-[var(--ink-border-subtle)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[var(--ink-muted)]">
              This branch is still a prototype. Posting is preview-only until the community backend and moderation rules are ready.
            </p>
            <button
              type="button"
              disabled={!canPost}
              onClick={submitPreview}
              className="quiet-shelf-primary-action min-h-12 shrink-0 justify-center disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> Preview Post
            </button>
          </div>
        </div>
      </section>

      {previewPosted && (
        <section className="inkbound-panel rounded-3xl p-4 sm:p-6">
          <div className="flex items-start gap-3">
            {avatarImage ? (
              <img src={avatarImage} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--ink-mauve)]/15 text-sm font-bold text-[var(--ink-mauve)]">{initials}</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-[var(--ink-ivory)]">{displayName}</strong>
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ink-border-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]"><SelectedCategoryIcon className="h-3 w-3" /> {selectedCategoryLabel}</span>
                {draft.containsSpoilers && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">Spoilers</span>}
                {draft.containsNsfw && <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200">NSFW</span>}
              </div>
              <p className={`mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-ivory)] ${draft.containsSpoilers || draft.containsNsfw ? 'rounded-xl bg-[var(--ink-surface-soft)] p-3 blur-sm transition hover:blur-none' : ''}`}>{draft.body.trim()}</p>
              {selectedBook && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">
                  <div className="grid h-16 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--ink-surface-raised)]">
                    {selectedBookCover
                      ? <img src={selectedBookCover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      : <BookOpen className="h-5 w-5 text-[var(--ink-mauve)]" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--ink-ivory)]">{selectedBook.work.title}</p>
                    <p className="truncate text-xs text-[var(--ink-muted)]">{selectedBook.work.author}</p>
                  </div>
                </div>
              )}
              <p className="mt-4 text-xs text-[var(--ink-muted)]">Preview · {draft.visibility === 'public' ? 'Public' : 'Followers only'}</p>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-dashed border-[var(--ink-border)] p-8 text-center">
        <MessageCircle className="mx-auto h-7 w-7 text-[var(--ink-mauve)]" />
        <h2 className="mt-3 font-serif text-xl font-bold text-[var(--ink-ivory)]">The feed comes next</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--ink-muted)]">For now we're getting the shape of posting right before we introduce persistence, follows, comments, reactions, or discovery.</p>
      </section>
    </div>
  );
};
