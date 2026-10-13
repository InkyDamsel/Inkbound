import AVFoundation
import Capacitor
import UIKit

@objc(InkboundBarcodeScannerPlugin)
public final class InkboundBarcodeScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkboundBarcodeScannerPlugin"
    public let jsName = "InkboundBarcodeScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    @objc func scan(_ call: CAPPluginCall) {
        let begin = { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("Barcode scanner is unavailable.")
                return
            }

            DispatchQueue.main.async {
                let scanner = InkboundBarcodeScannerViewController()
                scanner.modalPresentationStyle = .fullScreen
                scanner.onResult = { value in
                    presenter.dismiss(animated: true) {
                        if let value, !value.isEmpty {
                            call.resolve(["rawValue": value])
                        } else {
                            call.resolve(["canceled": true])
                        }
                    }
                }
                presenter.present(scanner, animated: true)
            }
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            begin()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                granted ? begin() : call.reject("Camera permission was not granted.")
            }
        default:
            call.reject("Camera permission was not granted.")
        }
    }
}

private final class InkboundBarcodeScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onResult: ((String?) -> Void)?

    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.071, green: 0.031, blue: 0.09, alpha: 1)

        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)

        let hint = UILabel()
        hint.text = "Point your camera at the book barcode"
        hint.textColor = .white
        hint.textAlignment = .center
        hint.font = .systemFont(ofSize: 15, weight: .medium)
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        NSLayoutConstraint.activate([
            cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            cancel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            hint.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            hint.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            hint.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -22),
        ])

        configureCapture()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        if let previewLayer {
            view.layer.insertSublayer(previewLayer, at: 0)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.session.startRunning() }
        }
    }

    private func configureCapture() {
        guard
            let camera = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: camera),
            session.canAddInput(input)
        else {
            finish(nil)
            return
        }

        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            finish(nil)
            return
        }

        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.ean13, .ean8, .upce]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        previewLayer = preview
    }

    @objc private func cancelTapped() {
        finish(nil)
    }

    private func finish(_ value: String?) {
        guard !finished else { return }
        finished = true
        session.stopRunning()
        onResult?(value)
    }

    private func compactIsbn(_ value: String) -> String {
        value.uppercased().filter { $0.isNumber || $0 == "X" }
    }

    private func isValidIsbn(_ value: String) -> Bool {
        let isbn = compactIsbn(value)
        if isbn.count == 10 {
            let characters = Array(isbn)
            guard characters.prefix(9).allSatisfy({ $0.isNumber }) else { return false }
            var sum = 0
            for (index, character) in characters.enumerated() {
                let digit: Int
                if character == "X" && index == 9 {
                    digit = 10
                } else if let value = character.wholeNumberValue {
                    digit = value
                } else {
                    return false
                }
                sum += digit * (10 - index)
            }
            return sum % 11 == 0
        }
        if isbn.count == 13 && (isbn.hasPrefix("978") || isbn.hasPrefix("979")) {
            let digits = isbn.compactMap(\.wholeNumberValue)
            guard digits.count == 13 else { return false }
            let sum = digits.prefix(12).enumerated().reduce(0) { total, pair in
                total + pair.element * (pair.offset.isMultiple(of: 2) ? 1 : 3)
            }
            return digits[12] == (10 - (sum % 10)) % 10
        }
        return false
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        let codes = metadataObjects
            .compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
            .map(compactIsbn)
            .filter(isValidIsbn)
        let uniqueCodes = Array(Set(codes))
        guard uniqueCodes.count == 1, let code = uniqueCodes.first else { return }
        finish(code)
    }
}
