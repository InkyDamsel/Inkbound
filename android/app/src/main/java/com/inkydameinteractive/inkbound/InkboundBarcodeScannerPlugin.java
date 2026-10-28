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
    public void getBuildInfo(PluginCall call) {
        JSObject result = new JSObject();
        boolean debug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        result.put("debug", debug);
        call.resolve(result);
    }
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
    private android.graphics.Bitmap enhanceCoverForText(android.graphics.Bitmap source) {
        android.graphics.Bitmap enhanced = android.graphics.Bitmap.createBitmap(
            source.getWidth(), source.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas canvas = new android.graphics.Canvas(enhanced);
        android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        android.graphics.ColorMatrix matrix = new android.graphics.ColorMatrix();
        matrix.setSaturation(0f);
        // Increase contrast around the midpoint while preserving the full cover.
        float contrast = 1.45f;
        float translate = (-0.5f * contrast + 0.5f) * 255f;
        android.graphics.ColorMatrix contrastMatrix = new android.graphics.ColorMatrix(new float[] {
            contrast, 0, 0, 0, translate,
            0, contrast, 0, 0, translate,
            0, 0, contrast, 0, translate,
            0, 0, 0, 1, 0
        });
        matrix.postConcat(contrastMatrix);
        paint.setColorFilter(new android.graphics.ColorMatrixColorFilter(matrix));
        canvas.drawBitmap(source, 0, 0, paint);
        return enhanced;
    }


    private android.graphics.Bitmap cropAndScaleCoverRegion(
        android.graphics.Bitmap source,
        float topFraction,
        float bottomFraction
    ) {
        int top = Math.max(0, Math.round(source.getHeight() * topFraction));
        int bottom = Math.min(source.getHeight(), Math.round(source.getHeight() * bottomFraction));
        int height = Math.max(1, bottom - top);
        android.graphics.Bitmap crop = android.graphics.Bitmap.createBitmap(source, 0, top, source.getWidth(), height);
        int targetWidth = Math.min(2400, Math.max(source.getWidth(), source.getWidth() * 2));
        int targetHeight = Math.max(1, Math.round(height * (targetWidth / (float) source.getWidth())));
        android.graphics.Bitmap scaled = android.graphics.Bitmap.createScaledBitmap(crop, targetWidth, targetHeight, true);
        if (scaled != crop) crop.recycle();
        return scaled;
    }

    private android.graphics.Bitmap thresholdCoverForText(android.graphics.Bitmap source, int threshold) {
        android.graphics.Bitmap thresholded = android.graphics.Bitmap.createBitmap(
            source.getWidth(), source.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
        int width = source.getWidth();
        int height = source.getHeight();
        int[] pixels = new int[width * height];
        source.getPixels(pixels, 0, width, 0, 0, width, height);
        for (int index = 0; index < pixels.length; index++) {
            int color = pixels[index];
            int gray = Math.round(
                android.graphics.Color.red(color) * 0.299f
                + android.graphics.Color.green(color) * 0.587f
                + android.graphics.Color.blue(color) * 0.114f);
            int value = gray >= threshold ? 255 : 0;
            pixels[index] = android.graphics.Color.rgb(value, value, value);
        }
        thresholded.setPixels(pixels, 0, width, 0, 0, width, height);
        return thresholded;
    }

    private android.graphics.Bitmap thresholdCoverForText(android.graphics.Bitmap source) {
        android.graphics.Bitmap thresholded = android.graphics.Bitmap.createBitmap(
            source.getWidth(), source.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
        int width = source.getWidth();
        int height = source.getHeight();
        int[] pixels = new int[width * height];
        source.getPixels(pixels, 0, width, 0, 0, width, height);
        for (int index = 0; index < pixels.length; index++) {
            int color = pixels[index];
            int gray = Math.round(
                android.graphics.Color.red(color) * 0.299f
                + android.graphics.Color.green(color) * 0.587f
                + android.graphics.Color.blue(color) * 0.114f);
            // A moderate threshold exposes high-contrast decorative glyphs
            // without relying on any title, author, or cover-specific rule.
            int value = gray >= 145 ? 255 : 0;
            pixels[index] = android.graphics.Color.rgb(value, value, value);
        }
        thresholded.setPixels(pixels, 0, width, 0, 0, width, height);
        return thresholded;
    }

    private void appendRecognizedLines(
        com.google.mlkit.vision.text.Text result,
        java.util.LinkedHashSet<String> merged
    ) {
        for (com.google.mlkit.vision.text.Text.TextBlock block : result.getTextBlocks()) {
            for (com.google.mlkit.vision.text.Text.Line line : block.getLines()) {
                String value = line.getText();
                if (value != null && !value.trim().isEmpty()) merged.add(value.trim());
            }
        }
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

            android.graphics.Bitmap enhanced = enhanceCoverForText(bitmap);
            android.graphics.Bitmap thresholded = thresholdCoverForText(bitmap);
            android.graphics.Bitmap titleRegion = cropAndScaleCoverRegion(bitmap, 0.12f, 0.88f);
            android.graphics.Bitmap titleRegionEnhanced = enhanceCoverForText(titleRegion);
            android.graphics.Bitmap titleRegionDark = thresholdCoverForText(titleRegion, 105);
            android.graphics.Bitmap titleRegionLight = thresholdCoverForText(titleRegion, 185);
            com.google.mlkit.vision.text.TextRecognizer recognizer =
                com.google.mlkit.vision.text.TextRecognition.getClient(
                    com.google.mlkit.vision.text.latin.TextRecognizerOptions.DEFAULT_OPTIONS);
            java.util.LinkedHashSet<String> merged = new java.util.LinkedHashSet<>();

            com.google.mlkit.vision.common.InputImage originalImage =
                com.google.mlkit.vision.common.InputImage.fromBitmap(bitmap, 0);
            recognizer.process(originalImage)
                .continueWithTask(task -> {
                    if (task.isSuccessful() && task.getResult() != null) {
                        appendRecognizedLines(task.getResult(), merged);
                    }
                    com.google.mlkit.vision.common.InputImage enhancedImage =
                        com.google.mlkit.vision.common.InputImage.fromBitmap(enhanced, 0);
                    return recognizer.process(enhancedImage);
                })
                .continueWithTask(task -> {
                    if (task.isSuccessful() && task.getResult() != null) {
                        appendRecognizedLines(task.getResult(), merged);
                    }
                    com.google.mlkit.vision.common.InputImage thresholdedImage =
                        com.google.mlkit.vision.common.InputImage.fromBitmap(thresholded, 0);
                    return recognizer.process(thresholdedImage);
                })
                .continueWithTask(task -> {
                    if (task.isSuccessful() && task.getResult() != null) appendRecognizedLines(task.getResult(), merged);
                    return recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(titleRegion, 0));
                })
                .continueWithTask(task -> {
                    if (task.isSuccessful() && task.getResult() != null) appendRecognizedLines(task.getResult(), merged);
                    return recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(titleRegionEnhanced, 0));
                })
                .continueWithTask(task -> {
                    if (task.isSuccessful() && task.getResult() != null) appendRecognizedLines(task.getResult(), merged);
                    return recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(titleRegionDark, 0));
                })
                .continueWithTask(task -> {
                    if (task.isSuccessful() && task.getResult() != null) appendRecognizedLines(task.getResult(), merged);
                    return recognizer.process(com.google.mlkit.vision.common.InputImage.fromBitmap(titleRegionLight, 0));
                })
                .addOnSuccessListener(result -> {
                    appendRecognizedLines(result, merged);
                    com.getcapacitor.JSArray lines = new com.getcapacitor.JSArray();
                    for (String line : merged) lines.put(line);
                    JSObject response = new JSObject();
                    response.put("lines", lines);
                    call.resolve(response);
                    recognizer.close();
                    enhanced.recycle();
                    thresholded.recycle();
                    titleRegion.recycle();
                    titleRegionEnhanced.recycle();
                    titleRegionDark.recycle();
                    titleRegionLight.recycle();
                    bitmap.recycle();
                })
                .addOnFailureListener(error -> {
                    recognizer.close();
                    enhanced.recycle();
                    thresholded.recycle();
                    bitmap.recycle();
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
