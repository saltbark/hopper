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

    private let relay = RelayClient()
    private var session: PhoneSession?
    private var retry = 1.0
    private var running = false

    // MARK: Pairing

    func pair(link text: String) {
        let offer: Offer
        do { offer = try Offer(link: text) } catch {
            pairStep = .failed(error.localizedDescription)
            return
        }
        let phone = Curve25519.KeyAgreement.PrivateKey()
        let request: (frame: Data, pairKey: SymmetricKey)
        do { request = try Wire.pairRequest(offer: offer, phone: phone, name: UIDevice.current.name) } catch {
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
                if session.onHello(data) { link = .live }
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
        default:
            break
        }
    }

    private struct Head: Decodable { let t: String }
}
