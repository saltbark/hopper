import SwiftUI

/// Prompts that run on a schedule while Hopper is open. A dot means a report you haven't read.
struct RoutinesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenTitle(title: "routines")
                if let snap = model.snapshot {
                    let routines = snap.items.filter { $0.kind == "routine" }
                    if routines.isEmpty {
                        Text("No routines yet. hopper routine templates lists the ones Hopper ships.")
                            .font(.system(size: 15)).foregroundStyle(T.soft).padding(.top, 40)
                    } else {
                        Card {
                            ForEach(Array(routines.enumerated()), id: \.element.id) { i, r in
                                if i > 0 { RowDivider() }
                                RoutineRow(routine: r)
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

struct RoutineRow: View {
    let routine: PhoneItem

    var body: some View {
        HStack(spacing: 12) {
            Mark(mark: StateMark(routine))
            VStack(alignment: .leading, spacing: 2) {
                Text(routine.title).font(T.mono(15, .medium))
                    .foregroundStyle(routine.state == "paused" ? T.soft : T.hi).lineLimit(1)
                Text(when).font(.system(size: 12)).foregroundStyle(T.dim)
            }
            Spacer()
            if let m = routine.model { Text(m).font(T.mono(12)).foregroundStyle(T.dim) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private var when: String {
        if routine.state == "paused" { return "paused" }
        let unread = (routine.unread ?? 0) > 0 ? "\(routine.unread!) unread · " : ""
        guard let next = routine.nextAt else { return unread + "run by hand" }
        let d = Date(timeIntervalSince1970: next / 1000)
        return unread + "next " + d.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}
