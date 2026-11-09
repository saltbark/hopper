import CryptoKit
import Foundation
import Synchronization

/// One WebSocket to a room on the relay, as the phone. It hands up the relay's news (the Mac came
/// or went) and the binary frames as a stream, and knows nothing about what's in them. It pings
/// the relay so a connection that died quietly (a tunnel, a switch from Wi-Fi to cellular) is
/// found in seconds rather than when the next message fails.
nonisolated final class RelaySocket: Sendable {
    enum Event: Sendable {
        /// The relay answered: the socket is up.
        case reachable
        /// The Mac is on the relay too, or has left it.
        case up, down
        case data(Data)
        /// The socket is gone, with the relay's close code when it closed it (`refused` and the
        /// limits in relay/src/index.ts). Not sent after `close()`.
        case closed(code: Int?)
    }

    /// The relay's close codes.
    static let refused = 4001
    static let tooBig = 4009
    static let tooMany = 4029

    let events: AsyncStream<Event>
    private let task: URLSessionWebSocketTask
    private let yield: AsyncStream<Event>.Continuation

    /// How often to check the line, and how long an answer may take.
    static let pingEvery: Duration = .seconds(15)
    static let pingWithin: Duration = .seconds(8)

    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.waitsForConnectivity = false
        c.timeoutIntervalForRequest = 12
        return URLSession(configuration: c)
    }()

    init?(relay: String, room: String, token: Data, role: String = "phone") {
        guard let url = URL(string: "\(relay)/v1/room/\(room)?role=\(role)&token=\(token.base64url)") else { return nil }
        task = Self.session.webSocketTask(with: url)
        task.maximumMessageSize = 16 << 20
        (events, yield) = AsyncStream.makeStream(of: Event.self, bufferingPolicy: .unbounded)
    }

    func open() {
        task.resume()
        Task.detached(priority: .userInitiated) { [task, yield] in
            while true {
                do {
                    switch try await task.receive() {
                    case .string(let s):
                        if s.contains("\"up\"") { yield.yield(.up) } else if s.contains("\"down\"") { yield.yield(.down) }
                    case .data(let d):
                        yield.yield(.data(d))
                    @unknown default:
                        break
                    }
                } catch {
                    let code = task.closeCode.rawValue
                    yield.yield(.closed(code: code >= 4000 ? code : nil))
                    yield.finish()
                    return
                }
            }
        }
        Task.detached(priority: .utility) { [weak self] in
            // The first answer says the relay is there; after that, silence means the line is dead.
            var first = true
            while let self, self.task.state == .running || first {
                let ok = await self.ping(within: first ? .seconds(10) : Self.pingWithin)
                if !ok {
                    self.task.cancel(with: .abnormalClosure, reason: nil)
                    return
                }
                if first { self.yield.yield(.reachable) }
                first = false
                try? await Task.sleep(for: Self.pingEvery)
            }
        }
    }

    private func ping(within limit: Duration) async -> Bool {
        let once = Once()
        return await withCheckedContinuation { c in
            task.sendPing { error in if once.take() { c.resume(returning: error == nil) } }
            Task.detached {
                try? await Task.sleep(for: limit)
                if once.take() { c.resume(returning: false) }
            }
        }
    }

    func send(_ data: Data) {
        task.send(.data(data)) { _ in }
    }

    func close() {
        yield.finish()
        task.cancel(with: .goingAway, reason: nil)
    }
}

/// True the first time it's asked, false after.
private nonisolated final class Once: Sendable {
    private let done = Atomic(false)
    func take() -> Bool { !done.exchange(true, ordering: .acquiringAndReleasing) }
}

/// What the app hears from the Mac, already opened and decoded, off the main thread.
nonisolated enum Inbound: Sendable {
    /// The relay is reachable; nothing yet about the Mac.
    case reachable
    /// The Mac is on the relay; the hello is out.
    case peerUp
    /// Talking to the Mac: a new session.
    case live
    /// The Mac left the relay.
    case peerDown
    case snapshot(PhoneSnapshot, raw: Data)
    case screen(ScreenState)
    case screenClosed(id: String, why: String)
    /// The Mac's answer to something asked with this `ref`.
    case answer(ref: Int, Data)
    /// The Mac speaks other versions; what to update.
    case otherVersion(String)
    /// The socket is gone, with the relay's close code when it closed it.
    case lost(code: Int?)
}

/// A session with the Mac over one socket: hello, then sealed messages. Frames are opened and
/// decoded where they arrive, and only what's ready to show goes to the main thread, in order.
nonisolated final class Connection: Sendable {
    private let socket: RelaySocket
    private let session: PhoneSession
    /// When the phone last said anything to the Mac. The Mac stops sending to a phone it hasn't
    /// heard from in 75 seconds (LEASE_MS in bridge.ts), so a quiet phone says `keep`.
    private let lastSent = Mutex(ContinuousClock.now)
    private let keeper = Mutex<Task<Void, Never>?>(nil)
    static let keepAfter: Duration = .seconds(30)

    init?(pairing: Pairing) {
        guard let key = try? pairing.pairKey(), let token = pairing.token,
            let socket = RelaySocket(relay: pairing.relay, room: pairing.roomID, token: token)
        else { return nil }
        self.socket = socket
        session = PhoneSession(pairKey: key)
    }

    var ready: Bool { session.ready }

    func run(_ deliver: @escaping @MainActor @Sendable (Inbound) -> Void) {
        socket.open()
        let keep = Task.detached(priority: .utility) { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard let self else { return }
                guard self.session.ready else { continue }
                if ContinuousClock.now - self.lastSent.withLock({ $0 }) >= Self.keepAfter { self.send(["t": "keep"]) }
            }
        }
        keeper.withLock { $0 = keep }
        Task.detached(priority: .userInitiated) { [socket, session] in
            let screens = ScreenBuffer()
            let decoder = JSONDecoder()
            func hello() { if let h = try? session.hello() { socket.send(h) } }
            for await event in socket.events {
                switch event {
                case .reachable:
                    await deliver(.reachable)
                case .up:
                    hello()
                    await deliver(.peerUp)
                case .down:
                    session.end()
                    await deliver(.peerDown)
                case .closed(let code):
                    session.end()
                    await deliver(.lost(code: code))
                case .data(let data):
                    if data.first == FrameKind.hello.rawValue {
                        switch session.onHello(data) {
                        case .live: await deliver(.live)
                        case .otherVersion(let advice): await deliver(.otherVersion(advice))
                        case .ignored: break
                        }
                        continue
                    }
                    // A frame that doesn't open ends the session: start a new one.
                    guard let json = session.open(data) else { hello(); continue }
                    if let inbound = Self.decode(json, decoder, screens) { await deliver(inbound) }
                }
            }
        }
    }

    private struct Head: Decodable {
        let t: String
        let ref: Int?
        let id: String?
        let why: String?
    }

    private static func decode(_ json: Data, _ decoder: JSONDecoder, _ screens: ScreenBuffer) -> Inbound? {
        guard let head = try? decoder.decode(Head.self, from: json) else { return nil }
        switch head.t {
        case "snapshot":
            return (try? decoder.decode(PhoneSnapshot.self, from: json)).map { .snapshot($0, raw: json) }
        case "screen":
            return (try? decoder.decode(ScreenFrame.self, from: json)).map { .screen(screens.apply($0)) }
        case "closed":
            return head.id.map { .screenClosed(id: $0, why: head.why ?? "The conversation closed on the Mac.") }
        default:
            return head.ref.map { .answer(ref: $0, json) }
        }
    }

    /// Seals and sends a message; false when there's no session to send it in.
    @discardableResult
    func send(_ message: [String: Any]) -> Bool {
        guard let json = try? JSONSerialization.data(withJSONObject: message), let frame = session.seal(json) else { return false }
        socket.send(frame)
        lastSent.withLock { $0 = .now }
        return true
    }

    func close() {
        keeper.withLock { $0?.cancel() }
        session.end()
        socket.close()
    }
}
