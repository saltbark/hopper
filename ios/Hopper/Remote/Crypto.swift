import CryptoKit
import Foundation

// The phone's half of the crypto in src/remote/crypto.ts: X25519 keys, a pairing key for life,
// fresh keys per connection, ChaCha20-Poly1305 frames. test/fixtures/remote-vectors.json holds
// the bytes both must produce; ios/scripts/check-vectors.swift runs this file against them.

nonisolated enum RemoteCrypto {
    static let pairInfo = Data("hopper pair v1".utf8)
    static let sessionInfo = Data("hopper session v1".utf8)
    static let proofLabel = Data("hopper pair v1".utf8)

    static func privateKey(_ raw: Data) throws -> Curve25519.KeyAgreement.PrivateKey {
        try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
    }

    static func shared(_ own: Curve25519.KeyAgreement.PrivateKey, _ other: Data) throws -> SharedSecret {
        try own.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: other))
    }

    /// The key a pairing keeps for life; the Mac computes the same from its side.
    static func pairingKey(own: Curve25519.KeyAgreement.PrivateKey, other: Data, room: Data) throws -> SymmetricKey {
        try shared(own, other).hkdfDerivedSymmetricKey(
            using: SHA256.self, salt: room, sharedInfo: pairInfo, outputByteCount: 32)
    }

    /// Shows the Mac that this phone saw its QR code.
    static func pairProof(secret: Data, room: Data, phonePublic: Data) -> Data {
        var m = HMAC<SHA256>(key: SymmetricKey(data: secret))
        m.update(data: proofLabel)
        m.update(data: room)
        m.update(data: phonePublic)
        return Data(m.finalize())
    }

    /// One connection's keys: Mac to phone, then phone to Mac.
    static func sessionKeys(
        ownEph: Curve25519.KeyAgreement.PrivateKey, otherEph: Data, pairKey: SymmetricKey,
        macEph: Data, phoneEph: Data
    ) throws -> (macToPhone: SymmetricKey, phoneToMac: SymmetricKey) {
        let out = try shared(ownEph, otherEph).hkdfDerivedSymmetricKey(
            using: SHA256.self, salt: pairKey.data, sharedInfo: sessionInfo + macEph + phoneEph,
            outputByteCount: 64)
        let bytes = out.data
        return (SymmetricKey(data: bytes.prefix(32)), SymmetricKey(data: bytes.suffix(32)))
    }

    /// Nonce, ciphertext, tag: for the few messages under the pairing key.
    static func sealBox(_ key: SymmetricKey, _ plaintext: Data, aad: Data, nonce: ChaChaPoly.Nonce = .init()) throws -> Data {
        try ChaChaPoly.seal(plaintext, using: key, nonce: nonce, authenticating: aad).combined
    }

    static func openBox(_ key: SymmetricKey, _ box: Data, aad: Data) -> Data? {
        guard box.count >= 28, let sealed = try? ChaChaPoly.SealedBox(combined: box) else { return nil }
        return try? ChaChaPoly.open(sealed, using: key, authenticating: aad)
    }

    /// Four zero bytes, then the count, big-endian.
    static func counterNonce(_ n: UInt64) -> ChaChaPoly.Nonce {
        var bytes = Data(count: 4)
        withUnsafeBytes(of: n.bigEndian) { bytes.append(contentsOf: $0) }
        return try! ChaChaPoly.Nonce(data: bytes)
    }
}

/// One direction of a connection; each side counts, so frames carry no nonce.
nonisolated final class RemoteChannel {
    private let sendKey: SymmetricKey
    private let receiveKey: SymmetricKey
    private var sent: UInt64 = 0
    private var received: UInt64 = 0

    init(send: SymmetricKey, receive: SymmetricKey) {
        sendKey = send
        receiveKey = receive
    }

    func seal(_ plaintext: Data) throws -> Data {
        let box = try ChaChaPoly.seal(plaintext, using: sendKey, nonce: RemoteCrypto.counterNonce(sent))
        sent += 1
        return box.ciphertext + box.tag
    }

    func open(_ frame: Data) -> Data? {
        guard frame.count >= 16,
            let box = try? ChaChaPoly.SealedBox(
                nonce: RemoteCrypto.counterNonce(received), ciphertext: frame.dropLast(16), tag: frame.suffix(16)),
            let out = try? ChaChaPoly.open(box, using: receiveKey)
        else { return nil }
        received += 1
        return out
    }
}

nonisolated extension SymmetricKey {
    var data: Data { withUnsafeBytes { Data($0) } }
}

nonisolated extension Data {
    init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var out = Data(capacity: hex.count / 2)
        var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
            out.append(b)
            i = j
        }
        self = out
    }

    var hex: String { map { String(format: "%02x", $0) }.joined() }

    init?(base64url s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }

    var base64url: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
