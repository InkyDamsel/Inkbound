package com.inkydameinteractive.inkbound;

import android.graphics.Color;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void applyInkboundSystemBars() {
        getWindow().setStatusBarColor(Color.rgb(11, 8, 16));
        getWindow().setNavigationBarColor(Color.rgb(11, 8, 16));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInkboundSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyInkboundSystemBars();
    }
}
