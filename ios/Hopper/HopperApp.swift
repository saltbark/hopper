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
        if model.pairing == nil {
            PairView()
        } else {
            TabView {
                Tab("Work", systemImage: "tray") { WorkView() }
                    .badge(waiting)
                Tab("Projects", systemImage: "folder") { ProjectsView() }
                Tab("Accounts", systemImage: "gauge.with.dots.needle.33percent") { AccountsView() }
                Tab("Routines", systemImage: "arrow.trianglehead.2.clockwise") { RoutinesView() }
            }
            .onAppear { model.start() }
        }
    }

    // Waiting on you, as the Mac counts it: not what's on hold.
    private var waiting: Int {
        model.snapshot?.items.filter { $0.group == WorkGroup.waiting.rawValue }.count ?? 0
    }
}
