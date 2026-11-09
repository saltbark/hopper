import SwiftUI

/// A new conversation, as a draft on the Mac would be: a project, a prompt (or one of its open
/// items to start from), and what it runs with, each shown with its default by name. Save it as a
/// draft, start it now, or queue it. It's what the + beside the tabs shows; leaving goes back to
/// where you were (Work, after starting one).
struct NewConversationView: View {
    @Environment(AppModel.self) private var model
    /// The project it opened in, when it came from a project's page.
    let start: String?
    @AppStorage("newProject") private var lastProject = ""
    @AppStorage("recentProjects") private var recent = ""
    @State private var project = ""
    @State private var query = ""
    @FocusState private var finding: Bool
    @State private var info: NewInfo?
    @State private var text = ""
    @State private var account: String?
    @State private var chosenModel: String?
    @State private var effort: String?
    @State private var worktree: String?
    @State private var busy = false
    @FocusState private var writing: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("new").font(T.mono(26, .bold)).foregroundStyle(T.hi).tracking(-0.4)
                Spacer()
                LinkChip()
                Button("Cancel") { model.closeNew(started: false) }
                    .font(.system(size: 16)).foregroundStyle(T.focus)
                    .padding(.leading, 8)
            }
            .padding(.horizontal, 20)
            .padding(.top, 2)
            .padding(.bottom, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    projectPicker
                    if let info, !info.items.isEmpty { openItems(info) }
                    prompt
                    options
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            actions
        }
        .background(T.bg)
        .task(id: project) { await load() }
        .onAppear {
            let keys = model.snapshot?.projects.map(\.key) ?? []
            if let start, keys.contains(start) {
                project = start
            } else if keys.contains(lastProject) {
                project = lastProject
            } else {
                // Nothing to go on: start by finding one.
                finding = true
            }
        }
    }

    // MARK: Parts

    // Type a few letters to find a project: matches drop in under the field, the ones used
    // lately first while nothing is typed. The list is too long to scroll through.
    private var projectPicker: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: finding ? "magnifyingglass" : "folder").foregroundStyle(T.dim).frame(width: 18)
                VStack(alignment: .leading, spacing: 1) {
                    TextField("", text: $query, prompt: Text(project.isEmpty ? "Find a project" : project)
                        .foregroundStyle(finding || project.isEmpty ? T.dim : T.hi))
                        .font(T.mono(15, .medium))
                        .foregroundStyle(T.hi)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($finding)
                        .onSubmit { if let first = matches.first { choose(first) } }
                    if !finding { Text(projectLine).font(.system(size: 12)).foregroundStyle(T.dim) }
                }
                Spacer()
                if finding, !project.isEmpty {
                    Button("Cancel") { query = ""; finding = false }.font(.system(size: 14)).foregroundStyle(T.focus)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            if finding {
                ForEach(matches.prefix(7), id: \.self) { key in
                    Rectangle().fill(T.rowLine).frame(height: 1)
                    Button { choose(key) } label: {
                        HStack {
                            Text(key).font(T.mono(14)).foregroundStyle(key == project ? T.focus : T.text).lineLimit(1)
                            Spacer()
                            if let open = model.snapshot?.projects.first(where: { $0.key == key })?.open {
                                Text("\(open) open").font(T.mono(11)).foregroundStyle(T.dim)
                            }
                        }
                        .padding(.horizontal, 14).frame(height: 42)
                        .contentShape(.rect)
                    }
                    .buttonStyle(RowPress())
                }
                if matches.isEmpty {
                    Rectangle().fill(T.rowLine).frame(height: 1)
                    Text("No project matches.").font(.system(size: 14)).foregroundStyle(T.dim)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                }
            }
        }
        .background(T.chip, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(finding ? T.focus.opacity(0.6) : Color(hex: 0x1F2A2F), lineWidth: 1))
        .animation(.snappy(duration: 0.2), value: finding)
    }

    private var matches: [String] {
        let keys = model.snapshot?.projects.map(\.key) ?? []
        if query.trimmingCharacters(in: .whitespaces).isEmpty {
            let used = recent.split(separator: "\n").map(String.init).filter(keys.contains)
            return used + keys.filter { !used.contains($0) }
        }
        return Fuzzy.rank(keys, query) { $0 }
    }

    private func choose(_ key: String) {
        project = key
        query = ""
        finding = false
        writing = true
    }

    private var projectLine: String {
        guard let info else { return " " }
        let open = model.snapshot?.projects.first { $0.key == project }?.open
        return [open.map { "\($0) open" }, "runs in \(info.runIn)"].compactMap { $0 }.joined(separator: " · ")
    }

    private func openItems(_ info: NewInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label("FROM AN OPEN ITEM")
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(info.items, id: \.self) { item in
                        let on = text.hasPrefix(item)
                        Button {
                            text = on ? "" : item + (item.hasSuffix(".") ? " " : ". ")
                            writing = true
                        } label: {
                            Text(item).font(.system(size: 13, weight: on ? .medium : .regular)).lineLimit(1)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(on ? Color(hex: 0x0F2624) : .clear, in: .capsule)
                                .overlay(Capsule().stroke(on ? T.focus : Color(hex: 0x243036), lineWidth: 1))
                        }
                        .foregroundStyle(on ? Color(hex: 0x96D8D3) : T.text)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private var prompt: some View {
        VStack(alignment: .leading, spacing: 8) {
            label("PROMPT")
            TextField("", text: $text, prompt: Text("What should Claude do?").foregroundStyle(T.dim), axis: .vertical)
                .lineLimit(6...14)
                .font(.system(size: 16))
                .foregroundStyle(T.hi)
                .focused($writing)
                .padding(14)
                .background(Color(hex: 0x0A0E10), in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0x1F2A2F), lineWidth: 1))
        }
    }

    private var options: some View {
        VStack(spacing: 0) {
            row("Account") {
                let accounts = info?.accounts ?? []
                if accounts.count <= 1 {
                    value(accountText, dot: accountColor, menu: false)
                } else {
                    Menu {
                        Picker("Account", selection: $account) {
                            if info?.route == nil { Text("Pick one").tag(String?.none) }
                            ForEach(accounts, id: \.self) { a in
                                Text(a.name == info?.route ? "\(a.label) (route)" : a.label)
                                    .tag(a.name == info?.route ? String?.none : Optional(a.name))
                            }
                        }
                    } label: { value(accountText, dot: accountColor) }
                }
            }
            RowDivider()
            row("Model") {
                Menu {
                    Picker("Model", selection: $chosenModel) {
                        Text("\(info?.defaults.model ?? "–") (default)").tag(String?.none)
                        ForEach(info?.models ?? [], id: \.self) { Text($0).tag(Optional($0)) }
                    }
                } label: { value(chosenModel ?? "\(info?.defaults.model ?? "–") (default)") }
            }
            RowDivider()
            row("Effort") {
                Menu {
                    Picker("Effort", selection: $effort) {
                        Text("\(info?.defaults.effort ?? "–") (default)").tag(String?.none)
                        ForEach(info?.efforts ?? [], id: \.self) { Text($0).tag(Optional($0)) }
                    }
                } label: { value(effort ?? "\(info?.defaults.effort ?? "–") (default)") }
            }
            RowDivider()
            row("Worktree") {
                HStack(spacing: 10) {
                    if worktree == nil { Text("(default)").font(T.mono(12)).foregroundStyle(T.dim) }
                    Toggle("Work in a worktree", isOn: worktreeOn).labelsHidden().tint(Color(hex: 0x3A9A93))
                }
            }
        }
        .background(T.chip, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0x1F2A2F), lineWidth: 1))
    }

    // Save draft and Start now are what you'll press; queueing (unattended, when there's room or
    // tonight) is in the clock's menu.
    private var actions: some View {
        HStack(spacing: 8) {
            Menu {
                Button { go(.queue("now")) } label: { Label("Queue: start when there's room", systemImage: "circle") }
                Button { go(.queue("night")) } label: { Label("Queue for tonight", systemImage: "moon") }
            } label: {
                Image(systemName: "clock").font(.system(size: 17, weight: .medium))
                    .frame(width: 52, height: 52)
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0x243036), lineWidth: 1))
            }
            .foregroundStyle(T.hi)
            .accessibilityLabel("Queue")
            Button { go(.draft) } label: { Text("Save draft").frame(maxWidth: .infinity) }
                .buttonStyle(Outline())
            Button { go(.start) } label: {
                Group { if busy { ProgressView().tint(Color(hex: 0x0A0C0D)) } else { Text("Start now") } }
                    .font(.system(size: 16, weight: .bold)).frame(maxWidth: .infinity).frame(height: 52)
            }
            .foregroundStyle(Color(hex: 0x0A0C0D))
            .background(T.focus.opacity(canGo ? 1 : 0.4), in: .rect(cornerRadius: 16))
        }
        .disabled(!canGo || busy)
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(T.bg)
        .overlay(alignment: .top) { Rectangle().fill(T.rule).frame(height: 1) }
    }

    // MARK: Helpers

    private var canGo: Bool { !project.isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && model.link == .live }

    private var accountText: String {
        guard let info else { return "–" }
        if let a = account { return info.accounts.first { $0.name == a }?.label ?? a }
        if let r = info.route {
            let label = info.accounts.first { $0.name == r }?.label ?? r
            return info.accounts.count <= 1 ? label : "\(label) (route)"
        }
        return "none: \(info.routeWhy ?? "no route")"
    }

    private var accountColor: Color? {
        let name = account ?? info?.route
        return model.snapshot?.accounts.first { $0.name == name }.map { Color(css: $0.color) }
    }

    private var worktreeOn: Binding<Bool> {
        Binding(
            get: { (worktree ?? info?.defaults.worktree ?? "yes") == "yes" },
            set: { on in
                let v = on ? "yes" : "no"
                worktree = v == info?.defaults.worktree ? nil : v
            })
    }

    private func load() async {
        guard !project.isEmpty else { return }
        info = nil
        info = await model.newInfo(project)
    }

    enum Go { case start, draft, queue(String) }

    private func go(_ how: Go) {
        var m: [String: Any] = ["t": "start", "project": project, "text": text]
        switch how {
        case .start: break
        case .draft: m["draft"] = true
        case .queue(let q): m["queue"] = q
        }
        if let account { m["account"] = account }
        if let chosenModel { m["model"] = chosenModel }
        if let effort { m["effort"] = effort }
        if let worktree { m["worktree"] = worktree }
        lastProject = project
        recent = ([project] + recent.split(separator: "\n").map(String.init).filter { $0 != project }).prefix(6).joined(separator: "\n")
        busy = true
        Task {
            let ok = await model.perform(m)
            busy = false
            if ok {
                if case .start = how { model.closeNew(started: true) } else { model.closeNew(started: false) }
            }
        }
    }

    private func label(_ s: String) -> some View {
        Text(s).font(T.mono(11)).tracking(1.3).foregroundStyle(T.dim).padding(.horizontal, 4)
    }

    private func row(_ name: String, @ViewBuilder _ trailing: () -> some View) -> some View {
        HStack {
            Text(name).font(.system(size: 15)).foregroundStyle(T.hi)
            Spacer()
            trailing()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
    }

    private func value(_ s: String, dot: Color? = nil, menu: Bool = true) -> some View {
        HStack(spacing: 7) {
            if let dot { Circle().fill(dot).frame(width: 7, height: 7) }
            Text(s).font(T.mono(13)).foregroundStyle(T.text)
            if menu { Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(T.dim) }
        }
    }
}

private struct Outline: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(T.hi)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0x243036), lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
