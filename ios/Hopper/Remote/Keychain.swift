import CryptoKit
import Foundation
import Security

/// What this phone keeps about the Mac it paired with, in the Keychain, on this device only.
nonisolated struct Pairing: Codable, Sendable {
    let relay: String
    let room: Data
    /// The room's token. Pairings made before tokens (protocol 1) have none and must pair again:
    /// the relay turns away a room without one.
    var token: Data?
    let macPublic: Data
    let macName: String
    let phonePrivate: Data

    var roomID: String { room.base64url }

    func pairKey() throws -> SymmetricKey {
        try RemoteCrypto.pairingKey(own: RemoteCrypto.privateKey(phonePrivate), other: macPublic, room: room)
    }
}

enum Keychain {
    private static let service = "com.saltbark.hopper"
    private static let account = "pairing"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func load() -> Pairing? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }

    static func save(_ p: Pairing) throws {
        let data = try JSONEncoder().encode(p)
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
