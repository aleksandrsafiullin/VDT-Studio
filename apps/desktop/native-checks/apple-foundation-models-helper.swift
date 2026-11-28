import Darwin
import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

private let version = 1
private let profile = "vdt-native-guided-v1"
private let modelName = "SystemLanguageModel.default"
private let maximumFrameBytes = 64 * 1024
private let maximumReplyBytes = 32 * 1024

private struct Identity: Codable, Equatable {
    var model: String
    var osBuild: String
    var profile: String
    var modelRevision: String?
}

private final class Shape: Decodable {
    var kind: String
    var choices: [String]?
    var fields: [Field]?
    var variants: [Shape]?
    var element: Shape?
    var maxItems: Int?
}

private struct Field: Decodable {
    var name: String
    var description: String?
    var optional: Bool?
    var shape: Shape
}

private struct Request: Decodable {
    var version: Int
    var id: String
    var op: String
    var locale: String
    var expectedIdentity: Identity?
    var prompt: String?
    var schema: Shape?
    var maxOutputTokens: Int?
}

private enum HelperError: String, Error {
    case unsupportedOS = "unsupported_os"
    case unsupportedSDK = "unsupported_sdk"
    case deviceNotEligible = "device_not_eligible"
    case disabled = "apple_intelligence_disabled"
    case notReady = "model_not_ready"
    case locale = "unsupported_locale"
    case stale = "stale_identity"
    case tokenAPI = "token_api_unavailable"
    case context = "context_exceeded"
    case request = "invalid_request"
    case guide = "invalid_guide"
    case output = "invalid_output"
    case refusal = "refused"
    case rateLimited = "rate_limited"
    case busy = "busy"
    case timeout = "timeout"
    case cancelled = "cancelled"
    case unavailable = "unavailable"
}

private func readRequest() throws -> (String, Request) {
    var bytes: [UInt8] = []
    while true {
        let byte = getchar()
        guard byte != EOF else { throw HelperError.request }
        if byte == 10 { break }
        guard bytes.count < maximumFrameBytes - 1 else { throw HelperError.request }
        bytes.append(UInt8(byte))
    }
    guard getchar() == EOF else { throw HelperError.request }
    let data = Data(bytes)
    guard let packet = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let request = try? JSONDecoder().decode(Request.self, from: data),
          request.version == version,
          request.id.range(of: "^[A-Fa-f0-9-]{36}$", options: .regularExpression) != nil,
          request.locale.range(of: "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$", options: .regularExpression) != nil else {
        throw HelperError.request
    }
    let common = Set(["version", "id", "op", "locale"])
    let keys = Set(packet.keys)
    let generationKeys = common.union(["expectedIdentity", "prompt", "schema", "maxOutputTokens"])
    guard (request.op == "capabilities" && keys == common)
        || (request.op == "generate" && keys == generationKeys) else {
        throw HelperError.request
    }
    return (request.id, request)
}

private func reply(_ packet: [String: Any]) throws {
    var bytes = try JSONSerialization.data(withJSONObject: packet)
    guard bytes.count < maximumReplyBytes else { throw HelperError.output }
    bytes.append(10)
    try FileHandle.standardOutput.write(contentsOf: bytes)
}

@main
private struct Main {
    static func main() async {
        var id = "invalid"
        do {
            let (requestID, request) = try readRequest()
            id = requestID
            #if canImport(FoundationModels)
            guard #available(macOS 26.0, *) else { throw HelperError.unsupportedOS }
            let result = try await execute(request)
            try reply(["version": version, "id": id, "result": result])
            #else
            throw HelperError.unsupportedSDK
            #endif
        } catch {
            let code = (error as? HelperError) ?? .unavailable
            try? reply(["version": version, "id": id, "error": code.rawValue])
        }
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private func execute(_ request: Request) async throws -> [String: Any] {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available: break
    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: throw HelperError.deviceNotEligible
        case .appleIntelligenceNotEnabled: throw HelperError.disabled
        case .modelNotReady: throw HelperError.notReady
        @unknown default: throw HelperError.unavailable
        }
    }
    guard model.supportsLocale(Locale(identifier: request.locale)) else {
        throw HelperError.locale
    }
    // Apple exposes the default public variant and OS build, with no model digest.
    let identity = Identity(model: modelName, osBuild: ProcessInfo.processInfo.operatingSystemVersionString,
                            profile: profile, modelRevision: nil)
    let wireIdentity: [String: Any] = [
        "model": identity.model, "osBuild": identity.osBuild, "profile": identity.profile, "modelRevision": NSNull()
    ]
    var contextSize = 4_096
    var canCount = false
    #if VDT_AFM_SDK_26_4
    if #available(macOS 26.4, *) {
        contextSize = model.contextSize
        canCount = true
    }
    #endif
    if request.op == "capabilities" {
        return ["identity": wireIdentity, "locale": request.locale, "contextSize": contextSize, "tokenBudgetVerified": canCount]
    }
    guard request.expectedIdentity == identity else { throw HelperError.stale }
    guard let promptText = request.prompt, !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          promptText.utf8.count <= 48 * 1024, let shape = request.schema, shape.kind == "object",
          let maxOutput = request.maxOutputTokens, (1...2_048).contains(maxOutput) else {
        throw HelperError.request
    }
    #if VDT_AFM_SDK_26_4
    if #available(macOS 26.4, *) {
        do {
            var count = 0
            let root = try generationShape(shape, name: "VDTRoot", depth: 0, count: &count)
            let schema = try GenerationSchema(root: root, dependencies: [])
            let prompt = Prompt(promptText)
            let instructions = Instructions("Return a bounded proposal in the requested structure. Host software verifies all proposed actions.")
            // Count each component and reserve extra tokens for system/framing
            // overhead plus the full requested output before starting generation.
            let framingReserve = 128
            let inputTokens = try await model.tokenCount(for: prompt) + model.tokenCount(for: instructions)
                + model.tokenCount(for: schema) + framingReserve
            guard inputTokens + maxOutput <= contextSize else { throw HelperError.context }
            let session = LanguageModelSession(model: model, tools: [], instructions: instructions)
            let response = try await session.respond(to: prompt, schema: schema,
                                                     options: GenerationOptions(maximumResponseTokens: maxOutput))
            let data = Data(response.content.jsonString.utf8)
            guard data.count < maximumReplyBytes,
                  let proposal = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw HelperError.output
            }
            return ["identity": wireIdentity, "contextSize": contextSize,
                    "inputTokens": inputTokens, "proposal": proposal]
        } catch {
            throw classify(error)
        }
    }
    #endif
    throw HelperError.tokenAPI
}

@available(macOS 26.0, *)
private func generationShape(_ shape: Shape, name: String, depth: Int, count: inout Int) throws -> DynamicGenerationSchema {
    count += 1
    guard depth <= 6, count <= 96 else { throw HelperError.guide }
    switch shape.kind {
    case "string": return .init(type: String.self)
    case "integer": return .init(type: Int.self)
    case "number": return .init(type: Double.self)
    case "boolean": return .init(type: Bool.self)
    case "choice":
        guard let choices = shape.choices, (1...24).contains(choices.count),
              Set(choices).count == choices.count, choices.allSatisfy({ (1...100).contains($0.utf8.count) }) else {
            throw HelperError.guide
        }
        return .init(name: name, anyOf: choices)
    case "array":
        guard let element = shape.element, let limit = shape.maxItems, (1...20).contains(limit) else {
            throw HelperError.guide
        }
        return .init(arrayOf: try generationShape(element, name: name + "Item", depth: depth + 1, count: &count),
                     maximumElements: limit)
    case "union":
        guard let variants = shape.variants, (2...8).contains(variants.count),
              variants.allSatisfy({ $0.kind == "object" }),
              shape.choices == nil, shape.fields == nil, shape.element == nil, shape.maxItems == nil else {
            throw HelperError.guide
        }
        let branches = try variants.enumerated().map { index, variant in
            try generationShape(variant, name: name + "Variant" + String(index), depth: depth + 1, count: &count)
        }
        return .init(name: name, anyOf: branches)
    case "object":
        guard let fields = shape.fields, (1...24).contains(fields.count),
              Set(fields.map(\.name)).count == fields.count else { throw HelperError.guide }
        let properties = try fields.enumerated().map { index, field in
            guard field.name.range(of: "^[A-Za-z][A-Za-z0-9_]{0,47}$", options: .regularExpression) != nil,
                  field.description?.utf8.count ?? 0 <= 240 else { throw HelperError.guide }
            return DynamicGenerationSchema.Property(
                name: field.name, description: field.description,
                schema: try generationShape(field.shape, name: name + "Field" + String(index), depth: depth + 1, count: &count),
                isOptional: field.optional ?? false
            )
        }
        return .init(name: name, properties: properties)
    default: throw HelperError.guide
    }
}

@available(macOS 26.0, *)
private func classify(_ error: Error) -> HelperError {
    if let typed = error as? HelperError { return typed }
    if error is CancellationError { return .cancelled }
    if error is GenerationSchema.SchemaError { return .guide }
    #if VDT_AFM_SDK_27
    if #available(macOS 27.0, *) {
        if case .assetsUnavailable? = error as? SystemLanguageModel.Error { return .notReady }
        if case .concurrentRequests? = error as? LanguageModelSession.Error { return .busy }
        if error is GeneratedContent.ParsingError { return .output }
        if let native = error as? LanguageModelError {
            switch native {
            case .contextSizeExceeded: return .context
            case .rateLimited: return .rateLimited
            case .guardrailViolation, .refusal: return .refusal
            case .unsupportedLanguageOrLocale: return .locale
            case .unsupportedGenerationGuide: return .guide
            case .timeout: return .timeout
            default: return .unavailable
            }
        }
    }
    #endif
    if let native = error as? LanguageModelSession.GenerationError {
        switch native {
        case .exceededContextWindowSize: return .context
        case .rateLimited: return .rateLimited
        case .guardrailViolation, .refusal: return .refusal
        case .unsupportedLanguageOrLocale: return .locale
        case .unsupportedGuide: return .guide
        case .concurrentRequests: return .busy
        case .assetsUnavailable: return .notReady
        case .decodingFailure: return .output
        default: return .unavailable
        }
    }
    return .unavailable
}
#endif
