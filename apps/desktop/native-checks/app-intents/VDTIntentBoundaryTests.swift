import Foundation

@MainActor private final class TestHost: VDTIntentHost {
    var snapshots: [VDTIntentSnapshot]
    var presentations: [VDTIntentPresentation] = []
    var mayPresent = true

    init(_ snapshots: [VDTIntentSnapshot]) {
        self.snapshots = snapshots
    }

    var intentSnapshot: VDTIntentSnapshot {
        snapshots.count > 1 ? snapshots.removeFirst() : snapshots[0]
    }

    func presentIntent(_ presentation: VDTIntentPresentation) -> Bool {
        presentations.append(presentation)
        return mayPresent
    }
}

@main struct VDTIntentBoundaryTests {
    @MainActor static func main() {
        let boundary = VDTIntentBoundary()
        let clock = ContinuousClock()
        let now = clock.now
        let epoch = UUID(), scope = UUID(), session = UUID(), review = UUID()
        let base = VDTIntentSnapshot(
            optedIn: true, consentEpoch: epoch, scope: scope,
            listeningSession: session, pendingReview: review, status: .listening
        )
        let otherScope = VDTIntentSnapshot(
            optedIn: true, consentEpoch: epoch, scope: UUID(),
            listeningSession: session, pendingReview: review, status: .listening
        )
        let otherSession = VDTIntentSnapshot(
            optedIn: true, consentEpoch: epoch, scope: scope,
            listeningSession: UUID(), pendingReview: review, status: .listening
        )
        let otherReview = VDTIntentSnapshot(
            optedIn: true, consentEpoch: epoch, scope: scope,
            listeningSession: session, pendingReview: UUID(), status: .listening
        )
        let optedOut = VDTIntentSnapshot(optedIn: false, consentEpoch: epoch, scope: scope)
        let newConsent = VDTIntentSnapshot(optedIn: true, consentEpoch: UUID(), scope: scope)
        let noScope = VDTIntentSnapshot(optedIn: true, consentEpoch: epoch, scope: nil)
        let idle = VDTIntentSnapshot(optedIn: true, consentEpoch: epoch, scope: scope)

        func issue(_ action: VDTIntentAction) -> UUID {
            guard let ticket = boundary.issue(action, from: base, at: now) else {
                preconditionFailure("Expected to issue \(action)")
            }
            return ticket
        }

        precondition(VDTIntentAction.allCases.count == 5)
        for action in ["approve", "startCapture", "send", "openPath"] {
            precondition(VDTIntentAction(rawValue: action) == nil)
        }
        for action in VDTIntentAction.allCases {
            precondition(boundary.issue(action, from: optedOut, at: now) == nil)
        }
        for action in [VDTIntentAction.showVoiceControls, .showStatus, .requestStopListening, .openPendingReview] {
            precondition(boundary.issue(action, from: noScope, at: now) == nil)
        }
        precondition(boundary.issue(.requestStopListening, from: idle, at: now) == nil)
        precondition(boundary.issue(.openPendingReview, from: idle, at: now) == nil)
        precondition(boundary.consume(UUID(), in: base, at: now) == .reply(.stale))

        let open = issue(.openApp)
        precondition(boundary.consume(open, in: base, at: now) == .effect(.openApp))
        precondition(boundary.consume(open, in: base, at: now) == .reply(.stale))
        let voice = issue(.showVoiceControls)
        precondition(boundary.consume(voice, in: base, at: now) == .effect(.showVoiceControls(scope: scope)))
        let status = issue(.showStatus)
        precondition(boundary.consume(status, in: base, at: now) == .reply(.status(.listening)))
        let stop = issue(.requestStopListening)
        precondition(boundary.consume(stop, in: base, at: now) == .effect(.showStopListeningReview(scope: scope, session: session)))
        let pendingReview = issue(.openPendingReview)
        precondition(boundary.consume(pendingReview, in: base, at: now) == .effect(.openPendingReview(scope: scope, review: review)))

        precondition(boundary.consume(issue(.showStatus), in: otherScope, at: now) == .reply(.stale))
        precondition(boundary.consume(issue(.showStatus), in: optedOut, at: now) == .reply(.stale))
        precondition(boundary.consume(issue(.showStatus), in: newConsent, at: now) == .reply(.stale))
        precondition(boundary.consume(issue(.showStatus), in: base, at: now.advanced(by: .seconds(5))) == .reply(.stale))
        let staleStop = issue(.requestStopListening)
        precondition(boundary.consume(staleStop, in: otherSession, at: now) == .reply(.stale))
        precondition(boundary.consume(staleStop, in: base, at: now) == .reply(.stale))
        precondition(boundary.consume(issue(.openPendingReview), in: otherReview, at: now) == .reply(.stale))
        for _ in 0..<16 { _ = issue(.openApp) }
        precondition(boundary.issue(.openApp, from: base, at: now) == nil)
        precondition(boundary.issue(.openApp, from: base, at: now.advanced(by: .seconds(5))) != nil)

        let runtime = VDTIntentRuntime()
        precondition(runtime.perform(.openApp) == .unavailable)
        let disabled = TestHost([optedOut])
        runtime.installHost(disabled)
        precondition(runtime.perform(.openApp) == .consentRequired)
        precondition(disabled.presentations.isEmpty)
        let switched = TestHost([base, otherScope])
        runtime.installHost(switched)
        precondition(runtime.perform(.showVoiceControls) == .stale)
        precondition(switched.presentations.isEmpty)
        let host = TestHost([base])
        runtime.installHost(host)
        precondition(runtime.perform(.showStatus) == .status(.listening))
        precondition(host.presentations.isEmpty)
        precondition(runtime.perform(.showVoiceControls) == .completed)
        precondition(host.presentations.map(\.effect) == [.showVoiceControls(scope: scope)])
        let showControls = host.presentations[0]
        precondition(showControls.isCurrent(in: base, at: clock.now))
        precondition(!showControls.isCurrent(in: newConsent, at: clock.now))
        precondition(!showControls.isCurrent(in: otherScope, at: clock.now))
        precondition(!showControls.isCurrent(in: base, at: clock.now.advanced(by: .seconds(5))))
        precondition(runtime.perform(.requestStopListening) == .completed)
        precondition(!host.presentations[1].isCurrent(in: otherSession, at: clock.now))
        host.mayPresent = false
        precondition(runtime.perform(.openPendingReview) == .stale)
        precondition(!host.presentations[2].isCurrent(in: otherReview, at: clock.now))
        runtime.installHost(nil)
        precondition(runtime.perform(.showStatus) == .unavailable)
        print("App Intent authorization, one-use and lifetime fences, UI ownership and read-only status passed.")
    }
}
