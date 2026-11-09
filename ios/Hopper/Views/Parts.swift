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

    var body: some View {
        Canvas { ctx, sz in
            let px = sz.width / 16
            for (x, y, w, c) in Self.runs {
                ctx.fill(
                    Path(CGRect(x: CGFloat(x) * px, y: CGFloat(y) * px, width: CGFloat(w) * px + 0.5, height: px + 0.5)),
                    with: .color(Color(hex: c)))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The glyph that leads a row; running work spins, as on the Mac.
struct Mark: View {
    let mark: StateMark
    var size: CGFloat = 15

    private static let frames = Array("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏").map(String.init)

    var body: some View {
        Group {
            if let m = mark.mark {
                Text(m).font(T.mono(size, mark.bold ? .bold : .regular))
            } else {
                TimelineView(.periodic(from: .now, by: 0.12)) { ctx in
                    let i = Int(ctx.date.timeIntervalSinceReferenceDate / 0.12) % Self.frames.count
                    Text(Self.frames[i]).font(T.mono(size))
                }
            }
        }
        .foregroundStyle(mark.color)
        .frame(width: 18)
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

/// Top of a tab: its name in Hopper's mono; the Mac's state only when it isn't connected (a phone
/// this size has no room to say "connected" all day); and a + where a new conversation fits.
struct ScreenTitle: View {
    @Environment(AppModel.self) private var model
    let title: String
    var frog = false
    var newIn: String?? = nil

    var body: some View {
        HStack(spacing: 10) {
            if frog { Frog() }
            Text(title).font(T.mono(frog ? 19 : 26, .bold)).foregroundStyle(T.hi).tracking(-0.4)
            Spacer()
            LinkChip()
            if let project = newIn { NewButton(project: project) }
        }
        .padding(.horizontal, 4)
    }
}

/// A page pushed from a tab: back, then its title, then whatever it adds on the right.
struct PageHeader<Trailing: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    var mono = true
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 4) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 19, weight: .semibold)).frame(width: 36, height: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(T.focus)
            .accessibilityLabel("Back")
            Text(title)
                .font(mono ? T.mono(22, .bold) : .system(size: 20, weight: .bold))
                .foregroundStyle(T.hi).tracking(mono ? -0.4 : 0).lineLimit(1).truncationMode(.head)
            Spacer(minLength: 8)
            LinkChip()
            trailing
        }
    }
}

extension PageHeader where Trailing == EmptyView {
    init(title: String, mono: Bool = true) {
        self.init(title: title, mono: mono) { EmptyView() }
    }
}

/// The round + that opens a new conversation, in a project when it knows which.
struct NewButton: View {
    @Environment(AppModel.self) private var model
    let project: String?

    var body: some View {
        Button { model.newConversation(in: project) } label: {
            Image(systemName: "plus").font(.system(size: 17, weight: .bold))
                .frame(width: 36, height: 36)
                .background(T.focus, in: .circle)
        }
        .foregroundStyle(Color(hex: 0x0A0C0D))
        .accessibilityLabel(project.map { "New conversation in \($0)" } ?? "New conversation")
    }
}

/// Says the Mac isn't there, and nothing when it is.
struct LinkChip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let (color, text) = state {
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(text).lineLimit(1)
            }
            .font(T.mono(11))
            .foregroundStyle(T.soft)
            .padding(.horizontal, 9)
            .frame(height: 26)
            .background(T.surface, in: .capsule)
            .accessibilityElement(children: .combine)
        }
    }

    private var state: (Color, String)? {
        switch model.link {
        case .live: return nil
        case .connecting: return (T.dim, "connecting")
        case .macAway:
            if let at = model.heardAt { return (T.held, "Mac away · \(Ago.short(at.timeIntervalSince1970 * 1000))") }
            return (T.held, "Mac away")
        case .offline: return (T.blocked, "offline")
        }
    }
}

/// A bar for a usage limit, with a tick at how far through its window we are.
struct Meter: View {
    let pct: Double
    var pace: Double?
    var color: Color?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(hex: 0x1D262A))
                Capsule().fill(color ?? T.tone(pct)).frame(width: geo.size.width * min(1, max(0, pct / 100)))
                if let pace {
                    RoundedRectangle(cornerRadius: 1).fill(T.soft)
                        .frame(width: 2, height: 14)
                        .offset(x: geo.size.width * min(1, max(0, pace)) - 1)
                }
            }
        }
        .frame(height: 8)
    }
}

/// What every tab shows before the first snapshot, or with no Mac.
struct Waiting: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 10) {
            Frog(size: 56)
            Text(message).font(.system(size: 15)).foregroundStyle(T.soft).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    private var message: String {
        switch model.link {
        case .macAway: "Waiting for Hopper on \(model.pairing?.macName ?? "your Mac").\nIt answers while it's open and awake."
        case .offline: "Can't reach the relay. Trying again."
        default: "Connecting…"
        }
    }
}
