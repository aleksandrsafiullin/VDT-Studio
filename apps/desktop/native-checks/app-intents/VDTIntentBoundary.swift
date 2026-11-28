import Foundation

public enum VDTIntentAction: String, CaseIterable, Sendable {
    case openApp
    case showVoiceControls
    case showStatus
    case requestStopListening
    case openPendingReview
}

public enum VDTIntentStatus: Sendable, Equatable {
    case ready
    case working
    case listening
    case reviewAvailable
}

public struct VDTIntentSnapshot: Sendable, Equatable {
    public let optedIn: Bool
    public let consentEpoch: UUID
    public let scope: UUID?
    public let listeningSession: UUID?
    public let pendingReview: UUID?
    public let status: VDTIntentStatus

    public init(
        optedIn: Bool,
        consentEpoch: UUID,
        scope: UUID?,
        listeningSession: UUID? = nil,
        pendingReview: UUID? = nil,
        status: VDTIntentStatus = .ready
    ) {
        self.optedIn = optedIn
        self.consentEpoch = consentEpoch
        self.scope = scope
        self.listeningSession = listeningSession
        self.pendingReview = pendingReview
        self.status = status
    }
}

public enum VDTIntentEffect: Sendable, Equatable {
    case openApp
    case showVoiceControls(scope: UUID)
    case showStopListeningReview(scope: UUID, session: UUID)
    case openPendingReview(scope: UUID, review: UUID)
}

public struct VDTIntentPresentation: Sendable, Equatable {
    public let effect: VDTIntentEffect
    let consentEpoch: UUID
    let scope: UUID?
    let expiresAt: ContinuousClock.Instant

    public func isCurrent(in snapshot: VDTIntentSnapshot, at now: ContinuousClock.Instant) -> Bool {
        guard snapshot.optedIn, snapshot.consentEpoch == consentEpoch,
              snapshot.scope == scope, now < expiresAt else { return false }
        switch effect {
        case .openApp, .showVoiceControls:
            return true
        case .showStopListeningReview(_, let session):
            return snapshot.listeningSession == session && snapshot.status == .listening
        case .openPendingReview(_, let review):
            return snapshot.pendingReview == review
        }
    }
}

public enum VDTIntentReply: Sendable, Equatable {
    case completed
    case status(VDTIntentStatus)
    case consentRequired
    case unavailable
    case stale
}

@MainActor public protocol VDTIntentHost: AnyObject {
    /// Opaque tokens change when the existing UI scope, capture, review, or consent changes.
    var intentSnapshot: VDTIntentSnapshot { get }

    /// Recheck isCurrent before dispatching a queued effect in the owning UI.
    func presentIntent(_ presentation: VDTIntentPresentation) -> Bool
}

@MainActor final class VDTIntentBoundary {
    enum Result: Equatable {
        case effect(VDTIntentEffect)
        case reply(VDTIntentReply)
    }

    private struct Binding {
        let consentEpoch: UUID
        let scope: UUID?
        let capture: UUID?
        let review: UUID?
        let expiresAt: ContinuousClock.Instant
        let action: VDTIntentAction
    }

    static let lifetime: Duration = .seconds(5)
    private var pending: [UUID: Binding] = [:]

    func issue(
        _ action: VDTIntentAction,
        from snapshot: VDTIntentSnapshot,
        at now: ContinuousClock.Instant
    ) -> UUID? {
        pending = pending.filter { $0.value.expiresAt > now }
        guard snapshot.optedIn, pending.count < 16, eligible(action, in: snapshot) else { return nil }
        let ticket = UUID()
        pending[ticket] = Binding(
            consentEpoch: snapshot.consentEpoch,
            scope: snapshot.scope,
            capture: snapshot.listeningSession,
            review: snapshot.pendingReview,
            expiresAt: now.advanced(by: Self.lifetime),
            action: action
        )
        return ticket
    }

    func consume(
        _ ticket: UUID,
        in current: VDTIntentSnapshot,
        at now: ContinuousClock.Instant
    ) -> Result {
        guard let binding = pending.removeValue(forKey: ticket), now < binding.expiresAt,
              current.optedIn, current.consentEpoch == binding.consentEpoch,
              current.scope == binding.scope, eligible(binding.action, in: current) else {
            return .reply(.stale)
        }
        switch binding.action {
        case .openApp:
            return .effect(.openApp)
        case .showVoiceControls:
            guard let scope = current.scope else { return .reply(.stale) }
            return .effect(.showVoiceControls(scope: scope))
        case .showStatus:
            return .reply(.status(current.status))
        case .requestStopListening:
            guard let scope = current.scope, let session = binding.capture,
                  current.listeningSession == session else { return .reply(.stale) }
            return .effect(.showStopListeningReview(scope: scope, session: session))
        case .openPendingReview:
            guard let scope = current.scope, let review = binding.review,
                  current.pendingReview == review else { return .reply(.stale) }
            return .effect(.openPendingReview(scope: scope, review: review))
        }
    }

    private func eligible(_ action: VDTIntentAction, in snapshot: VDTIntentSnapshot) -> Bool {
        switch action {
        case .openApp:
            return true
        case .showVoiceControls, .showStatus:
            return snapshot.scope != nil
        case .requestStopListening:
            return snapshot.scope != nil && snapshot.listeningSession != nil && snapshot.status == .listening
        case .openPendingReview:
            return snapshot.scope != nil && snapshot.pendingReview != nil
        }
    }
}

@MainActor public final class VDTIntentRuntime {
    public static let shared = VDTIntentRuntime()

    private weak var host: (any VDTIntentHost)?
    private let boundary = VDTIntentBoundary()
    private let clock = ContinuousClock()

    public init() {}

    public func installHost(_ host: (any VDTIntentHost)?) {
        self.host = host
    }

    public func perform(_ action: VDTIntentAction) -> VDTIntentReply {
        guard let host else { return .unavailable }
        let snapshot = host.intentSnapshot
        guard snapshot.optedIn else { return .consentRequired }
        let issuedAt = clock.now
        guard let ticket = boundary.issue(action, from: snapshot, at: issuedAt) else { return .unavailable }
        let current = host.intentSnapshot
        guard self.host === host else { return .stale }
        let result = boundary.consume(ticket, in: current, at: clock.now)
        switch result {
        case .effect(let effect):
            let presentation = VDTIntentPresentation(
                effect: effect, consentEpoch: snapshot.consentEpoch, scope: snapshot.scope,
                expiresAt: issuedAt.advanced(by: VDTIntentBoundary.lifetime)
            )
            return host.presentIntent(presentation) ? .completed : .stale
        case .reply(let reply):
            return reply
        }
    }
}
