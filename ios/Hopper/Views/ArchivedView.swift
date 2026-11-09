import SwiftUI

/// Where Archived opens from the bottom of Work.
struct ArchivedRoute: Hashable {}

/// Conversations marked done, newest first, as Archived on the Mac. Tap one to open it while
/// Claude still has it; swipe right to bring it back into Work.
struct ArchivedView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let all = model.archived
        let shown = query.isEmpty
            ? all : all.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.project.localizedCaseInsensitiveContains(query) }
        VStack(spacing: 0) {
        PageHeader(title: "archived").titleStrip(page: true)
        List {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(T.dim)
                TextField("", text: $query, prompt: Text("Find one").foregroundStyle(T.dim))
                    .foregroundStyle(T.hi)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(T.chip, in: .rect(cornerRadius: 12))
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
            .listRowSeparator(.hidden)

            if shown.isEmpty {
                Text(all.isEmpty ? "Nothing archived." : "Nothing matches.")
                    .font(.system(size: 15)).foregroundStyle(T.soft).padding(.top, 30)
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(shown) { item in
                        ArchivedRow(item: item)
                        .opens(item)
                        .cardRow()
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            Button { Task { await model.unarchive(item) } } label: {
                                Label("Bring back", systemImage: "arrow.uturn.backward")
                            }
                            .tint(T.focus)
                        }
                    }
                } footer: {
                    if all.count >= 60 {
                        Text("The latest 60. The rest are in Archived on the Mac.").font(.system(size: 12)).foregroundStyle(T.dim)
                    }
                }
            }
        }
        .cardList()
        .listSectionSpacing(8)
        .scrollDismissesKeyboard(.immediately)
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
    }
}

private struct ArchivedRow: View {
    let item: PhoneItem

    var body: some View {
        HStack(spacing: 12) {
            Text("✓").font(T.mono(15)).foregroundStyle(T.dim).frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(.system(size: 15.5, weight: .semibold)).foregroundStyle(T.soft).lineLimit(1)
                Text("\(item.project) · \(item.account)").font(T.mono(12)).foregroundStyle(T.dim).lineLimit(1)
            }
            Spacer(minLength: 8)
            AgoText(ms: item.activeAt).font(T.mono(12)).foregroundStyle(T.dim)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}
