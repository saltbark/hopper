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

    var body: some View {
        @Bindable var model = model
        if model.pairing == nil {
            PairView()
        } else {
            // Pages push above the tabs, so the tab bar slides away with the list and back with it.
            NavigationStack {
                TabView {
                    Tab("Work", systemImage: "tray") { WorkView() }
                        .badge(waiting)
                    Tab("Projects", systemImage: "folder") { ProjectsView() }
                    Tab("Accounts", systemImage: "gauge.with.dots.needle.33percent") { AccountsView() }
                }
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: PhoneItem.self) { ConversationView(item: $0) }
                .navigationDestination(for: ArchivedRoute.self) { _ in ArchivedView() }
                .navigationDestination(for: RoutinesRoute.self) { _ in RoutinesView() }
                .navigationDestination(for: RoutineRoute.self) { RoutineView(id: $0.id) }
                .navigationDestination(for: ReportRoute.self) { ReportView(route: $0) }
                .navigationDestination(for: ProjectRoute.self) { ProjectView(key: $0.key) }
            }
            .sheet(item: $model.newRequest) { NewConversationView(start: $0.project) }
            .overlay(alignment: .top) { ToastView() }
            .onAppear { model.start() }
        }
    }

    // Waiting on you, as the Mac counts it: not what's on hold.
    private var waiting: Int {
        model.snapshot?.items.filter { $0.group == WorkGroup.waiting.rawValue }.count ?? 0
    }
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
