import SwiftUI
import UIKit

/// One conversation, as in Hopper's right panel: Claude's own screen, drawn by the Mac at this
/// phone's width, with a text field and a row of keys under it. The Mac draws the whole
/// conversation into a tall screen, so it scrolls here like any list; 1 2 3 answer Claude's
/// questions as on the Mac.
struct ConversationView: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        VStack(spacing: 0) {
            TerminalView(id: id)
            InputBar(id: id)
        }
        .background(T.bg)
        .navigationTitle(model.item(id)?.title ?? "")
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            // Its glyph follows its state, as the row's does.
            ToolbarItem(placement: .principal) { title }
            ToolbarItem(placement: .topBarTrailing) { MacDot().padding(.horizontal, 8) }
                .sharedBackgroundVisibility(.hidden)
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .onDisappear { model.closeScreen() }
    }

    @ViewBuilder
    private var title: some View {
        if let live = model.item(id) {
            VStack(spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Mark(mark: StateMark(live), size: 14)
                    Text(live.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(T.hi).lineLimit(1)
                }
                Text(meta(live)).font(T.mono(11)).foregroundStyle(T.dim).lineLimit(1)
            }
            .animation(.snappy, value: live.state)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
    }

    private func meta(_ live: PhoneItem) -> String {
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
            .animation(.smooth, value: model.link)
            .accessibilityLabel(model.link == .live ? "Mac connected" : "Mac not connected")
    }
}

/// Claude's screen, scrolled here. Claude draws its conversation from the top and pins its
/// prompt to the bottom of a screen far taller than the phone's, with blank rows between; those
/// arrive folded to one (ScreenBuffer), so it reads as one column ending at the prompt. Only the
/// rows that changed are drawn again.
struct TerminalView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var pending: Task<Void, Never>?

    var body: some View {
        let screen = model.screen?.id == id ? model.screen : nil
        let state = screen?.state
        GeometryReader { geo in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if state?.full == true {
                        Button { older() } label: {
                            Label("Older", systemImage: "arrow.up").font(.system(size: 13, weight: .medium))
                                .padding(.horizontal, 12).frame(height: 30)
                                .background(T.surface, in: .capsule)
                        }
                        .buttonStyle(.press)
                        .foregroundStyle(T.soft)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    ForEach(state?.lines ?? []) { line in
                        TermRow(line: line, cursor: state?.cursor?.row == line.id ? state?.cursor?.col : nil)
                            .equatable()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollIndicators(.visible)
            .opacity(state == nil ? 0 : 1)
            .animation(.easeOut(duration: 0.25), value: state == nil)
            .overlay {
                if let why = screen?.closed {
                    note(why, busy: false)
                } else if state?.lines.isEmpty ?? true {
                    note(model.link == .live ? "Opening…" : "Waiting for the Mac…", busy: true)
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            .overlay(alignment: .top) {
                if state?.mine == false, screen?.closed == nil {
                    notMine.transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: state?.mine)
            .onAppear { size(geo.size.width, open: true) }
            .onChange(of: geo.size.width) { _, w in size(w, open: false) }
        }
    }

    private var notMine: some View {
        HStack(spacing: 10) {
            Text("Drawn for the Mac's panel").font(.system(size: 13)).foregroundStyle(T.hi)
            Button("Take it back") { model.reclaimScreen() }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(T.focus)
                .buttonStyle(.press)
        }
        .padding(.horizontal, 14).frame(height: 36)
        .glassEffect(.regular.tint(Color(hex: 0x182024).opacity(0.6)), in: .capsule)
        .padding(.top, 8)
    }

    private func note(_ text: String, busy: Bool) -> some View {
        HStack(spacing: 10) {
            if busy { ProgressView().controlSize(.small).tint(T.dim) }
            Text(text).font(.system(size: 14)).foregroundStyle(T.soft)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(T.surface, in: .rect(cornerRadius: 12))
    }

    // History older than the tall screen: Claude scrolls its own view back a few lines a time.
    private func older() {
        for _ in 0..<5 { model.wheel(up: true) }
    }

    private func size(_ width: CGFloat, open: Bool) {
        let cols = Int((width - 16) / Term.cell.width)
        if open { return model.open(id, cols: cols) }
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled { model.resizeScreen(cols: cols) }
        }
    }
}

/// One row of the screen, laid out already, with the cursor on it if it's there.
struct TermRow: View, Equatable {
    let line: ScreenLine
    var cursor: Int?

    var body: some View {
        Text(line.text).lineLimit(1).fixedSize(horizontal: true, vertical: false)
            .frame(height: Term.cell.height, alignment: .leading)
            .overlay(alignment: .leading) {
                if let cursor {
                    Rectangle().fill(T.focus.opacity(0.55))
                        .frame(width: Term.cell.width, height: Term.cell.height)
                        .offset(x: CGFloat(cursor) * Term.cell.width)
                        .accessibilityHidden(true)
                }
            }
    }
}

/// What you type to Claude, and the keys a phone keyboard lacks. Return sends, as the arrow does;
/// what's typed and not yet sent stays with the conversation when you leave it, and after the app
/// quits. With no Mac, the keys rest and the text waits.
struct InputBar: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var text = ""
    @State private var taps = 0
    @State private var sent = 0
    @FocusState private var typing: Bool

    private var live: Bool { model.link == .live }

    var body: some View {
        VStack(spacing: 9) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("", text: $text, prompt: Text("Type to Claude…").foregroundStyle(T.dim), axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 16))
                    .foregroundStyle(T.hi)
                    .focused($typing)
                    .submitLabel(.send)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(Color(hex: 0x11171A), in: .rect(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).stroke(typing ? T.focus.opacity(0.45) : T.fieldLine, lineWidth: 1))
                    .animation(.easeOut(duration: 0.2), value: typing)
                    .onChange(of: text) { old, new in typed(old, new) }
                Button(action: send) {
                    Image(systemName: text.isEmpty ? "return" : "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 44, height: 44)
                        .background(text.isEmpty ? T.sel : T.focus, in: .circle)
                        .foregroundStyle(text.isEmpty ? T.focus : T.ink)
                        .symbolEffect(.bounce.up, value: sent)
                }
                .buttonStyle(.press(0.88))
                .animation(.snappy(duration: 0.22), value: text.isEmpty)
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
            .opacity(live ? 1 : 0.45)
            .animation(.smooth, value: live)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .sensoryFeedback(.impact(weight: .medium), trigger: sent)
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(T.panel)
        .overlay(alignment: .top) { Rectangle().fill(T.surfaceLine).frame(height: 1) }
        .onAppear { text = model.unsentText(id) }
    }

    // Return arrives as a new line at the end: that's send. A line break inside (pasted text)
    // stays.
    private func typed(_ old: String, _ new: String) {
        if new.hasSuffix("\n"), new.count == old.count + 1 {
            text = String(new.dropLast())
            send()
            return
        }
        model.setUnsent(id, new)
    }

    /// The text goes as one paste and the Mac presses Enter a moment after, so Claude sends it.
    /// With no Mac it stays in the field for when there is one.
    private func send() {
        guard live else {
            taps += 1
            return
        }
        let t = text
        text = ""
        model.setUnsent(id, "")
        sent += 1
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
                    primary ? T.focus : answer ? Color(hex: 0x14120B) : T.key,
                    in: .rect(cornerRadius: 9)
                )
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(answer ? Color(hex: 0x3A321B) : .clear, lineWidth: 1))
                .contentShape(.rect)
        }
        .buttonStyle(.press(0.9))
        .foregroundStyle(primary ? T.ink : answer ? T.waiting : T.hi)
        .allowsHitTesting(live)
        .accessibilityLabel(label ?? title)
    }
}
