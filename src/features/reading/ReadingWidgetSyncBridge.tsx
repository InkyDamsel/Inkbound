import { useEffect, useRef } from 'react';
import type { ReadingSession, UserBookRecord } from '../../types';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { INKBOUND_LOCAL_DATA_CHANGED_EVENT } from '../../platform/runtimeStorage';
import { INKBOUND_CLOUD_DATA_EVENT } from '../sync/cloudSyncEvents';
import {
  applyReadingWidgetAction,
  buildReadingWidgetSnapshot,
  consumeReadingWidgetAction,
  readDisplayedReadingWidgetBookId,
  syncReadingWidget,
} from './readingWidget';

interface ReadingWidgetSyncBridgeProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onOpenTimer: (bookId?: string) => void;
}

export function ReadingWidgetSyncBridge({ books, sessions, onOpenTimer }: ReadingWidgetSyncBridgeProps) {
  const booksRef = useRef(books);
  const sessionsRef = useRef(sessions);
  const openTimerRef = useRef(onOpenTimer);
  const widgetSignatureRef = useRef('');

  useEffect(() => {
    booksRef.current = books;
    void syncReadingWidget(books, sessionsRef.current);
  }, [books]);

  useEffect(() => {
    sessionsRef.current = sessions;
    void syncReadingWidget(booksRef.current, sessions);
  }, [sessions]);

  useEffect(() => {
    openTimerRef.current = onOpenTimer;
  }, [onOpenTimer]);

  useEffect(() => {
    let stopped = false;

    const refresh = () => {
      const snapshot = buildReadingWidgetSnapshot(booksRef.current, sessionsRef.current);
      const timerBaseMillis = snapshot.timerRunning && snapshot.timerAnchorMillis
        ? snapshot.timerAnchorMillis - ((snapshot.timerSeconds ?? 0) * 1000)
        : 0;
      const signature = JSON.stringify({
        sessionMode: snapshot.sessionMode,
        bookId: snapshot.bookId,
        title: snapshot.title,
        author: snapshot.author,
        progressLabel: snapshot.progressLabel,
        timerRunning: snapshot.timerRunning,
        timerSeconds: snapshot.timerRunning ? undefined : snapshot.timerSeconds,
        timerBaseMillis,
        paceLabel: snapshot.paceLabel,
        paceDetail: snapshot.paceDetail,
        dueTitle: snapshot.dueTitle,
        dueDate: snapshot.dueDate,
        dueLabel: snapshot.dueLabel,
      });
      if (signature === widgetSignatureRef.current) return;
      widgetSignatureRef.current = signature;
      void syncReadingWidget(booksRef.current, sessionsRef.current);
    };
    const consume = async () => {
      const tapped = await consumeReadingWidgetAction();
      if (!tapped || stopped) return;
      const { action } = tapped;
      // Read the book actually shown on the native widget BEFORE syncing a new
      // snapshot: app hydration may lag behind the widget the reader tapped.
      const tappedBookId = tapped.bookId ?? await readDisplayedReadingWidgetBookId();
      const result = applyReadingWidgetAction(action);
      await syncReadingWidget(booksRef.current, sessionsRef.current);
      if (result.shouldOpenTimer) {
        // The native widget and its tap target must resolve the same book.
        // An idle persisted timer draft is not authoritative reader intent.
        const displayedBookId = buildReadingWidgetSnapshot(
          booksRef.current,
          sessionsRef.current,
        ).bookId;
        openTimerRef.current(
          (action === 'start' || action === 'open') ? (tappedBookId ?? displayedBookId) : (result.bookId ?? tappedBookId ?? displayedBookId),
        );
      }
    };

    const onCanonicalDataChanged = () => {
      widgetSignatureRef.current = '';
      refresh();
    };
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onCanonicalDataChanged);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, onCanonicalDataChanged);
    const unsubscribeResume = subscribeToRuntimeResume(() => {
      void consume();
      widgetSignatureRef.current = '';
      refresh();
      window.setTimeout(() => {
        if (stopped) return;
        widgetSignatureRef.current = '';
        refresh();
      }, 500);
    });

    void consume();
    widgetSignatureRef.current = '';
    refresh();
    const startupRetry = window.setTimeout(() => {
      if (stopped) return;
      widgetSignatureRef.current = '';
      refresh();
    }, 500);

    return () => {
      stopped = true;
      window.clearTimeout(startupRetry);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onCanonicalDataChanged);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, onCanonicalDataChanged);
      unsubscribeResume();
    };
  }, []);

  return null;
}
