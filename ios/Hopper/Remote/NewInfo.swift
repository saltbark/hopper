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
