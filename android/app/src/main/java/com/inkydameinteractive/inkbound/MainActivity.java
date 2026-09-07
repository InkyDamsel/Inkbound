package com.inkydameinteractive.inkbound;

import android.os.Bundle;

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
        super.onCreate(savedInstanceState);
        applyInkboundSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyInkboundSystemBars();
    }
}
