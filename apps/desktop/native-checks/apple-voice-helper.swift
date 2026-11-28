import Foundation
import Darwin
#if canImport(Speech) && !VDT_VOICE_NO_SDK
import Speech
#endif
#if canImport(AVFAudio)
@preconcurrency import AVFAudio
#endif

private let voiceLocales: [String: String] = [
    "de": "de-DE", "en": "en-US", "es": "es-ES", "fr": "fr-FR", "kk": "kk-KZ", "ru": "ru-RU", "zh": "zh-CN"
]
private let previewText: [String: String] = [
    "de": "Der Betriebsplan enthält zwei Produktionsstufen.",
    "en": "The production plan has two stages.",
    "es": "El plan de producción tiene dos etapas.",
    "fr": "Le plan de production comporte deux étapes.",
    "kk": "Өндіріс жоспары екі кезеңнен тұрады.",
    "ru": "Производственный план состоит из двух этапов.",
    "zh": "生产计划有两个阶段。"
]

private struct VoiceRequest: Decodable {
    let operation: String
    let locale: String?
    let audioBase64: String?
    let voiceId: String?
    let ratePercent: Int?
    let volumePercent: Int?
    let systemLocale: String?
    let confirmed: Bool?
    let text: String?
}

private struct LocaleStatus: Encodable {
    let locale: String
    let systemLocale: String?
    let status: String
}

private struct Voice: Encodable {
    let id: String
    let label: String
    let locale: String
    let quality: Int
    let systemDefault: Bool?
}

private struct Reply: Encodable {
    let status: String
    var recognition: [LocaleStatus]? = nil
    var installedVoices: [Voice]? = nil
    var text: String? = nil
    var waveformBase64: String? = nil
    var boundary: String? = nil
    var fraction: Double? = nil
}

private func parseRequest(_ data: Data) -> VoiceRequest? {
    guard let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let request = try? JSONDecoder().decode(VoiceRequest.self, from: data) else { return nil }
    if request.operation == "status" && Set(record.keys) == ["operation"] { return request }
    guard let locale = request.locale, voiceLocales[locale] != nil else { return nil }
    if request.operation == "install_asset",
       Set(record.keys) == ["operation", "locale", "systemLocale", "confirmed"],
       request.confirmed == true, let systemLocale = request.systemLocale,
       !systemLocale.isEmpty, systemLocale.utf8.count <= 35 { return request }
    if request.operation == "recognize",
       Set(record.keys) == ["operation", "locale", "audioBase64"],
       let rawAudio = request.audioBase64, validWave(rawAudio) != nil { return request }
    let voiceKeys: Set<String> = ["operation", "locale", "voiceId", "ratePercent", "volumePercent"]
    let preview = request.operation == "preview" && Set(record.keys) == voiceKeys
    let notification = request.operation == "synthesize" && Set(record.keys) == voiceKeys.union(["text"])
        && request.text.map { !$0.isEmpty && $0.utf16.count <= 120 && $0.rangeOfCharacter(from: .controlCharacters) == nil } == true
    if (preview || notification),
       let voiceId = request.voiceId, !voiceId.isEmpty, voiceId.utf8.count <= 200,
       let rate = request.ratePercent, (75...125).contains(rate),
       let volume = request.volumePercent, (0...100).contains(volume) { return request }
    return nil
}

private func validWave(_ base64: String) -> Data? {
    // Match the browser PCM wire format. The caller cannot select a file path,
    // container, codec or arbitrary system audio device.
    guard base64.utf8.count <= 512_060, let wave = Data(base64Encoded: base64),
          (46...384_044).contains(wave.count) else { return nil }
    let bytes = [UInt8](wave)
    func u16(_ start: Int) -> Int { Int(bytes[start]) | Int(bytes[start + 1]) << 8 }
    func u32(_ start: Int) -> Int { u16(start) | u16(start + 2) << 16 }
    guard bytes[0..<4].elementsEqual("RIFF".utf8), bytes[8..<12].elementsEqual("WAVE".utf8),
          bytes[12..<16].elementsEqual("fmt ".utf8), bytes[36..<40].elementsEqual("data".utf8),
          u32(4) == bytes.count - 8, u32(16) == 16, u16(20) == 1, u16(22) == 1,
          u32(24) == 16_000, u32(28) == 32_000, u16(32) == 2, u16(34) == 16,
          u32(40) == bytes.count - 44, u32(40).isMultiple(of: 2) else { return nil }
    return wave
}

private func ownTemporaryDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("vdt-apple-speech-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    return directory
}

@main
private struct AppleVoiceHelper {
    @MainActor
    static func main() async throws {
        let bound = 550_000
        let input = FileHandle.standardInput.readData(ofLength: bound + 1)
        let reply: Reply
        if input.count <= bound, let request = parseRequest(input) {
            reply = await handle(request)
        } else {
            reply = Reply(status: "invalid_request")
        }
        var output = try JSONEncoder().encode(reply)
        output.append(10)
        try FileHandle.standardOutput.write(contentsOf: output)
    }

    @MainActor
    private static func handle(_ request: VoiceRequest) async -> Reply {
        if request.operation == "status" {
            #if canImport(AVFAudio)
            let defaultVoiceIds = Set(voiceLocales.values.compactMap { locale -> String? in
                guard let voice = AVSpeechSynthesisVoice(language: locale),
                      voice.language.split(separator: "-").first == locale.split(separator: "-").first else { return nil }
                return voice.identifier
            })
            let voices = availableVoices().map { voice in
                Voice(id: voice.identifier, label: voice.name, locale: voice.language, quality: voice.quality.rawValue,
                      systemDefault: defaultVoiceIds.contains(voice.identifier) ? true : nil)
            }
            #else
            let voices: [Voice] = []
            #endif
            #if canImport(Speech) && !VDT_VOICE_NO_SDK
            if #available(macOS 26.0, *) {
                var recognition: [LocaleStatus] = []
                for locale in voiceLocales.keys.sorted() {
                    recognition.append(await describeRecognition(locale))
                }
                return Reply(status: "ok", recognition: recognition, installedVoices: voices, boundary: "on_device")
            }
            #endif
            let unsupported = voiceLocales.keys.sorted().map { LocaleStatus(locale: $0, systemLocale: nil, status: "unsupported_os_or_sdk") }
            return Reply(status: "ok", recognition: unsupported, installedVoices: voices, boundary: "on_device")
        }
        if request.operation == "install_asset" {
            #if canImport(Speech) && !VDT_VOICE_NO_SDK
            if #available(macOS 26.0, *), let locale = request.locale, let systemLocale = request.systemLocale {
                return await installAsset(locale, systemLocale: systemLocale)
            }
            #endif
            return Reply(status: "unsupported_os_or_sdk")
        }
        if request.operation == "recognize" {
            #if canImport(Speech) && !VDT_VOICE_NO_SDK
            if #available(macOS 26.0, *), let locale = request.locale, let base64 = request.audioBase64, let wave = validWave(base64) {
                return await recognize(locale, wave: wave)
            }
            #endif
            return Reply(status: "unsupported_os_or_sdk")
        }
        #if canImport(AVFAudio)
        return await preview(request)
        #else
        return Reply(status: "unsupported_os_or_sdk")
        #endif
    }
}

#if canImport(Speech) && !VDT_VOICE_NO_SDK
@available(macOS 26.0, *)
private func describeRecognition(_ locale: String) async -> LocaleStatus {
    guard SpeechTranscriber.isAvailable else { return LocaleStatus(locale: locale, systemLocale: nil, status: "unavailable") }
    guard let requested = voiceLocales[locale],
          let selected = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: requested)) else {
        return LocaleStatus(locale: locale, systemLocale: nil, status: "unsupported_locale")
    }
    let module = SpeechTranscriber(locale: selected, preset: .transcription)
    let state: String
    switch await AssetInventory.status(forModules: [module]) {
    case .installed: state = "installed"
    case .downloading: state = "downloading"
    case .supported: state = "asset_required"
    case .unsupported: state = "unsupported_locale"
    @unknown default: state = "unavailable"
    }
    return LocaleStatus(locale: locale, systemLocale: selected.identifier(.bcp47), status: state)
}

@available(macOS 26.0, *)
private func installAsset(_ locale: String, systemLocale: String) async -> Reply {
    let readiness = await describeRecognition(locale)
    guard readiness.systemLocale == systemLocale else { return Reply(status: "stale_locale") }
    if readiness.status == "installed" { return Reply(status: "installed") }
    guard readiness.status == "asset_required" else { return Reply(status: readiness.status) }
    let module = SpeechTranscriber(locale: Locale(identifier: systemLocale), preset: .transcription)
    do {
        guard let installer = try await AssetInventory.assetInstallationRequest(supporting: [module]) else {
            return Reply(status: await AssetInventory.status(forModules: [module]) == .installed ? "installed" : "asset_required")
        }
        let progress = installer.progress
        let updates = Task {
            var previous: Double? = nil
            while !Task.isCancelled {
                let fraction = progress.isIndeterminate ? nil : progress.fractionCompleted
                if previous != fraction || previous == nil {
                    var frame = try JSONEncoder().encode(Reply(status: "progress", fraction: fraction))
                    frame.append(10)
                    try FileHandle.standardOutput.write(contentsOf: frame)
                    previous = fraction
                }
                try await Task.sleep(for: .seconds(1))
            }
        }
        defer { updates.cancel() }
        let installation = Task { try await installer.downloadAndInstall() }
        signal(SIGTERM, SIG_IGN)
        let stop = DispatchSource.makeSignalSource(signal: SIGTERM)
        stop.setEventHandler {
            progress.cancel()
            installation.cancel()
        }
        stop.resume()
        defer { stop.cancel() }
        do {
            try await installation.value
            updates.cancel()
            _ = try? await updates.value
            if progress.isCancelled { return Reply(status: "cancelled") }
            return Reply(status: await AssetInventory.status(forModules: [module]) == .installed ? "installed" : "asset_required")
        } catch {
            updates.cancel()
            _ = try? await updates.value
            return Reply(status: progress.isCancelled ? "cancelled" : "installation_failed")
        }
    } catch {
        return Reply(status: "installation_failed")
    }
}

@available(macOS 26.0, *)
private func collectFinalResults(_ transcriber: SpeechTranscriber) async throws -> String {
    var result = ""
    for try await phrase in transcriber.results where phrase.isFinal {
        try Task.checkCancellation()
        result.append(contentsOf: phrase.text.characters)
        guard result.utf8.count <= 20_000 else { throw VoiceFailure.outputTooLarge }
    }
    return result.trimmingCharacters(in: .whitespacesAndNewlines)
}

@available(macOS 26.0, *)
private func recognize(_ locale: String, wave: Data) async -> Reply {
    let readiness = await describeRecognition(locale)
    guard readiness.status == "installed", let systemLocale = readiness.systemLocale else { return Reply(status: readiness.status) }
    let transcriber = SpeechTranscriber(locale: Locale(identifier: systemLocale), preset: .transcription)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    do {
        let directory = try ownTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let audioUrl = directory.appendingPathComponent("capture.wav")
        try wave.write(to: audioUrl, options: .withoutOverwriting)
        let audio = try AVAudioFile(forReading: audioUrl)
        async let transcript = collectFinalResults(transcriber)
        do {
            _ = try await analyzer.analyzeSequence(from: audio)
            try await analyzer.finalizeAndFinishThroughEndOfInput()
            return Reply(status: "ok", text: try await transcript, boundary: "on_device")
        } catch {
            await analyzer.cancelAndFinishNow()
            throw error
        }
    } catch is CancellationError {
        return Reply(status: "cancelled")
    } catch {
        return Reply(status: "recognition_failed")
    }
}
#endif

private enum VoiceFailure: Error { case outputTooLarge, invalidBuffer }

#if canImport(AVFAudio)
private func availableVoices() -> [AVSpeechSynthesisVoice] {
    AVSpeechSynthesisVoice.speechVoices().filter { voice in
        !voice.voiceTraits.contains(.isPersonalVoice) && !voice.voiceTraits.contains(.isNoveltyVoice)
    }.sorted { $0.identifier < $1.identifier }
}

private final class PreviewWriter: @unchecked Sendable {
    private let mutex = NSLock()
    private let destination: URL
    private var file: AVAudioFile?
    private var frames = 0
    private var continuation: CheckedContinuation<Void, Error>?

    init(destination: URL, continuation: CheckedContinuation<Void, Error>) {
        self.destination = destination
        self.continuation = continuation
    }

    func append(_ audio: AVAudioBuffer) {
        mutex.withLock {
            guard let continuation, let pcm = audio as? AVAudioPCMBuffer else { return }
            do {
                if pcm.frameLength == 0 {
                    guard frames > 0 else { throw VoiceFailure.invalidBuffer }
                    self.continuation = nil
                    file = nil
                    continuation.resume()
                    return
                }
                frames += Int(pcm.frameLength)
                guard frames <= 160_000 else { throw VoiceFailure.outputTooLarge }
                if file == nil {
                    file = try AVAudioFile(forWriting: destination, settings: pcm.format.settings,
                                           commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
                }
                try file?.write(from: pcm)
            } catch {
                self.continuation = nil
                file = nil
                continuation.resume(throwing: error)
            }
        }
    }
}

@MainActor
private func preview(_ request: VoiceRequest) async -> Reply {
    guard let locale = request.locale, let phrase = request.operation == "synthesize" ? request.text : previewText[locale],
          let rate = request.ratePercent, let volume = request.volumePercent,
          let voice = availableVoices().first(where: {
              $0.identifier == request.voiceId && Locale(identifier: $0.language).language.languageCode?.identifier == locale
          }) else { return Reply(status: "voice_unavailable") }
    let synthesizer = AVSpeechSynthesizer()
    let utterance = AVSpeechUtterance(string: phrase)
    utterance.voice = voice
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(rate) / 100
    utterance.volume = Float(volume) / 100
    do {
        let directory = try ownTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("voice.wav")
        try await withCheckedThrowingContinuation { continuation in
            let writer = PreviewWriter(destination: destination, continuation: continuation)
            synthesizer.write(utterance) { audio in writer.append(audio) }
        }
        withExtendedLifetime(synthesizer) {}
        let bytes = try Data(contentsOf: destination, options: .mappedIfSafe)
        if bytes.count > 460_000 { throw VoiceFailure.outputTooLarge }
        guard bytes.count >= 45 else { return Reply(status: "preview_failed") }
        return Reply(status: "ok", waveformBase64: bytes.base64EncodedString(), boundary: "on_device")
    } catch VoiceFailure.outputTooLarge {
        return Reply(status: request.operation == "synthesize" ? "output_too_large" : "preview_failed")
    } catch {
        return Reply(status: "preview_failed")
    }
}
#endif
