import Darwin
import Foundation

#if canImport(FoundationModels) && !VDT_AFM_NO_SDK
import FoundationModels

@available(macOS 26.0, *)
@Generable
struct RevenueReply {
    @Guide(description: "The exact currency code USD.")
    var unit: String
    var value: Int
}

@available(macOS 26.0, *)
@Generable
struct OperationProposal {
    @Guide(description: "The allowlisted read-only operation ID calculate_revenue.")
    var operation: String
    var quantity: Int
    var price: Int
}

@available(macOS 26.0, *)
actor ToolReceipt {
    private(set) var accepted = 0
    func accept() { accepted += 1 }
}

@available(macOS 26.0, *)
struct ReadSyntheticRate: Tool {
    let name = "readSyntheticRate"
    let description = "Get the planted price for the only permitted product ID, sample."
    let receipt: ToolReceipt

    @Generable
    struct Arguments {
        var productID: String
    }

    func call(arguments: Arguments) async throws -> String {
        guard arguments.productID == "sample" else { throw ProbeFault.deniedToolArguments }
        await receipt.accept()
        return "20 USD"
    }
}
#endif

enum ProbeFault: Error {
    case deniedToolArguments
}

struct ProbeRequest: Decodable {
    let id: String
    let op: String
}

struct ProbeResult: Encodable, Sendable {
    var status: String
    var elapsedMs: Double? = nil
    var firstSnapshotMs: Double? = nil
    var snapshots: Int? = nil
    var contextSize: Int? = nil
    var inputTokens: Int? = nil
    var cachedTokens: Int? = nil
    var outputTokens: Int? = nil
    var promptTokens: Int? = nil
    var schemaTokens: Int? = nil
    var instructionTokens: Int? = nil
    var expectedValueMatched: Bool? = nil
    var acceptedReadOnlyToolCalls: Int? = nil
    var helperSessionIdle: Bool? = nil
    var locales: [String: Bool]? = nil
    var supportedLanguageIDs: [String]? = nil
    var operatingSystem: String? = nil
    var modelVariant: String? = nil
}

struct WireReply: Encodable {
    let id: String
    let result: ProbeResult
}

private let maximumRequestBytes = 256
private let operations = Set(["availability", "synthetic_refusal", "synthetic_native_timeout", "synthetic_tool_scope", "tokens", "guided_en", "guided_ru", "dynamic_schema", "proposal", "tool", "stream", "cancel", "timeout", "overflow"])

private func milliseconds(_ start: ContinuousClock.Instant) -> Double {
    let elapsed = (ContinuousClock.now - start).components
    return (Double(elapsed.seconds) * 1_000) + (Double(elapsed.attoseconds) / 1_000_000_000_000_000)
}

private func receiveFrame() -> Data? {
    var bytes: [UInt8] = []
    while true {
        let byte = getchar()
        if byte == EOF || byte == 10 {
            return byte == EOF && bytes.isEmpty ? nil : Data(bytes)
        }
        if bytes.count == maximumRequestBytes { return nil }
        bytes.append(UInt8(byte))
    }
}

@main
struct Probe {
    static func main() async throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        while let frame = receiveFrame() {
            let result: WireReply
            if let request = try? JSONDecoder().decode(ProbeRequest.self, from: frame),
               let fields = try? JSONSerialization.jsonObject(with: frame) as? [String: Any],
               Set(fields.keys) == ["id", "op"],
               request.id.range(of: "^[A-Za-z0-9_-]{1,32}$", options: .regularExpression) != nil,
               operations.contains(request.op) {
                #if canImport(FoundationModels) && !VDT_AFM_NO_SDK
                if #available(macOS 26.0, *) {
                    result = WireReply(id: request.id, result: await runProbe(op: request.op))
                } else {
                    result = WireReply(id: request.id, result: ProbeResult(status: "unsupported_os"))
                }
                #else
                result = WireReply(id: request.id, result: ProbeResult(status: "unsupported_sdk"))
                #endif
            } else {
                result = WireReply(id: "invalid", result: ProbeResult(status: "invalid_request"))
            }
            var output = try encoder.encode(result)
            output.append(10)
            try FileHandle.standardOutput.write(contentsOf: output)
        }
    }
}

#if canImport(FoundationModels) && !VDT_AFM_NO_SDK
@available(macOS 26.0, *)
private func availability(_ model: SystemLanguageModel) -> String {
    switch model.availability {
    case .available: return "available"
    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: return "device_not_eligible"
        case .appleIntelligenceNotEnabled: return "apple_intelligence_disabled"
        case .modelNotReady: return "model_not_ready"
        @unknown default: return "unknown_unavailability"
        }
    }
}

@available(macOS 26.0, *)
private func contextSize(_ model: SystemLanguageModel) -> Int {
    #if VDT_AFM_SDK_26_4
    if #available(macOS 26.4, *) { return model.contextSize }
    #endif
    // Apple documents the original 26.0–26.3 window as 4,096.
    return 4_096
}

@available(macOS 26.0, *)
private func runProbe(op: String) async -> ProbeResult {
    let model = SystemLanguageModel.default
    let state = availability(model)
    let locales = ["en-US", "ru-RU", "de-DE", "ja-JP"]
    if op == "availability" {
        return ProbeResult(
            status: state,
            contextSize: state == "available" ? contextSize(model) : nil,
            locales: Dictionary(uniqueKeysWithValues: locales.map { ($0, model.supportsLocale(Locale(identifier: $0))) }),
            supportedLanguageIDs: model.supportedLanguages.map { $0.maximalIdentifier }.sorted(),
            operatingSystem: ProcessInfo.processInfo.operatingSystemVersionString,
            modelVariant: "SystemLanguageModel.default"
        )
    }
    if op == "synthetic_refusal" || op == "synthetic_native_timeout" {
        #if VDT_AFM_SDK_27
        if #available(macOS 27.0, *) {
            let error: LanguageModelError = op == "synthetic_refusal"
                ? .refusal(.init(explanation: "Unavailable.", debugDescription: "Synthetic fixture"))
                : .timeout(.init(debugDescription: "Synthetic fixture"))
            return ProbeResult(status: errorStatus(error))
        }
        #endif
        return ProbeResult(status: "modern_error_api_unavailable")
    }
    if op == "synthetic_tool_scope" {
        let receipt = ToolReceipt()
        do {
            _ = try await ReadSyntheticRate(receipt: receipt).call(arguments: .init(productID: "unlisted"))
            return ProbeResult(status: "tool_scope_not_enforced", acceptedReadOnlyToolCalls: await receipt.accepted)
        } catch {
            return ProbeResult(status: errorStatus(error), acceptedReadOnlyToolCalls: await receipt.accepted)
        }
    }
    guard state == "available" else { return ProbeResult(status: state) }
    if op == "guided_ru", !model.supportsLocale(Locale(identifier: "ru-RU")) {
        return ProbeResult(status: "unsupported_locale")
    }
    let instructions = "Use the requested language and answer only the stated synthetic business calculation."
    let prompt = "Calculate revenue from 100 units at 20 USD per unit."
    let receipt = ToolReceipt()
    let tools = op == "tool" ? [ReadSyntheticRate(receipt: receipt)] : []
    let session = LanguageModelSession(model: model, tools: tools, instructions: instructions)
    let options = GenerationOptions(maximumResponseTokens: 128)
    let start = ContinuousClock.now
    var result = ProbeResult(status: "ok")
    do {
        switch op {
        case "tokens":
            result.contextSize = contextSize(model)
            result.status = "token_api_unavailable"
            #if VDT_AFM_SDK_26_4
            if #available(macOS 26.4, *) {
                result.status = "ok"
                result.promptTokens = try await model.tokenCount(for: Prompt(prompt))
                result.schemaTokens = try await model.tokenCount(for: RevenueReply.generationSchema)
                result.instructionTokens = try await model.tokenCount(for: Instructions(instructions))
            }
            #endif
        case "guided_en", "guided_ru", "tool":
            let input = op == "tool"
                ? "Call readSyntheticRate with productID sample. Using that unit price, calculate revenue for selling 100 units."
                : op == "guided_ru"
                    ? "Рассчитай выручку от продажи 100 единиц по цене 20 USD за единицу."
                    : prompt
            let response = try await session.respond(to: input, generating: RevenueReply.self, options: options)
            result.expectedValueMatched = response.content.unit == "USD" && response.content.value == 2_000
            if op == "tool" { result.acceptedReadOnlyToolCalls = await receipt.accepted }
        case "dynamic_schema":
            let root = DynamicGenerationSchema(name: "RevenueResult", properties: [
                .init(name: "unit", schema: .init(name: "Currency", anyOf: ["USD"])),
                .init(name: "value", schema: .init(type: Int.self))
            ])
            let schema = try GenerationSchema(root: root, dependencies: [])
            let response = try await session.respond(to: prompt, schema: schema, options: options)
            let unit = try response.content.value(String.self, forProperty: "unit")
            let value = try response.content.value(Int.self, forProperty: "value")
            result.expectedValueMatched = unit == "USD" && value == 2_000
        case "proposal":
            let response = try await session.respond(
                to: "Propose calculate_revenue using quantity 100 and price 20. Do not execute anything.",
                generating: OperationProposal.self, options: options
            )
            let proposal = response.content
            result.expectedValueMatched = proposal.operation == "calculate_revenue"
                && proposal.quantity == 100 && proposal.price == 20
        case "stream":
            let stream = session.streamResponse(to: prompt, generating: RevenueReply.self, options: options)
            var snapshots = 0
            for try await snapshot in stream {
                snapshots += 1
                if result.firstSnapshotMs == nil && (snapshot.content.unit != nil || snapshot.content.value != nil) {
                    result.firstSnapshotMs = milliseconds(start)
                }
            }
            let reply = try await stream.collect().content
            result.snapshots = snapshots
            result.expectedValueMatched = reply.unit == "USD" && reply.value == 2_000
        case "cancel", "timeout":
            result = await cancelProbe(session, triggerAfterFirstSnapshot: op == "cancel")
        case "overflow":
            let oversized = String(repeating: " revenue", count: min(contextSize(model) * 2, 60_000))
            #if VDT_AFM_SDK_26_4
            if #available(macOS 26.4, *) {
                result.promptTokens = try await model.tokenCount(for: Prompt(oversized))
            }
            #endif
            _ = try await session.respond(to: oversized, options: options)
            result.status = "overflow_not_rejected"
        default:
            result.status = "invalid_request"
        }
    } catch {
        result.status = errorStatus(error)
    }
    #if VDT_AFM_SDK_27
    if #available(macOS 27.0, *) {
        let usage = session.usage
        result.inputTokens = usage.input.totalTokenCount
        result.cachedTokens = usage.input.cachedTokenCount
        result.outputTokens = usage.output.totalTokenCount
    }
    #endif
    result.helperSessionIdle = !session.isResponding
    result.elapsedMs = milliseconds(start)
    return result
}

@available(macOS 26.0, *)
private func cancelProbe(_ session: LanguageModelSession, triggerAfterFirstSnapshot: Bool) async -> ProbeResult {
    let start = ContinuousClock.now
    let (events, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
    let generation = Task {
        defer { continuation.finish() }
        let stream = session.streamResponse(
            to: "List 100 concise, friendly names for a synthetic retail KPI dashboard.",
            options: GenerationOptions(maximumResponseTokens: 192)
        )
        var snapshots = 0
        var firstSnapshot: Double?
        do {
            for try await snapshot in stream {
                snapshots += 1
                if firstSnapshot == nil && !snapshot.content.isEmpty {
                    firstSnapshot = milliseconds(start)
                    continuation.yield(())
                }
                try Task.checkCancellation()
            }
            try Task.checkCancellation()
            return ProbeResult(status: "completed_before_cancel", firstSnapshotMs: firstSnapshot, snapshots: snapshots)
        } catch {
            let status = Task.isCancelled ? "cancel_acknowledged" : errorStatus(error)
            return ProbeResult(status: status, firstSnapshotMs: firstSnapshot, snapshots: snapshots)
        }
    }
    if triggerAfterFirstSnapshot {
        var iterator = events.makeAsyncIterator()
        _ = await iterator.next()
    } else {
        try? await Task.sleep(for: .milliseconds(25))
    }
    generation.cancel()
    var result = await generation.value
    if !triggerAfterFirstSnapshot && result.status == "cancel_acknowledged" {
        result.status = "host_timeout_cancel_acknowledged"
    }
    return result
}

@available(macOS 26.0, *)
private func errorStatus(_ error: Error) -> String {
    if error is CancellationError { return "cancel_acknowledged" }
    #if VDT_AFM_SDK_27
    if #available(macOS 27.0, *), let native = error as? LanguageModelError {
        switch native {
        case .contextSizeExceeded: return "context_size_exceeded"
        case .rateLimited: return "rate_limited"
        case .guardrailViolation: return "guardrail_violation"
        case .refusal: return "refusal"
        case .unsupportedLanguageOrLocale: return "unsupported_locale"
        case .unsupportedGenerationGuide: return "unsupported_guide"
        case .timeout: return "native_timeout"
        default: return "native_error"
        }
    }
    #endif
    if let native = error as? LanguageModelSession.GenerationError {
        switch native {
        case .exceededContextWindowSize: return "context_size_exceeded"
        case .rateLimited: return "rate_limited"
        case .guardrailViolation: return "guardrail_violation"
        case .refusal: return "refusal"
        case .unsupportedLanguageOrLocale: return "unsupported_locale"
        case .concurrentRequests: return "busy"
        case .assetsUnavailable: return "model_not_ready"
        default: return "native_error"
        }
    }
    if error is LanguageModelSession.ToolCallError { return "tool_error" }
    switch error {
    case ProbeFault.deniedToolArguments: return "tool_scope_denied"
    default: return "unclassified_error"
    }
}
#endif
