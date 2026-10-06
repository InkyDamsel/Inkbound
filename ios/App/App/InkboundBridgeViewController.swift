import Capacitor

final class InkboundBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(InkboundBarcodeScannerPlugin())
        bridge?.registerPluginInstance(LoanReminderPlugin())
        bridge?.registerPluginInstance(ReadingWidgetPlugin())
    }
}
