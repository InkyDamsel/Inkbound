package com.inkydameinteractive.inkbound;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
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
        if (title == null || message == null) return;

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
