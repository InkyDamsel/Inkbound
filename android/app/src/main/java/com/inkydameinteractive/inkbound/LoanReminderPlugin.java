package com.inkydameinteractive.inkbound;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import androidx.core.app.NotificationManagerCompat;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Calendar;

@CapacitorPlugin(
    name = "LoanReminder",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class LoanReminderPlugin extends Plugin {
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_MESSAGE = "message";
    private static final String EXTRA_NOTIFICATION_ID = "notificationId";
    static final String EXTRA_BOOK_ID = "bookId";
    static final String EXTRA_DUE_DATE = "dueDate";
    static final String EXTRA_KIND = "kind";
    static final String PREFS_NAME = "inkbound_loan_reminders";
    static final String KIND_THREE_DAYS = "three-days";
    static final String KIND_DUE_TODAY = "due-today";

    @PluginMethod
    public void schedule(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
            return;
        }
        scheduleInternal(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notification permission was not granted.");
            return;
        }
        scheduleInternal(call);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String bookId = call.getString("bookId");
        if (bookId == null || bookId.isEmpty()) {
            call.reject("bookId is required");
            return;
        }
        cancelForBook(bookId, true);
        call.resolve();
    }

    private void scheduleInternal(PluginCall call) {
        String bookId = call.getString("bookId");
        String title = call.getString("title");
        String dueDateValue = call.getString("dueDate");
        if (bookId == null || title == null || dueDateValue == null) {
            call.reject("bookId, title, and dueDate are required");
            return;
        }

        final LocalDate dueDate;
        try {
            dueDate = LocalDate.parse(dueDateValue);
        } catch (Exception error) {
            call.reject("dueDate must use YYYY-MM-DD");
            return;
        }

        cancelForBook(bookId, false);
        scheduleAlarm(bookId, title, dueDate, dueDate.minusDays(3), false);
        scheduleAlarm(bookId, title, dueDate, dueDate, true);
        call.resolve(new JSObject());
    }

    private void scheduleAlarm(String bookId, String title, LocalDate dueDate, LocalDate reminderDate, boolean dueToday) {
        String kind = dueToday ? KIND_DUE_TODAY : KIND_THREE_DAYS;
        int requestCode = requestCode(bookId, dueToday);
        if (LoanReminderReceiver.wasDelivered(getContext(), bookId, dueDate.toString(), kind)) return;

        long triggerAt = triggerTime(reminderDate);
        long now = System.currentTimeMillis();
        if (triggerAt <= now) {
            if (!dueToday || !reminderDate.equals(LocalDate.now())) return;
            // If today's notification has not been delivered yet, allow one
            // catch-up delivery shortly after scheduling. Once delivered, the
            // receiver persists that fact so future app opens/syncs cannot
            // re-arm the same notification over and over.
            triggerAt = now + 3000L;
        }

        Intent intent = new Intent(getContext(), LoanReminderReceiver.class);
        intent.putExtra(EXTRA_TITLE, dueToday ? "Library book due today" : "Library book due in 3 days");
        intent.putExtra(EXTRA_MESSAGE, dueToday
            ? "Return “" + title + "” to the library today."
            : "“" + title + "” is due back at the library in 3 days.");
        intent.putExtra(EXTRA_NOTIFICATION_ID, requestCode);
        intent.putExtra(EXTRA_BOOK_ID, bookId);
        intent.putExtra(EXTRA_DUE_DATE, dueDate.toString());
        intent.putExtra(EXTRA_KIND, kind);

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            getContext(),
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        } else {
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        }
    }

    private long triggerTime(LocalDate date) {
        return date.atTime(9, 0)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli();
    }

    private void cancelForBook(String bookId, boolean cancelVisibleNotifications) {
        cancelAlarm(requestCode(bookId, false), cancelVisibleNotifications);
        cancelAlarm(requestCode(bookId, true), cancelVisibleNotifications);
    }

    private void cancelAlarm(int requestCode, boolean cancelVisibleNotification) {
        Intent intent = new Intent(getContext(), LoanReminderReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            getContext(),
            requestCode,
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pendingIntent != null) {
            AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) alarmManager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
        if (cancelVisibleNotification) {
            NotificationManagerCompat.from(getContext()).cancel(requestCode);
        }
    }

    private int requestCode(String bookId, boolean dueToday) {
        int base = Math.abs(bookId.hashCode());
        if (base > 1000000000) base = base % 1000000000;
        return (base * 2) + (dueToday ? 1 : 0);
    }
}
