import SwiftUI

// Hopper's colours and marks (src/tui/theme.ts), for a phone. Brightness steers the eye: `hi` for
// what matters most, `text` for content, `dim` for what explains it. Colour is for state, on its
// glyph or heading, never a whole row.

enum T {
    static let bg = Color(hex: 0x090C0E)
    static let surface = Color(hex: 0x0F1417)
    static let surfaceLine = Color(hex: 0x1B2428)
    static let rowLine = Color(hex: 0x182024)
    static let rule = Color(hex: 0x1E272B)
    static let chip = Color(hex: 0x141B1E)
    static let sel = Color(hex: 0x243039)
    static let hi = Color(hex: 0xEEF2EF)
    static let text = Color(hex: 0xC7CFCA)
    static let soft = Color(hex: 0xA7B0AB)
    static let dim = Color(hex: 0x838D88)
    static let focus = Color(hex: 0x6FCAC3)
    static let waiting = Color(hex: 0xE5C06A)
    static let held = Color(hex: 0xA08B58)
    static let blocked = Color(hex: 0xEC7A6F)
    static let draft = Color(hex: 0xC69CE8)
    static let running = Color(hex: 0x7FCF8F)
    static let code = Color(hex: 0xA3C3F0)
    /// Text on the accent.
    static let ink = Color(hex: 0x0A0C0D)
    /// Where you type, and its edge.
    static let field = Color(hex: 0x0A0E10)
    static let fieldLine = Color(hex: 0x243036)
    /// The edge of a form's card.
    static let cardLine = Color(hex: 0x1F2A2F)
    /// A key on the key row; the bar the keys sit in.
    static let key = Color(hex: 0x1D262A)
    static let panel = Color(hex: 0x0D1214)
    /// Behind "Later" and "Back" when swiping.
    static let holdTint = Color(hex: 0x8C7A4F)

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    /// Meters stay calm until a limit gets close.
    static func tone(_ pct: Double) -> Color { pct >= 90 ? blocked : pct >= 75 ? waiting : running }

    static func groupColor(_ g: WorkGroup) -> Color {
        switch g {
        case .waiting: waiting
        case .held: held
        case .draft, .proposed: draft
        case .running: running
        case .routines: focus
        case .next: dim
        }
    }
}

nonisolated extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }

    /// "#7eaaea", as the Mac sends account colours.
    init(css: String) {
        self.init(hex: UInt32(css.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0xC7CFCA)
    }
}

/// What an item is doing, as the glyph that leads its row (stateMark in theme.ts). `nil` mark
/// means the spinner.
struct StateMark {
    let mark: String?
    let color: Color
    var bold = false

    init(mark: String?, color: Color, bold: Bool = false) {
        self.mark = mark
        self.color = color
        self.bold = bold
    }

    init(_ item: PhoneItem) {
        let g = WorkGroup(rawValue: item.group)
        // Archived: done with, whatever state Claude left it in.
        if item.group == "archived" { self.init(mark: "✓", color: T.dim); return }
        if g == .next { self.init(mark: item.queue == "night" ? "☾" : "○", color: T.dim); return }
        if item.kind == "draft" { self.init(mark: "◇", color: T.draft); return }
        if item.kind == "routine" {
            if (item.unread ?? 0) > 0 { self.init(mark: "●", color: T.focus, bold: true); return }
            self.init(mark: item.state == "paused" ? "○" : "↻", color: item.state == "paused" ? T.dim : T.focus)
            return
        }
        if g == .held { self.init(mark: "◷", color: T.held); return }
        switch item.state {
        case "blocked": self.init(mark: "?", color: T.waiting, bold: true)
        case "failed", "stopped": self.init(mark: "✕", color: T.blocked)
        case "done": self.init(mark: "✓", color: T.waiting)
        default: self.init(mark: nil, color: T.running)
        }
    }
}

enum Ago {
    /// "now", "18m", "2h", "3d": how lists say how long ago.
    static func short(_ ms: Double, now: Date = .now) -> String {
        let s = max(0, now.timeIntervalSince1970 - ms / 1000)
        if s < 60 { return "now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86400 { return "\(Int(s / 3600))h" }
        return "\(Int(s / 86400))d"
    }

    /// "in 2h 30m", "Tue 08:33": when a limit resets.
    static func reset(_ iso: String?, now: Date = .now) -> String? {
        guard let iso, let t = ISO8601DateFormatter.flexible.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        else { return nil }
        let s = t.timeIntervalSince(now)
        if s <= 0 { return nil }
        if s < 86400 {
            let h = Int(s / 3600)
            let m = Int(s.truncatingRemainder(dividingBy: 3600) / 60)
            return h > 0 ? "\(h)h \(m)m" : "\(m)m"
        }
        return t.formatted(.dateTime.weekday(.abbreviated).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }
}

extension ISO8601DateFormatter {
    static let flexible: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
