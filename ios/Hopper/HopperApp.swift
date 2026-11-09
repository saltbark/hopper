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

/// Where a row leads: a conversation to watch, or a draft to edit.
struct ConversationRoute: Hashable { let id: String }
struct DraftRoute: Hashable { let id: String }

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()
    @State private var tab: TabID = .work
    // Where the New tab goes back to.
    @State private var back: TabID = .work

    enum TabID: Hashable { case work, projects, accounts, new }

    var body: some View {
        ZStack {
            if model.pairing == nil {
                PairView().transition(.opacity)
            } else {
                tabs.transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.35), value: model.pairing == nil)
    }

    private var tabs: some View {
        // Pages push above the tabs, so the tab bar slides away with the list and back with it.
        NavigationStack(path: $path) {
            // The system's bar is hidden: HopperTabBar draws the tabs and New beside them.
            TabView(selection: $tab) {
                Tab("Work", systemImage: "tray", value: TabID.work) { WorkView().toolbarVisibility(.hidden, for: .tabBar) }
                Tab("Projects", systemImage: "folder", value: TabID.projects) { ProjectsView().toolbarVisibility(.hidden, for: .tabBar) }
                Tab("Accounts", systemImage: "gauge.with.dots.needle.33percent", value: TabID.accounts) {
                    AccountsView().toolbarVisibility(.hidden, for: .tabBar)
                }
                // New's page is the new conversation itself, so there's no sheet to wait for. It
                // has its own Cancel and buttons, so no bar.
                Tab("New", systemImage: "plus", value: TabID.new) {
                    ComposeView(mode: .new(model.newRequest?.project)).id(model.newRequest?.id)
                        .toolbarVisibility(.hidden, for: .tabBar)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            // One bar for every tab, so the lit tab's backing slides between them. New has its
            // own buttons where the bar would be.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if tab != .new {
                    HopperTabBar(tab: $tab).transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .navigationDestination(for: ConversationRoute.self) { ConversationView(id: $0.id) }
            .navigationDestination(for: DraftRoute.self) { DraftView(id: $0.id) }
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

    #if DEBUG
        // For screenshots in the simulator (ios/scripts/sim.sh): HOPPER_SHOW opens a screen at
        // launch, once the Mac's first snapshot is in. Not in release builds.
        private func debugShow() {
            guard let show = ProcessInfo.processInfo.environment["HOPPER_SHOW"] else { return }
            Task {
                for _ in 0..<40 where model.link != .live { try? await Task.sleep(for: .milliseconds(250)) }
                switch show {
                case "new": model.newConversation()
                case "routines": path.append(RoutinesRoute())
                case "archived": path.append(ArchivedRoute())
                case "accounts": tab = .accounts
                case "projects": tab = .projects
                case "draft": if let d = model.items.first(where: \.isDraft) { path.append(DraftRoute(id: d.id)) }
                case "queued": if let d = model.items.first(where: { $0.isDraft && $0.queue != nil }) { path.append(DraftRoute(id: d.id)) }
                case let s where s.hasPrefix("new:"): model.newConversation(in: String(s.dropFirst(4)))
                case let s where s.hasPrefix("project:"): path.append(ProjectRoute(key: String(s.dropFirst(8))))
                case let s where s.hasPrefix("routine:"): path.append(RoutineRoute(id: s))
                case "conversation":
                    if let item = model.items.first(where: { $0.attach == true }) { path.append(ConversationRoute(id: item.id)) }
                default: break
                }
            }
        }
    #endif
}

/// What the Mac said about the last thing asked of it, dropping in from the top; with Undo when
/// the move can be taken back. Swipe it up to put it away.
struct ToastView: View {
    @Environment(AppModel.self) private var model
    @State private var drag: CGFloat = 0

    var body: some View {
        ZStack(alignment: .top) {
            if let t = model.toast {
                HStack(spacing: 10) {
                    Image(systemName: t.ok ? "checkmark" : "exclamationmark")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(t.ok ? T.focus : T.blocked)
                        .frame(width: 22, height: 22)
                        .background((t.ok ? T.focus : T.blocked).opacity(0.16), in: .circle)
                    Text(t.text).font(.system(size: 14, weight: .medium)).foregroundStyle(T.hi).lineLimit(2)
                    if let undo = t.undo {
                        Spacer(minLength: 4)
                        Button {
                            model.dismissToast()
                            undo()
                        } label: {
                            Text("Undo").font(.system(size: 14, weight: .semibold)).foregroundStyle(T.focus)
                                .padding(.horizontal, 10).frame(height: 30)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.press)
                    }
                }
                .padding(.leading, 10).padding(.trailing, t.undo == nil ? 16 : 6)
                .frame(minHeight: 44)
                .glassEffect(.regular.tint(Color(hex: 0x182024).opacity(0.6)), in: .capsule)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .offset(y: min(0, drag))
                .gesture(
                    DragGesture(minimumDistance: 4)
                        .onChanged { drag = $0.translation.height }
                        .onEnded { v in
                            if v.translation.height < -20 || v.predictedEndTranslation.height < -60 { model.dismissToast() }
                            withAnimation(.snappy) { drag = 0 }
                        }
                )
                .transition(.move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.92, anchor: .top)))
                .id(t.id)
                .sensoryFeedback(t.ok ? .success : .error, trigger: t.id) { _, _ in !t.ok || t.undo == nil }
            }
        }
    }
}
