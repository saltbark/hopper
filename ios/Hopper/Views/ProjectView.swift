import SwiftUI

struct ProjectRoute: Hashable { let key: String }

/// One project: its conversations in the Mac's groups, then its archived ones, and a new
/// conversation started right here.
struct ProjectView: View {
    @Environment(AppModel.self) private var model
    let key: String

    var body: some View {
        VStack(spacing: 0) {
            PageHeader(title: key) { NewButton(project: key) }.titleStrip(page: true)
            list
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var list: some View {
        List {
            if model.snapshot != nil {
                let project = model.snapshot?.projects.first { $0.key == key }
                let mine = model.items.filter { $0.project == key && $0.kind != "routine" }
                let archived = model.archived.filter { $0.project == key }

                Text(summary(project, mine))
                    .font(T.mono(12)).foregroundStyle(T.dim)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 4, trailing: 0))
                    .listRowSeparator(.hidden)

                Section {
                    Button { model.newConversation(in: key) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "plus").font(.system(size: 14, weight: .bold)).foregroundStyle(T.focus)
                            Text("New conversation here").font(.system(size: 15, weight: .medium)).foregroundStyle(T.hi)
                            Spacer()
                        }
                        .padding(.horizontal, 14).frame(height: 46)
                        .contentShape(.rect)
                    }
                    .buttonStyle(RowPress())
                    .listRowBackground(T.surface)
                    .listRowInsets(EdgeInsets())
                }

                ForEach(model.sections) { s in
                    let items = s.items.filter { $0.project == key }
                    if !items.isEmpty {
                        Section {
                            ForEach(items) { item in
                                WorkRow(item: item, accounts: model.snapshot?.accounts ?? [])
                                    .opens(item)
                                    .cardRow()
                            }
                        } header: {
                            GroupHeading(label: s.group.label, count: items.count, color: T.groupColor(s.group))
                                .sectionHeading()
                        }
                    }
                }

                if !archived.isEmpty {
                    Section {
                        ForEach(archived) { item in
                            WorkRow(item: item, accounts: model.snapshot?.accounts ?? [])
                                .opens(item)
                                .cardRow()
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    Button { Task { await model.unarchive(item) } } label: {
                                        Label("Bring back", systemImage: "arrow.uturn.backward")
                                    }
                                    .tint(T.focus)
                                }
                        }
                    } header: {
                        GroupHeading(label: "archived", count: archived.count, color: T.dim)
                            .sectionHeading()
                    }
                }

                if mine.isEmpty && archived.isEmpty {
                    Text("No conversations in this project yet.").font(.system(size: 15)).foregroundStyle(T.soft)
                        .frame(maxWidth: .infinity).padding(.top, 20)
                        .listRowBackground(Color.clear)
                }
            } else {
                Waiting().listRowBackground(Color.clear)
            }
        }
        .cardList()
        .listSectionSpacing(12)
    }

    private func summary(_ p: PhoneProject?, _ items: [PhoneItem]) -> String {
        let open = p?.open.map { "\($0) open" }
        let running = items.filter { $0.group == WorkGroup.running.rawValue }.count
        let waiting = items.filter { $0.group == WorkGroup.waiting.rawValue }.count
        return [open, running > 0 ? "\(running) running" : nil, waiting > 0 ? "\(waiting) waiting on you" : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }
}
