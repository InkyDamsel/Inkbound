package com.inkydameinteractive.inkbound;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
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
    private static final String EXTRA_CHANNEL_ID = "channelId";
    private static final String EXTRA_CHANNEL_NAME = "channelName";
    private static final String EXTRA_CHANNEL_DESCRIPTION = "channelDescription";

    @PluginMethod
    public void schedule(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "loanNotificationPermissionCallback");
            return;
        }
        scheduleInternal(call);
    }

    @PermissionCallback
    private void loanNotificationPermissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notification permission was not granted.");
            return;
        }
        scheduleInternal(call);
    }


    @PluginMethod
    public void notifyNow(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "activityNotificationPermissionCallback");
            return;
        }
        notifyNowInternal(call);
    }

    @PermissionCallback
    private void activityNotificationPermissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notification permission was not granted.");
            return;
        }
        notifyNowInternal(call);
    }

    private void notifyNowInternal(PluginCall call) {
        String notificationKey = call.getString("notificationKey");
        String title = call.getString("title");
        String message = call.getString("message");
        if (notificationKey == null || notificationKey.isEmpty() || title == null || message == null) {
            call.reject("notificationKey, title, and message are required");
            return;
        }

        int notificationId = notificationKey.hashCode() & 0x7fffffff;
        Intent intent = new Intent(getContext(), LoanReminderReceiver.class);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_MESSAGE, message);
        intent.putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        intent.putExtra(EXTRA_CHANNEL_ID, "inkbound_reading_activity");
        intent.putExtra(EXTRA_CHANNEL_NAME, "Reading activity");
        intent.putExtra(EXTRA_CHANNEL_DESCRIPTION, "Reading session and book completion notifications.");
        getContext().sendBroadcast(intent);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String bookId = call.getString("bookId");
        if (bookId == null || bookId.isEmpty()) {
            call.reject("bookId is required");
            return;
        }
        cancelForBook(bookId);
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

        cancelForBook(bookId);
        scheduleAlarm(bookId, title, dueDate.minusDays(3), false);
        scheduleAlarm(bookId, title, dueDate, true);
        call.resolve(new JSObject());
    }

    private void scheduleAlarm(String bookId, String title, LocalDate reminderDate, boolean dueToday) {
        long triggerAt = triggerTime(reminderDate);
        long now = System.currentTimeMillis();
        if (triggerAt <= now) {
            if (!dueToday || !reminderDate.equals(LocalDate.now())) return;
            triggerAt = now + 3000L;
        }

        int requestCode = requestCode(bookId, dueToday);
        Intent intent = new Intent(getContext(), LoanReminderReceiver.class);
        intent.putExtra(EXTRA_TITLE, dueToday ? "Library book due today" : "Library book due in 3 days");
        intent.putExtra(EXTRA_MESSAGE, dueToday
            ? "Return “" + title + "” to the library today."
            : "“" + title + "” is due back at the library in 3 days.");
        intent.putExtra(EXTRA_NOTIFICATION_ID, requestCode);
        intent.putExtra(EXTRA_CHANNEL_ID, "inkbound_library_loans");
        intent.putExtra(EXTRA_CHANNEL_NAME, "Library return reminders");
        intent.putExtra(EXTRA_CHANNEL_DESCRIPTION, "Reminders for library books that are due soon.");

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

    private void cancelForBook(String bookId) {
        cancelAlarm(requestCode(bookId, false));
        cancelAlarm(requestCode(bookId, true));
    }

    private void cancelAlarm(int requestCode) {
        Intent intent = new Intent(getContext(), LoanReminderReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            getContext(),
            requestCode,
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pendingIntent == null) return;
        AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) alarmManager.cancel(pendingIntent);
        pendingIntent.cancel();
    }

    private int requestCode(String bookId, boolean dueToday) {
        int base = Math.abs(bookId.hashCode());
        if (base > 1000000000) base = base % 1000000000;
        return (base * 2) + (dueToday ? 1 : 0);
    }
}
