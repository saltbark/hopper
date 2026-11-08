import Foundation

/// One WebSocket to a room on the relay, as the phone. It hands up the relay's news (the Mac came
/// or went) and the binary frames; it knows nothing about what's in them.
final class RelayClient {
    enum Event {
        case peerUp, peerDown, frame(Data), closed
    }

    private var task: URLSessionWebSocketTask?
    private var generation = 0

    func connect(relay: String, room: String, onEvent: @escaping (Event) -> Void) {
        close()
        guard let url = URL(string: "\(relay)/v1/room/\(room)?role=phone") else { return onEvent(.closed) }
        let task = URLSession.shared.webSocketTask(with: url)
        self.task = task
        generation += 1
        let mine = generation
        task.resume()
        Task {
            while true {
                do {
                    let message = try await task.receive()
                    guard mine == self.generation else { return }
                    switch message {
                    case .string(let s):
                        if s.contains("\"up\"") { onEvent(.peerUp) } else if s.contains("\"down\"") { onEvent(.peerDown) }
                    case .data(let d):
                        onEvent(.frame(d))
                    @unknown default:
                        break
                    }
                } catch {
                    if mine == self.generation { onEvent(.closed) }
                    return
                }
            }
        }
    }

    func send(_ data: Data) {
        task?.send(.data(data)) { _ in }
    }

    func close() {
        generation += 1
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }
}
