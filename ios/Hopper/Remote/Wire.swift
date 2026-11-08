import CryptoKit
import Foundation

// The phone's half of src/remote/wire.ts. Binary frames, the first byte saying which kind; the
// relay's own messages are text. A change to either side's framing changes both.

enum FrameKind: UInt8 {
    case pair = 1, paired = 2, hello = 3, data = 4
}

enum WireError: LocalizedError {
    case notAPairingLink, otherVersion, badField(String)

    var errorDescription: String? {
        switch self {
        case .notAPairingLink: "That isn't a Hopper pairing code."
        case .otherVersion: "That code is from another version of Hopper. Update both."
        case .badField(let f): "The pairing code is damaged (\(f))."
        }
    }
}

let protocolVersion = 1

private enum AAD {
    static let pair = Data("hopper pair request v1".utf8)
    static let paired = Data("hopper paired v1".utf8)
    static let helloPhone = Data("hopper hello v1 phone".utf8)
    static let helloMac = Data("hopper hello v1 mac".utf8)
}

/// What the Mac's QR code carries.
struct Offer {
    let relay: String
    let room: Data
    let macPublic: Data
    let secret: Data
    let name: String

    init(link: String) throws {
        guard let u = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
            u.scheme == "hopper", u.host == "pair"
        else { throw WireError.notAPairingLink }
        var q: [String: String] = [:]
        for item in u.queryItems ?? [] { q[item.name] = item.value }
        guard q["v"] == String(protocolVersion) else { throw WireError.otherVersion }
        func bytes(_ k: String, _ n: Int) throws -> Data {
            guard let d = Data(base64url: q[k] ?? ""), d.count == n else { throw WireError.badField(k) }
            return d
        }
        guard let r = q["r"], r.hasPrefix("ws") else { throw WireError.badField("r") }
        relay = r
        room = try bytes("room", 16)
        macPublic = try bytes("k", 32)
        secret = try bytes("s", 32)
        name = q["n"] ?? "Mac"
    }
}

private func frame(_ kind: FrameKind, _ body: Data) -> Data { Data([kind.rawValue]) + body }

private func json(_ v: [String: Any]) -> Data { (try? JSONSerialization.data(withJSONObject: v)) ?? Data() }

private func object(_ d: Data?) -> [String: Any]? {
    guard let d else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}

enum Wire {
    /// The request to pair: this phone's key, proof it saw the code, its name sealed.
    static func pairRequest(offer: Offer, phone: Curve25519.KeyAgreement.PrivateKey, name: String) throws -> (frame: Data, pairKey: SymmetricKey) {
        let key = try RemoteCrypto.pairingKey(own: phone, other: offer.macPublic, room: offer.room)
        let pub = phone.publicKey.rawRepresentation
        let proof = RemoteCrypto.pairProof(secret: offer.secret, room: offer.room, phonePublic: pub)
        let box = try RemoteCrypto.sealBox(key, json(["v": protocolVersion, "name": name]), aad: AAD.pair)
        return (frame(.pair, pub + proof + box), key)
    }

    /// The Mac's answer once it let this phone in: its name.
    static func pairedReply(_ data: Data, pairKey: SymmetricKey) -> String? {
        guard data.first == FrameKind.paired.rawValue else { return nil }
        return object(RemoteCrypto.openBox(pairKey, Data(data.dropFirst()), aad: AAD.paired))?["name"] as? String
    }
}

/// The phone's end of one connection: say hello, take the Mac's answer, then talk.
final class PhoneSession {
    private let pairKey: SymmetricKey
    private var pending: (id: String, eph: Curve25519.KeyAgreement.PrivateKey)?
    private var channel: RemoteChannel?

    init(pairKey: SymmetricKey) { self.pairKey = pairKey }

    var ready: Bool { channel != nil }

    func hello() throws -> Data {
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let id = Data((0..<8).map { _ in UInt8.random(in: 0...255) }).base64url
        pending = (id, eph)
        channel = nil
        let body = json(["v": protocolVersion, "id": id, "eph": eph.publicKey.rawRepresentation.base64url])
        return frame(.hello, try RemoteCrypto.sealBox(pairKey, body, aad: AAD.helloPhone))
    }

    /// True when this was the Mac's answer to our latest hello and the session is up.
    func onHello(_ data: Data) -> Bool {
        guard data.first == FrameKind.hello.rawValue, let pending,
            let body = object(RemoteCrypto.openBox(pairKey, Data(data.dropFirst()), aad: AAD.helloMac)),
            body["id"] as? String == pending.id,
            let macEph = Data(base64url: body["eph"] as? String ?? ""), macEph.count == 32,
            let keys = try? RemoteCrypto.sessionKeys(
                ownEph: pending.eph, otherEph: macEph, pairKey: pairKey, macEph: macEph,
                phoneEph: pending.eph.publicKey.rawRepresentation)
        else { return false }
        channel = RemoteChannel(send: keys.phoneToMac, receive: keys.macToPhone)
        self.pending = nil
        return true
    }

    func seal(_ message: [String: Any]) throws -> Data? {
        guard let channel else { return nil }
        return frame(.data, try channel.seal(json(message)))
    }

    /// The JSON of a message from the Mac, or nil when it doesn't open (the session is then over).
    func open(_ data: Data) -> Data? {
        guard data.first == FrameKind.data.rawValue, let channel else { return nil }
        guard let out = channel.open(Data(data.dropFirst())) else {
            self.channel = nil
            return nil
        }
        return out
    }

    func end() {
        channel = nil
        pending = nil
    }
}
