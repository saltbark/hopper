import CryptoKit
import Foundation

// Runs the app's Crypto.swift and Wire.swift against the vectors the Mac's tests use, so the two
// sides can't drift apart. From the repo root:
//   swiftc -parse-as-library ios/Hopper/Remote/Crypto.swift ios/Hopper/Remote/Wire.swift ios/scripts/check-vectors.swift -o /tmp/check-vectors
//   /tmp/check-vectors test/fixtures/remote-vectors.json

@main
struct CheckVectors {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "test/fixtures/remote-vectors.json"
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        let i = (json["inputs"] as! [String: String]).mapValues { Data(hex: $0)! }
        let e = json["expect"] as! [String: String]
        var failed = 0
        func check(_ name: String, _ got: Data) {
            if got.hex == e[name] { print("ok   \(name)") } else {
                failed += 1
                print("FAIL \(name)\n  got  \(got.hex)\n  want \(e[name] ?? "-")")
            }
        }

        let mac = try RemoteCrypto.privateKey(i["macPrivate"]!)
        let phone = try RemoteCrypto.privateKey(i["phonePrivate"]!)
        let macEph = try RemoteCrypto.privateKey(i["macEphPrivate"]!)
        let phoneEph = try RemoteCrypto.privateKey(i["phoneEphPrivate"]!)
        check("macPublic", mac.publicKey.rawRepresentation)
        check("phonePublic", phone.publicKey.rawRepresentation)
        check("macEphPublic", macEph.publicKey.rawRepresentation)
        check("phoneEphPublic", phoneEph.publicKey.rawRepresentation)

        let pk = try RemoteCrypto.pairingKey(own: phone, other: mac.publicKey.rawRepresentation, room: i["room"]!)
        check("pairingKey", pk.data)
        check("proof", RemoteCrypto.pairProof(secret: i["secret"]!, room: i["room"]!, phonePublic: phone.publicKey.rawRepresentation))

        // The phone's side of the session keys must come out the same as the Mac's.
        let sk = try RemoteCrypto.sessionKeys(
            ownEph: phoneEph, otherEph: macEph.publicKey.rawRepresentation, pairKey: pk,
            macEph: macEph.publicKey.rawRepresentation, phoneEph: phoneEph.publicKey.rawRepresentation)
        check("macToPhone", sk.macToPhone.data)
        check("phoneToMac", sk.phoneToMac.data)

        let nonce = try ChaChaPoly.Nonce(data: i["nonce"]!)
        check("box", try RemoteCrypto.sealBox(pk, i["plaintext"]!, aad: i["aad"]!, nonce: nonce))
        let opened = RemoteCrypto.openBox(pk, Data(hex: e["box"]!)!, aad: i["aad"]!)
        if opened != i["plaintext"] { failed += 1; print("FAIL box doesn't open") } else { print("ok   box opens") }

        // Frames the Mac sealed open on the phone, in order.
        let rx = RemoteChannel(send: sk.phoneToMac, receive: sk.macToPhone)
        let f0 = rx.open(Data(hex: e["frame0"]!)!)
        let f1 = rx.open(Data(hex: e["frame1"]!)!)
        if f0 != i["plaintext"] || f1 != i["plaintext"] { failed += 1; print("FAIL frames don't open") } else { print("ok   frames open") }
        let tx = RemoteChannel(send: sk.macToPhone, receive: sk.phoneToMac)
        check("frame0", try tx.seal(i["plaintext"]!))
        check("nonce1", RemoteCrypto.counterNonce(1).withUnsafeBytes { Data($0) })

        // The Mac's pairing link reads back to the same parts, its name's spaces included.
        func expect(_ name: String, _ ok: Bool) {
            if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") }
        }
        let offer = try Offer(link: e["link"]!)
        expect(
            "link",
            offer.relay == "wss://relay.example" && offer.room == i["room"]! && offer.token == i["token"]!
                && offer.secret == i["secret"]! && offer.macPublic == mac.publicKey.rawRepresentation
                && offer.name == "Test Mac")
        // A Mac on other versions says so, and the phone knows which side to update.
        let answer = Wire.readMacHello(Data(hex: e["versionAnswer"]!)!, pairKey: pk)
        expect("version answer", answer == Wire.MacHello(v: 3, oldest: 3, id: "hello-1", eph: nil))
        expect("version advice", Versions.advice(macNewest: 3, macOldest: 3).contains("Update the app"))

        if failed > 0 { print("\(failed) failed"); exit(1) }
        print("all match")
    }
}
