import SwiftUI

/// The bar along the bottom, as in the mockups: the tabs in a glass pill, and New as its own round
/// button beside it. Drawn here rather than by the system, which puts New inside the pill.
struct HopperTabBar: View {
    @Environment(AppModel.self) private var model
    @Binding var tab: RootView.TabID

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                item(.work, "Work", "tray", badge: waiting)
                item(.projects, "Projects", "folder")
                item(.accounts, "Accounts", "gauge.with.dots.needle.33percent")
            }
            .padding(4)
            .glassEffect(.regular, in: .capsule)

            Button { tab = .new } label: {
                Image(systemName: "plus").font(.system(size: 22, weight: .bold))
                    .frame(width: 58, height: 58)
                    .background(T.focus, in: .circle)
            }
            .foregroundStyle(Color(hex: 0x0A0C0D))
            .shadow(color: T.focus.opacity(0.25), radius: 12, y: 4)
            .accessibilityLabel("New conversation")
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 2)
    }

    // Waiting on you, as the Mac counts it: not what's on hold.
    private var waiting: Int {
        model.snapshot?.items.filter { $0.group == WorkGroup.waiting.rawValue }.count ?? 0
    }

    private func item(_ id: RootView.TabID, _ title: String, _ icon: String, badge: Int = 0) -> some View {
        let on = tab == id
        return Button { tab = id } label: {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.system(size: 19, weight: on ? .semibold : .regular))
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text("\(badge)").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(hex: 0x0A0C0D))
                                .frame(minWidth: 16, minHeight: 16)
                                .background(T.waiting, in: .capsule)
                                .offset(x: 10, y: -6)
                        }
                    }
                Text(title).font(.system(size: 10.5, weight: on ? .semibold : .medium))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(on ? T.sel : .clear, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .foregroundStyle(on ? T.focus : T.soft)
        .accessibilityLabel(badge > 0 ? "\(title), \(badge) waiting" : title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

extension View {
    /// A tab's page with the bar under it.
    func withTabBar(_ tab: Binding<RootView.TabID>) -> some View {
        toolbarVisibility(.hidden, for: .tabBar)
            .safeAreaInset(edge: .bottom, spacing: 0) { HopperTabBar(tab: tab) }
    }
}
