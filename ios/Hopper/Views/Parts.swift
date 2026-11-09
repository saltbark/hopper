import SwiftUI

// The pieces every screen shares: the frog, the state glyph, a group heading, a card, the pill
// that says whether the Mac is there.

/// Hopper's frog (site/frog.svg), drawn from its 16×16 pixels.
struct Frog: View {
    var size: CGFloat = 26

    // x, y, width, colour: each run of pixels in the SVG.
    private static let runs: [(Int, Int, Int, UInt32)] = [
        (3, 1, 3, 0x14463d), (10, 1, 3, 0x14463d), (2, 2, 1, 0x14463d), (3, 2, 3, 0xf4f7f5), (6, 2, 1, 0x14463d),
        (9, 2, 1, 0x14463d), (10, 2, 3, 0xf4f7f5), (13, 2, 1, 0x14463d), (2, 3, 1, 0x14463d), (3, 3, 1, 0xf4f7f5),
        (4, 3, 1, 0x0c1012), (5, 3, 1, 0xf4f7f5), (6, 3, 4, 0x14463d), (10, 3, 1, 0xf4f7f5), (11, 3, 1, 0x0c1012),
        (12, 3, 1, 0xf4f7f5), (13, 3, 1, 0x14463d), (2, 4, 1, 0x14463d), (3, 4, 1, 0x7fe0bf), (4, 4, 8, 0x3dbf98),
        (12, 4, 1, 0x7fe0bf), (13, 4, 1, 0x14463d), (1, 5, 1, 0x14463d), (2, 5, 1, 0x7fe0bf), (3, 5, 2, 0x3dbf98),
        (5, 5, 1, 0x2a8f72), (6, 5, 4, 0x3dbf98), (10, 5, 1, 0x2a8f72), (11, 5, 2, 0x3dbf98), (13, 5, 1, 0x7fe0bf),
        (14, 5, 1, 0x14463d), (1, 6, 1, 0x14463d), (2, 6, 12, 0x3dbf98), (14, 6, 1, 0x14463d), (1, 7, 1, 0x14463d),
        (2, 7, 1, 0x3dbf98), (3, 7, 10, 0x14463d), (13, 7, 1, 0x3dbf98), (14, 7, 1, 0x14463d), (2, 8, 1, 0x14463d),
        (3, 8, 2, 0x3dbf98), (5, 8, 6, 0xbdf2d9), (11, 8, 2, 0x3dbf98), (13, 8, 1, 0x14463d), (1, 9, 2, 0x14463d),
        (3, 9, 2, 0x3dbf98), (5, 9, 6, 0xbdf2d9), (11, 9, 2, 0x3dbf98), (13, 9, 2, 0x14463d), (0, 10, 1, 0x14463d),
        (1, 10, 1, 0x7fe0bf), (2, 10, 1, 0x3dbf98), (3, 10, 1, 0x14463d), (4, 10, 1, 0x3dbf98), (5, 10, 6, 0xbdf2d9),
        (11, 10, 1, 0x3dbf98), (12, 10, 1, 0x14463d), (13, 10, 1, 0x3dbf98), (14, 10, 1, 0x7fe0bf), (15, 10, 1, 0x14463d),
        (0, 11, 1, 0x14463d), (1, 11, 2, 0x3dbf98), (3, 11, 2, 0x14463d), (5, 11, 1, 0x3dbf98), (6, 11, 4, 0xbdf2d9),
        (10, 11, 1, 0x3dbf98), (11, 11, 2, 0x14463d), (13, 11, 2, 0x3dbf98), (15, 11, 1, 0x14463d), (1, 12, 4, 0x14463d),
        (5, 12, 2, 0x3dbf98), (7, 12, 2, 0x14463d), (9, 12, 2, 0x3dbf98), (11, 12, 4, 0x14463d), (2, 13, 1, 0x14463d),
        (4, 13, 2, 0x14463d), (7, 13, 2, 0x14463d), (10, 13, 2, 0x14463d), (13, 13, 1, 0x14463d),
    ]

    // One path per colour, in pixels, made once: drawing is a handful of fills.
    private static let layers: [(Path, Color)] = {
        var paths: [UInt32: Path] = [:]
        var order: [UInt32] = []
        for (x, y, w, c) in runs {
            if paths[c] == nil { order.append(c) }
            paths[c, default: Path()].addRect(CGRect(x: Double(x), y: Double(y), width: Double(w) + 0.03, height: 1.03))
        }
        return order.map { (paths[$0]!, Color(hex: $0)) }
    }()

    var body: some View {
        Canvas { ctx, sz in
            ctx.scaleBy(x: sz.width / 16, y: sz.height / 16)
            for (path, color) in Self.layers { ctx.fill(path, with: .color(color)) }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The glyph that leads a row; running work spins, as on the Mac. The spinner follows the
/// display's clock and stops while it's off screen.
struct Mark: View {
    let mark: StateMark
    var size: CGFloat = 15

    private static let frames = Array("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏").map(String.init)

    var body: some View {
        Group {
            if let m = mark.mark {
                Text(m).font(T.mono(size, mark.bold ? .bold : .regular))
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
            } else {
                TimelineView(.animation(minimumInterval: 0.1)) { ctx in
                    let i = Int(ctx.date.timeIntervalSinceReferenceDate * 10) % Self.frames.count
                    // Braille dots are small in any font: a size up so they read as a spinner.
                    Text(Self.frames[i]).font(T.mono(size + 5, .bold))
                }
                .transition(.scale(scale: 0.5).combined(with: .opacity))
            }
        }
        .foregroundStyle(mark.color)
        .frame(width: 18)
        .id(mark.mark ?? "spin")
    }
}

/// "18m", kept current: it moves on by the minute without anything else redrawing.
struct AgoText: View {
    let ms: Double

    var body: some View {
        TimelineView(.everyMinute) { ctx in
            Text(Ago.short(ms, now: ctx.date)).monospacedDigit()
                .contentTransition(.numericText())
        }
    }
}

/// "WAITING ON YOU 3 ────", as the Mac heads its groups.
struct GroupHeading: View {
    let label: String
    let count: Int
    let color: Color

    var body: some View {
        HStack(spacing: 8) {
            Text(label.uppercased()).foregroundStyle(color)
            Text("\(count)").foregroundStyle(T.dim)
            Rectangle().fill(T.rule).frame(height: 1)
        }
        .font(T.mono(11))
        .tracking(1.1)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}

/// A rounded group of rows with hairlines between them.
struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(T.surface, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(T.surfaceLine, lineWidth: 1))
    }
}

struct RowDivider: View {
    var body: some View { Rectangle().fill(T.rowLine).frame(height: 1) }
}

/// The bar every page shares: its title in the system's bar (in Hopper's mono, `Chrome`), the
/// Mac's state on the right only when it isn't connected (a phone this size has no room to say
/// "connected" all day), and whatever the page adds there.
struct Bar<Trailing: View>: ViewModifier {
    let title: String
    var large = false
    @ViewBuilder var trailing: Trailing

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .toolbarTitleDisplayMode(large ? .inlineLarge : .inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { LinkChip() }
                    .sharedBackgroundVisibility(.hidden)
                ToolbarItem(placement: .topBarTrailing) { trailing }
            }
    }
}

extension View {
    /// A page with its title and the Mac's state in the bar.
    func bar(_ title: String, large: Bool = false) -> some View {
        modifier(Bar(title: title, large: large) { EmptyView() })
    }

    /// The same, with something of the page's own at the right.
    func bar<T: View>(_ title: String, large: Bool = false, @ViewBuilder trailing: () -> T) -> some View {
        modifier(Bar(title: title, large: large, trailing: trailing))
    }
}

/// The + that opens a new conversation, in a project when it knows which: the bar's prominent
/// glass button.
struct NewButton: View {
    @Environment(AppModel.self) private var model
    let project: String?

    var body: some View {
        Button { model.newConversation(in: project) } label: {
            Image(systemName: "plus").fontWeight(.bold)
        }
        .buttonStyle(.glassProminent)
        .accessibilityLabel(project.map { "New conversation in \($0)" } ?? "New conversation")
    }
}

/// Says the Mac isn't there, and nothing when it is. Tapping it tries again now.
struct LinkChip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            if let (color, text) = state {
                Button { model.reconnectNow() } label: {
                    HStack(spacing: 6) {
                        Circle().fill(color).frame(width: 6, height: 6)
                        Text(text).lineLimit(1).contentTransition(.interpolate)
                    }
                    .font(T.mono(11))
                    .foregroundStyle(T.soft)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .glassEffect(.regular.interactive(), in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint("Tries again now")
                .transition(.scale(scale: 0.85, anchor: .trailing).combined(with: .opacity))
            }
        }
    }

    private var state: (Color, String)? { model.linkNote }
}

extension AppModel {
    /// What to say about the Mac when it isn't connected, in its colour; nil when it is.
    var linkNote: (Color, String)? {
        switch shownLink {
        case .live: return nil
        case .connecting: return (T.dim, "connecting")
        case .macAway:
            if let at = heardAt { return (T.held, "Mac away · \(Ago.short(at.timeIntervalSince1970 * 1000))") }
            return (T.held, "Mac away")
        case .offline: return (T.blocked, "offline")
        }
    }
}

extension View {
    /// A row that opens something when tapped (a conversation to watch, a draft to edit), with no
    /// chevron, as Hopper's rows have none: on a small phone the title needs that width. Rows that
    /// lead to another list keep theirs.
    @ViewBuilder
    func opens(_ item: PhoneItem) -> some View {
        if item.isDraft {
            background { NavigationLink(value: DraftRoute(id: item.id)) { EmptyView() }.opacity(0) }
        } else if item.attach == true {
            background { NavigationLink(value: ConversationRoute(id: item.id)) { EmptyView() }.opacity(0) }
        } else {
            self
        }
    }

    /// A row in one of the lists' cards. One that opens something keeps its chevron off the edge.
    func cardRow(link: Bool = false) -> some View {
        listRowBackground(T.surface)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: link ? 14 : 0))
            .listRowSeparatorTint(T.rowLine)
    }

    /// The look every list screen shares.
    func cardList() -> some View {
        listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .contentMargins(.top, 2, for: .scrollContent)
    }

    /// A heading over a list section, as the Mac heads its groups.
    func sectionHeading() -> some View {
        textCase(nil).listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 6, trailing: 0))
    }
}

/// A button that gives under the finger: it shrinks a little and springs back.
struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.94

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(configuration.isPressed ? .easeOut(duration: 0.08) : .spring(duration: 0.3, bounce: 0.35), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressStyle {
    static var press: PressStyle { PressStyle() }
    static func press(_ scale: CGFloat) -> PressStyle { PressStyle(scale: scale) }
}

/// A row that lights while pressed.
struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? T.sel : .clear)
            .animation(configuration.isPressed ? nil : .easeOut(duration: 0.25), value: configuration.isPressed)
            .contentShape(.rect)
    }
}

/// A bar for a usage limit, with a tick at how far through its window we are. It grows to a new
/// value rather than jumping.
struct Meter: View {
    let pct: Double
    var pace: Double?
    var color: Color?

    var body: some View {
        let fill = min(1, max(0, pct / 100))
        Capsule().fill(Color(hex: 0x1D262A))
            .overlay(alignment: .leading) {
                Capsule().fill(color ?? T.tone(pct))
                    .scaleEffect(x: fill, anchor: .leading)
            }
            .overlay(alignment: .leading) {
                if let pace {
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 1).fill(T.soft)
                            .frame(width: 2, height: 14)
                            .offset(x: geo.size.width * min(1, max(0, pace)) - 1, y: -3)
                    }
                }
            }
            .frame(height: 8)
            .animation(.smooth(duration: 0.6), value: pct)
    }
}

/// What every tab shows before the first snapshot, or with no Mac.
struct Waiting: View {
    @Environment(AppModel.self) private var model
    @State private var breathe = false

    var body: some View {
        VStack(spacing: 14) {
            Frog(size: 56)
                .scaleEffect(breathe ? 1.04 : 0.98)
                .opacity(breathe ? 1 : 0.75)
            Text(message).font(.system(size: 15)).foregroundStyle(T.soft).multilineTextAlignment(.center)
                .contentTransition(.opacity)
            if model.link == .offline {
                Button("Try now") { model.reconnectNow() }
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(T.focus)
                    .buttonStyle(.press)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
        .animation(.smooth, value: model.link)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { breathe = true }
        }
    }

    private var message: String {
        switch model.link {
        case .macAway: "Waiting for Hopper on \(model.pairing?.macName ?? "your Mac").\nIt answers while it's open and awake."
        case .offline: "Can't reach the relay. Trying again."
        default: "Connecting…"
        }
    }
}
