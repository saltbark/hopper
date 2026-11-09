import CryptoKit
import Foundation
import Synchronization

// The phone's half of src/remote/wire.ts. Binary frames, the first byte saying which kind; the
// relay's own messages are text. A change to either side's framing changes both.
//
// Nothing here belongs to the main thread: frames are opened where they arrive, off it.

nonisolated enum FrameKind: UInt8 {
    case pair = 1, paired = 2, hello = 3, data = 4
}

nonisolated enum WireError: LocalizedError {
    case notAPairingLink, otherVersion(Int), badField(String)

    var errorDescription: String? {
        switch self {
        case .notAPairingLink: "That isn't a Hopper pairing code."
        case .otherVersion(let v): Versions.advice(theirs: v)
        case .badField(let f): "The pairing code is damaged (\(f))."
        }
    }
}

/// 2: the pairing link carries a room token, which both sides show the relay on connecting.
nonisolated let protocolVersion = 2

/// Which side to update when the Mac speaks other versions than this app.
nonisolated enum Versions {
    static func advice(theirs: Int) -> String {
        theirs > protocolVersion
            ? "Hopper on your Mac is newer than this app. Update the app."
            : "Hopper on your Mac is older than this app. Update Hopper on the Mac."
    }

    /// From the Mac's answer: the newest version it speaks and the oldest it still answers.
    static func advice(macNewest: Int, macOldest: Int) -> String {
        advice(theirs: protocolVersion < macOldest ? macOldest : macNewest)
    }
}

private nonisolated enum AAD {
    static let pair = Data("hopper pair request v1".utf8)
    static let paired = Data("hopper paired v1".utf8)
    static let helloPhone = Data("hopper hello v1 phone".utf8)
    static let helloMac = Data("hopper hello v1 mac".utf8)
}

/// What the Mac's QR code carries.
nonisolated struct Offer: Sendable {
    let relay: String
    let room: Data
    /// The room's token: shown to the relay on every connection, which lets in only this one.
    let token: Data
    let macPublic: Data
    let secret: Data
    let name: String

    init(link: String) throws {
        guard var u = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
            u.scheme == "hopper", u.host == "pair"
        else { throw WireError.notAPairingLink }
        // The Mac writes the query as a form (URLSearchParams), where a space is "+" and a "+" is
        // "%2B"; URLComponents leaves "+" as it is.
        u.percentEncodedQuery = u.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%20")
        var q: [String: String] = [:]
        for item in u.queryItems ?? [] { q[item.name] = item.value }
        guard let v = Int(q["v"] ?? "") else { throw WireError.badField("v") }
        guard v == protocolVersion else { throw WireError.otherVersion(v) }
        func bytes(_ k: String, _ n: Int) throws -> Data {
            guard let d = Data(base64url: q[k] ?? ""), d.count == n else { throw WireError.badField(k) }
            return d
        }
        guard let r = q["r"], r.hasPrefix("ws") else { throw WireError.badField("r") }
        relay = r
        room = try bytes("room", 16)
        token = try bytes("t", 32)
        macPublic = try bytes("k", 32)
        secret = try bytes("s", 32)
        name = q["n"] ?? "Mac"
    }
}

private nonisolated func frame(_ kind: FrameKind, _ body: Data) -> Data { Data([kind.rawValue]) + body }

private nonisolated func json(_ v: [String: Any]) -> Data { (try? JSONSerialization.data(withJSONObject: v)) ?? Data() }

private nonisolated func object(_ d: Data?) -> [String: Any]? {
    guard let d else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}

nonisolated enum Wire {
    /// The request to pair: this phone's key, proof it saw the code, its name sealed.
    static func pairRequest(offer: Offer, phone: Curve25519.KeyAgreement.PrivateKey, name: String) throws -> (frame: Data, pairKey: SymmetricKey) {
        let key = try RemoteCrypto.pairingKey(own: phone, other: offer.macPublic, room: offer.room)
        let pub = phone.publicKey.rawRepresentation
        let proof = RemoteCrypto.pairProof(secret: offer.secret, room: offer.room, phonePublic: pub)
        let box = try RemoteCrypto.sealBox(key, json(["v": protocolVersion, "name": name]), aad: AAD.pair)
        return (frame(.pair, pub + proof + box), key)
    }

    /// The Mac's answer to a hello: its versions, the hello it answers, and its fresh key, which is
    /// missing when it doesn't speak this app's version.
    struct MacHello: Equatable {
        let v: Int
        let oldest: Int
        let id: String
        let eph: Data?
    }

    static func readMacHello(_ data: Data, pairKey: SymmetricKey) -> MacHello? {
        guard data.first == FrameKind.hello.rawValue,
            let body = object(RemoteCrypto.openBox(pairKey, Data(data.dropFirst()), aad: AAD.helloMac)),
            let id = body["id"] as? String, let v = body["v"] as? Int
        else { return nil }
        var eph: Data?
        if let e = body["eph"] as? String {
            guard let d = Data(base64url: e), d.count == 32 else { return nil }
            eph = d
        }
        return MacHello(v: v, oldest: body["oldest"] as? Int ?? v, id: id, eph: eph)
    }

    /// The Mac's answer once it let this phone in: its name.
    static func pairedReply(_ data: Data, pairKey: SymmetricKey) -> String? {
        guard data.first == FrameKind.paired.rawValue else { return nil }
        return object(RemoteCrypto.openBox(pairKey, Data(data.dropFirst()), aad: AAD.paired))?["name"] as? String
    }
}

/// The phone's end of one connection: say hello, take the Mac's answer, then talk. Frames are
/// opened on the socket's own thread and sealed on the main one, so its state is behind a lock.
nonisolated final class PhoneSession: Sendable {
    private struct State {
        var pending: (id: String, eph: Curve25519.KeyAgreement.PrivateKey)?
        var channel: RemoteChannel?
    }

    private let pairKey: SymmetricKey
    private let state = Mutex(State())

    init(pairKey: SymmetricKey) { self.pairKey = pairKey }

    var ready: Bool { state.withLock { $0.channel != nil } }

    func hello() throws -> Data {
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let id = Data((0..<8).map { _ in UInt8.random(in: 0...255) }).base64url
        state.withLock {
            $0.pending = (id, eph)
            $0.channel = nil
        }
        let body = json(["v": protocolVersion, "id": id, "eph": eph.publicKey.rawRepresentation.base64url])
        return frame(.hello, try RemoteCrypto.sealBox(pairKey, body, aad: AAD.helloPhone))
    }

    enum Answer: Equatable {
        /// The Mac answered our latest hello: the session is up.
        case live
        /// The Mac doesn't speak this app's version; this says which side to update.
        case otherVersion(String)
        /// Not an answer to our latest hello.
        case ignored
    }

    func onHello(_ data: Data) -> Answer {
        guard let hello = Wire.readMacHello(data, pairKey: pairKey) else { return .ignored }
        return state.withLock { s in
            guard let pending = s.pending, hello.id == pending.id else { return .ignored }
            guard let macEph = hello.eph else {
                s.pending = nil
                return .otherVersion(Versions.advice(macNewest: hello.v, macOldest: hello.oldest))
            }
            guard
                let keys = try? RemoteCrypto.sessionKeys(
                    ownEph: pending.eph, otherEph: macEph, pairKey: pairKey, macEph: macEph,
                    phoneEph: pending.eph.publicKey.rawRepresentation)
            else { return .ignored }
            s.channel = RemoteChannel(send: keys.phoneToMac, receive: keys.macToPhone)
            s.pending = nil
            return .live
        }
    }

    /// A message for the Mac, already JSON; nil until the session is up.
    func seal(_ message: Data) -> Data? {
        state.withLock { s in
            guard let channel = s.channel, let box = try? channel.seal(message) else { return nil }
            return frame(.data, box)
        }
    }

    /// The JSON of a message from the Mac, or nil when it doesn't open (the session is then over).
    func open(_ data: Data) -> Data? {
        guard data.first == FrameKind.data.rawValue else { return nil }
        return state.withLock { s in
            guard let channel = s.channel else { return nil }
            guard let out = channel.open(Data(data.dropFirst())) else {
                s.channel = nil
                return nil
            }
            return out
        }
    }

    func end() {
        state.withLock {
            $0.channel = nil
            $0.pending = nil
        }
    }
}
