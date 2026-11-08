import SwiftUI

/// Everything not done, in the Mac's groups and order: what you're writing, what's running, what
/// waits on you, what's on hold, what's up next. Routines have their own tab.
struct WorkView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            list
                .navigationDestination(for: PhoneItem.self) { ConversationView(item: $0) }
                .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "hopper", frog: true)
                if let snap = model.snapshot {
                    let groups = WorkGroup.allCases.filter { $0 != .routines }.compactMap { g -> (WorkGroup, [PhoneItem])? in
                        let items = snap.items.filter { $0.group == g.rawValue }
                        return items.isEmpty ? nil : (g, items)
                    }
                    if groups.isEmpty {
                        Text("Nothing running or waiting.").font(.system(size: 15)).foregroundStyle(T.soft)
                            .frame(maxWidth: .infinity).padding(.top, 60)
                    }
                    ForEach(groups, id: \.0) { g, items in
                        VStack(spacing: 6) {
                            GroupHeading(label: g.label, count: items.count, color: T.groupColor(g))
                            Card {
                                ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                                    if i > 0 { RowDivider() }
                                    if item.attach == true {
                                        NavigationLink(value: item) { WorkRow(item: item, accounts: snap.accounts) }
                                            .buttonStyle(RowPress())
                                    } else {
                                        WorkRow(item: item, accounts: snap.accounts)
                                    }
                                }
                            }
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
        .background(T.bg)
    }
}

/// A conversation, draft or queued draft: its glyph and name, then where and on what, then age.
struct WorkRow: View {
    let item: PhoneItem
    let accounts: [PhoneAccount]

    var body: some View {
        HStack(spacing: 12) {
            Mark(mark: StateMark(item))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.system(size: 15.5, weight: .semibold))
                    .foregroundStyle(item.group == WorkGroup.held.rawValue ? T.soft : T.hi)
                    .lineLimit(1)
                meta.font(T.mono(12)).lineLimit(1)
            }
            Spacer(minLength: 8)
            if item.kind != "draft", item.group != WorkGroup.next.rawValue {
                Text(Ago.short(item.activeAt)).font(T.mono(12)).foregroundStyle(T.dim)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private var meta: Text {
        let color = accounts.first { $0.name == item.account }.map { Color(css: $0.color) } ?? T.dim
        let account = item.kind == "draft" ? Text("") : Text(" · \(Text(item.account).foregroundStyle(color))")
        let model = [item.model, item.effort].compactMap { $0 }.joined(separator: " ")
        var tail = model.isEmpty ? "" : " · \(model)"
        if item.group == WorkGroup.next.rawValue { tail += item.queue == "night" ? " · tonight" : " · when there's room" }
        return Text("\(item.project)\(account)\(tail)").foregroundStyle(T.dim)
    }
}

/// A row that lights while pressed, as the Mac lights the row under the pointer.
struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? T.sel : .clear)
    }
}
