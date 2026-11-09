import CryptoKit
import Foundation
import Observation
import UIKit

/// The app's state: whether it's paired, whether the Mac is there, and the Mac's latest snapshot.
/// The Mac is the ground truth; this only shows what it last said, and how long ago.
@Observable
final class AppModel {
    enum Link: Equatable {
        /// Connecting to the relay.
        case connecting
        /// On the relay, but the Mac isn't (asleep, or Hopper closed).
        case macAway
        /// Talking to the Mac.
        case live
        /// The relay can't be reached; trying again.
        case offline
    }

    enum PairStep: Equatable {
        case idle, connecting, waitingForMac, failed(String)
    }

    private(set) var pairing: Pairing? = Keychain.load()
    private(set) var link: Link = .connecting
    private(set) var snapshot: PhoneSnapshot?
    private(set) var heardAt: Date?
    var pairStep: PairStep = .idle
    /// The conversation open on the phone, if any, and the size it was asked for.
    private(set) var screen: Screen?
    private var screenCols = 0
    /// What's typed in each conversation and not yet sent, so it's there when you come back.
    private var drafts: [String: String] = [:]

    private let relay = RelayClient()
    private var session: PhoneSession?
    private var retry = 1.0
    private var running = false

    // MARK: Pairing

    func pair(link text: String, name: String) {
        let offer: Offer
        do { offer = try Offer(link: text) } catch {
            pairStep = .failed(error.localizedDescription)
            return
        }
        let phone = Curve25519.KeyAgreement.PrivateKey()
        let request: (frame: Data, pairKey: SymmetricKey)
        let named = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do { request = try Wire.pairRequest(offer: offer, phone: phone, name: named.isEmpty ? UIDevice.current.name : named) } catch {
            pairStep = .failed(error.localizedDescription)
            return
        }
        pairStep = .connecting
        relay.connect(relay: offer.relay, room: offer.room.base64url) { [weak self] event in
            guard let self else { return }
            switch event {
            case .peerUp:
                self.pairStep = .waitingForMac
                self.relay.send(request.frame)
            case .frame(let data):
                guard let macName = Wire.pairedReply(data, pairKey: request.pairKey) else { return }
                let p = Pairing(
                    relay: offer.relay, room: offer.room, macPublic: offer.macPublic, macName: macName,
                    phonePrivate: phone.rawRepresentation)
                do { try Keychain.save(p) } catch {
                    self.pairStep = .failed("Couldn't keep the pairing in the Keychain.")
                    return
                }
                self.relay.close()
                self.pairing = p
                self.pairStep = .idle
                self.start()
            case .peerDown:
                break
            case .closed:
                if case .failed = self.pairStep { return }
                if self.pairing == nil { self.pairStep = .failed("Lost the relay. Make a new code on the Mac and scan again.") }
            }
        }
    }

    func unpair() {
        stop()
        Keychain.clear()
        pairing = nil
        snapshot = nil
        heardAt = nil
        pairStep = .idle
    }

    // MARK: The connection

    func start() {
        guard let pairing, !running, let key = try? pairing.pairKey() else { return }
        running = true
        let session = PhoneSession(pairKey: key)
        self.session = session
        link = .connecting
        relay.connect(relay: pairing.relay, room: pairing.roomID) { [weak self] event in
            self?.handle(event, session)
        }
        // The relay says when the Mac is there; quiet for a moment means it isn't.
        Task {
            try? await Task.sleep(for: .seconds(2))
            if self.link == .connecting, self.session === session { self.link = .macAway }
        }
    }

    func stop() {
        running = false
        relay.close()
        session?.end()
        session = nil
    }

    private func handle(_ event: RelayClient.Event, _ session: PhoneSession) {
        switch event {
        case .peerUp:
            retry = 1
            if let hello = try? session.hello() {
                link = .connecting
                relay.send(hello)
            }
        case .peerDown:
            session.end()
            link = .macAway
        case .frame(let data):
            if data.first == FrameKind.hello.rawValue {
                if session.onHello(data) {
                    link = .live
                    // A new session: the Mac's attach for the phone went with the old one.
                    if let screen { send(["t": "open", "id": screen.id, "cols": screenCols]) }
                }
                return
            }
            guard let json = session.open(data) else {
                // A frame that doesn't open ends the session: start a new one.
                if let hello = try? session.hello() { relay.send(hello) }
                return
            }
            receive(json)
        case .closed:
            session.end()
            guard running else { return }
            link = .offline
            running = false
            let wait = retry
            retry = min(30, retry * 2)
            Task {
                try? await Task.sleep(for: .seconds(wait))
                if self.pairing != nil, !self.running { self.start() }
            }
        }
    }

    private func receive(_ json: Data) {
        guard let head = try? JSONDecoder().decode(Head.self, from: json) else { return }
        heardAt = .now
        if link != .live { link = .live }
        switch head.t {
        case "snapshot":
            if let s = try? JSONDecoder().decode(PhoneSnapshot.self, from: json), s != snapshot { snapshot = s }
        case "screen":
            if let f = try? JSONDecoder().decode(ScreenFrame.self, from: json), let screen, f.id == screen.id {
                screen.closed = nil
                screen.apply(f)
            }
        case "closed":
            if let c = try? JSONDecoder().decode(Closed.self, from: json), let screen, c.id == screen.id {
                screen.closed = c.why ?? "The conversation closed on the Mac."
            }
        case "result", "newinfo":
            if let r = try? JSONDecoder().decode(Ref.self, from: json), let ref = r.ref, let waiting = answers.removeValue(forKey: ref) {
                waiting.resume(returning: json)
            }
        default:
            break
        }
    }

    private struct Head: Decodable { let t: String }
    private struct Closed: Decodable { let id: String; let why: String? }
    private struct Ref: Decodable { let ref: Int? }

    // MARK: Asking the Mac to do things

    /// What the Mac said about the last thing asked of it, for a moment on screen.
    struct Toast: Equatable, Identifiable {
        let id = UUID()
        let text: String
        let ok: Bool
    }

    private(set) var toast: Toast?
    private var answers: [Int: CheckedContinuation<Data?, Never>] = [:]
    private var nextRef = 1

    /// Sends an action with a fresh `ref` and waits for the Mac's answer to it (nil when it
    /// doesn't come: no Mac, or no answer in 20 seconds).
    private func ask(_ message: [String: Any]) async -> Data? {
        guard link == .live else { return nil }
        let ref = nextRef
        nextRef += 1
        var m = message
        m["ref"] = ref
        return await withCheckedContinuation { c in
            answers[ref] = c
            send(m)
            Task {
                try? await Task.sleep(for: .seconds(20))
                if let c = self.answers.removeValue(forKey: ref) { c.resume(returning: nil) }
            }
        }
    }

    struct Result: Decodable {
        let ok: Bool
        let text: String
    }

    /// Does an action and shows how it went; true when it worked.
    @discardableResult
    func perform(_ message: [String: Any]) async -> Bool {
        guard let data = await ask(message), let r = try? JSONDecoder().decode(Result.self, from: data) else {
            show(Toast(text: link == .live ? "The Mac didn't answer." : "The Mac isn't connected.", ok: false))
            return false
        }
        show(Toast(text: r.text, ok: r.ok))
        return r.ok
    }

    private func show(_ t: Toast) {
        toast = t
        Task {
            try? await Task.sleep(for: .seconds(t.ok ? 2.5 : 4.5))
            if self.toast?.id == t.id { self.toast = nil }
        }
    }

    func hold(_ id: String) async { await perform(["t": "hold", "id": id]) }
    func archive(_ id: String) async { await perform(["t": "done", "id": id]) }
    func unarchive(_ id: String) async { await perform(["t": "done", "id": id, "undo": true]) }
    func routine(_ id: String, _ action: String) async { await perform(["t": "routine", "id": id, "do": action]) }

    /// What a new conversation in this project would start with.
    func newInfo(_ project: String) async -> NewInfo? {
        guard let data = await ask(["t": "new", "project": project]) else { return nil }
        return try? JSONDecoder().decode(NewInfo.self, from: data)
    }

    // MARK: The open conversation

    private func send(_ message: [String: Any]) {
        guard let session, session.ready, let frame = try? session.seal(message) else { return }
        relay.send(frame)
    }

    /// Only the width is the phone's: the Mac draws the conversation into a screen far taller than
    /// this one, and it scrolls here.
    func open(_ id: String, cols: Int) {
        if screen?.id != id { screen = Screen(id: id) }
        screenCols = cols
        send(["t": "open", "id": id, "cols": cols])
    }

    func closeScreen() {
        guard let screen else { return }
        send(["t": "close", "id": screen.id])
        self.screen = nil
    }

    func resizeScreen(cols: Int) {
        guard let screen, cols != screenCols else { return }
        screenCols = cols
        send(["t": "resize", "id": screen.id, "cols": cols])
    }

    /// The conversation is drawn for the Mac's panel: draw it for the phone again.
    func reclaimScreen() {
        guard let screen else { return }
        send(["t": "reclaim", "id": screen.id])
    }

    /// Sends what was typed: the Mac pastes it, then presses Enter a moment later, so Claude takes
    /// it as sent rather than as a new line. Nothing typed is just Enter.
    func submit(_ text: String) {
        guard let screen else { return }
        send(["t": "submit", "id": screen.id, "text": text])
    }

    func draft(_ id: String) -> String { drafts[id] ?? "" }

    func setDraft(_ id: String, _ text: String) {
        if text.isEmpty { drafts[id] = nil } else { drafts[id] = text }
    }

    /// Bytes for Claude, as a terminal would send them.
    func keys(_ data: String) {
        guard let screen else { return }
        send(["t": "keys", "id": screen.id, "data": data])
    }

    /// Text in one go: Claude takes it as a paste, not as typing.
    func paste(_ text: String) {
        guard let screen else { return }
        send(["t": "paste", "id": screen.id, "text": text])
    }

    func wheel(up: Bool) {
        guard let screen else { return }
        send(["t": "wheel", "id": screen.id, "up": up])
    }
}
