import Foundation
import Observation

/// A run of styled text on Claude's screen, as src/remote/screen.ts sends it:
/// [text, fg, bg, flags]; fg empty or missing is Hopper's text colour, bg empty is none.
struct Run: Decodable, Equatable {
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

struct ScreenFrame: Decodable {
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

/// The conversation open on the phone: Claude's screen as the Mac last drew it. Its own object,
/// so a frame redraws the conversation and nothing else.
@Observable
final class Screen {
    let id: String
    private(set) var rows: [[Run]] = []
    private(set) var cols = 0
    private(set) var cursor: (col: Int, row: Int)?
    private(set) var mine = true
    /// Why it isn't showing any more, once it isn't.
    var closed: String?

    init(id: String) { self.id = id }

    func apply(_ f: ScreenFrame) {
        if rows.count != f.rows || f.full { rows = Array(repeating: [], count: f.rows) }
        cols = f.cols
        for r in f.set where r.index < rows.count { rows[r.index] = r.runs }
        cursor = f.cursor.flatMap { $0.count == 2 ? ($0[0], $0[1]) : nil }
        if let m = f.mine, m != mine { mine = m }
    }
}
