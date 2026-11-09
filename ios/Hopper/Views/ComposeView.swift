import SwiftUI

/// A conversation before it starts, as a draft on the Mac is: a project, a prompt (or one of its
/// open items to start from), and what it runs with, each shown with its default by name. Save it
/// as a draft, start it now, or queue it.
///
/// New is what the + beside the tabs shows; leaving goes back to where you were (Work, after
/// starting one). A draft opens here from its row to edit, start, queue or throw away; going back
/// keeps what was changed, as the Mac's editor does.
struct ComposeView: View {
    enum Mode {
        /// A new one, in this project when it came from a project's page.
        case new(String?)
        case draft(PhoneItem)
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    @AppStorage("newProject") private var lastProject = ""
    @AppStorage("recentProjects") private var recent = ""
    @State private var form = Form()
    @State private var opened = Form()
    @State private var query = ""
    @State private var busy: Go?
    @State private var done = false
    @State private var confirmDiscard = false
    @FocusState private var finding: Bool
    @FocusState private var writing: Bool

    /// What the form says, so a draft knows whether it changed.
    struct Form: Equatable {
        var project = ""
        var text = ""
        var account: String?
        var model: String?
        var effort: String?
        var worktree: String?
    }

    enum Go: Equatable { case start, save, queue(String), unqueue }

    init(mode: Mode) {
        self.mode = mode
        // A draft's form is filled before it's first drawn, so nothing flashes empty.
        if case .draft(let d) = mode {
            let f = Form(
                project: d.project, text: d.text ?? d.title, account: d.picked == true ? d.account : nil,
                model: d.model, effort: d.effort, worktree: d.worktree)
            _form = State(initialValue: f)
            _opened = State(initialValue: f)
        }
    }

    private var draft: PhoneItem? { if case .draft(let d) = mode { d } else { nil } }
    private var info: NewInfo? { model.newInfos[form.project] }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let draft, let note = queuedNote(draft) { queuedBanner(note) }
                    projectPicker
                    if let info, !info.items.isEmpty {
                        openItems(info).transition(.opacity.combined(with: .move(edge: .top)))
                    }
                    prompt
                    options
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
                .animation(.snappy(duration: 0.28), value: info?.items)
            }
            .scrollDismissesKeyboard(.interactively)
            actions
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: form.project) {
            guard !form.project.isEmpty else { return }
            await model.newInfo(form.project)
        }
        .onAppear(perform: fill)
        .onDisappear(perform: keepChanges)
        .confirmationDialog("Throw this draft away?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Throw away", role: .destructive, action: discard)
        } message: {
            Text("It goes from the Mac too.")
        }
        .sensoryFeedback(.success, trigger: done) { _, now in now }
    }

    // MARK: Parts

    @ViewBuilder
    private var header: some View {
        HStack(spacing: 4) {
            if let draft {
                BackButton()
                Text(draft.queue == nil ? "draft" : "queued").font(T.mono(22, .bold)).foregroundStyle(T.hi).tracking(-0.4)
                Spacer()
                LinkChip()
                Button { confirmDiscard = true } label: {
                    Image(systemName: "trash").font(.system(size: 16, weight: .medium))
                        .frame(width: 40, height: 40).contentShape(.rect)
                }
                .buttonStyle(.press)
                .foregroundStyle(T.soft)
                .accessibilityLabel("Throw away")
            } else {
                Text("new").font(T.mono(26, .bold)).foregroundStyle(T.hi).tracking(-0.4)
                Spacer()
                LinkChip()
                Button("Cancel") { model.closeNew(started: false) }
                    .font(.system(size: 16)).foregroundStyle(T.focus)
                    .buttonStyle(.press)
                    .padding(.leading, 8)
            }
        }
        .frame(height: 44)
        .padding(.leading, draft == nil ? 20 : 8)
        .padding(.trailing, draft == nil ? 20 : 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    private func queuedNote(_ d: PhoneItem) -> String? {
        guard let q = d.queue else { return nil }
        let when = q == "night" ? "Queued for tonight" : "Queued: starts when there's room"
        return d.waiting.map { "\(when). Waiting: \($0)." } ?? "\(when)."
    }

    private func queuedBanner(_ note: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: draft?.queue == "night" ? "moon" : "circle.dashed").foregroundStyle(T.dim)
            Text(note).font(.system(size: 13)).foregroundStyle(T.soft)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(T.surface, in: .rect(cornerRadius: 12))
    }

    // Type a few letters to find a project: matches drop in under the field, the ones used
    // lately first while nothing is typed. The list is too long to scroll through.
    private var projectPicker: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: finding ? "magnifyingglass" : "folder").foregroundStyle(T.dim).frame(width: 18)
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 1) {
                    TextField("", text: $query, prompt: Text(form.project.isEmpty ? "Find a project" : form.project)
                        .foregroundStyle(finding || form.project.isEmpty ? T.dim : T.hi))
                        .font(T.mono(15, .medium))
                        .foregroundStyle(T.hi)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($finding)
                        .onSubmit { if let first = matches.first { choose(first) } }
                    if !finding {
                        Text(projectLine).font(.system(size: 12)).foregroundStyle(T.dim)
                            .contentTransition(.opacity)
                    }
                }
                Spacer()
                if finding, !form.project.isEmpty {
                    Button("Cancel") { query = ""; finding = false }.font(.system(size: 14)).foregroundStyle(T.focus)
                        .buttonStyle(.press)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            if finding {
                VStack(spacing: 0) {
                    ForEach(matches.prefix(7), id: \.self) { key in
                        Rectangle().fill(T.rowLine).frame(height: 1)
                        Button { choose(key) } label: {
                            HStack {
                                Text(key).font(T.mono(14)).foregroundStyle(key == form.project ? T.focus : T.text).lineLimit(1)
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
                .transition(.opacity)
            }
        }
        .background(T.chip, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(finding ? T.focus.opacity(0.6) : T.cardLine, lineWidth: 1))
        .clipShape(.rect(cornerRadius: 14))
        .animation(.snappy(duration: 0.25), value: finding)
        .animation(.snappy(duration: 0.2), value: query)
    }

    private var matches: [String] {
        let keys = model.snapshot?.projects.map(\.key) ?? []
        if query.trimmingCharacters(in: .whitespaces).isEmpty {
            let known = Set(keys)
            let used = recent.split(separator: "\n").map(String.init).filter(known.contains)
            let usedSet = Set(used)
            return used + keys.filter { !usedSet.contains($0) }
        }
        return Fuzzy.rank(keys, query) { $0 }
    }

    private func choose(_ key: String) {
        form.project = key
        query = ""
        finding = false
        writing = true
    }

    private var projectLine: String {
        guard let info else { return form.project.isEmpty ? " " : "…" }
        let open = model.snapshot?.projects.first { $0.key == form.project }?.open
        return [open.map { "\($0) open" }, "runs in \(info.runIn)"].compactMap { $0 }.joined(separator: " · ")
    }

    private func openItems(_ info: NewInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label("FROM AN OPEN ITEM")
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(info.items, id: \.self) { item in
                        let on = form.text.hasPrefix(item)
                        Button {
                            withAnimation(.snappy(duration: 0.2)) {
                                form.text = on ? "" : item + (item.hasSuffix(".") ? " " : ". ")
                            }
                            writing = true
                        } label: {
                            // A chip stays short enough that the next one shows beside it.
                            Text(item.count > 34 ? item.prefix(32) + "…" : item)
                                .font(.system(size: 13, weight: on ? .medium : .regular)).lineLimit(1)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(on ? Color(hex: 0x0F2624) : .clear, in: .capsule)
                                .overlay(Capsule().stroke(on ? T.focus : T.fieldLine, lineWidth: 1))
                        }
                        .buttonStyle(.press(0.95))
                        .foregroundStyle(on ? Color(hex: 0x96D8D3) : T.text)
                    }
                }
                .padding(.vertical, 1)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
    }

    private var prompt: some View {
        VStack(alignment: .leading, spacing: 8) {
            label("PROMPT")
            TextField("", text: $form.text, prompt: Text("What should Claude do?").foregroundStyle(T.dim), axis: .vertical)
                .lineLimit(6...14)
                .font(.system(size: 16))
                .foregroundStyle(T.hi)
                .focused($writing)
                .padding(14)
                .background(T.field, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(writing ? T.focus.opacity(0.45) : T.cardLine, lineWidth: 1))
                .animation(.easeOut(duration: 0.2), value: writing)
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
                        Picker("Account", selection: $form.account) {
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
                    Picker("Model", selection: $form.model) {
                        Text("\(info?.defaults.model ?? "–") (default)").tag(String?.none)
                        ForEach(info?.models ?? [], id: \.self) { Text($0).tag(Optional($0)) }
                    }
                } label: { value(form.model ?? "\(info?.defaults.model ?? "–") (default)") }
            }
            RowDivider()
            row("Effort") {
                Menu {
                    Picker("Effort", selection: $form.effort) {
                        Text("\(info?.defaults.effort ?? "–") (default)").tag(String?.none)
                        ForEach(info?.efforts ?? [], id: \.self) { Text($0).tag(Optional($0)) }
                    }
                } label: { value(form.effort ?? "\(info?.defaults.effort ?? "–") (default)") }
            }
            RowDivider()
            row("Worktree") {
                HStack(spacing: 10) {
                    if form.worktree == nil {
                        Text("(default)").font(T.mono(12)).foregroundStyle(T.dim).transition(.opacity)
                    }
                    Toggle("Work in a worktree", isOn: worktreeOn).labelsHidden().tint(Color(hex: 0x3A9A93))
                }
                .animation(.snappy(duration: 0.2), value: form.worktree == nil)
            }
        }
        .background(T.chip, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(T.cardLine, lineWidth: 1))
    }

    // Save and Start now are what you'll press; queueing (unattended, when there's room or
    // tonight) is in the clock's menu.
    private var actions: some View {
        HStack(spacing: 8) {
            Menu {
                Button { go(.queue("now")) } label: { Label("Queue: start when there's room", systemImage: "circle.dashed") }
                Button { go(.queue("night")) } label: { Label("Queue for tonight", systemImage: "moon") }
                if draft?.queue != nil {
                    Divider()
                    Button { go(.unqueue) } label: { Label("Unqueue: a draft again", systemImage: "pencil") }
                }
            } label: {
                Group {
                    if case .queue = busy { ProgressView().tint(T.hi) } else { Image(systemName: "clock") }
                }
                .font(.system(size: 17, weight: .medium))
                .frame(width: 52, height: 52)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(T.fieldLine, lineWidth: 1))
                .contentShape(.rect)
            }
            .foregroundStyle(T.hi)
            .accessibilityLabel("Queue")
            Button { go(.save) } label: {
                Group {
                    if busy == .save || busy == .unqueue { ProgressView().tint(T.hi) } else { Text(draft == nil ? "Save draft" : "Save") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(Outline())
            Button { go(.start) } label: {
                Group {
                    if busy == .start { ProgressView().tint(T.ink) } else { Text("Start now") }
                }
                .font(.system(size: 16, weight: .bold)).frame(maxWidth: .infinity).frame(height: 52)
                .background(T.focus.opacity(canGo ? 1 : 0.4), in: .rect(cornerRadius: 16))
                .contentShape(.rect)
            }
            .buttonStyle(.press(0.96))
            .foregroundStyle(T.ink)
        }
        .disabled(!canGo || busy != nil)
        .animation(.snappy(duration: 0.2), value: canGo)
        .animation(.snappy(duration: 0.2), value: busy)
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(T.bg)
        .overlay(alignment: .top) { Rectangle().fill(T.rule).frame(height: 1) }
    }

    // MARK: Helpers

    private var canGo: Bool {
        !form.project.isEmpty && !form.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && model.link == .live
    }

    private var accountText: String {
        guard let info else { return form.account ?? draft?.account ?? "–" }
        if let a = form.account { return info.accounts.first { $0.name == a }?.label ?? a }
        if let r = info.route {
            let label = info.accounts.first { $0.name == r }?.label ?? r
            return info.accounts.count <= 1 ? label : "\(label) (route)"
        }
        return "none: \(info.routeWhy ?? "no route")"
    }

    private var accountColor: Color? {
        let name = form.account ?? info?.route
        return model.snapshot?.accounts.first { $0.name == name }.map { Color(css: $0.color) }
    }

    private var worktreeOn: Binding<Bool> {
        Binding(
            get: { (form.worktree ?? info?.defaults.worktree ?? "yes") == "yes" },
            set: { on in
                let v = on ? "yes" : "no"
                form.worktree = v == info?.defaults.worktree ? nil : v
            })
    }

    private func fill() {
        guard form.project.isEmpty, case .new(let start) = mode else { return }
        let keys = Set(model.snapshot?.projects.map(\.key) ?? [])
        do {
            if let start, keys.contains(start) {
                form.project = start
                writing = true
            } else if keys.contains(lastProject) {
                form.project = lastProject
                writing = true
            } else {
                // Nothing to go on: start by finding one.
                finding = true
            }
        }
        opened = form
    }

    private func message(_ how: Go) -> [String: Any] {
        var m: [String: Any] = ["t": "start", "project": form.project, "text": form.text]
        switch how {
        case .start: break
        case .save, .unqueue: m["draft"] = true
        case .queue(let q): m["queue"] = q
        }
        // Saving a queued draft keeps it queued; unqueueing makes it a draft again.
        if how == .save, let q = draft?.queue { m["queue"] = q }
        if let draft { m["id"] = draft.id }
        if let a = form.account { m["account"] = a }
        if let x = form.model { m["model"] = x }
        if let x = form.effort { m["effort"] = x }
        if let x = form.worktree { m["worktree"] = x }
        return m
    }

    private func go(_ how: Go) {
        lastProject = form.project
        recent = ([form.project] + recent.split(separator: "\n").map(String.init).filter { $0 != form.project })
            .prefix(6).joined(separator: "\n")
        writing = false
        finding = false
        busy = how
        let m = message(how)
        Task {
            let ok = await model.send(draft: m)
            busy = nil
            guard ok else { return }
            done = true
            if draft != nil {
                dismiss()
            } else {
                model.closeNew(started: how == .start)
            }
        }
    }

    // Going back from a draft keeps what changed, as leaving the Mac's editor does.
    private func keepChanges() {
        guard draft != nil, !done, busy == nil, form != opened,
            !form.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !form.project.isEmpty
        else { return }
        let m = message(.save)
        Task { await model.perform(m) }
    }

    private func discard() {
        guard let draft else { return }
        done = true
        dismiss()
        Task { await model.discard(draft) }
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
            Text(s).font(T.mono(13)).foregroundStyle(T.text).contentTransition(.opacity)
            if menu { Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(T.dim) }
        }
        .animation(.snappy(duration: 0.2), value: s)
    }
}

/// A draft opened from its row. It reads the draft from the latest snapshot, so one started or
/// thrown away on the Mac meanwhile says so rather than editing nothing.
struct DraftView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var item: PhoneItem?

    var body: some View {
        Group {
            if let item = item ?? model.item(id) {
                ComposeView(mode: .draft(item))
            } else {
                VStack(spacing: 0) {
                    PageHeader(title: "draft").titleStrip(page: true)
                    Text("That draft is gone: started or thrown away on the Mac.")
                        .font(.system(size: 15)).foregroundStyle(T.soft).multilineTextAlignment(.center)
                        .padding(.top, 60).padding(.horizontal, 32)
                    Spacer()
                }
                .background(T.bg)
                .toolbar(.hidden, for: .navigationBar)
            }
        }
        // The draft as it was when it opened: the form owns it from there.
        .onAppear { if item == nil { item = model.item(id) } }
    }
}

private struct Outline: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(T.hi)
            .padding(.horizontal, 16)
            .frame(height: 52)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(T.fieldLine, lineWidth: 1))
            .contentShape(.rect)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(configuration.isPressed ? .easeOut(duration: 0.08) : .spring(duration: 0.3, bounce: 0.35), value: configuration.isPressed)
    }
}
