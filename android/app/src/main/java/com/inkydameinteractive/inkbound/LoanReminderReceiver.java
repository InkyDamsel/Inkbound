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
    private static final String DEFAULT_CHANNEL_ID = "inkbound_library_loans";

    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String message = intent.getStringExtra("message");
        int notificationId = intent.getIntExtra("notificationId", 9100);
        String channelId = intent.getStringExtra("channelId");
        String channelName = intent.getStringExtra("channelName");
        String channelDescription = intent.getStringExtra("channelDescription");
        if (title == null || message == null) return;
        if (channelId == null || channelId.isEmpty()) channelId = DEFAULT_CHANNEL_ID;
        if (channelName == null || channelName.isEmpty()) channelName = "Library return reminders";
        if (channelDescription == null || channelDescription.isEmpty()) channelDescription = "Reminders for library books that are due soon.";

        createChannel(context, channelId, channelName, channelDescription);

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
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

    private void createChannel(Context context, String channelId, String channelName, String channelDescription) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            channelId,
            channelName,
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(channelDescription);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
