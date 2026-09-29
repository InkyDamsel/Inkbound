package com.inkydameinteractive.inkbound;

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
