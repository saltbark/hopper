import SwiftUI

/// The projects in Hopper's home, with how many open items each has, how many conversations are
/// running and how many wait on you. Tap one for its conversations.
struct ProjectsView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenTitle(title: "projects")
                if let snap = model.snapshot {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(T.dim)
                        TextField("", text: $query, prompt: Text("Find a project").foregroundStyle(T.dim))
                            .foregroundStyle(T.hi)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .background(T.chip, in: .rect(cornerRadius: 12))

                    HStack(spacing: 0) {
                        Spacer()
                        ForEach(["open", "run", "you"], id: \.self) { Text($0).frame(width: 40, alignment: .trailing) }
                    }
                    .font(T.mono(11))
                    .foregroundStyle(T.dim)
                    .padding(.horizontal, 14)

                    let shown = Fuzzy.rank(snap.projects, query) { $0.key }
                    Card {
                        ForEach(Array(shown.enumerated()), id: \.element.id) { i, p in
                            if i > 0 { RowDivider() }
                            NavigationLink(value: ProjectRoute(key: p.key)) { ProjectRow(project: p) }
                                .buttonStyle(RowPress())
                        }
                    }
                } else {
                    Waiting()
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .background(T.bg)
    }
}

struct ProjectRow: View {
    let project: PhoneProject

    var body: some View {
        HStack(spacing: 0) {
            keyText.font(T.mono(15, .medium)).lineLimit(1).truncationMode(.head)
            Spacer(minLength: 8)
            count(project.open, T.text)
            count(project.running, T.running)
            count(project.waiting, T.waiting, bold: true)
        }
        .padding(.horizontal, 14)
        .frame(height: 50)
        .accessibilityElement(children: .combine)
    }

    // A nested key shows its parent dimmer: pm/lantern/ apps/ledger.
    private var keyText: Text {
        let parts = project.key.split(separator: "/")
        guard parts.count > 2 else { return Text(project.key).foregroundStyle(T.hi) }
        let head = parts.prefix(2).joined(separator: "/") + "/"
        let rest = parts.dropFirst(2).joined(separator: "/")
        return Text("\(Text(head).foregroundStyle(T.dim))\(Text(rest).foregroundStyle(T.hi))")
    }

    private func count(_ n: Int?, _ color: Color, bold: Bool = false) -> some View {
        Text(n.map { $0 > 0 ? "\($0)" : "·" } ?? "–")
            .font(T.mono(13, bold && (n ?? 0) > 0 ? .bold : .regular))
            .foregroundStyle((n ?? 0) > 0 ? color : T.dim)
            .frame(width: 40, alignment: .trailing)
    }
}

