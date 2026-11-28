import Foundation

// The callback must consume these bytes synchronously and return 1 only if
// the presentation was queued for the registered desktop window.
public typealias VDTIntentDelivery = @convention(c) (UnsafePointer<UInt8>?, Int) -> Int32

private let maxWindowMessageBytes = 2_048

private struct WindowSnapshot: Decodable {
    enum Status: String, Decodable {
        case ready, working, listening, reviewAvailable

        var value: VDTIntentStatus {
            switch self {
            case .ready: .ready
            case .working: .working
            case .listening: .listening
            case .reviewAvailable: .reviewAvailable
            }
        }
    }

    let owner: UUID
    let sequence: UInt64
    let optedIn: Bool
    let consentEpoch: UUID
    let scope: UUID?
    let listeningSession: UUID?
    let pendingReview: UUID?
    let status: Status

    var snapshot: VDTIntentSnapshot? {
        guard (1...9_007_199_254_740_991).contains(sequence),
              (status == .listening) == (listeningSession != nil),
              scope != nil || (listeningSession == nil && pendingReview == nil && status == .ready)
        else { return nil }
        return VDTIntentSnapshot(
            optedIn: optedIn,
            consentEpoch: consentEpoch,
            scope: scope,
            listeningSession: listeningSession,
            pendingReview: pendingReview,
            status: status.value
        )
    }
}

private struct WindowPresentation: Encodable {
    let owner: UUID
    let sequence: UInt64
    let deliveryId: UUID
    let consentEpoch: UUID
    let scope: UUID?
    let action: VDTIntentAction.RawValue
    let target: UUID?
    let expiresAtUnixMilliseconds: Int64
}

@MainActor
private final class DesktopIntentHost: VDTIntentHost {
    private static var current: DesktopIntentHost?

    private let owner: UUID
    private let delivery: VDTIntentDelivery
    private var sequence: UInt64 = 0
    private var validUntil = ContinuousClock().now
    private var snapshot = VDTIntentSnapshot(optedIn: false, consentEpoch: UUID(), scope: nil)

    var intentSnapshot: VDTIntentSnapshot {
        if ContinuousClock().now < validUntil { return snapshot }
        return VDTIntentSnapshot(optedIn: false, consentEpoch: snapshot.consentEpoch, scope: nil)
    }

    private init(owner: UUID, delivery: VDTIntentDelivery) {
        self.owner = owner
        self.delivery = delivery
    }

    static func attach(owner: UUID, delivery: VDTIntentDelivery) -> Bool {
        guard current == nil else { return false }
        let host = DesktopIntentHost(owner: owner, delivery: delivery)
        current = host
        VDTIntentRuntime.shared.installHost(host)
        return true
    }

    static func update(_ update: WindowSnapshot) -> Bool {
        guard let host = current, host.owner == update.owner, host.sequence <= update.sequence,
              let snapshot = update.snapshot else { return false }
        guard host.sequence != update.sequence || host.snapshot == snapshot else { return false }
        host.sequence = update.sequence
        host.snapshot = snapshot
        host.validUntil = ContinuousClock().now.advanced(by: .seconds(3))
        return true
    }

    static func detach(owner: UUID) -> Bool {
        guard current?.owner == owner else { return false }
        VDTIntentRuntime.shared.installHost(nil)
        current = nil
        return true
    }

    func presentIntent(_ presentation: VDTIntentPresentation) -> Bool {
        let now = ContinuousClock().now
        guard presentation.isCurrent(in: intentSnapshot, at: now) else { return false }
        let remaining = now.duration(to: presentation.expiresAt).components
        let ttl = remaining.seconds * 1_000 + remaining.attoseconds / 1_000_000_000_000_000
        guard ttl > 0 else { return false }

        let action: VDTIntentAction
        let target: UUID?
        switch presentation.effect {
        case .openApp: (action, target) = (.openApp, nil)
        case .showVoiceControls: (action, target) = (.showVoiceControls, nil)
        case .showStopListeningReview(_, let session): (action, target) = (.requestStopListening, session)
        case .openPendingReview(_, let review): (action, target) = (.openPendingReview, review)
        }
        let message = WindowPresentation(
            owner: owner, sequence: sequence, deliveryId: UUID(),
            consentEpoch: presentation.consentEpoch, scope: presentation.scope,
            action: action.rawValue, target: target,
            expiresAtUnixMilliseconds: Int64(Date().timeIntervalSince1970 * 1_000) + ttl
        )
        guard let bytes = try? JSONEncoder().encode(message) else { return false }
        return bytes.withUnsafeBytes { buffer in
            delivery(buffer.bindMemory(to: UInt8.self).baseAddress, buffer.count) == 1
        }
    }
}

private func ownerToken(_ bytes: UnsafePointer<UInt8>?, _ length: Int) -> UUID? {
    guard let bytes, length == 36 else { return nil }
    return UUID(uuidString: String(decoding: UnsafeBufferPointer(start: bytes, count: length), as: UTF8.self))
}

// Scheduling, owner-token creation and WebView trust checks belong to the
// desktop host. Calls from a worker thread are rejected at the ABI boundary.
@_cdecl("vdt_app_intents_available")
public func vdtAppIntentsAvailable() -> Int32 {
    if #available(macOS 26.0, *) { return 1 }
    return 0
}

@_cdecl("vdt_app_intents_attach")
public func vdtAppIntentsAttach(_ bytes: UnsafePointer<UInt8>?, _ length: Int, _ delivery: VDTIntentDelivery?) -> Int32 {
    guard vdtAppIntentsAvailable() == 1, Thread.isMainThread, let owner = ownerToken(bytes, length), let delivery else { return 0 }
    return MainActor.assumeIsolated { DesktopIntentHost.attach(owner: owner, delivery: delivery) ? 1 : 0 }
}

@_cdecl("vdt_app_intents_update")
public func vdtAppIntentsUpdate(_ bytes: UnsafePointer<UInt8>?, _ length: Int) -> Int32 {
    guard Thread.isMainThread, let bytes, (1...maxWindowMessageBytes).contains(length),
          let update = try? JSONDecoder().decode(WindowSnapshot.self, from: Data(bytes: bytes, count: length))
    else { return 0 }
    return MainActor.assumeIsolated { DesktopIntentHost.update(update) ? 1 : 0 }
}

@_cdecl("vdt_app_intents_detach")
public func vdtAppIntentsDetach(_ bytes: UnsafePointer<UInt8>?, _ length: Int) -> Int32 {
    guard Thread.isMainThread, let owner = ownerToken(bytes, length) else { return 0 }
    return MainActor.assumeIsolated { DesktopIntentHost.detach(owner: owner) ? 1 : 0 }
}
