import SwiftUI
import UIKit

@main
struct HopperApp: App {
    @State private var model: AppModel
    @State private var lock: AppLock
    @Environment(\.scenePhase) private var phase

    init() {
        Chrome.apply()
        let model = AppModel()
        _model = State(initialValue: model)
        _lock = State(initialValue: AppLock(paired: model.pairing != nil))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .accessibilityHidden(lock.covered)
                .overlay {
                    if lock.covered { LockCover() }
                }
                .animation(.smooth(duration: 0.2), value: lock.covered)
                .environment(model)
                .environment(lock)
                .preferredColorScheme(.dark)
                .tint(T.focus)
                .onChange(of: model.pairing == nil) { _, unpaired in if unpaired { lock.unpaired() } }
        }
        .onChange(of: phase, initial: true) { _, now in
            lock.phase(now, paired: model.pairing != nil)
            // Connected only while on screen: the Mac sends nothing to a phone in a pocket.
            if now == .active { model.start() } else if now == .background { model.stop() }
        }
    }
}

/// The system's bars in Hopper's type: titles in its mono, the waiting count in its yellow. Only
/// text and colour are set, so the bars keep their glass and scroll-edge effects.
enum Chrome {
    static func apply() {
        let mono = { (size: CGFloat, weight: UIFont.Weight) in UIFont.monospacedSystemFont(ofSize: size, weight: weight) }
        let hi = UIColor(T.hi)
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = [.font: mono(28, .bold), .foregroundColor: hi, .kern: -0.4]
        bar.titleTextAttributes = [.font: mono(17, .bold), .foregroundColor: hi]
        // The badge in the waiting yellow, set on the bar's own item appearance; the rest of the bar
        // is the system's.
        let tabs = UITabBarAppearance()
        tabs.configureWithDefaultBackground()
        for layout in [tabs.stackedLayoutAppearance, tabs.inlineLayoutAppearance, tabs.compactInlineLayoutAppearance] {
            layout.normal.badgeBackgroundColor = UIColor(T.waiting)
            layout.normal.badgeTextAttributes = [.foregroundColor: UIColor(T.ink), .font: UIFont.systemFont(ofSize: 11, weight: .bold)]
        }
        UITabBar.appearance().standardAppearance = tabs
        UITabBar.appearance().scrollEdgeAppearance = tabs
    }
}

/// Where a row leads: a conversation to watch, or a draft to edit.
struct ConversationRoute: Hashable { let id: String }
struct DraftRoute: Hashable { let id: String }

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @State private var tab: TabID = .work
    // Where the New tab goes back to.
    @State private var back: TabID = .work
    // Each tab keeps its own pages, as system tabs do.
    @State private var workPath = NavigationPath()
    @State private var projectsPath = NavigationPath()
    @State private var accountsPath = NavigationPath()

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

    // The system's tab bar, its glass pill holding Work, Projects, Accounts and New. The system
    // draws a tab apart from the pill (as Photos' search) only when choosing it opens a search
    // field in the bar (`.searchable` with `.tabViewSearchActivation(.searchTabSelection)`); the
    // search role or `.tabPlacement(.pinned)` alone leave it inside. New opening on a search for a
    // project was offered and turned down, so it's an ordinary tab that opens on the form. The bar
    // doesn't shrink on scroll: a touch springing it back added to the system's own lift.
    private var tabs: some View {
        TabView(selection: $tab) {
            Tab("Work", systemImage: "tray", value: TabID.work) {
                NavigationStack(path: $workPath) { WorkView().pages() }
            }
            .badge(model.waitingCount)
            .accessibilityLabel(model.waitingCount > 0 ? "Work, \(model.waitingCount) waiting" : "Work")
            Tab("Projects", systemImage: "folder", value: TabID.projects) {
                NavigationStack(path: $projectsPath) { ProjectsView().pages() }
            }
            Tab("Accounts", systemImage: "gauge.with.dots.needle.33percent", value: TabID.accounts) {
                NavigationStack(path: $accountsPath) { AccountsView().pages() }
            }
            // New's page is the new conversation itself, so there's no sheet to wait for. It has its
            // own Cancel and buttons where the bar would be.
            Tab("New", systemImage: "plus", value: TabID.new) {
                NavigationStack {
                    ComposeView(mode: .new(model.newRequest?.project)).id(model.newRequest?.id)
                }
                .toolbarVisibility(.hidden, for: .tabBar)
            }
            .accessibilityLabel("New conversation")
        }
        .overlay(alignment: .top) { ToastView() }
        .sensoryFeedback(.selection, trigger: tab)
        // The + tab chosen: a fresh form. Leaving it some other way lets it go.
        .onChange(of: tab) { old, new in
            if new == .new {
                if old != .new { back = old }
                if model.newRequest == nil { model.newConversation() }
            } else if old == .new, model.newRequest != nil {
                model.closeNew(started: false)
            }
        }
        // Asked for from elsewhere (a project's +): over to the New tab, from wherever; the page it
        // came from is still there to go back to.
        .onChange(of: model.newRequest?.id) { _, id in
            if id != nil, tab != .new {
                back = tab
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
                case "tour": await tour()
                case "new": model.newConversation()
                case "routines": workPath.append(RoutinesRoute())
                case "archived": workPath.append(ArchivedRoute())
                case "accounts": tab = .accounts
                case "projects": tab = .projects
                case "draft": if let d = model.items.first(where: \.isDraft) { workPath.append(DraftRoute(id: d.id)) }
                case "queued": if let d = model.items.first(where: { $0.isDraft && $0.queue != nil }) { workPath.append(DraftRoute(id: d.id)) }
                case let s where s.hasPrefix("new:"): model.newConversation(in: String(s.dropFirst(4)))
                case let s where s.hasPrefix("project:"):
                    tab = .projects
                    projectsPath.append(ProjectRoute(key: String(s.dropFirst(8))))
                case let s where s.hasPrefix("routine:"): workPath.append(RoutineRoute(id: s))
                case let s where s.hasPrefix("report:"):
                    if let r = model.routines.first(where: { $0.title == String(s.dropFirst(7)) }),
                        let info = await model.routineInfo(r.id), let rep = info.reports.first
                    {
                        workPath.append(ReportRoute(routine: info.name, file: rep.file, at: rep.at))
                    }
                case "conversation":
                    if let item = model.items.first(where: { $0.attach == true }) { workPath.append(ConversationRoute(id: item.id)) }
                default: break
                }
            }
        }

        // The app walked through by itself, for the screen recording that goes with App Review
        // (the simulator takes no taps): the lists, a conversation answered, a draft started,
        // the projects and accounts, and the lock. Each step is marked on stderr with the time,
        // so the recording can be cut to it.
        private func tour() async {
            func mark(_ step: String) { fputs("TOUR \(Date().timeIntervalSince1970) \(step)\n", stderr) }
            func wait(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }
            mark("work")
            await wait(5)
            if let item = model.items.first(where: { $0.attach == true }) {
                mark("conversation")
                workPath.append(ConversationRoute(id: item.id))
                await wait(4.5)
                mark("reply")
                model.submit("Yes, run them")
                await wait(4.5)
                workPath.removeLast()
                await wait(2)
            }
            if let d = model.items.first(where: \.isDraft) {
                mark("draft")
                workPath.append(DraftRoute(id: d.id))
                await wait(4)
                mark("start")
                _ = await model.send(draft: ["t": "start", "project": d.project, "text": d.text ?? d.title, "id": d.id])
                await wait(1.5)
                workPath.removeLast()
                await wait(3)
            }
            mark("projects")
            tab = .projects
            await wait(2.5)
            projectsPath.append(ProjectRoute(key: "bh/atlas"))
            await wait(3)
            mark("accounts")
            tab = .accounts
            await wait(4)
            mark("lock")
            lock.demoLock()
            await wait(4)
            mark("end")
        }
    #endif
}

extension View {
    /// Every page a tab can push, and the Mac's state in its bar.
    func pages() -> some View {
        navigationDestination(for: ConversationRoute.self) { ConversationView(id: $0.id) }
            .navigationDestination(for: DraftRoute.self) { DraftView(id: $0.id) }
            .navigationDestination(for: ArchivedRoute.self) { _ in ArchivedView() }
            .navigationDestination(for: RoutinesRoute.self) { _ in RoutinesView() }
            .navigationDestination(for: RoutineRoute.self) { RoutineView(id: $0.id) }
            .navigationDestination(for: ReportRoute.self) { ReportView(route: $0) }
            .navigationDestination(for: ProjectRoute.self) { ProjectView(key: $0.key) }
    }
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
