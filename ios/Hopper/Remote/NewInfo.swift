import Foundation

/// The Mac's answer to "new conversation in this project": its open items, what it would start
/// with, and which account its route picks (src/remote/actions.ts, `new`).
struct NewInfo: Decodable, Equatable {
    let project: String
    let runIn: String
    let items: [String]
    let defaults: Defaults
    let route: String?
    let routeWhy: String?
    let models: [String]
    let efforts: [String]
    let accounts: [Account]

    struct Defaults: Decodable, Equatable {
        let model: String
        let effort: String
        let worktree: String
    }

    struct Account: Decodable, Equatable, Hashable {
        let name: String
        let label: String
    }
}

/// A routine as the Mac has it (src/remote/actions.ts, `routineinfo`).
struct RoutineInfo: Decodable, Equatable {
    let name: String
    let project: String
    let schedule: String
    let enabled: Bool
    let prompt: String
    let model: String
    let effort: String
    let check: String?
    let nextAt: Double?
    let reports: [Report]

    struct Report: Decodable, Equatable, Hashable, Identifiable {
        var id: String { file }
        let file: String
        let at: Double
        let summary: String
        let unread: Bool
        let account: String?
    }
}

/// One report's text (`report`).
struct ReportText: Decodable, Equatable {
    let routine: String
    let at: Double
    let markdown: String
}
