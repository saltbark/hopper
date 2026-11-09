import Foundation

// What the Mac sends after each poll: src/remote/view.ts's PhoneView. Already grouped and sorted
// the way the Mac's list is, so the phone only draws it.

nonisolated struct PhoneSnapshot: Decodable, Equatable {
    let at: Double
    let mac: String
    let items: [PhoneItem]
    /// Marked done, newest first (Archived on the Mac). Missing from an older Mac.
    let archived: [PhoneItem]?
    let accounts: [PhoneAccount]
    let projects: [PhoneProject]
}

nonisolated struct PhoneItem: Decodable, Hashable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let project: String
    let account: String
    let group: String
    let state: String
    let activeAt: Double
    let model: String?
    let effort: String?
    let nextAt: Double?
    let unread: Int?
    let waiting: String?
    let queue: String?
    /// A background conversation the phone can open.
    let attach: Bool?
    /// A draft's own: its whole text, worktree, and whether its account was picked by hand.
    let text: String?
    let worktree: String?
    let picked: Bool?

    var isDraft: Bool { kind == "draft" }
    /// Whether a tap opens something: a conversation to watch or a draft to edit.
    var opens: Bool { attach == true || isDraft }
    var workGroup: WorkGroup? { WorkGroup(rawValue: group) }

    /// The same item in another group, for showing a move before the Mac confirms it.
    func moved(to group: String) -> PhoneItem {
        PhoneItem(
            id: id, kind: kind, title: title, project: project, account: account, group: group, state: state,
            activeAt: activeAt, model: model, effort: effort, nextAt: nextAt, unread: unread, waiting: waiting,
            queue: queue, attach: attach, text: text, worktree: worktree, picked: picked)
    }
}

nonisolated struct UsageWindow: Decodable, Equatable {
    let pct: Double
    let resetsAt: String?
}

nonisolated struct PhoneAccount: Decodable, Equatable, Identifiable {
    var id: String { name }
    let name: String
    let label: String
    let color: String
    let email: String?
    let plan: String?
    let local: Bool
    let signedIn: Bool
    let session: UsageWindow?
    let week: UsageWindow?
    let usageAt: Double?
    let running: Int
    let waiting: Int
}

nonisolated struct PhoneProject: Decodable, Equatable, Identifiable {
    var id: String { key }
    let key: String
    let open: Int?
    let running: Int
    let waiting: Int
}

/// The Mac's list groups, in its order (GROUPS in src/tui/state.ts).
nonisolated enum WorkGroup: String, CaseIterable {
    case draft, proposed, running, waiting, held, next, routines

    var label: String {
        switch self {
        case .draft: "drafts"
        case .proposed: "proposed"
        case .running: "running"
        case .waiting: "waiting on you"
        case .held: "on hold"
        case .next: "up next"
        case .routines: "routines"
        }
    }
}
