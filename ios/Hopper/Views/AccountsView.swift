import SwiftUI

/// Each login's session and weekly limits, with when they reset and how old the numbers are.
struct AccountsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmUnpair = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let snap = model.snapshot {
                    if let at = snap.accounts.compactMap(\.usageAt).max() {
                        HStack(spacing: 0) {
                            Text("usage read ")
                            AgoText(ms: at)
                            Text(" ago")
                        }
                        .font(T.mono(12)).foregroundStyle(T.dim).padding(.horizontal, 4)
                    }
                    ForEach(snap.accounts) { AccountCard(account: $0) }
                } else {
                    Waiting()
                }

                if let pairing = model.pairing {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("THE MAC").font(T.mono(11)).tracking(1.3).foregroundStyle(T.dim).padding(.horizontal, 4)
                        Card {
                            HStack {
                                Text("Paired with").foregroundStyle(T.hi)
                                Spacer()
                                Text(pairing.macName).font(T.mono(13)).foregroundStyle(T.text)
                            }
                            .padding(.horizontal, 16).frame(height: 50)
                            if let trouble = model.linkTrouble {
                                RowDivider()
                                Text(trouble).font(.system(size: 14)).foregroundStyle(T.blocked)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 16).padding(.vertical, 12)
                            }
                            RowDivider()
                            if model.demo {
                                Button { model.unpair() } label: {
                                    HStack { Text("Leave the demo"); Spacer() }
                                        .padding(.horizontal, 16).frame(height: 50)
                                }
                                .foregroundStyle(T.focus)
                            } else {
                                Button(role: .destructive) { confirmUnpair = true } label: {
                                    HStack { Text("Unpair this phone"); Spacer() }
                                        .padding(.horizontal, 16).frame(height: 50)
                                }
                                .foregroundStyle(T.blocked)
                            }
                        }
                        if model.demo {
                            Text("A made-up Mac on this phone: nothing here is real, and nothing leaves the phone.")
                                .font(.system(size: 13)).foregroundStyle(T.dim).padding(.horizontal, 4)
                        }
                    }
                    .padding(.top, 6)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("ABOUT").font(T.mono(11)).tracking(1.3).foregroundStyle(T.dim).padding(.horizontal, 4)
                    Card {
                        LinkRow(title: "Help", url: Links.help)
                        RowDivider()
                        LinkRow(title: "Privacy policy", url: Links.privacy)
                    }
                }
                .padding(.top, 6)
            }
            .font(.system(size: 15))
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(T.bg)
        .bar("accounts", large: true)
        .confirmationDialog("Unpair this phone?", isPresented: $confirmUnpair, titleVisibility: .visible) {
            Button("Unpair", role: .destructive) { model.unpair() }
        } message: {
            Text("You'll need a new code from the Mac to pair again. On the Mac, hopper unpair forgets this phone there too.")
        }
    }
}

/// Hopper's pages for the app, on its site.
enum Links {
    static let help = URL(string: "https://hopper.saltbark.com/iphone")!
    static let privacy = URL(string: "https://hopper.saltbark.com/privacy")!
}

/// A row that opens a page in the browser.
private struct LinkRow: View {
    let title: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            HStack {
                Text(title).foregroundStyle(T.hi)
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(T.dim)
            }
            .padding(.horizontal, 16).frame(height: 50)
            .contentShape(.rect)
        }
        .buttonStyle(RowPress())
    }
}

struct AccountCard: View {
    let account: PhoneAccount

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Circle().fill(Color(css: account.color)).frame(width: 9, height: 9)
                        Text(account.label).font(.system(size: 17, weight: .semibold)).foregroundStyle(T.hi)
                    }
                    Text(subtitle).font(T.mono(12)).foregroundStyle(T.dim).lineLimit(1)
                }
                Spacer()
                Text("\(Text("\(account.running)").foregroundStyle(T.running)) run · \(Text("\(account.waiting)").foregroundStyle(T.waiting)) you")
                    .foregroundStyle(T.text)
                    .font(T.mono(12))
            }
            if !account.signedIn {
                Text(account.local ? "server not answering" : "signed out").font(T.mono(12)).foregroundStyle(T.blocked)
            } else if !account.local {
                HStack(alignment: .top, spacing: 16) {
                    limit("Session", account.session, window: 5 * 3600)
                    limit("Week", account.week, window: 7 * 86400)
                }
            }
        }
        .padding(16)
        .background(T.surface, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(T.surfaceLine, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        [account.name, account.email, account.plan].compactMap { $0 }.joined(separator: " · ")
    }

    private func limit(_ name: String, _ w: UsageWindow?, window: Double) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).font(.system(size: 13)).foregroundStyle(T.soft)
                Spacer()
                Text(w.map { "\(Int($0.pct.rounded()))%" } ?? "–").font(T.mono(13)).foregroundStyle(T.hi)
            }
            Meter(pct: w?.pct ?? 0, pace: pace(w?.resetsAt, window))
            Text(Ago.reset(w?.resetsAt).map { "↻ \($0)" } ?? " ").font(T.mono(11.5)).foregroundStyle(T.dim)
        }
        .frame(maxWidth: .infinity)
    }

    // How far through its window this limit is, for the tick (paceAt in Accounts.tsx).
    private func pace(_ iso: String?, _ window: Double) -> Double? {
        guard let iso, let t = ISO8601DateFormatter.flexible.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        else { return nil }
        let left = t.timeIntervalSinceNow
        guard left > 0 else { return nil }
        return 1 - min(1, left / window)
    }
}
