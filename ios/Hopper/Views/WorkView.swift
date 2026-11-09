import SwiftUI

/// Everything not done, in the Mac's groups and order: what you're writing, what's running, what
/// waits on you, what's on hold, what's up next. Routines have their own tab. Tap a conversation
/// to open it; swipe left for Done, right to put one that waits on you on hold. Archived is at
/// the bottom.
struct WorkView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            ScreenTitle(title: "hopper", frog: true, newIn: .some(nil)).titleStrip()
            list
        }
        .background(T.bg)
    }

    private var groups: [(WorkGroup, [PhoneItem])] {
        guard let snap = model.snapshot else { return [] }
        return WorkGroup.allCases.filter { $0 != .routines }.compactMap { g in
            let items = snap.items.filter { $0.group == g.rawValue }
            return items.isEmpty ? nil : (g, items)
        }
    }

    private var list: some View {
        List {
            if let snap = model.snapshot {
                if groups.isEmpty {
                    Text("Nothing running or waiting.").font(.system(size: 15)).foregroundStyle(T.soft)
                        .frame(maxWidth: .infinity).padding(.top, 60)
                        .listRowBackground(Color.clear)
                }
                ForEach(groups, id: \.0) { g, items in
                    Section {
                        ForEach(items) { item in
                            row(item, snap.accounts)
                                .cardRow(link: item.attach == true)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) { doneSwipe(item) }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) { holdSwipe(item, g) }
                        }
                    } header: {
                        GroupHeading(label: g.label, count: items.count, color: T.groupColor(g))
                            .textCase(nil)
                            .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 6, trailing: 0))
                    }
                }
                Section {
                    let routines = snap.items.filter { $0.kind == "routine" }
                    let unread = routines.reduce(0) { $0 + ($1.unread ?? 0) }
                    NavigationLink(value: RoutinesRoute()) {
                        PlaceRow(glyph: "↻", color: T.focus, title: "Routines",
                                 count: unread > 0 ? "\(unread) unread" : "\(routines.count)", lit: unread > 0)
                    }
                    .cardRow(link: true)
                    NavigationLink(value: ArchivedRoute()) {
                        PlaceRow(glyph: "✓", color: T.dim, title: "Archived", count: "\(snap.archived?.count ?? 0)")
                    }
                    .cardRow(link: true)
                }
            } else {
                Waiting().listRowBackground(Color.clear)
            }
        }
        .cardList()
        .listSectionSpacing(14)
    }

    @ViewBuilder
    private func row(_ item: PhoneItem, _ accounts: [PhoneAccount]) -> some View {
        if item.attach == true {
            NavigationLink(value: item) { WorkRow(item: item, accounts: accounts) }
        } else {
            WorkRow(item: item, accounts: accounts)
        }
    }

    // Swipe left: done, into Archived (e on the Mac).
    @ViewBuilder
    private func doneSwipe(_ item: PhoneItem) -> some View {
        if item.kind == "background" || item.kind == "interactive" {
            Button { Task { await model.archive(item.id) } } label: { Label("Done", systemImage: "checkmark") }
                .tint(T.focus)
        }
    }

    // Swipe right: on hold, still waiting but counted nowhere until it moves (h on the Mac). Only
    // a conversation that waits on you can go on hold; one on hold comes back the same way.
    @ViewBuilder
    private func holdSwipe(_ item: PhoneItem, _ g: WorkGroup) -> some View {
        if g == .waiting {
            Button { Task { await model.hold(item.id) } } label: { Label("Later", systemImage: "clock") }
                .tint(Color(hex: 0x8C7A4F))
        } else if g == .held {
            Button { Task { await model.hold(item.id) } } label: { Label("Back", systemImage: "arrow.uturn.backward") }
                .tint(Color(hex: 0x8C7A4F))
        }
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

/// A row on Work that leads somewhere else: Routines, Archived.
struct PlaceRow: View {
    let glyph: String
    let color: Color
    let title: String
    let count: String
    var lit = false

    var body: some View {
        HStack(spacing: 12) {
            Text(glyph).font(T.mono(15)).foregroundStyle(color).frame(width: 18)
            Text(title).font(.system(size: 15)).foregroundStyle(T.text)
            Spacer()
            Text(count).font(T.mono(12)).foregroundStyle(lit ? T.focus : T.dim)
        }
        .padding(.horizontal, 14).frame(height: 46)
        .contentShape(.rect)
    }
}
