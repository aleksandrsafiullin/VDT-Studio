# Apple Foundation Models SDK feasibility, 25 November 2026

A01 compares the native SDK with the installed development CLI's readiness and
selects the transport for A02. The SDK probe only uses synthetic fixtures. It
requires Apple Intelligence and its installed system model.

## Native feasibility

The arm64 Swift 6 probe compiles with SDK 27.2 and deployment target macOS
14.0. The built Mach-O declares minimum OS 14.0 and weak-loads the
FoundationModels framework. The code uses both a compile-time import gate and
an OS 26 runtime gate. SDK 26.4 and 27-only symbols also have build-time
feature gates. Compiling the disabled-SDK branch on the same toolchain
produced a clean unsupported response. These checks establish build/link
feasibility. Launch on macOS 14–25 and on Intel remains unverified.

The target is Mac15,12 with 16 GiB, macOS 27.0.1 build 26A434 and Apple Swift
6.4.2. `SystemLanguageModel.default` reports available and a context size of
8,192 tokens. This is the measured budget for the installed model. Read
`contextSize` dynamically. Token counting has a separate 26.4 availability gate
and live session usage a 27.0 gate. Context includes instructions, prompt,
schema, tools, tool results, output and retained exchanges. Use a per-turn
output reserve and a bounded context before each call. [Apple system
model](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)
· [Apple SDK updates](https://developer.apple.com/documentation/updates/foundationmodels)
· [Context sizing](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)

`supportsLocale` accepts en-US, de-DE and ja-JP. It rejects ru-RU, and Russian
is absent from the 24 reported language identifiers. The app must surface the
unsupported locale before native generation and keep the draft intact. Russian
analytics on this host therefore needs another explicitly selected route.
Readiness in each locale is separate from end-to-end quality qualification.
[Apple's locale handling](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)

The observable identity is the general `SystemLanguageModel.default` variant
and the OS version/build, plus the application protocol/profile version. The
public API supplies no immutable internal model digest. Keep that field unknown
and refresh eligibility after an OS update or a readiness change. The SDK
version identifies the build interface. [Apple model versions](https://developer.apple.com/documentation/foundationmodels/updating-prompts-for-new-model-versions)

## Live smoke results

The parent launched one fresh helper process at 14:28:29 Dubai time after the
Ollama measurement lane ended. Each inference used a fresh Swift model session.
The operating system's model residency was neither measured nor reset. Timings
cover these synthetic tasks on the active desktop, with no planned concurrent
Ollama inference. Workspace latency and first-ever load remain unmeasured.

| SDK probe | Measured result |
|---|---|
| Static guided English | Revenue matched 2,000 USD on three calls. First in helper 6,676 ms, then 869 and 599 ms. Each reported 146 input and 21 output tokens. |
| Russian | `unsupported_locale` before generation. |
| Token counts | 17 prompt, 60 instruction and 70 static schema tokens counted separately. These counters come from separate tokenization calls. Report the actual session usage independently because framing and schema inclusion are provider-owned. |
| Dynamic guided schema | A host-built two-field object using `DynamicGenerationSchema` matched the revenue oracle in 515 ms. Arbitrary JSON Schema compatibility remains unqualified. |
| Scoped operation proposal | The final typed value matched the allowlisted operation and both inputs in 754 ms. The helper executed no operation on that path. |
| Narrow Apple Tool callback | The synthetic read callback ran once, guarded by an exact product ID. The subsequent typed answer matched the oracle in 1,487 ms. Calling the same fixture callback with a different ID was denied with zero accepted calls. |
| Typed stream and final | Ten snapshots, first populated field at 388 ms and typed final collected at 592 ms. |
| Cancellation | Cancelling after streamed content joined the Task, observed an idle Swift session and returned no final. A fresh session in the same helper produced a valid response afterward. |
| Host deadline | A 25 ms cooperative timer joined cancellation in 30 ms, with zero stream snapshots and an idle Swift session. A fresh session in the same helper succeeded afterward. This was a host timeout path. The independent native timeout classifier used a synthetic typed error. |
| Context overflow | A measured 16,385-token prompt produced the typed context error. A fresh session in the same helper succeeded afterward. |
| Refusal | A synthetic public SDK refusal error mapped to the sanitized result class. Live refusal behavior remains unqualified. |

The accepted results are in `output/apple-local-ai-voice-2026-11-25/a01/live.json`.
The separate `metadata-final.json` contains the compile-disabled fallback,
Mach-O load command, readiness, malformed request tests and sanitized error
fixtures. Both receipts record the probe source SHA-256.

## A02 transport decision

Bundle an app-owned signed Swift executable and retain the existing Rust and
Node host boundaries. The probe demonstrates a direct executable using bounded
newline frames over stdin/stdout. Launch the helper from a package-owned fixed
path after integrity and availability checks. Gate the release artifact by
architecture and deployment capability and preserve the existing app minimum.
The helper has no listener, model download, external package or interpreter.
Python in the reproduction command is a development test driver.

Resolve request ID, immutable provider/model selection, allowed task, scope
and deadline at the trusted host. The app-owned parent keeps one in-flight
request per helper at first. It drains stdout and stderr independently and
limits frames and retained output. A private cancel request or host deadline
cancels the owned Swift Task. Return one correlated terminal receipt after
joining it. A missing receipt within the cleanup budget fences the helper,
rejects late messages, and causes the parent to terminate and wait before
starting a replacement. Never retry the same turn on another provider. In
production the parent also owns busy admission, crash recovery, child
termination, code signing and helper resource hashes. This spike did not
qualify installed packaging, worker concurrency or interprocess cancellation.

Use final guided output as a typed proposal. Translate it to the canonical
task or action schema and pass it through existing validation and Gateway
checks. The graph and transactions stay with the host. Foundation Models
`Tool` executes inside the helper and is demonstrated only with a narrow
synthetic read fixture. Do not register mutation, research or delegation
callbacks in this Local provider. Stream progress separately from the final
response, and never present a partial as a valid action. The SDK's
`collect()` obtains the typed final result. [Guided output and Apple tool
calling](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)
· [Streaming final](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/responsestream/collect())

Map typed refusal, guardrail, unsupported locale, timeout and context overflow
to stable public statuses. Omit raw prompt, transcript, private reasoning,
native error descriptions and refusal explanations from diagnostics. Keep
context rollover and validated output handling above the native connector.
A refusal does not authorize a provider switch. Synthetic typed refusal and
native timeout classifiers exercised the API without attempting to trigger a
guardrail with a live request.

The installed `fm available` command reported the system model available.
Its own CLI lists a distinct terms-acceptance flow. No evidence of accepted
serve terms was available, so A01 did not start that listener or measure
CLI-server performance. The selected native path uses public
`SystemLanguageModel.default` directly.

## Evidence

Run the metadata check from the repository root.

```bash
python3 apps/desktop/native-checks/run-apple-foundation-models-probe.py \
  --output output/apple-local-ai-voice-2026-11-25/a01/metadata-local.json
```

Use `--live` with a separate output path and a load note for the inference
matrix. The runner uses a unique temporary binary and module cache after a
10 GiB scratch-volume check. It waits for the child and removes that scratch
directory. Evidence reports only fixed case identifiers, result checks,
capability metadata and timing/token counters. The probe is a feasibility
fixture and leaves signed installed acceptance, offline/egress qualification,
live refusal behaviour and non-Mac fallback verification open.
