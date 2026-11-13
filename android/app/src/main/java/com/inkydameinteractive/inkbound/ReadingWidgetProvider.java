package com.inkydameinteractive.inkbound;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import android.view.View;
import android.widget.RemoteViews;

public class ReadingWidgetProvider extends AppWidgetProvider {
    static final String EXTRA_WIDGET_ACTION = "inkboundWidgetAction";
    private static final String NAVIGATE = "com.inkydameinteractive.inkbound.WIDGET_NAVIGATE";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        updateAll(context, manager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!NAVIGATE.equals(intent.getAction())) return;
        int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (widgetId < 0) return;
        SharedPreferences prefs = context.getSharedPreferences(ReadingWidgetPlugin.PREFS, Context.MODE_PRIVATE);
        JSONArray books = roster(prefs);
        if (books.length() < 2) return;
        int index = selectedIndex(prefs, books);
        int direction = intent.getIntExtra("direction", 1);
        int next = (index + (direction < 0 ? -1 : 1) + books.length()) % books.length();
        prefs.edit().putString("selectedWidgetBookId", books.optJSONObject(next).optString("id")).apply();
        updateAll(context, AppWidgetManager.getInstance(context), new int[] { widgetId });
    }

    private static JSONArray roster(SharedPreferences prefs) {
        try { return new JSONArray(prefs.getString("readingBooks", "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private static int selectedIndex(SharedPreferences prefs, JSONArray books) {
        String selected = prefs.getString("selectedWidgetBookId", "");
        for (int i = 0; i < books.length(); i++) {
            JSONObject book = books.optJSONObject(i);
            if (book != null && selected.equals(book.optString("id")) && !selected.isEmpty()) return i;
        }
        return 0;
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        super.onAppWidgetOptionsChanged(context, manager, appWidgetId, newOptions);
        updateAll(context, manager, new int[] { appWidgetId });
    }

    static void updateAll(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(ReadingWidgetPlugin.PREFS, Context.MODE_PRIVATE);
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.reading_widget);

            String sessionMode = prefs.getString("sessionMode", "none");
            String title = prefs.getString("title", "");
            String author = prefs.getString("author", "");
            String progress = prefs.getString("progressLabel", "");
            String paceLabel = prefs.getString("paceLabel", "");
            String paceDetail = prefs.getString("paceDetail", "");
            String dueTitle = prefs.getString("dueTitle", "");
            String dueDate = prefs.getString("dueDate", "");
            String dueLabel = prefs.getString("dueLabel", "");
            JSONArray readingBooks = roster(prefs);
            int selectedIndex = selectedIndex(prefs, readingBooks);
            JSONObject selectedBook = readingBooks.optJSONObject(selectedIndex);
            boolean showingAlternate = selectedBook != null && !selectedBook.optString("id").equals(prefs.getString("bookId", ""));
            if (selectedBook != null) {
                title = selectedBook.optString("title", title);
                author = selectedBook.optString("author", author);
                progress = selectedBook.optString("progressLabel", progress);
            }

            views.setTextViewText(R.id.widget_title, title.isEmpty() ? "Inkbound" : title);
            views.setTextViewText(R.id.widget_author, author);
            views.setTextViewText(R.id.widget_progress, progress);
            views.setTextViewText(R.id.widget_pace, paceLabel);
            views.setTextViewText(R.id.widget_pace_detail, paceDetail);
            String dueText = "";
            if (!dueTitle.isEmpty()) {
                String loanBook = dueTitle.equals(title) ? "" : dueTitle + " · ";
                String dateText = dueDate.isEmpty() ? "" : "Due back " + dueDate;
                String relativeText = dueLabel.isEmpty() ? "" : (dateText.isEmpty() ? dueLabel : " · " + dueLabel);
                dueText = "Library: " + loanBook + dateText + relativeText;
            }
            views.setTextViewText(R.id.widget_due, dueText);

            long timerSeconds = prefs.getLong("timerSeconds", 0L);
            boolean running = prefs.getBoolean("timerRunning", false);
            long anchor = prefs.getLong("timerAnchorMillis", 0L);
            long elapsed = timerSeconds + (running && anchor > 0L ? Math.max(0L, (System.currentTimeMillis() - anchor) / 1000L) : 0L);
            long chronometerBase = SystemClock.elapsedRealtime() - (elapsed * 1000L);
            views.setChronometer(R.id.widget_timer, chronometerBase, null, running);

            boolean hasBook = !title.isEmpty();
            boolean active = "active".equals(sessionMode);
            boolean paused = "paused".equals(sessionMode);
            boolean finished = "finished".equals(sessionMode);

            // Compact launcher sizes prioritize the book and progress; expanded
            // widgets can show supplemental pace and loan details.
            Bundle size = manager.getAppWidgetOptions(appWidgetId);
            int minHeight = size.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            boolean compact = minHeight > 0 && minHeight < 160;
            boolean multipleBooks = readingBooks.length() > 1;
            views.setViewVisibility(R.id.widget_book_navigation, multipleBooks ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.widget_book_position, (selectedIndex + 1) + " of " + readingBooks.length());
            views.setOnClickPendingIntent(R.id.widget_previous_book, navigationIntent(context, appWidgetId, -1));
            views.setOnClickPendingIntent(R.id.widget_next_book, navigationIntent(context, appWidgetId, 1));
            views.setViewVisibility(R.id.widget_timer, (active || paused || finished) && !compact && !showingAlternate ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.widget_progress, hasBook && !progress.isEmpty() ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.widget_pace, hasBook && !compact && !showingAlternate && !paceLabel.isEmpty() ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.widget_pace_detail, hasBook && !compact && !showingAlternate && !paceDetail.isEmpty() ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.widget_due, !compact && !dueTitle.isEmpty() ? View.VISIBLE : View.GONE);
            // Session mode belongs to the timer's book, not every book in the roster.
            // An alternate currently-reading book must retain its own Start button.
            // Only the book owning an active/paused/finished timer hides Start.
            views.setViewVisibility(R.id.widget_start,
                hasBook && (showingAlternate || "none".equals(sessionMode)) ? View.VISIBLE : View.GONE);
            // Active-session controls stay inside Inkbound. The widget remains a
            // glanceable mirror; tapping it opens the canonical timer UI.
            views.setViewVisibility(R.id.widget_resume, View.GONE);
            views.setViewVisibility(R.id.widget_pause, View.GONE);
            views.setViewVisibility(R.id.widget_stop, View.GONE);
            views.setViewVisibility(R.id.widget_empty, hasBook ? View.GONE : View.VISIBLE);

            views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context, "open", 4000 + appWidgetId));
            views.setOnClickPendingIntent(R.id.widget_start, launchIntent(context, "start", 5000 + appWidgetId));
            views.setOnClickPendingIntent(R.id.widget_resume, launchIntent(context, "resume", 6000 + appWidgetId));
            views.setOnClickPendingIntent(R.id.widget_pause, launchIntent(context, "pause", 7000 + appWidgetId));
            views.setOnClickPendingIntent(R.id.widget_stop, launchIntent(context, "stop", 8000 + appWidgetId));

            manager.updateAppWidget(appWidgetId, views);
        }
    }

    private static PendingIntent navigationIntent(Context context, int widgetId, int direction) {
        Intent intent = new Intent(context, ReadingWidgetProvider.class);
        intent.setAction(NAVIGATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.putExtra("direction", direction);
        return PendingIntent.getBroadcast(context, 9000 + widgetId * 2 + (direction > 0 ? 1 : 0), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent launchIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra(EXTRA_WIDGET_ACTION, action);
        intent.putExtra("widgetBookId", context.getSharedPreferences(ReadingWidgetPlugin.PREFS, Context.MODE_PRIVATE).getString("selectedWidgetBookId", ""));
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

}
