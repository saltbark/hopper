import SwiftUI

/// Everything not done, in the Mac's groups and order: what you're writing, what's running, what
/// waits on you, what's on hold, what's up next. Tap a conversation to open it, a draft to edit
/// it; swipe left for Done, right to put one that waits on you on hold. Routines and Archived are
/// at the bottom.
struct WorkView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        list
            .background(T.bg)
            .bar("hopper", large: true)
            .toolbar {
                // The frog beside the name, as on the Mac.
                ToolbarItem(placement: .largeTitle) {
                    HStack(spacing: 10) {
                        Frog()
                        Text("hopper").font(T.mono(24, .bold)).foregroundStyle(T.hi).tracking(-0.4)
                    }
                    .padding(.leading, Self.windowControls)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                }
            }
    }

    /// On an iPad, iPadOS draws its window controls over the top left of an iPhone app's window.
    /// The system's own titles move over for them (Accounts' does); this one, ours, is moved by
    /// the same amount. App Review runs iPhone apps on iPads too.
    private static let windowControls: CGFloat = UIDevice.current.model.hasPrefix("iPad") ? 60 : 0

    private var list: some View {
        List {
            if model.snapshot != nil {
                if model.sections.isEmpty {
                    Text("Nothing running or waiting.").font(.system(size: 15)).foregroundStyle(T.soft)
                        .frame(maxWidth: .infinity).padding(.top, 60)
                        .listRowBackground(Color.clear)
                }
                ForEach(model.sections) { s in
                    Section {
                        ForEach(s.items) { item in
                            WorkRow(item: item, accounts: model.snapshot?.accounts ?? [])
                                .opens(item)
                                .cardRow()
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) { doneSwipe(item) }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) { holdSwipe(item, s.group) }
                        }
                    } header: {
                        GroupHeading(label: s.group.label, count: s.items.count, color: T.groupColor(s.group))
                            .sectionHeading()
                    }
                }
                Section {
                    let unread = model.routines.reduce(0) { $0 + ($1.unread ?? 0) }
                    NavigationLink(value: RoutinesRoute()) {
                        PlaceRow(glyph: "↻", color: T.focus, title: "Routines",
                                 count: unread > 0 ? "\(unread) unread" : "\(model.routines.count)", lit: unread > 0)
                    }
                    .cardRow(link: true)
                    NavigationLink(value: ArchivedRoute()) {
                        PlaceRow(glyph: "✓", color: T.dim, title: "Archived", count: "\(model.archived.count)")
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

    // Swipe left: done, into Archived (e on the Mac).
    @ViewBuilder
    private func doneSwipe(_ item: PhoneItem) -> some View {
        if item.kind == "background" || item.kind == "interactive" {
            Button { Task { await model.archive(item) } } label: { Label("Done", systemImage: "checkmark") }
                .tint(T.focus)
        }
    }

    // Swipe right: on hold, still waiting but counted nowhere until it moves (h on the Mac). Only
    // a conversation that waits on you can go on hold; one on hold comes back the same way.
    @ViewBuilder
    private func holdSwipe(_ item: PhoneItem, _ g: WorkGroup) -> some View {
        if g == .waiting {
            Button { Task { await model.hold(item) } } label: { Label("Later", systemImage: "clock") }
                .tint(T.holdTint)
        } else if g == .held {
            Button { Task { await model.hold(item) } } label: { Label("Back", systemImage: "arrow.uturn.backward") }
                .tint(T.holdTint)
        }
    }
}

/// A conversation, draft or queued draft: its glyph and name, then where and on what, then age.
struct WorkRow: View, Equatable {
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
            if !item.isDraft, item.group != WorkGroup.next.rawValue {
                AgoText(ms: item.activeAt).font(T.mono(12)).foregroundStyle(T.dim)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private var meta: Text {
        let color = accounts.first { $0.name == item.account }.map { Color(css: $0.color) } ?? T.dim
        let account = item.isDraft && item.picked != true ? Text("") : Text(" · \(Text(item.account).foregroundStyle(color))")
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
                .contentTransition(.numericText())
        }
        .padding(.horizontal, 14).frame(height: 46)
        .contentShape(.rect)
    }
}
