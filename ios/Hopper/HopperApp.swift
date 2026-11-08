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
    @State private var tab: TabID = .work
    @State private var newOpen = false

    enum TabID: Hashable { case work, projects, accounts, routines, new }

    var body: some View {
        if model.pairing == nil {
            PairView()
        } else {
            TabView(selection: selection) {
                Tab("Work", systemImage: "tray", value: TabID.work) { WorkView() }
                    .badge(waiting)
                Tab("Projects", systemImage: "folder", value: TabID.projects) { ProjectsView() }
                Tab("Accounts", systemImage: "gauge.with.dots.needle.33percent", value: TabID.accounts) { AccountsView() }
                Tab("Routines", systemImage: "arrow.trianglehead.2.clockwise", value: TabID.routines) { RoutinesView() }
                // Drawn apart from the others, at the end of the bar: it opens a sheet rather than a tab.
                Tab("New", systemImage: "plus", value: TabID.new, role: .search) { Color.clear }
            }
            .sheet(isPresented: $newOpen) { NewConversationView() }
            .overlay(alignment: .top) { ToastView() }
            .onAppear { model.start() }
        }
    }

    // Choosing New opens the sheet and leaves you on the tab you were on.
    private var selection: Binding<TabID> {
        Binding(
            get: { tab },
            set: { next in
                if next == .new { newOpen = true } else { tab = next }
            })
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
