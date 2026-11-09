import Foundation
import Observation
import SwiftUI
import UIKit

/// A run of styled text on Claude's screen, as src/remote/screen.ts sends it:
/// [text, fg, bg, flags]; fg empty or missing is Hopper's text colour, bg empty is none.
nonisolated struct Run: Decodable, Equatable {
    let text: String
    let fg: String?
    let bg: String?
    let flags: Int

    var bold: Bool { flags & 1 != 0 }
    var dim: Bool { flags & 2 != 0 }
    var italic: Bool { flags & 4 != 0 }
    var underline: Bool { flags & 8 != 0 }
    var inverse: Bool { flags & 16 != 0 }

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        text = try c.decode(String.self)
        let f = c.isAtEnd ? "" : try c.decode(String.self)
        let b = c.isAtEnd ? "" : try c.decode(String.self)
        flags = c.isAtEnd ? 0 : try c.decode(Int.self)
        fg = f.isEmpty ? nil : f
        bg = b.isEmpty ? nil : b
    }
}

nonisolated struct ScreenFrame: Decodable {
    let id: String
    let cols: Int
    let rows: Int
    let set: [Row]
    let full: Bool
    let cursor: [Int]?
    /// Whether the conversation is drawn at the phone's size (false: the Mac's panel has it).
    let mine: Bool?

    /// [index, runs]
    struct Row: Decodable {
        let index: Int
        let runs: [Run]

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            index = try c.decode(Int.self)
            runs = try c.decode([Run].self)
        }
    }
}

/// The terminal's type: one size, so a row is exactly as wide as its columns.
nonisolated enum Term {
    static let fontSize: CGFloat = 11.5
    static let cell: CGSize = {
        let f = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        return CGSize(width: ("M" as NSString).size(withAttributes: [.font: f]).width, height: ceil(f.lineHeight))
    }()
    static let text = Color(hex: 0xC7CFCA)
    static let bg = Color(hex: 0x090C0E)
    static let regular = Font.system(size: fontSize, weight: .regular, design: .monospaced)
    static let bold = Font.system(size: fontSize, weight: .bold, design: .monospaced)
}

/// One row of Claude's screen, ready to draw. `version` changes whenever its text does, so a row
/// that didn't change compares equal and isn't drawn again.
nonisolated struct ScreenLine: Identifiable, Equatable, Sendable {
    /// Its row on the Mac's screen.
    let id: Int
    let version: Int
    let text: AttributedString

    static func == (a: ScreenLine, b: ScreenLine) -> Bool { a.id == b.id && a.version == b.version }
}

/// What the conversation pane draws: Claude's screen with its runs of blank rows folded to one,
/// so it reads as one column ending at the prompt.
nonisolated struct ScreenState: Sendable {
    let id: String
    let lines: [ScreenLine]
    /// No blank stretch: there may be more above, for Claude to scroll to.
    let full: Bool
    let cursor: (col: Int, row: Int)?
    let mine: Bool
}

/// Claude's screen as the Mac last drew it, kept where frames arrive (off the main thread): each
/// frame brings only the rows that changed, and those alone are laid out again.
nonisolated final class ScreenBuffer {
    private var id = ""
    private var rows: [ScreenLine?] = []
    private var blank: [Bool] = []
    private var version = 0
    private var colors: [String: Color] = [:]

    func apply(_ f: ScreenFrame) -> ScreenState {
        if f.id != id || rows.count != f.rows || f.full {
            id = f.id
            rows = Array(repeating: nil, count: f.rows)
            blank = Array(repeating: true, count: f.rows)
        }
        for r in f.set where r.index >= 0 && r.index < rows.count {
            version += 1
            blank[r.index] = r.runs.isEmpty
            rows[r.index] = r.runs.isEmpty ? nil : ScreenLine(id: r.index, version: version, text: attributed(r.runs))
        }
        var lines: [ScreenLine] = []
        lines.reserveCapacity(64)
        var folded = false
        var lastBlank = true
        for i in rows.indices {
            if blank[i] {
                if lastBlank { folded = true; continue }
                lastBlank = true
                lines.append(ScreenLine(id: i, version: 0, text: AttributedString()))
            } else if let line = rows[i] {
                lastBlank = false
                lines.append(line)
            }
        }
        return ScreenState(
            id: f.id, lines: lines, full: !folded && !lines.isEmpty,
            cursor: f.cursor.flatMap { $0.count == 2 ? ($0[0], $0[1]) : nil }, mine: f.mine ?? true)
    }

    private func color(_ css: String) -> Color {
        if let c = colors[css] { return c }
        let c = Color(css: css)
        colors[css] = c
        return c
    }

    private func attributed(_ runs: [Run]) -> AttributedString {
        var out = AttributedString()
        for r in runs {
            // Claude's bullet, ⏺, is drawn as an emoji on iOS: the same-width dot instead.
            var s = AttributedString(r.text.contains("⏺") ? r.text.replacingOccurrences(of: "⏺", with: "●") : r.text)
            var fg = r.fg.map(color) ?? Term.text
            var bg = r.bg.map(color)
            if r.inverse { (fg, bg) = (bg ?? Term.bg, fg) }
            s.foregroundColor = r.dim ? fg.opacity(0.55) : fg
            if let bg { s.backgroundColor = bg }
            var font = r.bold ? Term.bold : Term.regular
            if r.italic { font = font.italic() }
            s.font = font
            if r.underline { s.underlineStyle = .single }
            out += s
        }
        return out
    }
}

/// The conversation open on the phone. Its own object, so a frame redraws the conversation and
/// nothing else.
@Observable
final class Screen {
    let id: String
    private(set) var state: ScreenState?
    /// Why it isn't showing any more, once it isn't.
    var closed: String?

    init(id: String) { self.id = id }

    func show(_ s: ScreenState) {
        closed = nil
        state = s
    }
}
