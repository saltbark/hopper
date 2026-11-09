import SwiftUI

/// The bar along the bottom, as in the mockups: the tabs in a glass pill, and New as its own round
/// button beside it. Drawn here rather than by the system, which puts New inside the pill. The
/// lit tab's backing slides from one tab to the next.
struct HopperTabBar: View {
    @Environment(AppModel.self) private var model
    @Binding var tab: RootView.TabID
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                item(.work, "Work", "tray", badge: model.waitingCount)
                item(.projects, "Projects", "folder")
                item(.accounts, "Accounts", "gauge.with.dots.needle.33percent")
            }
            .padding(4)
            .glassEffect(.regular, in: .capsule)

            Button { withAnimation(.snappy(duration: 0.3)) { tab = .new } } label: {
                Image(systemName: "plus").font(.system(size: 22, weight: .bold))
                    .frame(width: 58, height: 58)
                    .background(T.focus, in: .circle)
            }
            .buttonStyle(.press(0.9))
            .foregroundStyle(T.ink)
            .shadow(color: T.focus.opacity(0.25), radius: 12, y: 4)
            .accessibilityLabel("New conversation")
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 2)
        .sensoryFeedback(.selection, trigger: tab)
    }

    private func item(_ id: RootView.TabID, _ title: String, _ icon: String, badge: Int = 0) -> some View {
        let on = tab == id
        return Button {
            withAnimation(.spring(duration: 0.35, bounce: 0.22)) { tab = id }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.system(size: 19, weight: on ? .semibold : .regular))
                    .symbolEffect(.bounce.down, value: on)
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text("\(badge)").font(.system(size: 10, weight: .bold)).foregroundStyle(T.ink)
                                .monospacedDigit()
                                .contentTransition(.numericText(value: Double(badge)))
                                .frame(minWidth: 16, minHeight: 16)
                                .background(T.waiting, in: .capsule)
                                .offset(x: 10, y: -6)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .animation(.spring(duration: 0.35, bounce: 0.3), value: badge)
                Text(title).font(.system(size: 10.5, weight: on ? .semibold : .medium))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background {
                if on { Capsule().fill(T.sel).matchedGeometryEffect(id: "pill", in: pill) }
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.press(0.95))
        .foregroundStyle(on ? T.focus : T.soft)
        .accessibilityLabel(badge > 0 ? "\(title), \(badge) waiting" : title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
