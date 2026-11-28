import Foundation

@MainActor
private final class FixtureIntentHost: VDTIntentHost {
    let scope = UUID()
    let consentEpoch = UUID()
    let capture = UUID()
    let review = UUID()
    var optedIn = false
    private(set) var effects: [VDTIntentEffect] = []

    var intentSnapshot: VDTIntentSnapshot {
        VDTIntentSnapshot(
            optedIn: optedIn, consentEpoch: consentEpoch, scope: scope,
            listeningSession: capture, pendingReview: review, status: .listening
        )
    }

    func presentIntent(_ presentation: VDTIntentPresentation) -> Bool {
        guard presentation.isCurrent(in: intentSnapshot, at: ContinuousClock().now) else { return false }
        effects.append(presentation.effect)
        return true
    }
}

@main
struct VDTIntentHostFixture {
    @MainActor
    static func main() async throws {
        // Run via the bundle executable. No Launch Services registration or UI is needed.
        guard CommandLine.arguments.dropFirst().elementsEqual(["--self-check"]),
              #available(macOS 26.0, *) else { return }

        let runtime = VDTIntentRuntime.shared
        precondition(runtime.perform(.showStatus) == .unavailable)
        let host = FixtureIntentHost()
        runtime.installHost(host)
        defer { runtime.installHost(nil) }

        _ = try await OpenVDTStudioIntent().perform()
        _ = try await ShowVDTVoiceControlsIntent().perform()
        _ = try await RequestVDTStopListeningIntent().perform()
        _ = try await OpenVDTPendingReviewIntent().perform()
        precondition(runtime.perform(.showStatus) == .consentRequired)
        precondition(host.effects.isEmpty)

        host.optedIn = true
        _ = try await OpenVDTStudioIntent().perform()
        _ = try await ShowVDTVoiceControlsIntent().perform()
        _ = try await ShowVDTStatusIntent().perform()
        _ = try await RequestVDTStopListeningIntent().perform()
        _ = try await OpenVDTPendingReviewIntent().perform()
        precondition(runtime.perform(.showStatus) == .status(.listening))
        precondition(host.effects == [
            .openApp,
            .showVoiceControls(scope: host.scope),
            .showStopListeningReview(scope: host.scope, session: host.capture),
            .openPendingReview(scope: host.scope, review: host.review),
        ])

        host.optedIn = false
        _ = try await ShowVDTVoiceControlsIntent().perform()
        precondition(host.effects.count == 4)
        print("Signed app principal routed five App Intent implementations through an in-process host. Consent denied and revoked before dispatch.")
    }
}
