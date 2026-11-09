import SwiftUI
import UIKit

/// One conversation, as in Hopper's right panel: Claude's own screen, drawn by the Mac at this
/// phone's width, with a text field and a row of keys under it. The Mac draws the whole
/// conversation into a tall screen, so it scrolls here like any list; 1 2 3 answer Claude's
/// questions as on the Mac.
struct ConversationView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let item: PhoneItem

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(T.rowLine).frame(height: 1)
            TerminalView(id: item.id)
            InputBar(id: item.id)
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
            .accessibilityLabel("Back")
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Mark(mark: StateMark(live), size: 15)
                    Text(live.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(T.hi).lineLimit(1)
                }
                Text(meta).font(T.mono(11.5)).foregroundStyle(T.dim).lineLimit(1)
            }
            Spacer(minLength: 4)
            MacDot()
        }
        .padding(.leading, 4)
        .padding(.trailing, 16)
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

/// Claude's screen, scrolled here. Claude draws its conversation from the top and pins its
/// prompt to the bottom of a screen far taller than the phone's, with blank rows between; those
/// fold to one, so it reads as one column ending at the prompt.
struct TerminalView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var pending: Task<Void, Never>?

    static let fontSize: CGFloat = 11.5
    static let cell: CGSize = {
        let f = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        return CGSize(width: ("M" as NSString).size(withAttributes: [.font: f]).width, height: ceil(f.lineHeight))
    }()

    var body: some View {
        let screen = model.screen?.id == id ? model.screen : nil
        let shown = screen.map(Self.fold) ?? Fold(rows: [], full: false)
        GeometryReader { geo in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if shown.full {
                        Button { older() } label: {
                            Label("Older", systemImage: "arrow.up").font(.system(size: 13, weight: .medium))
                                .padding(.horizontal, 12).frame(height: 30)
                                .background(T.surface, in: .capsule)
                        }
                        .foregroundStyle(T.soft)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    ForEach(shown.rows, id: \.index) { row in
                        TermRow(runs: row.runs, cursor: screen?.cursor?.row == row.index ? screen?.cursor?.col : nil)
                            .equatable()
                            .frame(height: Self.cell.height, alignment: .leading)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollIndicators(.visible)
            .overlay {
                if let why = screen?.closed {
                    note(why)
                } else if shown.rows.isEmpty {
                    note(model.link == .live ? "Opening…" : "Waiting for the Mac…")
                }
            }
            .overlay(alignment: .top) {
                if screen?.mine == false, screen?.closed == nil { notMine }
            }
            .onAppear { size(geo.size.width, open: true) }
            .onChange(of: geo.size.width) { _, w in size(w, open: false) }
        }
    }

    /// Claude's screen with its runs of blank rows folded to one, and whether it was full (no
    /// blank stretch: there may be more above, for Claude to scroll to).
    struct Fold {
        let rows: [(index: Int, runs: [Run])]
        let full: Bool
    }

    static func fold(_ s: Screen) -> Fold {
        var out: [(index: Int, runs: [Run])] = []
        var folded = false
        for (i, runs) in s.rows.enumerated() {
            if runs.isEmpty, out.last?.runs.isEmpty ?? true {
                folded = true
                continue
            }
            out.append((i, runs))
        }
        return Fold(rows: out, full: !folded && !out.isEmpty)
    }

    private var notMine: some View {
        HStack(spacing: 10) {
            Text("Drawn for the Mac's panel").font(.system(size: 13)).foregroundStyle(T.hi)
            Button("Take it back") { model.reclaimScreen() }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(T.focus)
        }
        .padding(.horizontal, 14).frame(height: 36)
        .background(Color(hex: 0x182024).opacity(0.97), in: .capsule)
        .overlay(Capsule().stroke(Color(hex: 0x2A363C), lineWidth: 1))
        .padding(.top, 8)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.system(size: 14)).foregroundStyle(T.soft)
            .padding(12).background(T.surface, in: .rect(cornerRadius: 12))
    }

    // History older than the tall screen: Claude scrolls its own view back a few lines a time.
    private func older() {
        for _ in 0..<5 { model.wheel(up: true) }
    }

    private func size(_ width: CGFloat, open: Bool) {
        let cols = Int((width - 16) / Self.cell.width)
        if open { return model.open(id, cols: cols) }
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled { model.resizeScreen(cols: cols) }
        }
    }
}

/// One row of the screen, in the Mac's colours, with the cursor on it if it's there.
struct TermRow: View, Equatable {
    let runs: [Run]
    var cursor: Int?

    var body: some View {
        Text(attributed).lineLimit(1).fixedSize(horizontal: true, vertical: false)
            .overlay(alignment: .leading) {
                if let cursor {
                    Rectangle().fill(T.focus.opacity(0.55))
                        .frame(width: TerminalView.cell.width, height: TerminalView.cell.height)
                        .offset(x: CGFloat(cursor) * TerminalView.cell.width)
                        .accessibilityHidden(true)
                }
            }
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

/// What you type to Claude, and the keys a phone keyboard lacks. Return sends, as the arrow does;
/// what's typed and not yet sent stays with the conversation when you leave it.
struct InputBar: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var taps = 0
    @FocusState private var typing: Bool

    var body: some View {
        VStack(spacing: 9) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("", text: draft, prompt: Text("Type to Claude…").foregroundStyle(T.dim), axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 16))
                    .foregroundStyle(T.hi)
                    .focused($typing)
                    .submitLabel(.send)
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
                .accessibilityLabel(model.draft(id).isEmpty ? "Enter" : "Send")
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

    // The conversation's own draft. Return arrives as a new line at the end: that's send. A line
    // break inside (pasted text) stays.
    private var draft: Binding<String> {
        Binding(
            get: { model.draft(id) },
            set: { new in
                if new.hasSuffix("\n"), new.count == model.draft(id).count + 1 {
                    model.setDraft(id, String(new.dropLast()))
                    send()
                } else {
                    model.setDraft(id, new)
                }
            })
    }

    /// The text goes as one paste and the Mac presses Enter a moment after, so Claude sends it.
    private func send() {
        let t = model.draft(id)
        model.setDraft(id, "")
        taps += 1
        model.submit(t)
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
