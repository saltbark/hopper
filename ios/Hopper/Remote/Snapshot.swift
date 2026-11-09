import Foundation

// What the Mac sends after each poll: src/remote/view.ts's PhoneView. Already grouped and sorted
// the way the Mac's list is, so the phone only draws it.

struct PhoneSnapshot: Decodable, Equatable {
    let at: Double
    let mac: String
    let items: [PhoneItem]
    /// Marked done, newest first (Archived on the Mac). Missing from an older Mac.
    let archived: [PhoneItem]?
    let accounts: [PhoneAccount]
    let projects: [PhoneProject]
}

struct PhoneItem: Decodable, Hashable, Identifiable {
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
}

struct UsageWindow: Decodable, Equatable {
    let pct: Double
    let resetsAt: String?
}

struct PhoneAccount: Decodable, Equatable, Identifiable {
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

struct PhoneProject: Decodable, Equatable, Identifiable {
    var id: String { key }
    let key: String
    let open: Int?
    let running: Int
    let waiting: Int
}

/// The Mac's list groups, in its order (GROUPS in src/tui/state.ts).
enum WorkGroup: String, CaseIterable {
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
