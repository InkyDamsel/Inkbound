import { registerPlugin } from '@capacitor/core';
import type { ReadingSession, UserBookRecord } from '../../types';
import { getSessionDurationMinutes, getSessionListeningMinutes, getSessionPagesRead } from '../reading/sessionAnalytics';
import { isAndroidRuntime } from '../../platform/runtimePlatform';

interface InkboundNotificationPlugin {
  notifyNow(options: {
    notificationKey: string;
    title: string;
    message: string;
  }): Promise<void>;
}

const NativeNotifications = registerPlugin<InkboundNotificationPlugin>('LoanReminder');

async function notifyNow(notificationKey: string, title: string, message: string): Promise<void> {
  if (!isAndroidRuntime()) return;
  try {
    await NativeNotifications.notifyNow({ notificationKey, title, message });
  } catch (error) {
    console.warn('Inkbound could not show the native notification.', error);
  }
}

export async function notifyNativeBookFinished(book: UserBookRecord): Promise<void> {
  await notifyNow(
    `book-finished:${book.id}:${book.dateFinished ?? 'finished'}`,
    'Book finished',
    `You finished “${book.work.title}”.`,
  );
}

export async function notifyNativeReadingSessionFinished(
  session: ReadingSession,
  book?: UserBookRecord,
): Promise<void> {
  const duration = getSessionDurationMinutes(session);
  const pages = getSessionPagesRead(session);
  const listened = getSessionListeningMinutes(session);
  const progress = pages > 0
    ? ` · ${pages} page${pages === 1 ? '' : 's'}`
    : listened > 0
      ? ` · ${Math.round(listened)} min listened`
      : '';
  const bookLabel = book ? `“${book.work.title}” · ` : '';

  await notifyNow(
    `session-finished:${session.id}`,
    'Reading session finished',
    `${bookLabel}${duration} min${progress}`,
  );
}
