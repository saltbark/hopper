import Foundation

/// A made-up Mac, for trying the app without one ("Try it without a Mac" on the pairing screen).
/// It plays back Hopper's demo world as the Mac's own code describes it (demo.json, written by
/// ios/scripts/demo-bundle.ts), with no relay: the lists, a project's open items, routines and
/// their reports, the accounts. It answers what the phone asks as the Mac would (hold, archive,
/// start, queue, save, throw away), moving items in its snapshot, and keeps a made-up conversation
/// going. Nothing leaves the phone.
final class DemoMac: MacLink {
    private var snapshot: [String: Any]
    private let bundle: [String: Any]
    private var deliver: (@MainActor @Sendable (Inbound) -> Void)?
    private var screen: DemoScreen?
    private let buffer = ScreenBuffer()
    private var ticker: Task<Void, Never>?
    private var closed = false
    private var made = 0

    init?() {
        guard let url = Bundle.main.url(forResource: "demo", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let at = (all["snapshot"] as? [String: Any])?["at"] as? Double
        else { return nil }
        // Written once, shown any day: every time in it moves up to now.
        let shifted = Self.shift(all, by: Date.now.timeIntervalSince1970 * 1000 - at) as? [String: Any] ?? all
        bundle = shifted
        snapshot = shifted["snapshot"] as? [String: Any] ?? [:]
    }

    func run(_ deliver: @escaping @MainActor @Sendable (Inbound) -> Void) {
        self.deliver = deliver
        Task {
            for event: Inbound in [.reachable, .peerUp, .live] {
                try? await Task.sleep(for: .milliseconds(120))
                guard !closed else { return }
                deliver(event)
            }
            sendSnapshot()
        }
    }

    @discardableResult
    func send(_ message: [String: Any]) -> Bool {
        guard !closed else { return false }
        // Answered a moment later, as a Mac would.
        nonisolated(unsafe) let m = message
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            if !closed { handle(m) }
        }
        return true
    }

    func close() {
        closed = true
        ticker?.cancel()
        deliver = nil
    }

    // MARK: What the phone asks

    private func handle(_ m: [String: Any]) {
        let ref = m["ref"] as? Int
        let id = m["id"] as? String ?? ""
        switch m["t"] as? String ?? "" {
        case "keep", "wheel": return
        case "open":
            let title = (items + archived).first { $0["id"] as? String == id }?["title"] as? String ?? ""
            screen = DemoScreen(id: id, title: title, cols: m["cols"] as? Int ?? 40)
            startTicking()
            draw()
        case "close":
            screen = nil
            ticker?.cancel()
        case "resize":
            screen?.cols = m["cols"] as? Int ?? screen?.cols ?? 40
            draw()
        case "reclaim": draw()
        case "submit": typed(m["text"] as? String ?? "", enter: true)
        case "paste": typed(m["text"] as? String ?? "", enter: false)
        case "keys": key(m["data"] as? String ?? "")
        case "new":
            let project = m["project"] as? String ?? ""
            answer(ref, newinfo(project) ?? ["t": "result", "ok": false, "text": "No project \(project)."])
        case "routineinfo":
            answer(ref, (bundle["routineinfo"] as? [String: Any])?[id] as? [String: Any] ?? result(false, "No such routine."))
        case "report":
            let key = "\(id)/\(m["file"] as? String ?? "")"
            answer(ref, (bundle["reports"] as? [String: Any])?[key] as? [String: Any] ?? result(false, "That report is gone."))
        case "hold": answer(ref, hold(id))
        case "done": answer(ref, m["undo"] as? Bool == true ? unarchive(id) : archive(id))
        case "discard": answer(ref, discard(id))
        case "start": answer(ref, start(m))
        case "routine": answer(ref, routine(id, m["do"] as? String ?? ""))
        default: answer(ref, result(false, "Not in the demo."))
        }
    }

    private func result(_ ok: Bool, _ text: String) -> [String: Any] { ["t": "result", "ok": ok, "text": text] }

    private func answer(_ ref: Int?, _ body: [String: Any]) {
        guard let ref else { return }
        var b = body
        b["ref"] = ref
        guard let data = try? JSONSerialization.data(withJSONObject: b) else { return }
        deliver?(.answer(ref: ref, data))
    }

    // MARK: The lists

    private var items: [[String: Any]] {
        get { snapshot["items"] as? [[String: Any]] ?? [] }
        set { snapshot["items"] = newValue }
    }

    private var archived: [[String: Any]] {
        get { snapshot["archived"] as? [[String: Any]] ?? [] }
        set { snapshot["archived"] = newValue }
    }

    private var now: Double { Date.now.timeIntervalSince1970 * 1000 }

    private func sendSnapshot() {
        snapshot["at"] = now
        guard let raw = try? JSONSerialization.data(withJSONObject: snapshot),
            let s = try? JSONDecoder().decode(PhoneSnapshot.self, from: raw)
        else { return }
        deliver?(.snapshot(s, raw: raw))
    }

    private func newinfo(_ project: String) -> [String: Any]? {
        (bundle["newinfo"] as? [String: Any])?[project] as? [String: Any]
    }

    private func hold(_ id: String) -> [String: Any] {
        guard let i = items.firstIndex(where: { $0["id"] as? String == id }) else { return result(false, "That conversation is gone.") }
        let title = items[i]["title"] as? String ?? ""
        switch items[i]["group"] as? String {
        case "waiting":
            items[i]["group"] = "held"
            sendSnapshot()
            return result(true, "On hold: \(title)")
        case "held":
            items[i]["group"] = "waiting"
            sendSnapshot()
            return result(true, "Back in waiting on you: \(title)")
        default:
            return result(false, "Only a conversation waiting on you goes on hold.")
        }
    }

    private func archive(_ id: String) -> [String: Any] {
        guard let i = items.firstIndex(where: { $0["id"] as? String == id }) else { return result(false, "That conversation is gone.") }
        var item = items.remove(at: i)
        item["group"] = "archived"
        archived.insert(item, at: 0)
        sendSnapshot()
        return result(true, "Archived: \(item["title"] as? String ?? "")")
    }

    private func unarchive(_ id: String) -> [String: Any] {
        guard let i = archived.firstIndex(where: { $0["id"] as? String == id }) else { return result(false, "That conversation is gone.") }
        var item = archived.remove(at: i)
        item["group"] = "waiting"
        item["activeAt"] = now
        items.append(item)
        sendSnapshot()
        return result(true, "Back in conversations: \(item["title"] as? String ?? "")")
    }

    private func discard(_ id: String) -> [String: Any] {
        guard let i = items.firstIndex(where: { $0["id"] as? String == id && $0["kind"] as? String == "draft" })
        else { return result(false, "That draft is gone already.") }
        items.remove(at: i)
        sendSnapshot()
        return result(true, "Thrown away.")
    }

    private func start(_ m: [String: Any]) -> [String: Any] {
        let text = (m["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return result(false, "Nothing to start: the prompt is empty.") }
        let project = m["project"] as? String ?? ""
        guard let info = newinfo(project) else { return result(false, "No project \(project).") }
        let title = String(text.split(separator: "\n", maxSplits: 1).first ?? "")
        let account = m["account"] as? String ?? info["route"] as? String ?? ""
        let defaults = info["defaults"] as? [String: Any] ?? [:]
        let was = (m["id"] as? String).flatMap { id in items.firstIndex { $0["id"] as? String == id } }
        var item: [String: Any] = [
            "kind": "draft", "title": title, "project": project, "account": account, "state": "draft",
            "activeAt": now, "text": text,
        ]
        for k in ["model", "effort", "worktree"] { if let v = m[k] { item[k] = v } }
        if m["draft"] as? Bool == true {
            item["id"] = was.flatMap { items[$0]["id"] } ?? newID("draft:demo-")
            item["group"] = "draft"
            if let q = m["queue"] as? String {
                item["group"] = "next"
                item["queue"] = q
            }
            if let was { items[was] = item } else { items.insert(item, at: 0) }
            sendSnapshot()
            return result(true, was == nil ? "Saved as a draft." : "Saved.")
        }
        if let was { items.remove(at: was) }
        if let queue = m["queue"] as? String {
            item["id"] = newID("draft:demo-")
            item["group"] = "next"
            item["queue"] = queue
            items.append(item)
            sendSnapshot()
            return result(true, queue == "now" ? "Queued: starts when an account has room." : "Queued for tonight.")
        }
        item = [
            "id": newID("demo-run-"), "kind": "background", "title": title, "project": project, "account": account,
            "group": "running", "state": "working", "activeAt": now, "attach": true,
            "model": m["model"] as? String ?? defaults["model"] as? String ?? "opus",
        ]
        items.insert(item, at: 0)
        sendSnapshot()
        return result(true, "Started on \(account): \(project) · \(title)")
    }

    private func routine(_ id: String, _ what: String) -> [String: Any] {
        guard let i = items.firstIndex(where: { $0["id"] as? String == id }) else { return result(false, "No such routine.") }
        let name = items[i]["title"] as? String ?? id
        switch what {
        case "resume", "pause":
            items[i]["state"] = what == "resume" ? "scheduled" : "paused"
            sendSnapshot()
            return result(true, what == "resume" ? "Resumed \(name)." : "Paused \(name).")
        case "run":
            return result(true, "Running \(name) on \(items[i]["account"] as? String ?? "bh").")
        default:
            return result(false, "Resume, pause or run.")
        }
    }

    private func newID(_ prefix: String) -> String {
        made += 1
        return "\(prefix)\(made)"
    }

    // MARK: The conversation

    private func startTicking() {
        ticker?.cancel()
        ticker = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if screen?.working == true { draw() }
            }
        }
    }

    private func draw() {
        guard let screen, let frame = screen.frame(),
            let data = try? JSONSerialization.data(withJSONObject: frame),
            let f = try? JSONDecoder().decode(ScreenFrame.self, from: data)
        else { return }
        deliver?(.screen(buffer.apply(f)))
    }

    private func typed(_ text: String, enter: Bool) {
        guard let screen else { return }
        screen.typed += text
        if enter { reply() } else { draw() }
    }

    private func key(_ data: String) {
        guard let screen else { return }
        switch data {
        case "\r": reply()
        case "1", "2" where screen.asking:
            screen.answer()
            draw()
            Task {
                try? await Task.sleep(for: .seconds(2.5))
                screen.finish()
                draw()
            }
        case "3" where screen.asking:
            screen.asking = false
            screen.say(.claude, "What should I do instead?")
            draw()
        case "\u{1b}", "\u{3}":
            screen.interrupt()
            draw()
        case "\u{7f}":
            screen.typed = String(screen.typed.dropLast())
            draw()
        default:
            if !data.hasPrefix("\u{1b}") {
                screen.typed += data
                draw()
            }
        }
    }

    private func reply() {
        guard let screen else { return }
        let said = screen.typed
        screen.typed = ""
        if !said.isEmpty { screen.say(.you, said, lead: "> ") }
        screen.asking = false
        screen.working = true
        draw()
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            screen.working = false
            screen.say(.claude, said.isEmpty ? "Carrying on." : "Got it: I'll do that next, and say when it's done.")
            draw()
        }
    }

    // MARK: Times

    private static let times: Set<String> = ["at", "activeAt", "nextAt", "usageAt"]

    private static func shift(_ v: Any, by ms: Double, key: String? = nil) -> Any {
        if let d = v as? [String: Any] {
            return Dictionary(uniqueKeysWithValues: d.map { ($0.key, shift($0.value, by: ms, key: $0.key)) })
        }
        if let a = v as? [Any] { return a.map { shift($0, by: ms) } }
        if let key, times.contains(key), let n = v as? Double { return n + ms }
        if key == "resetsAt", let s = v as? String, let date = ISO8601DateFormatter.withFraction.date(from: s) {
            return ISO8601DateFormatter.withFraction.string(from: date.addingTimeInterval(ms / 1000))
        }
        return v
    }
}

private extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// The made-up Claude behind every demo conversation: what it said, what it's doing, what's typed.
/// Drawn as the Mac draws Claude's screen, as rows of styled runs.
final class DemoScreen {
    enum Voice { case you, claude, tool, dim }

    let id: String
    var cols: Int
    var typed = ""
    var asking: Bool
    var working: Bool
    private var said: [[[Any]]] = []
    private var started = Date.now

    private static let colors: [Voice: String] = [
        .you: "#a7b0ab", .claude: "#e8a07a", .tool: "#7fcf8f", .dim: "#838d88",
    ]

    init(id: String, title: String, cols: Int) {
        self.id = id
        self.cols = cols
        let tiles = title.lowercased().contains("tiles")
        asking = tiles
        working = !tiles
        say(.you, title.isEmpty ? "Take a look at this." : title, lead: "> ")
        if tiles {
            say(.claude, "I'll look at how tiles are picked for the screen's scale. The retina path is in tiles/scale.ts.")
            tool("Read", "tiles/scale.ts", "Read 84 lines")
            tool("Update", "tiles/scale.ts", "Updated with 2 additions and 1 removal")
            said.append([["     41 ", "#838d88", "", 0], ["-  const z = Math.floor(zoom)", "#ec7a6f", "", 0]])
            said.append([["     41 ", "#838d88", "", 0], ["+  const z = Math.round(zoom + Math.log2(dpr))", "#7fcf8f", "", 0]])
            said.append([])
            say(.claude, "Tiles now come from one zoom level up on a 2x screen, so zoom 14 is sharp. Shall I run the visual tests?")
        } else {
            say(.claude, "I'll start by reading the code around it.")
            tool("Search", "\"\(title.split(separator: " ").prefix(2).joined(separator: " "))\"", "Found 6 files")
            say(.claude, "Found where it happens. Working on the change now.")
        }
    }

    func say(_ voice: Voice, _ text: String, lead: String = "⏺ ") {
        let color = Self.colors[voice] ?? "#c7cfca"
        for (i, line) in wrap(text, cols - 4).enumerated() {
            let first: [Any] = i == 0 ? [lead, color, "", 0] : ["  ", "", "", 0]
            said.append([first, [line, voice == .you ? color : "", "", 0]])
        }
        said.append([])
    }

    private func tool(_ name: String, _ arg: String, _ outcome: String) {
        said.append([["⏺ ", Self.colors[.tool]!, "", 0], [name, "", "", 1], ["(\(arg))", "#a3c3f0", "", 0]])
        said.append([["  ⎿  \(outcome)", Self.colors[.dim]!, "", 0]])
        said.append([])
    }

    func answer() {
        asking = false
        working = true
        started = .now
        say(.you, "Yes", lead: "> ")
        tool("Bash", "pnpm test:visual", "Running…")
    }

    func finish() {
        working = false
        say(.claude, "All 214 visual tests pass, zoom 14 included. Done: the change is on the branch fix/retina-tiles.")
    }

    func interrupt() {
        guard working || asking else { return }
        working = false
        asking = false
        said.append([["  ⎿  Interrupted · What should Claude do instead?", Self.colors[.dim]!, "", 0]])
        said.append([])
    }

    /// The whole screen, as one frame.
    func frame() -> [String: Any]? {
        // Blank rows on top, as on the Mac's tall screen: the whole conversation is here, with
        // nothing older to ask for.
        var rows: [[[Any]]] = [[], []] + said
        if working {
            let s = Int(Date.now.timeIntervalSince(started))
            let spin = Array("·✢✳✶✻✽")[s % 6]
            rows.append([["\(spin) ", "#e8a07a", "", 0], ["Working… ", "#e8a07a", "", 0], ["(\(s)s · esc to interrupt)", "#838d88", "", 0]])
            rows.append([])
        }
        let rule: [Any] = [String(repeating: "─", count: max(cols, 1)), "#2a363c", "", 0]
        if asking {
            rows.append([rule])
            rows.append([[" Run the visual tests?", "", "", 1]])
            rows.append([[" ❯ 1. Yes", "#e5c06a", "", 0]])
            rows.append([["   2. Yes, and don't ask again for this command", "", "", 0]])
            rows.append([["   3. No, and tell Claude what to do differently", "", "", 0]])
        }
        rows.append([rule])
        rows.append([["> ", "#838d88", "", 0], [typed, "", "", 0]])
        let set: [[Any]] = rows.enumerated().map { [$0.offset, $0.element] }
        return [
            "id": id, "cols": cols, "rows": rows.count, "set": set, "full": true,
            "cursor": [2 + typed.count, rows.count - 1], "mine": true,
        ]
    }

    private func wrap(_ text: String, _ width: Int) -> [String] {
        var out: [String] = []
        var line = ""
        for word in text.split(separator: " ") {
            if !line.isEmpty, line.count + 1 + word.count > width {
                out.append(line)
                line = String(word)
            } else {
                line = line.isEmpty ? String(word) : "\(line) \(word)"
            }
        }
        if !line.isEmpty { out.append(line) }
        return out
    }
}
