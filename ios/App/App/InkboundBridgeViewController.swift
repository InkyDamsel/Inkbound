import Capacitor

final class InkboundBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(InkboundBarcodeScannerPlugin())
        bridge?.registerPluginInstance(LoanReminderPlugin())
        bridge?.registerPluginInstance(ReadingWidgetPlugin())
    }
}
