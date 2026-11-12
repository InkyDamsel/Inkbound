package com.inkydameinteractive.inkbound;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReadingWidget")
public class ReadingWidgetPlugin extends Plugin {
    static final String PREFS = "inkbound_reading_widget";
    static final String PENDING_ACTION = "pendingAction";

    @PluginMethod
    public void syncState(PluginCall call) {
        SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        JSArray readingBooks = call.getArray("readingBooks");
        if (readingBooks != null) editor.putString("readingBooks", readingBooks.toString());
        editor.putString("sessionMode", value(call.getString("sessionMode")));
        editor.putString("bookId", value(call.getString("bookId")));
        editor.putString("title", value(call.getString("title")));
        editor.putString("author", value(call.getString("author")));
        editor.putString("progressLabel", value(call.getString("progressLabel")));
        editor.putLong("timerSeconds", longValue(call, "timerSeconds"));
        editor.putBoolean("timerRunning", Boolean.TRUE.equals(call.getBoolean("timerRunning")));
        editor.putLong("timerAnchorMillis", longValue(call, "timerAnchorMillis"));
        editor.putString("paceLabel", value(call.getString("paceLabel")));
        editor.putString("paceDetail", value(call.getString("paceDetail")));
        editor.putString("dueTitle", value(call.getString("dueTitle")));
        editor.putString("dueDate", value(call.getString("dueDate")));
        editor.putString("dueLabel", value(call.getString("dueLabel")));
        editor.commit();
        refreshWidgets(getContext());
        call.resolve();
    }

    @PluginMethod
    public void readState(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("sessionMode", prefs.getString("sessionMode", "none"));
        result.put("bookId", prefs.getString("bookId", ""));
        result.put("title", prefs.getString("title", ""));
        result.put("author", prefs.getString("author", ""));
        result.put("progressLabel", prefs.getString("progressLabel", ""));
        result.put("timerSeconds", prefs.getLong("timerSeconds", 0L));
        result.put("timerRunning", prefs.getBoolean("timerRunning", false));
        result.put("timerAnchorMillis", prefs.getLong("timerAnchorMillis", 0L));
        result.put("paceLabel", prefs.getString("paceLabel", ""));
        result.put("paceDetail", prefs.getString("paceDetail", ""));
        result.put("dueTitle", prefs.getString("dueTitle", ""));
        result.put("dueDate", prefs.getString("dueDate", ""));
        result.put("dueLabel", prefs.getString("dueLabel", ""));
        call.resolve(result);
    }

    @PluginMethod
    public void consumeAction(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String action = prefs.getString(PENDING_ACTION, "");
        prefs.edit().remove(PENDING_ACTION).apply();
        JSObject result = new JSObject();
        if (action != null && !action.isEmpty()) result.put("action", action);
        call.resolve(result);
    }

    static void storePendingAction(Context context, String action) {
        if (action == null || action.isEmpty()) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(PENDING_ACTION, action)
            .apply();
    }

    static void refreshWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, ReadingWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids.length > 0) {
            ReadingWidgetProvider.updateAll(context, manager, ids);
        }
    }

    private static String value(String value) {
        return value == null ? "" : value;
    }

    private static long longValue(PluginCall call, String key) {
        Double value = call.getDouble(key);
        return value == null ? 0L : value.longValue();
    }
}
