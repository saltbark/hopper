import CryptoKit
import Foundation
import Network
import Observation
import SwiftUI
import UIKit

/// The app's state: whether it's paired, whether the Mac is there, and the Mac's latest snapshot.
/// The Mac is the ground truth; this only shows what it last said, and how long ago. What the
/// phone asks of it shows at once and is put back if the Mac says no.
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
        /// The relay turned this pairing's room away (another token holds it): pair again.
        case refused
        /// The Mac speaks other protocol versions; says which side to update.
        case otherVersion(String)
    }

    enum PairStep: Equatable {
        case idle, connecting, waitingForMac, failed(String)
    }

    private(set) var pairing: Pairing?
    /// Why this phone has to pair again, said on the pairing screen.
    private(set) var pairAgain: String?
    private(set) var link: Link = .connecting {
        didSet { if link != oldValue { linkChanged() } }
    }
    /// The link as the headers show it: a moment's gap, such as coming back from the background,
    /// doesn't flash "connecting".
    private(set) var shownLink: Link = .live
    private(set) var snapshot: PhoneSnapshot?
    private(set) var heardAt: Date?
    var pairStep: PairStep = .idle

    // Worked out once per snapshot (and per move), not in every view's body.
    private(set) var sections: [WorkSection] = []
    private(set) var items: [PhoneItem] = []
    private(set) var archived: [PhoneItem] = []
    private(set) var routines: [PhoneItem] = []
    private(set) var waitingCount = 0
    private var byID: [String: PhoneItem] = [:]

    /// The conversation open on the phone, if any, and the width it was asked for.
    private(set) var screen: Screen?
    private var screenCols = 0

    private var connection: Connection?
    private var generation = 0
    private var peerUp = false
    /// In the foreground, so it should be connected.
    private var wanted = false
    private var retry = 0.5
    private var retryTask: Task<Void, Never>?
    private var shownTask: Task<Void, Never>?
    private let paths = NWPathMonitor()

    init() {
        let kept = Keychain.load()
        if let kept, kept.token == nil {
            // Paired before room tokens: the relay turns that room away now, so it's let go.
            Keychain.clear()
            Saved.clear()
            pairAgain = "This phone was paired with an earlier version. Run hopper pair on your Mac and scan the new code."
        } else {
            pairing = kept
        }
        loadSaved()
        paths.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.networkCameBack() }
        }
        paths.start(queue: .global(qos: .utility))
        #if DEBUG
            // For the simulator, which has no camera (ios/scripts/sim.sh): pair from a link at launch.
            let env = ProcessInfo.processInfo.environment
            if let link = env["HOPPER_PAIR_LINK"] {
                if env["HOPPER_UNPAIR"] != nil { Keychain.clear(); pairing = nil; snapshot = nil; Saved.clear() }
                if pairing == nil { Task { self.pair(link: link, name: "Simulator") } }
            }
        #endif
    }

    // MARK: Pairing

    private var pairSocket: RelaySocket?

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
        guard let socket = RelaySocket(relay: offer.relay, room: offer.room.base64url, token: offer.token) else {
            pairStep = .failed("That code names a relay that can't be reached.")
            return
        }
        pairSocket?.close()
        pairSocket = socket
        pairStep = .connecting
        socket.open()
        Task {
            for await event in socket.events {
                switch event {
                case .up:
                    pairStep = .waitingForMac
                    socket.send(request.frame)
                case .data(let data):
                    guard let macName = Wire.pairedReply(data, pairKey: request.pairKey) else { continue }
                    let p = Pairing(
                        relay: offer.relay, room: offer.room, token: offer.token, macPublic: offer.macPublic,
                        macName: macName, phonePrivate: phone.rawRepresentation)
                    socket.close()
                    pairSocket = nil
                    do { try Keychain.save(p) } catch {
                        pairStep = .failed("Couldn't keep the pairing in the Keychain.")
                        return
                    }
                    withAnimation(.smooth) {
                        pairing = p
                        pairAgain = nil
                        pairStep = .idle
                    }
                    start()
                    return
                case .closed(let code):
                    if pairing == nil {
                        pairStep = .failed(
                            code == RelaySocket.refused
                                ? "The relay turned that code away. Make a new code on the Mac and scan again."
                                : "Lost the relay. Make a new code on the Mac and scan again.")
                    }
                    return
                case .reachable, .down:
                    break
                }
            }
        }
    }

    func unpair() {
        stop()
        Keychain.clear()
        // After stop's write of the unsent text, on the same queue, so nothing is left behind.
        Saved.clear()
        unsent = [:]
        withAnimation(.smooth) {
            pairing = nil
            snapshot = nil
            heardAt = nil
            pairStep = .idle
            recompute()
        }
    }

    // MARK: The connection

    /// On screen: connect, and keep trying until it's there.
    func start() {
        wanted = true
        retry = 0.5
        loadSaved()
        connect()
    }

    /// Off screen: the Mac sends nothing to a phone in a pocket.
    func stop() {
        wanted = false
        retryTask?.cancel()
        disconnect()
        flushUnsent()
    }

    /// Tried again now, not after the wait (the status chip, a network that came back).
    func reconnectNow() {
        guard wanted, pairing != nil, link != .live else { return }
        retry = 0.5
        disconnect()
        connect()
    }

    private func networkCameBack() {
        if link == .offline { reconnectNow() }
    }

    private func connect() {
        guard wanted, connection == nil, let pairing, let c = Connection(pairing: pairing) else { return }
        retryTask?.cancel()
        generation += 1
        let mine = generation
        connection = c
        peerUp = false
        // Not live until the hello is answered, so what's asked meanwhile waits for it. The
        // headers only say so if it takes a while.
        link = .connecting
        c.run { [weak self] event in
            guard let self, self.generation == mine else { return }
            self.handle(event)
        }
    }

    private func disconnect() {
        generation += 1
        connection?.close()
        connection = nil
        peerUp = false
        failAnswers()
    }

    private func handle(_ event: Inbound) {
        switch event {
        case .reachable:
            retry = 0.5
            // The relay says at once when the Mac is there too; nothing said means it isn't.
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                if !self.peerUp, self.link == .connecting, self.connection != nil { self.link = .macAway }
            }
        case .peerUp:
            peerUp = true
            if link != .live { link = .connecting }
        case .live:
            retry = 0.5
            link = .live
            heardAt = .now
            // A new session: the Mac's attach for the phone went with the old one.
            if let screen { connection?.send(["t": "open", "id": screen.id, "cols": screenCols]) }
        case .peerDown:
            peerUp = false
            link = .macAway
            failAnswers()
        case .snapshot(let s, let raw):
            heardAt = .now
            if s != snapshot {
                withAnimation(.snappy(duration: 0.32)) {
                    snapshot = s
                    settle()
                    recompute()
                }
                Saved.snapshot(raw)
            }
        case .screen(let state):
            heardAt = .now
            if let screen, screen.id == state.id { screen.show(state) }
        case .screenClosed(let id, let why):
            if let screen, screen.id == id { screen.closed = why }
        case .answer(let ref, let json):
            heardAt = .now
            answers.removeValue(forKey: ref)?.resume(returning: json)
        case .otherVersion(let advice):
            // Saying hello again would get the same answer: it waits for an update, or a tap.
            failAnswers()
            link = .otherVersion(advice)
        case .lost(let code):
            connection = nil
            peerUp = false
            failAnswers()
            // Another token holds the room: every try would be turned away, and each is billed.
            if code == RelaySocket.refused {
                link = .refused
                return
            }
            link = .offline
            scheduleRetry()
        }
    }

    private func scheduleRetry() {
        guard wanted else { return }
        let wait = retry * Double.random(in: 0.8...1.2)
        retry = min(15, retry * 2)
        retryTask?.cancel()
        retryTask = Task {
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            self.connect()
        }
    }

    private func linkChanged() {
        shownTask?.cancel()
        // Bad news waits a moment, in case it's over by then; good news and a change between two
        // kinds of bad show at once. With nothing to show yet, the waiting screen says it all.
        if link == .live || shownLink != .live || snapshot == nil {
            withAnimation(.snappy) { shownLink = link }
            return
        }
        shownTask = Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy) { self.shownLink = self.link }
        }
    }

    // MARK: What the lists show

    struct WorkSection: Identifiable, Equatable {
        var id: WorkGroup { group }
        let group: WorkGroup
        let items: [PhoneItem]
    }

    func item(_ id: String) -> PhoneItem? { byID[id] }

    private func recompute() {
        guard let snap = snapshot else {
            (sections, items, archived, routines, waitingCount, byID) = ([], [], [], [], 0, [:])
            return
        }
        var items = snap.items
        var archived = snap.archived ?? []
        for (id, move) in moves {
            switch move.to {
            case .archived:
                if let i = items.firstIndex(where: { $0.id == id }) {
                    archived.insert(items.remove(at: i).moved(to: "archived"), at: 0)
                }
            case .back:
                if let i = archived.firstIndex(where: { $0.id == id }) {
                    items.append(archived.remove(at: i).moved(to: WorkGroup.waiting.rawValue))
                }
            case .group(let g):
                if let i = items.firstIndex(where: { $0.id == id }) { items[i] = items[i].moved(to: g.rawValue) }
            case .gone:
                items.removeAll { $0.id == id }
            }
        }
        var grouped: [WorkGroup: [PhoneItem]] = [:]
        for item in items where item.kind != "routine" {
            if let g = item.workGroup { grouped[g, default: []].append(item) }
        }
        sections = WorkGroup.allCases.compactMap { g in grouped[g].map { WorkSection(group: g, items: $0) } }
        self.items = items
        self.archived = archived
        routines = items.filter { $0.kind == "routine" }
        waitingCount = grouped[.waiting]?.count ?? 0
        byID = Dictionary((items + archived).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    // MARK: Asking the Mac to do things

    /// What the Mac said about the last thing asked of it, for a moment on screen, with a way to
    /// take it back when there is one.
    struct Toast: Identifiable {
        let id = UUID()
        let text: String
        let ok: Bool
        var undo: (() -> Void)?
    }

    private(set) var toast: Toast?
    private var answers: [Int: CheckedContinuation<Data?, Never>] = [:]
    private var nextRef = 1

    /// Waits a moment for the Mac when it's on its way (the app just came back to the screen).
    private func untilLive(_ limit: Duration = .seconds(5)) async -> Bool {
        let deadline = ContinuousClock.now + limit
        while link != .live {
            if pairing == nil || !wanted || ContinuousClock.now >= deadline { return false }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return true
    }

    /// Sends an action with a fresh `ref` and waits for the Mac's answer to it (nil when it
    /// doesn't come: no Mac, the line dropped, or no answer in 20 seconds).
    private func ask(_ message: [String: Any]) async -> Data? {
        guard await untilLive(), let connection else { return nil }
        let ref = nextRef
        nextRef += 1
        var m = message
        m["ref"] = ref
        return await withCheckedContinuation { c in
            answers[ref] = c
            guard connection.send(m) else {
                answers.removeValue(forKey: ref)?.resume(returning: nil)
                return
            }
            Task {
                try? await Task.sleep(for: .seconds(20))
                self.answers.removeValue(forKey: ref)?.resume(returning: nil)
            }
        }
    }

    private func failAnswers() {
        let waiting = answers
        answers = [:]
        for c in waiting.values { c.resume(returning: nil) }
    }

    struct Result: Decodable {
        let ok: Bool
        let text: String
    }

    /// Does an action and shows how it went; true when it worked.
    @discardableResult
    func perform(_ message: [String: Any], undo: (() -> Void)? = nil) async -> Bool {
        guard let data = await ask(message), let r = try? JSONDecoder().decode(Result.self, from: data) else {
            show(Toast(text: link == .live ? "The Mac didn't answer." : "The Mac isn't connected.", ok: false))
            return false
        }
        show(Toast(text: r.text, ok: r.ok, undo: r.ok ? undo : nil))
        return r.ok
    }

    func show(_ t: Toast) {
        withAnimation(.spring(duration: 0.4, bounce: 0.2)) { toast = t }
        Task {
            try? await Task.sleep(for: .seconds(t.undo != nil ? 4 : t.ok ? 2.2 : 4.5))
            if self.toast?.id == t.id { self.dismissToast() }
        }
    }

    func dismissToast() {
        withAnimation(.spring(duration: 0.35, bounce: 0)) { toast = nil }
    }

    // MARK: Moves shown before the Mac confirms them

    private struct Move {
        enum To { case archived, back, group(WorkGroup), gone }
        let to: To
        /// The Mac said yes: it goes with the next snapshot, which shows the same.
        var settled = false
    }

    private var moves: [String: Move] = [:]

    /// Moves an item on screen at once, asks the Mac, and puts it back if the Mac says no.
    @discardableResult
    private func move(_ id: String, _ to: Move.To, _ message: [String: Any], undo: (() -> Void)? = nil) async -> Bool {
        withAnimation(.snappy(duration: 0.32)) {
            moves[id] = Move(to: to)
            recompute()
        }
        let ok = await perform(message, undo: undo)
        withAnimation(.snappy(duration: 0.32)) {
            if ok { moves[id]?.settled = true } else { moves[id] = nil }
            recompute()
        }
        // In case no snapshot follows (the Mac sent it before its answer).
        if ok {
            Task {
                try? await Task.sleep(for: .seconds(3))
                if self.moves[id]?.settled == true {
                    withAnimation(.snappy) {
                        self.moves[id] = nil
                        self.recompute()
                    }
                }
            }
        }
        return ok
    }

    private func settle() {
        moves = moves.filter { !$0.value.settled }
    }

    func hold(_ item: PhoneItem) async {
        let toHeld = item.workGroup == .waiting
        await move(item.id, .group(toHeld ? .held : .waiting), ["t": "hold", "id": item.id]) { [weak self] in
            guard let self, let now = self.item(item.id) else { return }
            Task { await self.hold(now) }
        }
    }

    func archive(_ item: PhoneItem) async {
        await move(item.id, .archived, ["t": "done", "id": item.id]) { [weak self] in
            guard let self, let now = self.item(item.id) else { return }
            Task { await self.unarchive(now) }
        }
    }

    func unarchive(_ item: PhoneItem) async {
        await move(item.id, .back, ["t": "done", "id": item.id, "undo": true])
    }

    func routine(_ id: String, _ action: String) async { await perform(["t": "routine", "id": id, "do": action]) }

    /// Saves, starts or queues a draft (new, or the one `message["id"]` names). Started or queued,
    /// it leaves the drafts at once.
    func send(draft message: [String: Any]) async -> Bool {
        guard let id = message["id"] as? String, message["draft"] as? Bool != true else { return await perform(message) }
        let queue = message["queue"] as? String
        let to: Move.To = queue == nil ? .gone : .group(.next)
        return await move(id, to, message)
    }

    func discard(_ item: PhoneItem) async -> Bool {
        await move(item.id, .gone, ["t": "discard", "id": item.id])
    }

    // MARK: Answers kept for next time

    /// What the Mac last said about these, shown at once next time while a fresh answer comes.
    private(set) var newInfos: [String: NewInfo] = [:]
    private(set) var routineInfos: [String: RoutineInfo] = [:]
    private(set) var reports: [String: ReportText] = [:]

    /// What a new conversation in this project would start with.
    @discardableResult
    func newInfo(_ project: String) async -> NewInfo? {
        guard let data = await ask(["t": "new", "project": project]),
            let info = try? JSONDecoder().decode(NewInfo.self, from: data)
        else { return newInfos[project] }
        if newInfos[project] != info { newInfos[project] = info }
        return info
    }

    /// A routine's prompt, schedule and reports.
    @discardableResult
    func routineInfo(_ id: String) async -> RoutineInfo? {
        guard let data = await ask(["t": "routineinfo", "id": id]),
            let info = try? JSONDecoder().decode(RoutineInfo.self, from: data)
        else { return routineInfos[id] }
        if routineInfos[id] != info { withAnimation(.snappy) { routineInfos[id] = info } }
        return info
    }

    static func reportKey(_ routine: String, _ file: String) -> String { routine + "/" + file }

    /// One of a routine's reports, as markdown. Reading it marks it read, as on the Mac.
    @discardableResult
    func report(_ routine: String, _ file: String) async -> ReportText? {
        let key = Self.reportKey(routine, file)
        guard let data = await ask(["t": "report", "id": routine, "file": file]),
            let text = try? JSONDecoder().decode(ReportText.self, from: data)
        else { return reports[key] }
        if reports[key] != text { reports[key] = text }
        return text
    }

    // MARK: The new conversation

    /// The New tab shows a fresh form while this is set; `project` is the one to start in, when it
    /// came from a project's page.
    struct NewRequest: Identifiable {
        let id = UUID()
        let project: String?
    }

    var newRequest: NewRequest?
    /// Whether the last new conversation was started, rather than saved, queued or let go:
    /// starting one goes to Work, the rest back to where you were.
    private(set) var newStarted = false

    func newConversation(in project: String? = nil) { newRequest = NewRequest(project: project) }

    func closeNew(started: Bool) {
        newStarted = started
        newRequest = nil
    }

    // MARK: The open conversation

    /// Only the width is the phone's: the Mac draws the conversation into a screen far taller than
    /// this one, and it scrolls here.
    func open(_ id: String, cols: Int) {
        if screen?.id != id { screen = Screen(id: id) }
        screenCols = cols
        connection?.send(["t": "open", "id": id, "cols": cols])
    }

    func closeScreen() {
        guard let screen else { return }
        connection?.send(["t": "close", "id": screen.id])
        self.screen = nil
        flushUnsent()
    }

    func resizeScreen(cols: Int) {
        guard let screen, cols != screenCols else { return }
        screenCols = cols
        connection?.send(["t": "resize", "id": screen.id, "cols": cols])
    }

    /// The conversation is drawn for the Mac's panel: draw it for the phone again.
    func reclaimScreen() { toScreen(["t": "reclaim"]) }

    /// Sends what was typed: the Mac pastes it, then presses Enter a moment later, so Claude takes
    /// it as sent rather than as a new line. Nothing typed is just Enter.
    func submit(_ text: String) { toScreen(["t": "submit", "text": text]) }

    /// Bytes for Claude, as a terminal would send them.
    func keys(_ data: String) { toScreen(["t": "keys", "data": data]) }

    /// Text in one go: Claude takes it as a paste, not as typing.
    func paste(_ text: String) { toScreen(["t": "paste", "text": text]) }

    func wheel(up: Bool) { toScreen(["t": "wheel", "up": up]) }

    private func toScreen(_ message: [String: Any]) {
        guard let screen, let connection else { return }
        var m = message
        m["id"] = screen.id
        connection.send(m)
    }

    // MARK: Unsent text

    /// What's typed in each conversation and not yet sent, so it's there when you come back, even
    /// after the app was quit.
    @ObservationIgnored private var unsent: [String: String] = [:]
    /// Whether `unsent` holds what's on the phone. Until it does (the file couldn't be read while
    /// the phone was locked), nothing is written over it.
    @ObservationIgnored private var unsentRead = false

    func unsentText(_ id: String) -> String { unsent[id] ?? "" }

    func setUnsent(_ id: String, _ text: String) {
        unsent[id] = text.isEmpty ? nil : text
    }

    // MARK: Kept on the phone

    /// Reads what was kept, if it hasn't been read yet. The files are protected while the phone is
    /// locked, and the system may start the app before it's unlocked, so this runs again when the
    /// app comes to the front.
    private func loadSaved() {
        guard pairing != nil else { return }
        if !unsentRead, let kept = Saved.unsent() {
            // Typed while the file was still unread: that's newer.
            unsent = kept.merging(unsent) { _, typed in typed }
            unsentRead = true
        }
        guard snapshot == nil, let (snap, at) = Saved.lastSnapshot() else { return }
        snapshot = snap
        heardAt = at
        recompute()
    }

    private func flushUnsent() {
        if unsentRead { Saved.flushUnsent(unsent) }
    }
}

/// The last snapshot and the unsent text, kept on the phone so the app opens on what it last
/// showed rather than on an empty screen while it connects. Both are readable only while the
/// phone is unlocked (complete file protection), sit in Caches (not backed up), and go when the
/// phone unpairs.
private enum Saved {
    private static var snapshotFile: URL { URL.cachesDirectory.appending(path: "snapshot.json") }
    private static var unsentFile: URL { URL.cachesDirectory.appending(path: "unsent.json") }

    /// Writes and removals in order, off the main thread: an unpair can't be undone by a write
    /// still on its way.
    private static let writes = DispatchQueue(label: "hopper.saved", qos: .utility)

    static func lastSnapshot() -> (PhoneSnapshot, Date)? {
        guard let data = try? Data(contentsOf: snapshotFile),
            let snap = try? JSONDecoder().decode(PhoneSnapshot.self, from: data)
        else { return nil }
        let at =
            (try? snapshotFile.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
        return (snap, at)
    }

    static func snapshot(_ raw: Data) {
        let file = snapshotFile
        writes.async { try? raw.write(to: file, options: [.atomic, .completeFileProtection]) }
    }

    /// What's unsent, or nil when the file is there but can't be read yet (the phone is locked).
    static func unsent() -> [String: String]? {
        // Kept in UserDefaults before 2026-11-09, which isn't protected: moved once, then gone.
        let defaults = UserDefaults.standard
        if let old = defaults.dictionary(forKey: "unsent") as? [String: String] {
            defaults.removeObject(forKey: "unsent")
            flushUnsent(old)
            return old
        }
        let file = unsentFile
        guard FileManager.default.fileExists(atPath: file.path()) else { return [:] }
        guard let data = try? Data(contentsOf: file) else { return nil }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    static func flushUnsent(_ u: [String: String]) {
        let file = unsentFile
        writes.async {
            if u.isEmpty {
                try? FileManager.default.removeItem(at: file)
            } else if let data = try? JSONEncoder().encode(u) {
                try? data.write(to: file, options: [.atomic, .completeFileProtection])
            }
        }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: "unsent")
        let files = [snapshotFile, unsentFile]
        writes.async { for f in files { try? FileManager.default.removeItem(at: f) } }
    }
}
