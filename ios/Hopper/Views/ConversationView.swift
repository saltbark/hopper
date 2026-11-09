import SwiftUI
import UIKit

/// One conversation, as in Hopper's right panel: Claude's own screen, drawn by the Mac at this
/// phone's width, with a text field and a row of keys under it. Swipe the screen to scroll
/// (Claude's PgUp/PgDn); 1 2 3 answer its questions as on the Mac.
struct ConversationView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let item: PhoneItem

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(T.rowLine).frame(height: 1)
            TerminalView(id: item.id)
            InputBar()
        }
        .background(T.bg)
        .toolbar(.hidden, for: .navigationBar)
        .onDisappear { model.closeScreen() }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 19, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .foregroundStyle(T.focus)
            .accessibilityLabel("Back to Work")
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Mark(mark: StateMark(live), size: 15)
                    Text(live.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(T.hi).lineLimit(1)
                }
                Text(meta).font(T.mono(11.5)).foregroundStyle(T.dim).lineLimit(1)
            }
            Spacer(minLength: 4)
            if live.group == WorkGroup.waiting.rawValue || live.group == WorkGroup.held.rawValue {
                Button { Task { await model.hold(item.id) } } label: {
                    Text("◷").font(T.mono(16)).frame(width: 38, height: 38)
                        .background(T.surface, in: .circle)
                        .overlay(Circle().stroke(Color(hex: 0x1F2A2F), lineWidth: 1))
                }
                .foregroundStyle(T.held)
                .accessibilityLabel(live.group == WorkGroup.held.rawValue ? "Take off hold" : "Put on hold")
            }
            Button {
                Task {
                    if await model.perform(["t": "done", "id": item.id]) { dismiss() }
                }
            } label: {
                Text("✓").font(T.mono(16)).frame(width: 38, height: 38)
                    .background(T.surface, in: .circle)
                    .overlay(Circle().stroke(Color(hex: 0x1F2A2F), lineWidth: 1))
            }
            .foregroundStyle(T.focus)
            .accessibilityLabel("Mark done")
            MacDot().padding(.leading, 4)
        }
        .padding(.leading, 4)
        .padding(.trailing, 14)
        .padding(.bottom, 8)
    }

    /// The item as the latest snapshot has it, so its glyph follows its state.
    private var live: PhoneItem {
        model.snapshot?.items.first { $0.id == item.id } ?? model.snapshot?.archived?.first { $0.id == item.id } ?? item
    }

    private var meta: String {
        ([live.project, live.account] + [[live.model, live.effort].compactMap { $0 }.joined(separator: " ")]
            + [Ago.short(live.activeAt)]).filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Just the dot of the Mac's state, where there's no room for the pill.
private struct MacDot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Circle().fill(model.link == .live ? T.running : model.link == .offline ? T.blocked : T.held)
            .frame(width: 8, height: 8)
            .accessibilityLabel(model.link == .live ? "Mac connected" : "Mac not connected")
    }
}

/// Claude's screen. Its size in cells follows the space it has, and the Mac redraws to match.
struct TerminalView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var dragged: CGFloat = 0
    @State private var pending: Task<Void, Never>?

    static let fontSize: CGFloat = 11.5
    static let cell: CGSize = {
        let f = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        return CGSize(width: ("M" as NSString).size(withAttributes: [.font: f]).width, height: ceil(f.lineHeight))
    }()

    var body: some View {
        GeometryReader { geo in
            let cell = Self.cell
            let screen = model.screen?.id == id ? model.screen : nil
            ZStack(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array((screen?.rows ?? []).enumerated()), id: \.offset) { _, runs in
                        TermRow(runs: runs).equatable().frame(height: cell.height, alignment: .leading)
                    }
                }
                if let c = screen?.cursor {
                    Rectangle().fill(T.focus.opacity(0.55))
                        .frame(width: cell.width, height: cell.height)
                        .offset(x: CGFloat(c.col) * cell.width, y: CGFloat(c.row) * cell.height)
                        .accessibilityHidden(true)
                }
                if let why = screen?.closed {
                    note(why)
                } else if screen?.rows.allSatisfy(\.isEmpty) ?? true {
                    note(model.link == .live ? "Opening…" : "Waiting for the Mac…")
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipped()
            .contentShape(.rect)
            .gesture(scroll)
            .onAppear { size(geo.size, open: true) }
            .onChange(of: geo.size) { _, s in size(s, open: false) }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.system(size: 14)).foregroundStyle(T.soft)
            .padding(12).background(T.surface, in: .rect(cornerRadius: 12))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // A swipe scrolls Claude's view a page per stretch, as the wheel does on the Mac.
    private var scroll: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { v in
                let step = Self.cell.height * 4
                let moved = v.translation.height - dragged
                if abs(moved) >= step {
                    model.wheel(up: moved > 0)
                    dragged += moved
                }
            }
            .onEnded { _ in dragged = 0 }
    }

    private func size(_ s: CGSize, open: Bool) {
        let cols = Int((s.width - 16) / Self.cell.width)
        let rows = Int((s.height - 8) / Self.cell.height)
        if open { return model.open(id, cols: cols, rows: rows) }
        // The keyboard comes and goes: wait for it to settle before Claude redraws.
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled { model.resizeScreen(cols: cols, rows: rows) }
        }
    }
}

/// One row of the screen, in the Mac's colours.
struct TermRow: View, Equatable {
    let runs: [Run]

    var body: some View {
        Text(attributed).lineLimit(1).fixedSize(horizontal: true, vertical: false)
    }

    private var attributed: AttributedString {
        var out = AttributedString()
        for r in runs {
            var s = AttributedString(r.text)
            var fg = r.fg.map(Color.init(css:)) ?? T.text
            var bg = r.bg.map(Color.init(css:))
            if r.inverse { (fg, bg) = (bg ?? T.bg, fg) }
            s.foregroundColor = r.dim ? fg.opacity(0.55) : fg
            if let bg { s.backgroundColor = bg }
            var font = Font.system(size: TerminalView.fontSize, weight: r.bold ? .bold : .regular, design: .monospaced)
            if r.italic { font = font.italic() }
            s.font = font
            if r.underline { s.underlineStyle = .single }
            out += s
        }
        return out
    }
}

/// What you type to Claude, and the keys a phone keyboard lacks.
struct InputBar: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var taps = 0
    @FocusState private var typing: Bool

    var body: some View {
        VStack(spacing: 9) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("", text: $text, prompt: Text("Type to Claude…").foregroundStyle(T.dim), axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 16))
                    .foregroundStyle(T.hi)
                    .focused($typing)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(Color(hex: 0x11171A), in: .rect(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color(hex: 0x243036), lineWidth: 1))
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold))
                        .frame(width: 44, height: 44)
                        .background(T.sel, in: .circle)
                }
                .foregroundStyle(T.focus)
                .accessibilityLabel(text.isEmpty ? "Enter" : "Send")
            }
            HStack(spacing: 5) {
                key("esc", "\u{1b}")
                key("^C", "\u{03}", label: "Interrupt")
                key("↑", "\u{1b}[A", label: "Up")
                key("↓", "\u{1b}[B", label: "Down")
                key("1", "1", answer: true)
                key("2", "2", answer: true)
                key("3", "3", answer: true)
                key("⏎", "\r", label: "Enter", primary: true)
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(Color(hex: 0x0D1214))
        .overlay(alignment: .top) { Rectangle().fill(T.surfaceLine).frame(height: 1) }
    }

    /// Short typing goes as keys; anything long or on several lines as one paste. Then Enter.
    private func send() {
        let t = text
        text = ""
        if t.isEmpty { return model.keys("\r") }
        if t.contains("\n") || t.count > 200 { model.paste(t) } else { model.keys(t) }
        model.keys("\r")
    }

    private func key(_ title: String, _ bytes: String, label: String? = nil, answer: Bool = false, primary: Bool = false) -> some View {
        Button {
            taps += 1
            model.keys(bytes)
        } label: {
            Text(title).font(T.mono(13, answer || primary ? .bold : .regular))
                .frame(maxWidth: .infinity).frame(height: 40)
                .background(
                    primary ? T.focus : answer ? Color(hex: 0x14120B) : Color(hex: 0x1D262A),
                    in: .rect(cornerRadius: 9)
                )
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(answer ? Color(hex: 0x3A321B) : .clear, lineWidth: 1))
        }
        .foregroundStyle(primary ? Color(hex: 0x0A0C0D) : answer ? T.waiting : T.hi)
        .accessibilityLabel(label ?? title)
    }
}
