import Foundation

@MainActor
private enum DeliveryCapture {
    static var messages: [[String: Any]] = []
    static var acceptsDelivery = true
}

private let recordDelivery: VDTIntentDelivery = { bytes, length in
    guard Thread.isMainThread, let bytes,
          let decoded = try? JSONSerialization.jsonObject(with: Data(bytes: bytes, count: length)) as? [String: Any]
    else { return 0 }
    return MainActor.assumeIsolated {
        guard DeliveryCapture.acceptsDelivery else { return 0 }
        DeliveryCapture.messages.append(decoded)
        return 1
    }
}

@main
struct VDTIntentNativeHostTests {
    @MainActor
    static func main() throws {
        guard #available(macOS 26.0, *) else {
            precondition(vdtAppIntentsAvailable() == 0)
            print("App Intent host withheld below macOS 26.")
            return
        }
        let owner = UUID()
        let stranger = UUID()
        let scope = UUID()
        let capture = UUID()
        let review = UUID()
        let consent = UUID()
        let revoked = UUID()
        let runtime = VDTIntentRuntime.shared

        func attach(_ id: UUID) -> Int32 {
            Array(id.uuidString.utf8).withUnsafeBufferPointer {
                vdtAppIntentsAttach($0.baseAddress, $0.count, recordDelivery)
            }
        }

        func detach(_ id: UUID) -> Int32 {
            Array(id.uuidString.utf8).withUnsafeBufferPointer {
                vdtAppIntentsDetach($0.baseAddress, $0.count)
            }
        }

        func update(_ owner: UUID, _ sequence: Int, _ optedIn: Bool, _ epoch: UUID,
                    status: String = "listening", listening: UUID? = nil) throws -> Int32 {
            var object: [String: Any] = [
                "owner": owner.uuidString, "sequence": sequence, "optedIn": optedIn,
                "consentEpoch": epoch.uuidString, "scope": scope.uuidString,
                "pendingReview": review.uuidString, "status": status,
            ]
            if let listening { object["listeningSession"] = listening.uuidString }
            let data = try JSONSerialization.data(withJSONObject: object)
            return data.withUnsafeBytes {
                vdtAppIntentsUpdate($0.bindMemory(to: UInt8.self).baseAddress, $0.count)
            }
        }

        precondition(vdtAppIntentsAvailable() == 1)
        let attached = attach(owner)
        precondition(attached == 1 && attach(stranger) == 0)
        precondition(runtime.perform(.showStatus) == .consentRequired)
        let foreignUpdate = try update(stranger, 1, true, consent, listening: capture)
        let invalidUpdate = try update(owner, 1, true, consent)
        precondition(foreignUpdate == 0 && invalidUpdate == 0)
        let accepted = try update(owner, 1, true, consent, listening: capture)
        let heartbeat = try update(owner, 1, true, consent, listening: capture)
        let changedHeartbeat = try update(owner, 1, true, stranger, listening: capture)
        precondition(accepted == 1 && heartbeat == 1 && changedHeartbeat == 0)

        precondition(runtime.perform(.showStatus) == .status(.listening))
        precondition(runtime.perform(.openApp) == .completed)
        precondition(runtime.perform(.showVoiceControls) == .completed)
        precondition(runtime.perform(.requestStopListening) == .completed)
        precondition(runtime.perform(.openPendingReview) == .completed)
        let messages = DeliveryCapture.messages
        precondition(messages.compactMap { $0["action"] as? String } == [
            "openApp", "showVoiceControls", "requestStopListening", "openPendingReview",
        ])
        precondition(messages.allSatisfy { $0["owner"] as? String == owner.uuidString &&
            $0["consentEpoch"] as? String == consent.uuidString && $0["scope"] as? String == scope.uuidString &&
            $0["sequence"] as? Int == 1 && ($0["expiresAtUnixMilliseconds"] as? Int64 ?? 0) > 0
        })
        precondition(messages[2]["target"] as? String == capture.uuidString && messages[3]["target"] as? String == review.uuidString)
        precondition(Set(messages.compactMap { $0["deliveryId"] as? String }).count == 4)

        DeliveryCapture.acceptsDelivery = false
        precondition(runtime.perform(.showVoiceControls) == .stale)
        let revokedUpdate = try update(owner, 2, false, revoked, status: "ready")
        let replay = try update(owner, 1, true, consent, listening: capture)
        precondition(revokedUpdate == 1 && replay == 0)
        precondition(runtime.perform(.showStatus) == .consentRequired)
        precondition(detach(stranger) == 0 && detach(owner) == 1)
        precondition(runtime.perform(.openApp) == .unavailable)
        precondition(DeliveryCapture.messages.count == 4)
        print("Native host ABI checked single owner, consent, exact tokens, monotonic updates, refused delivery, and detach.")
    }
}
