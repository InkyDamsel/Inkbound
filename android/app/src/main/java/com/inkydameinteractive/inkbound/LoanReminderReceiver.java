package com.inkydameinteractive.inkbound;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public class LoanReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "inkbound_library_loans";

    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String message = intent.getStringExtra("message");
        int notificationId = intent.getIntExtra("notificationId", 9100);
        String bookId = intent.getStringExtra(LoanReminderPlugin.EXTRA_BOOK_ID);
        String dueDate = intent.getStringExtra(LoanReminderPlugin.EXTRA_DUE_DATE);
        String kind = intent.getStringExtra(LoanReminderPlugin.EXTRA_KIND);
        if (title == null || message == null) return;

        // Pre-fix Inkbound builds scheduled alarms without these identity
        // extras. Those alarms cannot be proven to represent the reader's
        // current loan state after an upgrade, so discard them silently instead
        // of showing a stale/duplicate notification. Every alarm scheduled by
        // this build carries the full canonical identity below.
        if (bookId == null || dueDate == null || kind == null) return;

        markDelivered(context, bookId, dueDate, kind);
        createChannel(context);

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (SecurityException ignored) {
            // Android 13+ can deny notification permission. Scheduling remains safe;
            // Inkbound will ask again when a future library loan is saved.
        }
    }

    static boolean wasDelivered(Context context, String bookId, String dueDate, String kind) {
        return context
            .getSharedPreferences(LoanReminderPlugin.PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(deliveryKey(bookId, dueDate, kind), false);
    }

    private static void markDelivered(Context context, String bookId, String dueDate, String kind) {
        SharedPreferences preferences = context.getSharedPreferences(LoanReminderPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit().putBoolean(deliveryKey(bookId, dueDate, kind), true).apply();
    }

    private static String deliveryKey(String bookId, String dueDate, String kind) {
        return "delivered:" + bookId + ":" + dueDate + ":" + kind;
    }

    private void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Library return reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Reminders for library books that are due soon.");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
