import SwiftUI

/// Prompts that run on a schedule while Hopper is open. A dot means a report you haven't read.
/// Swipe one to run it now, or to pause or resume it.
struct RoutinesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            ScreenTitle(title: "routines")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 6, trailing: 16))
                .listRowSeparator(.hidden)
            if let snap = model.snapshot {
                let routines = snap.items.filter { $0.kind == "routine" }
                if routines.isEmpty {
                    Text("No routines yet. hopper routine templates lists the ones Hopper ships.")
                        .font(.system(size: 15)).foregroundStyle(T.soft).padding(.top, 40)
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(routines) { r in
                            RoutineRow(routine: r)
                                .listRowBackground(T.surface)
                                .listRowInsets(EdgeInsets())
                                .listRowSeparatorTint(T.rowLine)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button { Task { await model.routine(r.id, "run") } } label: { Label("Run now", systemImage: "play.fill") }
                                        .tint(T.focus)
                                    if r.state == "paused" {
                                        Button { Task { await model.routine(r.id, "resume") } } label: { Label("Resume", systemImage: "arrow.clockwise") }
                                            .tint(Color(hex: 0x3A6E5A))
                                    } else {
                                        Button { Task { await model.routine(r.id, "pause") } } label: { Label("Pause", systemImage: "pause.fill") }
                                            .tint(Color(hex: 0x4A5459))
                                    }
                                }
                        }
                    }
                }
            } else {
                Waiting().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(T.bg)
        .contentMargins(.horizontal, 16, for: .scrollContent)
    }
}

struct RoutineRow: View {
    @Environment(AppModel.self) private var model
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
            if routine.state == "paused" {
                Button("Resume") { Task { await model.routine(routine.id, "resume") } }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(T.focus)
                    .padding(.horizontal, 12).frame(height: 32)
                    .overlay(Capsule().stroke(Color(hex: 0x243036), lineWidth: 1))
                    .buttonStyle(.plain)
            } else if let m = routine.model {
                Text(m).font(T.mono(12)).foregroundStyle(T.dim)
            }
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
