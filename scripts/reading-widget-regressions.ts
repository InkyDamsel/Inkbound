import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ReadingSession, UserBookRecord } from '../src/types';
import { selectReadingWidgetBook } from '../src/features/reading/readingWidgetSelection';

const book = (
  id: string,
  title: string,
  lastSessionDate?: string,
): UserBookRecord => ({
  id,
  work: {
    id: `work-${id}`,
    title,
    author: 'Test Author',
    summary: '',
    genres: [],
    publicationYear: 2026,
  },
  activeEditionId: `edition-${id}`,
  editions: [{
    id: `edition-${id}`,
    format: 'hardcover',
    pageCount: 400,
    coverGradient: '',
  }],
  status: 'currently-reading',
  ownership: 'owned',
  progressPages: 0,
  progressMinutes: 0,
  progressPercentage: 0,
  privateTags: [],
  priority: 'medium',
  moods: [],
  collections: [],
  dateAdded: '2026-09-01',
  lastSessionDate,
});

const session = (
  id: string,
  bookId: string,
  date: string,
  startTime: string,
  endTime: string,
): ReadingSession => ({
  id,
  bookId,
  date,
  startTime,
  endTime,
  durationMinutes: 20,
  startPage: 0,
  endPage: 16,
  pagesRead: 16,
  activitySource: 'timer',
});

// A stale idle timer draft must not pin the widget to an older title.
{
  const tom = book('tom', 'Tom Clancy Target Acquired', '2026-10-01');
  const splintered = book('splintered', 'Splintered', '2026-10-07');
  const sessions = [
    session('splintered-session', 'splintered', '2026-10-07', '15:16', '15:37'),
  ];

  const selected = selectReadingWidgetBook(
    [tom, splintered],
    sessions,
    {
      selectedBookId: 'tom',
      isActive: false,
      isFinished: false,
      timerSeconds: 0,
    },
  );

  assert.equal(
    selected?.id,
    'splintered',
    'Idle stale draft must yield to the most recently read Currently Reading book.',
  );
}

// An active timer still owns the widget even if another book was read more recently.
{
  const tom = book('tom', 'Tom Clancy Target Acquired', '2026-10-01');
  const splintered = book('splintered', 'Splintered', '2026-10-07');
  const selected = selectReadingWidgetBook(
    [tom, splintered],
    [session('splintered-session', 'splintered', '2026-10-07', '15:16', '15:37')],
    {
      selectedBookId: 'tom',
      isActive: true,
      isFinished: false,
      timerSeconds: 120,
    },
  );

  assert.equal(
    selected?.id,
    'tom',
    'Active timer book must remain the widget title while the timer is running.',
  );
}

// With no timer context, widget ordering must match the dashboard's reading recency.
{
  const older = book('older', 'Older', '2026-10-01');
  const newer = book('newer', 'Newer', '2026-10-05');
  const selected = selectReadingWidgetBook([older, newer], [], null);
  assert.equal(selected?.id, 'newer');
}

// A carousel's idle timer belongs only to its own selected book. Alternate
// reading books (2 of 3, 3 of 3, etc.) must each have a Start action.
{
  const provider = readFileSync('android/app/src/main/java/com/inkydameinteractive/inkbound/ReadingWidgetProvider.java', 'utf8');
  assert.match(provider,
    /hasBook && \(showingAlternate \|\| "none"\.equals\(sessionMode\)\)/,
    'Android widget must show Start for alternate carousel books.');
  assert.match(provider,
    /views\.setOnClickPendingIntent\(R\.id\.widget_start, launchIntent\(context, "start",/,
    'Start must open the timer with the selected widget book.');
  assert.match(provider, /intent\.putExtra\("widgetBookId",.*selectedWidgetBookId/,
    'Start must carry the currently selected carousel book ID.');
}

// Navigation should be floating gold arrows, not platform-default white buttons.
{
  const layout = readFileSync('android/app/src/main/res/layout/reading_widget.xml', 'utf8');
  for (const id of ['widget_previous_book', 'widget_next_book']) {
    const control = layout.match(new RegExp('<TextView\\s+android:id="@\\+id/' + id + '"[\\s\\S]*?/>'))?.[0];
    assert.ok(control, id + ' must use a text-only control instead of a default button.');
    assert.match(control, /android:background="@android:color\\/transparent"/, id + ' must have no pill background.');
    assert.match(control, /android:textColor="#D8B56D"/, id + ' must use the Inkbound gold accent.');
    assert.match(control, /android:layout_width="48dp"/, id + ' must keep an accessible tap target.');
    assert.match(control, /android:layout_height="48dp"/, id + ' must keep an accessible tap target.');
  }
}

console.log('Inkbound reading widget selection regressions passed.');
