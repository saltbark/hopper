import SwiftUI

struct RoutinesRoute: Hashable {}
struct RoutineRoute: Hashable { let id: String }
struct ReportRoute: Hashable {
    let routine: String
    let file: String
    let at: Double
}

/// Prompts that run on a schedule while Hopper is open, opened from Work. A dot means a report you
/// haven't read. Tap one for its prompt and reports; swipe to run it now, pause or resume it.
struct RoutinesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            PageHeader(title: "routines").titleStrip(page: true)
            list
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var list: some View {
        List {
            if model.snapshot != nil {
                let routines = model.routines
                if routines.isEmpty {
                    Text("No routines yet. hopper routine templates lists the ones Hopper ships.")
                        .font(.system(size: 15)).foregroundStyle(T.soft).padding(.top, 40)
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(routines) { r in
                            NavigationLink(value: RoutineRoute(id: r.id)) { RoutineRow(routine: r) }
                                .cardRow(link: true)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button { Task { await model.routine(r.id, "run") } } label: { Label("Run now", systemImage: "play.fill") }
                                        .tint(T.focus)
                                }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    if r.state == "paused" {
                                        Button { Task { await model.routine(r.id, "resume") } } label: { Label("Resume", systemImage: "arrow.clockwise") }
                                            .tint(Color(hex: 0x3A6E5A))
                                    } else {
                                        Button { Task { await model.routine(r.id, "pause") } } label: { Label("Pause", systemImage: "pause.fill") }
                                            .tint(Color(hex: 0x4A5459))
                                    }
                                }
                        }
                    }
                }
            } else {
                Waiting().listRowBackground(Color.clear)
            }
        }
        .cardList()
    }
}

struct RoutineRow: View {
    let routine: PhoneItem

    var body: some View {
        HStack(spacing: 12) {
            Mark(mark: StateMark(routine))
            VStack(alignment: .leading, spacing: 2) {
                Text(routine.title).font(T.mono(15, .medium))
                    .foregroundStyle(routine.state == "paused" ? T.soft : T.hi).lineLimit(1)
                Text(Self.when(routine)).font(.system(size: 12)).foregroundStyle(T.dim)
            }
            Spacer()
            if let m = routine.model { Text(m).font(T.mono(12)).foregroundStyle(T.dim) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    static func when(_ r: PhoneItem) -> String {
        if r.state == "paused" { return "paused" }
        let unread = (r.unread ?? 0) > 0 ? "\(r.unread!) unread · " : ""
        guard let next = r.nextAt else { return unread + "run by hand" }
        return unread + "next " + Date(timeIntervalSince1970: next / 1000).formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}

/// One routine: what it does and when, run or pause it, and its reports, newest first.
struct RoutineView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var loaded = false

    private var item: PhoneItem? { model.item(id) }
    // Shown at once from last time while a fresh answer comes.
    private var info: RoutineInfo? { model.routineInfos[id] }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader(title: item?.title ?? info?.name ?? "routine").titleStrip(page: true)
            list
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
        // Again when the routine changes on the Mac: a run, a report read.
        .task(id: item) { await load() }
    }

    private var list: some View {
        List {
            if let info {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(when(info)).font(T.mono(12)).foregroundStyle(T.dim)
                        Text(info.prompt).font(.system(size: 15)).foregroundStyle(T.text).lineLimit(8)
                        Text("\(info.project) · \(info.model) · \(info.effort)").font(T.mono(12)).foregroundStyle(T.dim)
                    }
                    .padding(14)
                    .listRowBackground(T.surface)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    HStack(spacing: 8) {
                        action("Run now", "play.fill", primary: true) { await model.routine(id, "run") }
                        if paused {
                            action("Resume", "arrow.clockwise") { await model.routine(id, "resume") }
                        } else {
                            action("Pause", "pause.fill") { await model.routine(id, "pause") }
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    if info.reports.isEmpty {
                        Text("No reports yet.").font(.system(size: 14)).foregroundStyle(T.soft)
                            .padding(14).listRowBackground(T.surface).listRowInsets(EdgeInsets())
                    }
                    ForEach(info.reports) { rep in
                        NavigationLink(value: ReportRoute(routine: info.name, file: rep.file, at: rep.at)) {
                            HStack(spacing: 12) {
                                Text(rep.unread ? "●" : "·").font(T.mono(14, .bold))
                                    .foregroundStyle(rep.unread ? T.focus : T.dim).frame(width: 14)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(rep.summary.isEmpty ? rep.file : rep.summary)
                                        .font(.system(size: 15, weight: rep.unread ? .semibold : .regular))
                                        .foregroundStyle(rep.unread ? T.hi : T.text).lineLimit(2)
                                    Text(Date(timeIntervalSince1970: rep.at / 1000).formatted(.dateTime.weekday(.abbreviated).day().month().hour().minute()))
                                        .font(T.mono(11.5)).foregroundStyle(T.dim)
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                        }
                        .cardRow(link: true)
                    }
                } header: {
                    GroupHeading(label: "reports", count: info.reports.count, color: T.focus)
                        .sectionHeading()
                }
            } else {
                Loading(failed: loaded).listRowBackground(Color.clear)
            }
        }
        .cardList()
        .listSectionSpacing(12)
        .refreshable { await load() }
    }

    private var paused: Bool { (item?.state ?? (info?.enabled == false ? "paused" : "")) == "paused" }

    private func load() async {
        await model.routineInfo(id)
        loaded = true
    }

    private func when(_ info: RoutineInfo) -> String {
        if paused { return "paused · \(info.schedule.isEmpty ? "run by hand" : info.schedule)" }
        let next = info.nextAt.map { " · next " + Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.weekday(.abbreviated).hour().minute()) } ?? ""
        return (info.schedule.isEmpty ? "run by hand" : info.schedule) + next
    }

    private func action(_ title: String, _ icon: String, primary: Bool = false, _ run: @escaping () async -> Void) -> some View {
        Button { Task { await run() } } label: {
            Label(title, systemImage: icon).font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 46)
                .background(primary ? T.focus : T.surface, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(primary ? .clear : T.fieldLine, lineWidth: 1))
                .contentShape(.rect)
        }
        .buttonStyle(.press(0.96))
        .foregroundStyle(primary ? T.ink : T.hi)
    }
}

/// While an answer is on its way, and when it didn't come.
struct Loading: View {
    let failed: Bool

    var body: some View {
        HStack(spacing: 10) {
            if !failed { ProgressView().controlSize(.small).tint(T.dim) }
            Text(failed ? "The Mac didn't answer." : "Loading…").font(.system(size: 15)).foregroundStyle(T.soft)
        }
        .frame(maxWidth: .infinity).padding(.top, 40)
        .transition(.opacity)
    }
}

/// One report, laid out from its markdown.
struct ReportView: View {
    @Environment(AppModel.self) private var model
    let route: ReportRoute
    @State private var loaded = false

    private var text: ReportText? { model.reports[AppModel.reportKey(route.routine, route.file)] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                PageHeader(title: Date(timeIntervalSince1970: route.at / 1000).formatted(.dateTime.weekday(.abbreviated).day().month().hour().minute()), mono: false)
                Text(route.routine).font(T.mono(12)).foregroundStyle(T.dim).padding(.leading, 40).padding(.top, -10)
                if let text {
                    Markdown(text: text.markdown).padding(.horizontal, 4)
                        .transition(.opacity)
                } else {
                    Loading(failed: loaded)
                }
            }
            .animation(.easeOut(duration: 0.25), value: text == nil)
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.report(route.routine, route.file)
            loaded = true
        }
    }
}

/// Markdown as a report uses it: headings, lists, quotes, code blocks and paragraphs, with links,
/// bold, italics and code inside lines.
struct Markdown: View {
    // Parsed once, when the text arrives, not on every redraw.
    private let blocks: [Block]

    init(text: String) { blocks = Self.blocks(text) }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(blocks.indices, id: \.self) { i in block(blocks[i]) }
        }
        .tint(Color(hex: 0x7EAAEA))
        .textSelection(.enabled)
    }

    enum Block {
        case heading(Int, String), bullet(String, Int), quote(String), code(String), para(String), rule
    }

    static func blocks(_ s: String) -> [Block] {
        var out: [Block] = []
        var para: [String] = []
        var code: [String]?
        func flush() {
            if !para.isEmpty { out.append(.para(para.joined(separator: " "))) }
            para = []
        }
        for raw in s.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let c = code { out.append(.code(c.joined(separator: "\n"))); code = nil } else { flush(); code = [] }
                continue
            }
            if code != nil { code!.append(raw); continue }
            if line.isEmpty { flush(); continue }
            if line == "---" || line == "***" { flush(); out.append(.rule); continue }
            if let h = line.firstIndex(where: { $0 != "#" }), line.hasPrefix("#"), line[h] == " " {
                flush(); out.append(.heading(line.distance(from: line.startIndex, to: h), String(line[h...]).trimmingCharacters(in: .whitespaces))); continue
            }
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.range(of: #"^\d+\. "#, options: .regularExpression) != nil {
                flush()
                let indent = raw.prefix { $0 == " " }.count / 2
                let body = line.replacingOccurrences(of: #"^([-*]|\d+\.) "#, with: "", options: .regularExpression)
                out.append(.bullet(body.replacingOccurrences(of: #"^\[[ x]\] "#, with: "", options: .regularExpression), indent))
                continue
            }
            if line.hasPrefix(">") { flush(); out.append(.quote(String(line.dropFirst()).trimmingCharacters(in: .whitespaces))); continue }
            para.append(line)
        }
        if let c = code { out.append(.code(c.joined(separator: "\n"))) }
        flush()
        return out
    }

    private func inline(_ s: String) -> Text {
        let a = (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        return Text(a)
    }

    @ViewBuilder
    private func block(_ b: Block) -> some View {
        switch b {
        case .heading(let level, let s):
            inline(s).font(.system(size: level <= 1 ? 22 : level == 2 ? 18 : 16, weight: .bold)).foregroundStyle(T.hi)
                .padding(.top, 6)
        case .bullet(let s, let indent):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•").foregroundStyle(T.dim)
                inline(s).foregroundStyle(T.text)
            }
            .font(.system(size: 15))
            .padding(.leading, CGFloat(indent) * 16)
        case .quote(let s):
            inline(s).font(.system(size: 15)).italic().foregroundStyle(T.soft).padding(.leading, 12)
        case .code(let s):
            ScrollView(.horizontal) {
                Text(s).font(T.mono(12.5)).foregroundStyle(T.code).padding(12)
            }
            .scrollIndicators(.hidden)
            .background(T.surface, in: .rect(cornerRadius: 10))
        case .para(let s):
            inline(s).font(.system(size: 15)).foregroundStyle(T.text).lineSpacing(3)
        case .rule:
            Rectangle().fill(T.rule).frame(height: 1).padding(.vertical, 4)
        }
    }
}
