import React, { useEffect, useMemo, useState } from 'react';
import { CanonicalInput } from './form/CanonicalInput';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { CheckCircle2, Clock, Flame, Gauge, MoonStar, Pause, Play, Square, Target, Trash2, X } from 'lucide-react';
import {
  formatDurationEstimate,
  getCurrentPace,
  getDailyReadingMinutes,
  getReadingStreak,
  getSessionDurationMinutes,
  getSevenDayAveragePace,
} from '../features/reading/sessionAnalytics';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../features/sync/storageKeys';
import { removeRuntimeValue } from '../platform/runtimeStorage';

interface ReadingSessionModalProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  initialBookId?: string;
  onClose: () => void;
  onSaveSession: (
    session: ReadingSession,
    updatedProgressPages: number,
    updatedProgressMins: number,
  ) => void;
}

interface SessionDraft {
  selectedBookId: string;
  timerSeconds: number;
  isActive: boolean;
  isFinished: boolean;
  lastActiveAt?: number;
  startedAt?: number;
  endedAt?: number;
  startPage: number;
  endPage: number;
  startMins: number;
  endMins: number;
  secondsByDate?: Record<string, number>;
  splitAtMidnight?: boolean;
  midnightProgress?: number;
  notes: string;
  mood: string;
  location: string;
}

const SESSION_DRAFT_KEY = 'inkbound_active_session_draft';
const MAX_BACKGROUND_RECOVERY_SECONDS = 8 * 60 * 60;

const localDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const localTime = (timestamp: number) => new Date(timestamp).toTimeString().substring(0, 5);

function addElapsedToDateBuckets(existing: Record<string, number> | undefined, startTimestamp: number, endTimestamp: number) {
  const next = { ...(existing ?? {}) };
  let cursor = startTimestamp;
  while (cursor < endTimestamp) {
    const date = new Date(cursor);
    const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();
    const segmentEnd = Math.min(endTimestamp, nextMidnight);
    const seconds = Math.max(0, Math.floor((segmentEnd - cursor) / 1000));
    const key = localDateKey(cursor);
    next[key] = (next[key] ?? 0) + seconds;
    cursor = segmentEnd;
  }
  return next;
}

function fallbackDateBuckets(startedAt: number, endedAt: number, timerSeconds: number) {
  const startDate = localDateKey(startedAt);
  const endDate = localDateKey(endedAt);
  if (startDate === endDate) return { [startDate]: timerSeconds };
  const midnight = new Date(startedAt);
  midnight.setHours(24, 0, 0, 0);
  const totalWallMs = Math.max(1, endedAt - startedAt);
  const beforeMidnightRatio = Math.min(1, Math.max(0, (midnight.getTime() - startedAt) / totalWallMs));
  const firstSeconds = Math.round(timerSeconds * beforeMidnightRatio);
  return { [startDate]: firstSeconds, [endDate]: Math.max(0, timerSeconds - firstSeconds) };
}

function allocateSplitMinutes(totalSeconds: number, firstSeconds: number) {
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const secondSeconds = Math.max(0, totalSeconds - firstSeconds);
  if (totalMinutes === 1) {
    return firstSeconds >= secondSeconds ? { firstMinutes: 1, secondMinutes: 0 } : { firstMinutes: 0, secondMinutes: 1 };
  }
  const roundedFirst = Math.round(firstSeconds / 60);
  const firstMinutes = Math.min(totalMinutes - 1, Math.max(1, roundedFirst));
  return { firstMinutes, secondMinutes: totalMinutes - firstMinutes };
}

export const ReadingSessionModal: React.FC<ReadingSessionModalProps> = ({ books, sessions, initialBookId, onClose, onSaveSession }) => {
  const selectableBooks = books.filter((book) => book.status === 'currently-reading');
  const requestedInitialBook = selectableBooks.find((book) => book.id === initialBookId);
  const initialBook = requestedInitialBook ?? selectableBooks[0];
  const [error, setError] = useState('');
  const [dailyGoalMins] = usePersistentState(ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes, '30');
  const [draft, setDraft] = usePersistentState<SessionDraft>(SESSION_DRAFT_KEY, () => ({
    selectedBookId: initialBook?.id ?? '',
    timerSeconds: 0,
    isActive: false,
    isFinished: false,
    startPage: initialBook?.progressPages ?? 0,
    endPage: initialBook?.progressPages ?? 0,
    startMins: initialBook?.progressMinutes ?? 0,
    endMins: initialBook?.progressMinutes ?? 0,
    secondsByDate: {},
    splitAtMidnight: true,
    notes: '',
    mood: '',
    location: '',
  }));
  const [endingProgressInput, setEndingProgressInput] = useState<string | null>(null);

  const selectedBook = selectableBooks.find((book) => book.id === draft.selectedBookId) || initialBook;
  const activeEdition = selectedBook?.editions.find((edition) => edition.id === selectedBook.activeEditionId) || selectedBook?.editions[0];
  const isAudiobook = activeEdition?.format === 'audiobook';
  const listeningSpeed = 1.2;

  useEffect(() => {
    if (draft.timerSeconds > 0 || draft.isActive || draft.isFinished) return;
    const requestedBook = selectableBooks.find((item) => item.id === initialBookId) ?? selectedBook;
    if (!requestedBook) return;
    const nextStartPage = requestedBook.progressPages ?? 0;
    const nextStartMins = requestedBook.progressMinutes ?? 0;
    if (requestedBook.id === draft.selectedBookId && draft.startPage === nextStartPage && draft.endPage === nextStartPage && draft.startMins === nextStartMins && draft.endMins === nextStartMins) return;
    setEndingProgressInput(null);
    setDraft((current) => ({
      ...current,
      selectedBookId: requestedBook.id,
      startPage: nextStartPage,
      endPage: nextStartPage,
      startMins: nextStartMins,
      endMins: nextStartMins,
      secondsByDate: {},
      midnightProgress: undefined,
    }));
  }, [draft.endMins, draft.endPage, draft.isActive, draft.isFinished, draft.selectedBookId, draft.startMins, draft.startPage, draft.timerSeconds, initialBookId, selectableBooks, selectedBook, setDraft]);

  useEffect(() => {
    if (!draft.isActive) return undefined;
    const recoveredAt = Date.now();
    const initialRecoverySeconds = draft.lastActiveAt && recoveredAt > draft.lastActiveAt
      ? Math.floor((recoveredAt - draft.lastActiveAt) / 1000)
      : 0;

    if (initialRecoverySeconds > MAX_BACKGROUND_RECOVERY_SECONDS) {
      setError('Inkbound paused this timer after a very long background gap so closed-app time is not mistaken for reading. Resume when you are ready.');
      setDraft((current) => ({ ...current, isActive: false, lastActiveAt: undefined }));
      return undefined;
    }

    setDraft((current) => {
      if (!current.isActive || !current.lastActiveAt || recoveredAt <= current.lastActiveAt) return current;
      const recoveredSeconds = Math.floor((recoveredAt - current.lastActiveAt) / 1000);
      if (recoveredSeconds <= 0) return current;
      return {
        ...current,
        timerSeconds: current.timerSeconds + recoveredSeconds,
        secondsByDate: addElapsedToDateBuckets(current.secondsByDate, current.lastActiveAt, recoveredAt),
        lastActiveAt: recoveredAt,
      };
    });

    const interval = window.setInterval(() => {
      const tickAt = Date.now();
      setDraft((current) => {
        if (!current.isActive) return current;
        const previousTick = current.lastActiveAt ?? tickAt - 1000;
        const elapsedSeconds = Math.max(1, Math.floor((tickAt - previousTick) / 1000));
        if (elapsedSeconds > MAX_BACKGROUND_RECOVERY_SECONDS) {
          window.setTimeout(() => setError('Inkbound paused this timer after a very long background gap so closed-app time is not mistaken for reading. Resume when you are ready.'), 0);
          return { ...current, isActive: false, lastActiveAt: undefined };
        }
        return {
          ...current,
          timerSeconds: current.timerSeconds + elapsedSeconds,
          secondsByDate: addElapsedToDateBuckets(current.secondsByDate, previousTick, tickAt),
          lastActiveAt: tickAt,
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [draft.isActive, draft.lastActiveAt, setDraft]);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleBookChange = (bookId: string) => {
    if (draft.timerSeconds > 0 || draft.isActive) {
      setError('Finish or discard the current session before switching books.');
      return;
    }
    const book = selectableBooks.find((item) => item.id === bookId);
    if (!book) return;
    setError('');
    setEndingProgressInput(null);
    setDraft((current) => ({
      ...current,
      selectedBookId: bookId,
      startPage: book.progressPages,
      endPage: book.progressPages,
      startMins: book.progressMinutes,
      endMins: book.progressMinutes,
      secondsByDate: {},
      midnightProgress: undefined,
    }));
  };

  const startOrResume = () => {
    const now = Date.now();
    setError('');
    setDraft((current) => ({ ...current, isActive: true, startedAt: current.startedAt ?? now, lastActiveAt: now, splitAtMidnight: current.splitAtMidnight ?? true }));
  };
  const pause = () => setDraft((current) => ({ ...current, isActive: false, lastActiveAt: undefined }));
  const handleFinishSession = () => {
    setEndingProgressInput(null);
    setDraft((current) => ({ ...current, isActive: false, isFinished: true, lastActiveAt: undefined, endedAt: Date.now() }));
  };
  const clearDraft = () => removeRuntimeValue(SESSION_DRAFT_KEY);
  const discardSession = () => {
    if (!window.confirm('Discard this reading session? The timer and unsaved notes will be removed.')) return;
    clearDraft();
    onClose();
  };

  const endedAt = draft.endedAt ?? Date.now();
  const startedAt = draft.startedAt ?? Math.max(0, endedAt - draft.timerSeconds * 1000);
  const startDate = localDateKey(startedAt);
  const endDate = localDateKey(endedAt);
  const crossedMidnight = startDate !== endDate;
  const recordedBuckets = useMemo(() => {
    const stored = draft.secondsByDate ?? {};
    const storedTotal = Object.values(stored).reduce((sum, value) => sum + value, 0);
    if (storedTotal > 0) {
      const normalized = { ...stored };
      const difference = draft.timerSeconds - storedTotal;
      if (difference !== 0) normalized[endDate] = Math.max(0, (normalized[endDate] ?? 0) + difference);
      return normalized;
    }
    return fallbackDateBuckets(startedAt, endedAt, draft.timerSeconds);
  }, [draft.secondsByDate, draft.timerSeconds, endDate, endedAt, startedAt]);

  const firstDaySeconds = recordedBuckets[startDate] ?? 0;
  const totalTrackedSeconds = Math.max(1, Object.values(recordedBuckets).reduce((sum, value) => sum + value, 0));
  const progressStart = isAudiobook ? draft.startMins : draft.startPage;
  const progressEnd = isAudiobook ? draft.endMins : draft.endPage;
  const suggestedMidnightProgress = Math.round(progressStart + (progressEnd - progressStart) * (firstDaySeconds / totalTrackedSeconds));
  const midnightProgress = Math.min(Math.max(progressStart, draft.midnightProgress ?? suggestedMidnightProgress), progressEnd);
  const sessionDurationMins = Math.max(1, Math.round(draft.timerSeconds / 60));
  const pagesCompleted = Math.max(0, draft.endPage - draft.startPage);
  const minsCompleted = Math.max(0, draft.endMins - draft.startMins);
  const shouldSplit = crossedMidnight && draft.splitAtMidnight !== false;

  const projectedSessions = useMemo(() => {
    if (!draft.isFinished || !selectedBook) return sessions;
    if (shouldSplit) {
      const { firstMinutes, secondMinutes } = allocateSplitMinutes(totalTrackedSeconds, firstDaySeconds);
      return [
        ...sessions,
        {
          id: 'preview-before-midnight', bookId: selectedBook.id, date: startDate, startTime: localTime(startedAt), endTime: '23:59', durationMinutes: firstMinutes,
          pagesRead: isAudiobook ? undefined : Math.max(0, midnightProgress - draft.startPage),
          minutesListened: isAudiobook ? Math.max(0, midnightProgress - draft.startMins) : undefined,
        },
        {
          id: 'preview-after-midnight', bookId: selectedBook.id, date: endDate, startTime: '00:00', endTime: localTime(endedAt), durationMinutes: secondMinutes,
          pagesRead: isAudiobook ? undefined : Math.max(0, draft.endPage - midnightProgress),
          minutesListened: isAudiobook ? Math.max(0, draft.endMins - midnightProgress) : undefined,
        },
      ];
    }
    return [...sessions, {
      id: 'preview-session', bookId: selectedBook.id, date: startDate, startTime: localTime(startedAt), endTime: localTime(endedAt), durationMinutes: sessionDurationMins,
      pagesRead: isAudiobook ? undefined : pagesCompleted,
      minutesListened: isAudiobook ? minsCompleted : undefined,
    }];
  }, [draft.endMins, draft.endPage, draft.isFinished, draft.startMins, draft.startPage, endDate, endedAt, firstDaySeconds, isAudiobook, midnightProgress, minsCompleted, pagesCompleted, selectedBook, sessionDurationMins, sessions, shouldSplit, startDate, startedAt, totalTrackedSeconds]);

  const completionDate = shouldSplit ? endDate : startDate;
  const showDailyMilestones = !sessions.some(
    (session) => session.date === completionDate && getSessionDurationMinutes(session) > 0,
  );
  const streak = getReadingStreak(projectedSessions, completionDate);
  const dailyGoal = Math.max(1, Number(dailyGoalMins) || 30);
  const dailyMinutes = getDailyReadingMinutes(projectedSessions, completionDate);
  const goalPercent = Math.min(100, Math.round((dailyMinutes / dailyGoal) * 100));
  const projectedBook = selectedBook ? { ...selectedBook, progressPages: draft.endPage, progressMinutes: draft.endMins } : undefined;
  const currentPace = projectedBook && !isAudiobook
    ? getCurrentPace({
        startPage: draft.startPage,
        endPage: draft.endPage,
        pagesRead: pagesCompleted,
        durationMinutes: sessionDurationMins,
      }, projectedBook)
    : null;
  const sevenDayPace = projectedBook && !isAudiobook ? getSevenDayAveragePace(projectedSessions, projectedBook, completionDate) : null;
  const currentRemainingLabel = formatDurationEstimate(currentPace?.estimatedRemainingSeconds);
  const averageRemainingLabel = formatDurationEstimate(sevenDayPace?.estimatedRemainingSeconds);

  const handleSaveAndClose = () => {
    if (!selectedBook) return;
    if (endingProgressInput === '') return setError(`Enter an ending ${isAudiobook ? 'minute' : 'page'} before saving.`);
    if (!isAudiobook && draft.endPage < draft.startPage) return setError('Ending page cannot be before the starting page. Inkbound will never create negative pages read.');
    if (isAudiobook && draft.endMins < draft.startMins) return setError('Ending minutes cannot be before the starting minute. Inkbound will never create negative listening time.');
    if (!isAudiobook && activeEdition?.pageCount && draft.endPage > activeEdition.pageCount) return setError(`Ending page cannot be beyond page ${activeEdition.pageCount.toLocaleString()} for this edition.`);
    if (isAudiobook && activeEdition?.audiobookDurationMins && draft.endMins > activeEdition.audiobookDurationMins) return setError(`Ending minute cannot be beyond ${activeEdition.audiobookDurationMins.toLocaleString()} minutes for this edition.`);

    if (shouldSplit) {
      const { firstMinutes: firstDurationMinutes, secondMinutes: secondDurationMinutes } = allocateSplitMinutes(totalTrackedSeconds, firstDaySeconds);
      const splitId = Date.now();
      const firstSession: ReadingSession = {
        id: `sess-${splitId}-before-midnight`, bookId: selectedBook.id, date: startDate, startTime: localTime(startedAt), endTime: '23:59', durationMinutes: firstDurationMinutes,
        startPage: !isAudiobook ? draft.startPage : undefined, endPage: !isAudiobook ? midnightProgress : undefined, pagesRead: !isAudiobook ? Math.max(0, midnightProgress - draft.startPage) : undefined,
        startTimestampSec: isAudiobook ? draft.startMins * 60 : undefined, endTimestampSec: isAudiobook ? midnightProgress * 60 : undefined, minutesListened: isAudiobook ? Math.max(0, midnightProgress - draft.startMins) : undefined,
        listeningSpeed: isAudiobook ? listeningSpeed : undefined, notes: draft.notes.trim() || undefined, mood: draft.mood.trim() || undefined, location: draft.location.trim() || undefined,
      };
      const secondSession: ReadingSession = {
        id: `sess-${splitId}-after-midnight`, bookId: selectedBook.id, date: endDate, startTime: '00:00', endTime: localTime(endedAt), durationMinutes: secondDurationMinutes,
        startPage: !isAudiobook ? midnightProgress : undefined, endPage: !isAudiobook ? draft.endPage : undefined, pagesRead: !isAudiobook ? Math.max(0, draft.endPage - midnightProgress) : undefined,
        startTimestampSec: isAudiobook ? midnightProgress * 60 : undefined, endTimestampSec: isAudiobook ? draft.endMins * 60 : undefined, minutesListened: isAudiobook ? Math.max(0, draft.endMins - midnightProgress) : undefined,
        listeningSpeed: isAudiobook ? listeningSpeed : undefined, notes: draft.notes.trim() || undefined, mood: draft.mood.trim() || undefined, location: draft.location.trim() || undefined,
      };
      clearDraft();
      onSaveSession(firstSession, !isAudiobook ? midnightProgress : draft.startPage, isAudiobook ? midnightProgress : draft.startMins);
      onSaveSession(secondSession, !isAudiobook ? draft.endPage : draft.startPage, isAudiobook ? draft.endMins : draft.startMins);
      onClose();
      return;
    }

    const session: ReadingSession = {
      id: `sess-${Date.now()}`, bookId: selectedBook.id, date: startDate, startTime: localTime(startedAt), endTime: localTime(endedAt), durationMinutes: sessionDurationMins,
      startPage: !isAudiobook ? draft.startPage : undefined, endPage: !isAudiobook ? draft.endPage : undefined, pagesRead: !isAudiobook ? pagesCompleted : undefined,
      startTimestampSec: isAudiobook ? draft.startMins * 60 : undefined, endTimestampSec: isAudiobook ? draft.endMins * 60 : undefined, minutesListened: isAudiobook ? minsCompleted : undefined,
      listeningSpeed: isAudiobook ? listeningSpeed : undefined, notes: draft.notes.trim() || undefined, mood: draft.mood.trim() || undefined, location: draft.location.trim() || undefined,
    };
    clearDraft();
    onSaveSession(session, !isAudiobook ? draft.endPage : draft.startPage, isAudiobook ? draft.endMins : draft.startMins);
    onClose();
  };

  if (!selectedBook) {
    return (
      <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
        <section className="relative w-full max-w-lg rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] p-6 text-center shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="reading-session-title">
          <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/30 text-stone-400 transition hover:bg-black/50 hover:text-white" aria-label="Close reading session"><X className="h-5 w-5" /></button>
          <Clock className="mx-auto h-8 w-8 text-[#e5c158]" />
          <h3 id="reading-session-title" className="mt-3 font-serif text-2xl font-bold text-[#f4efe6]">No books currently being read</h3>
          <p className="mt-2 text-sm leading-6 text-stone-300">Start a book from your library first. Reading Session Companion only lists books with the status Currently Reading.</p>
          <button type="button" onClick={onClose} className="mt-5 min-h-11 rounded-full border border-[#c5a059]/40 px-5 text-sm font-bold text-[#f4efe6]">Close</button>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section className="relative flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="reading-session-title">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-black/30 text-stone-400 transition hover:bg-black/50 hover:text-white" aria-label="Close reading session without discarding it" title="Close — your session will remain saved"><X className="h-5 w-5" /></button>
        <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:p-6">
          <div className="space-y-5">
            <header className="space-y-1 pr-10 text-center">
              <Clock className="mx-auto h-8 w-8 animate-pulse text-[#e5c158]" />
              <h3 id="reading-session-title" className="font-serif text-2xl font-bold text-[#f4efe6]">Reading Session Companion</h3>
              <p className="text-xs text-stone-300">Your active session saves automatically. Closing this window does not discard it.</p>
            </header>

            {!draft.isFinished && <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Select Book</label><select value={draft.selectedBookId} onChange={(event) => handleBookChange(event.target.value)} disabled={draft.timerSeconds > 0 || draft.isActive} className="w-full rounded-xl border border-[#3d2448] bg-[#120817] p-3 text-sm font-medium text-[#f4efe6] focus:border-[#c5a059] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60">{selectableBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title} ({book.work.author})</option>)}</select><p className="mt-2 text-xs text-stone-400">Only books marked Currently Reading are available here. This session will begin from your saved {isAudiobook ? `minute ${draft.startMins}` : `page ${draft.startPage}`}. The next session will continue from whatever ending progress you save.</p></div>}
            {error && <p className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}

            {!draft.isFinished ? (
              <div className="space-y-4 rounded-2xl border border-[#c5a059]/30 bg-[#25132f] p-5 text-center text-[#f4efe6] shadow-inner sm:p-6">
                <div className="font-mono font-serif text-4xl font-bold tracking-[0.12em] text-[#e5c158] sm:text-5xl">{formatTime(draft.timerSeconds)}</div>
                <p className="text-xs text-stone-300">{draft.isActive ? 'Session in progress...' : draft.timerSeconds > 0 ? 'Paused' : 'Ready to start'}</p>
                <div className="grid gap-3 pt-2 sm:flex sm:items-center sm:justify-center sm:gap-4">
                  {!draft.isActive ? <button type="button" onClick={startOrResume} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-6 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"><Play className="h-4 w-4 fill-current" /><span>{draft.timerSeconds === 0 ? 'Start Timer' : 'Resume'}</span></button> : <button type="button" onClick={pause} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-amber-600 px-6 text-xs font-bold text-white shadow-md transition hover:bg-amber-700"><Pause className="h-4 w-4 fill-current" /><span>Pause</span></button>}
                  {draft.timerSeconds > 0 && <button type="button" onClick={handleFinishSession} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 text-xs font-bold text-white shadow-md transition hover:bg-emerald-800"><Square className="h-4 w-4 fill-current" /><span>Complete Session</span></button>}
                </div>
                {(draft.timerSeconds > 0 || draft.notes) && <button type="button" onClick={discardSession} className="mx-auto flex min-h-11 items-center gap-2 text-xs font-bold text-rose-300 hover:text-rose-200"><Trash2 className="h-3.5 w-3.5" /> Discard Session</button>}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-emerald-300"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" /><div><p className="text-sm font-bold">Session completed</p><p className="text-xs text-stone-300">{sessionDurationMins} minutes tracked.</p></div></div>

                {showDailyMilestones && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#3d2448] bg-[#25132f] p-3"><p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400"><Flame className="h-3.5 w-3.5 text-[#e5c158]" /> Reading streak</p><p className="mt-1 font-serif text-2xl font-bold text-[#f4efe6]">{streak} day{streak === 1 ? '' : 's'}</p></div>
                    <div className="rounded-xl border border-[#3d2448] bg-[#25132f] p-3"><p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400"><Target className="h-3.5 w-3.5 text-[#e5c158]" /> Daily goal</p><p className="mt-1 font-serif text-2xl font-bold text-[#f4efe6]">{dailyMinutes} / {dailyGoal}m</p><p className="mt-1 text-[11px] text-stone-400">{dailyMinutes >= dailyGoal ? 'Goal reached!' : `${dailyGoal - dailyMinutes} minutes to go.`}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${goalPercent}%` }} /></div></div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">{isAudiobook ? 'Starting minute' : 'Starting page'}</label><div className="w-full rounded-lg border border-[#3d2448] bg-[#17101b] p-3 text-sm text-stone-300">{isAudiobook ? draft.startMins : draft.startPage}</div><p className="mt-1 text-[11px] text-stone-500">Locked to your saved progress when this session began.</p></div>
                  <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">{isAudiobook ? 'Ending minute' : 'Ending page'}</label><CanonicalInput inputMode="numeric" min={isAudiobook ? draft.startMins : draft.startPage} max={isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount} type="number" value={endingProgressInput ?? String(isAudiobook ? draft.endMins : draft.endPage)} onValueChange={(raw) => { setEndingProgressInput(raw); setError(''); if (raw === '') return; const parsed = Number.parseInt(raw, 10); if (!Number.isFinite(parsed)) return; setDraft((current) => ({ ...current, midnightProgress: undefined, ...(isAudiobook ? { endMins: Math.max(0, parsed) } : { endPage: Math.max(0, parsed) }) })); }} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none" /><p className="mt-1 text-[11px] text-stone-500">Your next session will start here.</p></div>
                </div>

                {!isAudiobook && currentPace?.pagesPerHour ? <div className="rounded-2xl border border-[#c5a059]/35 bg-[#25132f] p-4"><p className="flex items-center gap-2 text-sm font-bold text-[#f4efe6]"><Gauge className="h-4 w-4 text-[#e5c158]" /> Reading pace</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[#120817] p-3"><p className="text-[11px] uppercase tracking-wider text-stone-500">Current pace</p><p className="mt-1 text-lg font-bold text-[#f4efe6]">{Math.round(currentPace.pagesPerHour)} pages/hour</p>{currentRemainingLabel && <p className="mt-1 text-xs text-stone-400">About {currentRemainingLabel} of reading remaining.</p>}</div><div className="rounded-xl bg-[#120817] p-3"><p className="text-[11px] uppercase tracking-wider text-stone-500">7-day average</p>{sevenDayPace?.pagesPerHour ? <><p className="mt-1 text-lg font-bold text-[#f4efe6]">{Math.round(sevenDayPace.pagesPerHour)} pages/hour</p>{averageRemainingLabel && <p className="mt-1 text-xs text-stone-400">About {averageRemainingLabel} remaining at your recent average.</p>}</> : <p className="mt-1 text-xs leading-5 text-stone-400">Inkbound needs at least 2 sessions and 20 tracked minutes in the last 7 days before showing an average pace.</p>}</div></div></div> : null}

                {crossedMidnight ? <div className="rounded-2xl border border-[#c5a059]/35 bg-[#25132f] p-4"><div className="flex items-start gap-3"><MoonStar className="mt-0.5 h-5 w-5 shrink-0 text-[#e5c158]" /><div className="flex-1"><p className="text-sm font-bold text-[#f4efe6]">This session crossed midnight</p><p className="mt-1 text-xs leading-5 text-stone-300">Inkbound can count the reading time on the day it actually happened instead of placing the entire session on one date.</p><label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[#3d2448] bg-[#120817] p-3"><input type="checkbox" checked={draft.splitAtMidnight !== false} onChange={(event) => setDraft((current) => ({ ...current, splitAtMidnight: event.target.checked }))} className="mt-0.5 h-5 w-5 shrink-0 accent-[#d4af37]" /><span><span className="block text-sm font-semibold text-[#f4efe6]">Split at midnight</span><span className="mt-0.5 block text-xs text-stone-400">Recommended. Uncheck this only if you want the entire reading period saved as one session.</span></span></label>{draft.splitAtMidnight !== false ? <label className="mt-3 block text-xs font-bold text-[#f4efe6]">{isAudiobook ? 'Minute reached at midnight' : 'Page reached at midnight'}<input inputMode="numeric" min={progressStart} max={progressEnd} type="number" value={midnightProgress} onChange={(event) => setDraft((current) => ({ ...current, midnightProgress: Math.min(progressEnd, Math.max(progressStart, Number.parseInt(event.target.value, 10) || progressStart)) }))} className="mt-1 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none" /><span className="mt-1 block font-normal text-stone-400">We estimate this from your tracked time, but you can correct it before saving.</span></label> : null}</div></div></div> : null}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Reading Mood <span className="font-normal text-stone-500">(optional)</span></label><select value={draft.mood} onChange={(event) => setDraft((current) => ({ ...current, mood: event.target.value }))} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]"><option value="">Not specified</option><option value="Atmospheric">Atmospheric</option><option value="Cozy">Cozy</option><option value="Fast-paced">Fast-paced</option><option value="Mind-bending">Mind-bending</option><option value="Relaxing">Relaxing</option></select></div><div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Location <span className="font-normal text-stone-500">(optional)</span></label><select value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]"><option value="">Not specified</option><option value="Cozy Armchair">Cozy Armchair</option><option value="Bed">Bed</option><option value="Coffee Shop">Coffee Shop</option><option value="Library">Library</option><option value="Airport">Airport</option><option value="Commute">Commute</option><option value="Study">Study</option></select></div></div>
                <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Session Notes & Reflections <span className="font-normal text-stone-500">(optional)</span></label><textarea rows={3} placeholder="What happened in this session?" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} className="w-full resize-y rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none" /></div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><button type="button" onClick={handleSaveAndClose} className="min-h-12 w-full rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] py-3 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95">{crossedMidnight && draft.splitAtMidnight !== false ? 'Save Split Sessions' : 'Log & Save Session'}</button><button type="button" onClick={discardSession} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" /> Discard</button></div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};