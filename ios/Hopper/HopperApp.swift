import SwiftUI

@main
struct HopperApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(T.focus)
        }
        .onChange(of: phase) { _, now in
            // Connected only while on screen: the Mac sends nothing to a phone in a pocket.
            if now == .active { model.start() } else if now == .background { model.stop() }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()
    @State private var tab: TabID = .work
    // Where the New tab goes back to.
    @State private var back: TabID = .work

    enum TabID: Hashable { case work, projects, accounts, new }

    var body: some View {
        @Bindable var model = model
        if model.pairing == nil {
            PairView()
        } else {
            // Pages push above the tabs, so the tab bar slides away with the list and back with it.
            NavigationStack(path: $path) {
                // The system's bar is hidden: HopperTabBar draws the tabs and New beside them.
                TabView(selection: $tab) {
                    Tab("Work", systemImage: "tray", value: TabID.work) { WorkView().withTabBar($tab) }
                    Tab("Projects", systemImage: "folder", value: TabID.projects) { ProjectsView().withTabBar($tab) }
                    Tab("Accounts", systemImage: "gauge.with.dots.needle.33percent", value: TabID.accounts) {
                        AccountsView().withTabBar($tab)
                    }
                    // New's page is the new conversation itself, so there's no sheet to wait for. It
                    // has its own Cancel and buttons, so no bar.
                    Tab("New", systemImage: "plus", value: TabID.new) {
                        NewConversationView(start: model.newRequest?.project).id(model.newRequest?.id)
                            .toolbarVisibility(.hidden, for: .tabBar)
                    }
                }
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: PhoneItem.self) { ConversationView(item: $0) }
                .navigationDestination(for: ArchivedRoute.self) { _ in ArchivedView() }
                .navigationDestination(for: RoutinesRoute.self) { _ in RoutinesView() }
                .navigationDestination(for: RoutineRoute.self) { RoutineView(id: $0.id) }
                .navigationDestination(for: ReportRoute.self) { ReportView(route: $0) }
                .navigationDestination(for: ProjectRoute.self) { ProjectView(key: $0.key) }
            }
            .overlay(alignment: .top) { ToastView() }
            // The + tab chosen: a fresh form. Leaving it some other way lets it go.
            .onChange(of: tab) { old, new in
                if new == .new {
                    if old != .new { back = old }
                    if model.newRequest == nil { model.newConversation() }
                } else if old == .new, model.newRequest != nil {
                    model.closeNew(started: false)
                }
            }
            // Asked for from elsewhere (a project's +): over to the New tab, from wherever.
            .onChange(of: model.newRequest?.id) { _, id in
                if id != nil, tab != .new {
                    back = tab
                    path = NavigationPath()
                    tab = .new
                } else if id == nil, tab == .new {
                    tab = model.newStarted ? .work : back
                }
            }
            .onAppear {
                model.start()
                #if DEBUG
                    debugShow()
                #endif
            }
        }
    }

    #if DEBUG
        // For screenshots in the simulator (ios/scripts/sim.sh): HOPPER_SHOW opens a screen at
        // launch, once the Mac's first snapshot is in. Not in release builds.
        private func debugShow() {
            guard let show = ProcessInfo.processInfo.environment["HOPPER_SHOW"] else { return }
            Task {
                for _ in 0..<40 where model.snapshot == nil { try? await Task.sleep(for: .milliseconds(250)) }
                let snap = model.snapshot
                switch show {
                case "new": model.newConversation()
                case "routines": path.append(RoutinesRoute())
                case "archived": path.append(ArchivedRoute())
                case let s where s.hasPrefix("new:"): model.newConversation(in: String(s.dropFirst(4)))
                case let s where s.hasPrefix("project:"): path.append(ProjectRoute(key: String(s.dropFirst(8))))
                case let s where s.hasPrefix("routine:"): path.append(RoutineRoute(id: s))
                case "conversation":
                    if let item = snap?.items.first(where: { $0.attach == true }) { path.append(item) }
                default: break
                }
            }
        }
    #endif

}

/// What the Mac said about the last thing asked of it.
struct ToastView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let t = model.toast {
            HStack(spacing: 8) {
                Text(t.ok ? "✓" : "!").font(T.mono(13, .bold)).foregroundStyle(t.ok ? T.focus : T.blocked)
                Text(t.text).font(.system(size: 14)).foregroundStyle(T.hi).lineLimit(3)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color(hex: 0x182024).opacity(0.97), in: .capsule)
            .overlay(Capsule().stroke(Color(hex: 0x2A363C), lineWidth: 1))
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .transition(.move(edge: .top).combined(with: .opacity))
            .id(t.id)
        }
    }
}
