import SwiftUI

/// A new conversation, as a draft on the Mac would be: a project, a prompt (or one of its open
/// items to start from), and what it runs with, each shown with its default by name. Start now,
/// queue it for when there's room, or queue it for tonight.
struct NewConversationView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("newProject") private var project = ""
    @State private var info: NewInfo?
    @State private var text = ""
    @State private var account: String?
    @State private var chosenModel: String?
    @State private var effort: String?
    @State private var worktree: String?
    @State private var busy = false
    @FocusState private var writing: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    projectPicker
                    if let info, !info.items.isEmpty { openItems(info) }
                    prompt
                    options
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 110)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(T.surface)
            .navigationTitle("New conversation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) { actions }
        }
        .presentationDragIndicator(.visible)
        .presentationBackground(T.surface)
        .task(id: project) { await load() }
        .onAppear {
            let keys = model.snapshot?.projects.map(\.key) ?? []
            if !keys.contains(project) { project = keys.first ?? "" }
        }
    }

    // MARK: Parts

    private var projectPicker: some View {
        Menu {
            Picker("Project", selection: $project) {
                ForEach(model.snapshot?.projects ?? []) { Text($0.key).tag($0.key) }
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "folder").foregroundStyle(T.dim)
                VStack(alignment: .leading, spacing: 1) {
                    Text(project.isEmpty ? "Pick a project" : project).font(T.mono(15, .medium)).foregroundStyle(T.hi)
                    Text(projectLine).font(.system(size: 12)).foregroundStyle(T.dim)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 13)).foregroundStyle(T.dim)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(T.chip, in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0x1F2A2F), lineWidth: 1))
        }
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
                Menu {
                    Picker("Account", selection: $account) {
                        Text(routeText).tag(String?.none)
                        ForEach(info?.accounts ?? [], id: \.self) { Text($0.label).tag(Optional($0.name)) }
                    }
                } label: { value(account.flatMap { a in info?.accounts.first { $0.name == a }?.label } ?? routeText, dot: accountColor) }
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

    private var actions: some View {
        HStack(spacing: 8) {
            Button { go(queue: "night") } label: { Label("Tonight", systemImage: "moon").labelStyle(.titleAndIcon) }
                .buttonStyle(Outline())
            Button { go(queue: "now") } label: { Label("Queue", systemImage: "circle").labelStyle(.titleAndIcon) }
                .buttonStyle(Outline())
            Button { go(queue: nil) } label: {
                Group { if busy { ProgressView().tint(Color(hex: 0x0A0C0D)) } else { Text("Start now") } }
                    .font(.system(size: 16, weight: .bold)).frame(maxWidth: .infinity).frame(height: 52)
            }
            .foregroundStyle(Color(hex: 0x0A0C0D))
            .background(T.focus.opacity(canGo ? 1 : 0.4), in: .rect(cornerRadius: 16))
        }
        .disabled(!canGo || busy)
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(T.surface)
        .overlay(alignment: .top) { Rectangle().fill(T.surfaceLine).frame(height: 1) }
    }

    // MARK: Helpers

    private var canGo: Bool { !project.isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && model.link == .live }

    private var routeText: String {
        guard let info else { return "–" }
        if let r = info.route { return "\(info.accounts.first { $0.name == r }?.label ?? r) (route)" }
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

    private func go(queue: String?) {
        var m: [String: Any] = ["t": "start", "project": project, "text": text]
        if let account { m["account"] = account }
        if let chosenModel { m["model"] = chosenModel }
        if let effort { m["effort"] = effort }
        if let worktree { m["worktree"] = worktree }
        if let queue { m["queue"] = queue }
        busy = true
        Task {
            let ok = await model.perform(m)
            busy = false
            if ok { dismiss() }
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

    private func value(_ s: String, dot: Color? = nil) -> some View {
        HStack(spacing: 7) {
            if let dot { Circle().fill(dot).frame(width: 7, height: 7) }
            Text(s).font(T.mono(13)).foregroundStyle(T.text)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(T.dim)
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
