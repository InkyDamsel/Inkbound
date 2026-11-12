package com.inkydameinteractive.inkbound;

import android.os.Bundle;
import android.content.Intent;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void applyInkboundSystemBars() {
        // Android 15 enforces edge-to-edge for apps targeting API 35. Avoid the
        // deprecated status/navigation bar color APIs and let Inkbound's WebView
        // draw behind the transparent system bars instead.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LoanReminderPlugin.class);
        registerPlugin(PlayBillingPlugin.class);
        registerPlugin(InkboundBarcodeScannerPlugin.class);
        registerPlugin(ReadingWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        handleReadingWidgetIntent(getIntent());
        applyInkboundSystemBars();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleReadingWidgetIntent(intent);
    }

    private void handleReadingWidgetIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(ReadingWidgetProvider.EXTRA_WIDGET_ACTION);
        if (action == null || action.isEmpty()) return;
        ReadingWidgetPlugin.storePendingAction(this, action, intent.getStringExtra("widgetBookId"));
    }

    @Override
    public void onResume() {
        super.onResume();
        applyInkboundSystemBars();
    }
}
