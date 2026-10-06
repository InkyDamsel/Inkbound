import { useEffect, useRef } from 'react';
import type { ReadingSession, UserBookRecord } from '../../types';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { INKBOUND_LOCAL_DATA_CHANGED_EVENT } from '../../platform/runtimeStorage';
import {
  applyReadingWidgetAction,
  buildReadingWidgetSnapshot,
  consumeAndroidReadingWidgetAction,
  syncAndroidReadingWidget,
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
    void syncAndroidReadingWidget(books, sessionsRef.current);
  }, [books]);

  useEffect(() => {
    sessionsRef.current = sessions;
    void syncAndroidReadingWidget(booksRef.current, sessions);
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
      void syncAndroidReadingWidget(booksRef.current, sessionsRef.current);
    };
    const consume = async () => {
      const action = await consumeAndroidReadingWidgetAction();
      if (!action || stopped) return;
      const result = applyReadingWidgetAction(action);
      await syncAndroidReadingWidget(booksRef.current, sessionsRef.current);
      if (result.shouldOpenTimer) {
        const fallbackBookId = action === 'start'
          ? booksRef.current.find((book) => book.status === 'currently-reading')?.id
          : undefined;
        openTimerRef.current(result.bookId ?? fallbackBookId);
      }
    };

    const onLocalDataChanged = () => refresh();
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalDataChanged);
    const unsubscribeResume = subscribeToRuntimeResume(() => {
      void consume();
      widgetSignatureRef.current = '';
      refresh();
    });

    void consume();
    refresh();

    return () => {
      stopped = true;
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalDataChanged);
      unsubscribeResume();
    };
  }, []);

  return null;
}
