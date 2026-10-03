import { useEffect, useRef } from 'react';
import type { UserBookRecord } from '../../types';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { INKBOUND_LOCAL_DATA_CHANGED_EVENT } from '../../platform/runtimeStorage';
import {
  applyReadingWidgetAction,
  consumeAndroidReadingWidgetAction,
  syncAndroidReadingWidget,
} from './readingWidget';

interface ReadingWidgetSyncBridgeProps {
  books: UserBookRecord[];
  onOpenTimer: (bookId?: string) => void;
}

export function ReadingWidgetSyncBridge({ books, onOpenTimer }: ReadingWidgetSyncBridgeProps) {
  const booksRef = useRef(books);
  const openTimerRef = useRef(onOpenTimer);

  useEffect(() => {
    booksRef.current = books;
    void syncAndroidReadingWidget(books);
  }, [books]);

  useEffect(() => {
    openTimerRef.current = onOpenTimer;
  }, [onOpenTimer]);

  useEffect(() => {
    let stopped = false;

    const refresh = () => void syncAndroidReadingWidget(booksRef.current);
    const consume = async () => {
      const action = await consumeAndroidReadingWidgetAction();
      if (!action || stopped) return;
      const result = applyReadingWidgetAction(action);
      await syncAndroidReadingWidget(booksRef.current);
      if (result.shouldOpenTimer) openTimerRef.current(result.bookId);
    };

    const onLocalDataChanged = () => refresh();
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalDataChanged);
    const unsubscribeResume = subscribeToRuntimeResume(() => {
      void consume();
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
