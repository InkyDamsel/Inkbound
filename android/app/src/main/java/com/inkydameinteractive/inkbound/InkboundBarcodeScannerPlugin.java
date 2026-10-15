package com.inkydameinteractive.inkbound;

import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

@CapacitorPlugin(name = "InkboundBarcodeScanner")
public class InkboundBarcodeScannerPlugin extends Plugin {
    @PluginMethod
    public void confirmSuccess(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            try {
                ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 95);
                tone.startTone(ToneGenerator.TONE_PROP_BEEP, 160);
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(tone::release, 300);
            } catch (Exception error) {
                android.util.Log.w("InkboundScanner", "Scan sound unavailable", error);
            }
            try {
                Vibrator vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null && vibrator.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createOneShot(65, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        vibrator.vibrate(65);
                    }
                }
            } catch (Exception error) {
                android.util.Log.w("InkboundScanner", "Scan haptic unavailable", error);
            }
            call.resolve();
        });
    }
    @PluginMethod
    public void recognizeCover(PluginCall call) {
        String base64 = call.getString("image");
        if (base64 == null || base64.isEmpty()) {
            call.reject("No cover image was supplied.");
            return;
        }
        try {
            byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) { call.reject("Could not read cover image."); return; }
            com.google.mlkit.vision.common.InputImage image =
                com.google.mlkit.vision.common.InputImage.fromBitmap(bitmap, 0);
            com.google.mlkit.vision.text.TextRecognizer recognizer =
                com.google.mlkit.vision.text.TextRecognition.getClient(
                    com.google.mlkit.vision.text.latin.TextRecognizerOptions.DEFAULT_OPTIONS);
            recognizer.process(image)
                .addOnSuccessListener(result -> {
                    com.getcapacitor.JSArray lines = new com.getcapacitor.JSArray();
                    for (com.google.mlkit.vision.text.Text.TextBlock block : result.getTextBlocks()) {
                        for (com.google.mlkit.vision.text.Text.Line line : block.getLines()) {
                            lines.put(line.getText());
                        }
                    }
                    JSObject response = new JSObject();
                    response.put("lines", lines);
                    call.resolve(response);
                    recognizer.close();
                })
                .addOnFailureListener(error -> {
                    recognizer.close();
                    call.reject("Cover text recognition failed.", error);
                });
        } catch (Exception error) {
            call.reject("Could not process cover image.", error);
        }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_EAN_13,
                Barcode.FORMAT_EAN_8,
                Barcode.FORMAT_UPC_A,
                Barcode.FORMAT_UPC_E
            )
            .enableAutoZoom()
            .build();

        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        scanner.startScan()
            .addOnSuccessListener(barcode -> {
                String rawValue = barcode.getRawValue();
                if (rawValue == null || rawValue.trim().isEmpty()) {
                    call.reject("No barcode value was returned.");
                    return;
                }
                JSObject result = new JSObject();
                result.put("rawValue", rawValue);
                call.resolve(result);
            })
            .addOnCanceledListener(() -> {
                JSObject result = new JSObject();
                result.put("canceled", true);
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject(
                error.getMessage() != null ? error.getMessage() : "Barcode scanning failed."
            ));
    }
}
