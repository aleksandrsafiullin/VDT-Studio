import AppIntents
import Foundation

@available(macOS 26.0, *)
public struct VDTAppIntentsPackage: AppIntentsPackage {}

@available(macOS 26.0, *)
private extension VDTIntentReply {
    var dialog: IntentDialog {
        switch self {
        case .completed: "Continue in VDT Studio."
        case .status(.ready): "VDT Studio is ready."
        case .status(.working): "VDT Studio is working."
        case .status(.listening): "VDT Studio is listening."
        case .status(.reviewAvailable): "A review is available in VDT Studio."
        case .consentRequired: "Enable Shortcuts in VDT Studio first."
        case .unavailable: "Open VDT Studio to use this action."
        case .stale: "The current view changed. Check VDT Studio."
        }
    }
}

// These actions have no AppEntity, parameters, shortcut phrases, or returned data.
@available(macOS 26.0, *)
public struct OpenVDTStudioIntent: AppIntent {
    public static let title: LocalizedStringResource = "Open VDT Studio"
    public static let supportedModes: IntentModes = .foreground(.immediate)
    public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    @available(macOS 27.0, *)
    public static let allowedExecutionTargets: IntentExecutionTargets = .main

    public init() {}

    @MainActor public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: VDTIntentRuntime.shared.perform(.openApp).dialog)
    }
}

@available(macOS 26.0, *)
public struct ShowVDTVoiceControlsIntent: AppIntent {
    public static let title: LocalizedStringResource = "Show VDT Voice Controls"
    public static let description: IntentDescription? = IntentDescription("Opens the voice controls. You can start listening yourself in VDT Studio.")
    public static let supportedModes: IntentModes = .foreground(.immediate)
    public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    @available(macOS 27.0, *)
    public static let allowedExecutionTargets: IntentExecutionTargets = .main

    public init() {}

    @MainActor public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: VDTIntentRuntime.shared.perform(.showVoiceControls).dialog)
    }
}

@available(macOS 26.0, *)
public struct ShowVDTStatusIntent: AppIntent {
    public static let title: LocalizedStringResource = "Show VDT Status"
    public static let supportedModes: IntentModes = .foreground(.immediate)
    public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    @available(macOS 27.0, *)
    public static let allowedExecutionTargets: IntentExecutionTargets = .main

    public init() {}

    @MainActor public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: VDTIntentRuntime.shared.perform(.showStatus).dialog)
    }
}

@available(macOS 26.0, *)
public struct RequestVDTStopListeningIntent: AppIntent {
    public static let title: LocalizedStringResource = "Request to Stop VDT Listening"
    public static let description: IntentDescription? = IntentDescription("Opens the stop-listening control for the current voice session.")
    public static let supportedModes: IntentModes = .foreground(.immediate)
    public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    @available(macOS 27.0, *)
    public static let allowedExecutionTargets: IntentExecutionTargets = .main

    public init() {}

    @MainActor public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: VDTIntentRuntime.shared.perform(.requestStopListening).dialog)
    }
}

@available(macOS 26.0, *)
public struct OpenVDTPendingReviewIntent: AppIntent {
    public static let title: LocalizedStringResource = "Open Pending VDT Review"
    public static let description: IntentDescription? = IntentDescription("Opens the current review so you can check it in VDT Studio.")
    public static let supportedModes: IntentModes = .foreground(.immediate)
    public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    @available(macOS 27.0, *)
    public static let allowedExecutionTargets: IntentExecutionTargets = .main

    public init() {}

    @MainActor public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: VDTIntentRuntime.shared.perform(.openPendingReview).dialog)
    }
}
