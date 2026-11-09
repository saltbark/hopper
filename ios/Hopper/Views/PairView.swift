import SwiftUI
import VisionKit

/// Pairing: scan the code `hopper pair` shows on the Mac (or paste its link, where there's no
/// camera), then say yes on the Mac.
struct PairView: View {
    @Environment(AppModel.self) private var model
    @State private var scanned = false
    @AppStorage("phoneName") private var name = ""

    var body: some View {
        ZStack {
            T.bg.ignoresSafeArea()
            if DataScannerViewController.isSupported, DataScannerViewController.isAvailable, model.pairStep == .idle || isFailed {
                QRScanner { link in
                    guard !scanned else { return }
                    scanned = true
                    model.pair(link: link, name: name)
                }
                .ignoresSafeArea()
                .overlay(Color.black.opacity(0.35).ignoresSafeArea())
                Brackets()
            }
            VStack(spacing: 8) {
                Text("Pair with your Mac").font(.system(size: 26, weight: .bold)).foregroundStyle(T.hi)
                Text(subtitle).font(.system(size: 15)).foregroundStyle(T.text).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, 60)

            VStack { Spacer(); Steps(scanned: $scanned, name: $name) }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
        }
        .onChange(of: model.pairStep) { _, step in if case .failed = step { scanned = false } }
    }

    private var isFailed: Bool { if case .failed = model.pairStep { true } else { false } }

    private var subtitle: String {
        switch model.pairStep {
        case .idle, .failed: "Point the camera at the code in Hopper"
        case .connecting: "Reaching the relay…"
        case .waitingForMac: "Say yes on your Mac"
        }
    }
}

private struct Brackets: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 22)
            .stroke(T.focus, style: StrokeStyle(lineWidth: 4, dash: [44, 152], dashPhase: 22))
            .frame(width: 240, height: 240)
            .accessibilityHidden(true)
    }
}

private struct Steps: View {
    @Environment(AppModel.self) private var model
    @Binding var scanned: Bool
    @Binding var name: String
    @FocusState private var naming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("THIS PHONE'S NAME").font(T.mono(11)).tracking(1.3).foregroundStyle(T.dim)
                TextField("", text: $name, prompt: Text("Sam's iPhone").foregroundStyle(T.dim))
                    .font(.system(size: 16))
                    .foregroundStyle(T.hi)
                    .focused($naming)
                    .submitLabel(.done)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background(Color(hex: 0x0A0E10), in: .rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x243036), lineWidth: 1))
                Text("The Mac asks whether to let this name in, and lists it in hopper phones.")
                    .font(.system(size: 12)).foregroundStyle(T.dim)
            }
            let command = Text("hopper pair").font(T.mono(13)).foregroundStyle(Color(hex: 0x96D8D3))
            step(1, Text("On your Mac, run \(command)."))
            step(2, Text("Scan the code, then say yes on the Mac."))
            if case .failed(let why) = model.pairStep {
                Text(why).font(.system(size: 14)).foregroundStyle(T.blocked)
            }
            Rectangle().fill(Color(hex: 0x1F2A2F)).frame(height: 1)
            HStack(spacing: 10) {
                Image(systemName: "lock").foregroundStyle(T.focus)
                Text("End to end encrypted. The relay passes sealed messages it can't read.")
                    .font(.system(size: 13)).foregroundStyle(T.soft)
            }
            Button {
                if let link = UIPasteboard.general.string {
                    scanned = true
                    naming = false
                    model.pair(link: link, name: name)
                }
            } label: {
                Text("Paste the link instead").font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity).frame(height: 44)
            }
            .foregroundStyle(T.focus)
            .background(T.chip, in: .rect(cornerRadius: 12))
        }
        .padding(18)
        .background(Color(hex: 0x12181B).opacity(0.94), in: .rect(cornerRadius: 26))
        .overlay(RoundedRectangle(cornerRadius: 26).stroke(Color(hex: 0x243036), lineWidth: 1))
    }

    private func step(_ n: Int, _ text: Text) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(T.mono(13, .bold)).foregroundStyle(T.focus)
                .frame(width: 28, height: 28).background(Color(hex: 0x1D262A), in: .circle)
            text.font(.system(size: 15)).foregroundStyle(T.hi)
        }
    }
}

/// VisionKit's scanner, for QR codes only; hands up the first Hopper link it sees.
struct QRScanner: UIViewControllerRepresentable {
    let onLink: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
            isHighlightingEnabled: false)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onLink: onLink) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onLink: (String) -> Void
        init(onLink: @escaping (String) -> Void) { self.onLink = onLink }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in items {
                if case .barcode(let code) = item, let s = code.payloadStringValue, s.hasPrefix("hopper://pair") {
                    onLink(s)
                    return
                }
            }
        }
    }
}
