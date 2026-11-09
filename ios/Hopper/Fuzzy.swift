import Foundation

/// Type a few letters of a project, as in Hopper's picker on the Mac (src/tui/fuzzy.ts): the
/// letters in order, anywhere in the key. Runs of letters together, matches at the start of a
/// segment ("tern" in pm/tern) and shorter keys rank first.
enum Fuzzy {
    static func score(_ query: String, _ text: String) -> Int? {
        let q = Array(query.lowercased().filter { !$0.isWhitespace })
        if q.isEmpty { return 0 }
        let t = Array(text.lowercased())
        var qi = 0
        var score = 0
        var run = 0
        var prev: Int?
        for (i, c) in t.enumerated() where qi < q.count && c == q[qi] {
            let starts = i == 0 || "/-_. ".contains(t[i - 1])
            run = prev == i - 1 ? run + 1 : 0
            score += 10 + run * 15 + (starts ? 25 : 0)
            prev = i
            qi += 1
        }
        guard qi == q.count else { return nil }
        return score - t.count
    }

    /// The items that match, best first; all of them, in their order, for an empty query.
    static func rank<T>(_ items: [T], _ query: String, key: (T) -> String) -> [T] {
        if query.trimmingCharacters(in: .whitespaces).isEmpty { return items }
        return items.compactMap { item in score(query, key(item)).map { (item, $0) } }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
    }
}
