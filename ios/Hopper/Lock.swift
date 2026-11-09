import LocalAuthentication
import Observation
import SwiftUI

/// A paired phone can start Claude on its Mac and type into it, so the app asks for Face ID, Touch
/// ID or the passcode when it opens, and when it comes back after more than `grace` in the
/// background. A cover hides everything while it's locked and whenever the app isn't in front,
/// so the app switcher shows nothing.
@Observable
final class AppLock {
    /// How long the app may sit in the background and come back without asking again.
    static let grace: Duration = .seconds(60)

    /// Locked: nothing shows until the owner proves it's them.
    private(set) var locked: Bool
    /// Off the screen or on its way (the app switcher, a call): covered, but not locked.
    private(set) var away = false
    private(set) var asking = false
    /// Why the last try didn't unlock, when it wasn't the owner backing out.
    private(set) var problem: String?

    /// When the app went to the background; nil while it's in front.
    @ObservationIgnored private var leftAt: ContinuousClock.Instant?
    /// Set when the app opens or comes back from the background: the next time it's active, ask.
    /// Not set by the system's own sheet coming and going (Face ID makes the app inactive), or the
    /// owner backing out would be asked again at once, over and over.
    @ObservationIgnored private var askWhenActive = true
    /// Debug only: the cover stays up for a screenshot without the system's sheet over it.
    @ObservationIgnored private var neverAsk = false

    init(paired: Bool) {
        locked = paired
        #if DEBUG
            // The simulator's screenshots (ios/scripts/sim.sh): the cover shows only when asked
            // for, and then stays up.
            if let show = ProcessInfo.processInfo.environment["HOPPER_SHOW"] {
                locked = show == "lock"
                neverAsk = show == "lock"
            }
        #endif
    }

    var covered: Bool { locked || away }

    /// The unlock button's mark: what this phone checks with.
    let symbol: String = {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        default: return "lock.fill"
        }
    }()

    func phase(_ now: ScenePhase, paired: Bool) {
        switch now {
        case .active:
            away = false
            if let leftAt, ContinuousClock.now - leftAt > Self.grace, paired { locked = true }
            leftAt = nil
            if locked, askWhenActive, !neverAsk {
                askWhenActive = false
                unlock()
            }
        case .inactive:
            away = true
        case .background:
            away = true
            if leftAt == nil { leftAt = .now }
            askWhenActive = true
        @unknown default:
            break
        }
    }

    #if DEBUG
        /// The cover as it shows when locked, without the system's sheet over it (the tour).
        func demoLock() {
            neverAsk = true
            withAnimation(.smooth(duration: 0.25)) { locked = true }
        }
    #endif

    /// Nothing to keep once there's no pairing; locked again on the next pairing's first open.
    func unpaired() {
        locked = false
        problem = nil
    }

    func unlock() {
        guard locked, !asking else { return }
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No passcode on the phone: there's nothing to check against, and locking the owner
            // out of their own app protects nothing.
            if (error as? LAError)?.code == .passcodeNotSet {
                withAnimation(.smooth) { locked = false }
            } else {
                problem = error?.localizedDescription
            }
            return
        }
        asking = true
        problem = nil
        Task {
            do {
                let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Hopper")
                asking = false
                if ok { withAnimation(.smooth(duration: 0.25)) { locked = false } }
            } catch {
                asking = false
                let code = (error as? LAError)?.code
                // Backing out isn't a problem to report: the button is there to try again.
                if code != .userCancel, code != .appCancel, code != .systemCancel { problem = error.localizedDescription }
            }
        }
    }
}

/// What shows over the app while it's locked or not in front: the frog, and a way in.
struct LockCover: View {
    @Environment(AppLock.self) private var lock

    var body: some View {
        ZStack {
            T.bg.ignoresSafeArea()
            VStack(spacing: 18) {
                Frog(size: 56)
                if lock.locked {
                    VStack(spacing: 6) {
                        Text("Hopper is locked").font(.system(size: 20, weight: .semibold)).foregroundStyle(T.hi)
                        Text(lock.problem ?? "It can drive your Mac, so it asks who you are first.")
                            .font(.system(size: 14)).foregroundStyle(lock.problem == nil ? T.dim : T.blocked)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                    Button { lock.unlock() } label: {
                        Label("Unlock", systemImage: lock.symbol)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(T.ink)
                            .padding(.horizontal, 22).frame(height: 44)
                            .background(T.focus, in: .capsule)
                    }
                    .buttonStyle(.press)
                    .opacity(lock.asking ? 0 : 1)
                    .padding(.top, 6)
                }
            }
        }
        .transition(.opacity)
    }
}
