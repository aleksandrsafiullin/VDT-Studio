# A02 private Apple Foundation Models transport

The independent transport remains unregistered while L03's measured
optimization gate is open. The native connector and Node owner have no
production activation or provider fallback.

## Package and host interface

Build `apps/desktop/native-checks/apple-foundation-models-helper.swift` as an
arm64 Mach-O with macOS 14 deployment, weak FoundationModels linking and the
SDK-version compile definitions below. Place the signed executable at a
fixed application-owned path and record its SHA-256 in the trusted desktop
resource manifest. The packaged host must verify bundle ownership and the
manifest/signature before furnishing the absolute path and hash to Node.
The transport rejects symbolic-link aliases, other noncanonical paths,
non-regular or oversized files and a digest mismatch. The certified app
path must be immutable to untrusted writers between verification and launch.

The host module is
`packages/local-runner/src/apple-foundation-models/transport.ts`. The future
package export should refer to that module. The API takes a trusted helper path
and SHA-256 once, then offers `discover(locale, signal?)` and
`complete(request, validateCanonical)`. Discovery confirms the model and
actual locale. Completion takes the observed identity, an admitted locale and
bounded prompt/shape/output/deadline settings. The host must select the shape
and invoke its strict canonical validator for the registered task. The
returned value is a proposal for the existing Gateway. Types support closed
guided objects, scalars, enums, arrays and finite nesting. A nested union
admits two to eight nonempty object variants within the same depth and node
budgets. The existing object root and wire version stay in use. Arbitrary provider
configuration, model selection, execution paths and arbitrary JSON Schema
dialects have no wire representation.

The native identity pins `SystemLanguageModel.default`, OS version/build
and `vdt-native-guided-v1` at the start of each inference. The model asset
digest is unknown. The helper checks availability and actual locale before
inference. A changed OS identity fails the pending selection. The 26.4
token API counts native prompt, instructions and guided schema. The helper
reserves 128 input tokens for framing and the full requested output before
generation, then uses the native output cap. The returned `context.inputTokens`
is the preflight count including framing reserve. It is distinct from native
session usage after generation. The legacy OS gate leaves the rest of the app
eligible for its existing deployment target. MacOS 26.0–26.3 discovery can
report nominal context but generation stays disabled without verifiable token
count. The native source gates newer errors and token APIs at SDK and OS level.

## Lifecycle

A single child receives one UTF-8, version-1 JSON request followed by EOF.
Correlated capabilities or generation results use exactly one line. Invalid
frames, overflow, wrong IDs, wrong versions, multiple replies, child failures
and late replies fail closed. Request frames are at most 64 KiB and final
replies 32 KiB. The parent drains stderr and returns stable sanitized failure
classes. It neither logs native output nor passes through stderr or Apple's
refusal explanation. The helper exposes final proposals only. A future live
voice or progress stream needs its own typed events and control protocol.

Each transport allows one in-flight process. The private child retains no
persistent transcript across calls. A parent deadline or AbortSignal
terminates the owned process, escalates to SIGKILL after 250 ms if needed, and
holds the slot until the child closes and is reaped. Output captured before
timeout or cancellation never becomes a completed proposal. This verifies
child ownership and late-result rejection. OS model-service quiescence after
external termination remains a separate qualification case. Mutating tools,
web research and delegation stay outside the helper.

## Verification on macOS 27.0.1

Between 14:34:17.6 and 14:34:22.8 Dubai, the Node owner launched the native
helper for English capability, Russian capability, guided generation and a
stale identity check. It validated the synthetic 2,000 USD response through
the canonical oracle. Guided completion took 4,749 ms end to end, including
child startup and exit. Preflight budget was 282 tokens including input
reserve plus 128 output tokens against the 8,192 context. Russian failed
with `unsupported_locale`. A stale OS build failed with `stale_identity`.
The helper emitted zero stderr bytes. No Ollama measurement was scheduled
concurrently. The source digest and sanitized metrics are in
`output/apple-local-ai-voice-2026-11-25/a02/live.json`.

For a local reproduction on this SDK, provision an owned temporary directory
as `probe_tmp` and use the commands below. Delete only that directory after
the child exits and retain only the sanitized receipt if needed.

```bash
xcrun swiftc -parse-as-library -swift-version 6 -target arm64-apple-macos14.0 \
  -D VDT_AFM_SDK_26_4 -D VDT_AFM_SDK_27 \
  -module-cache-path "$probe_tmp/modules" -o "$probe_tmp/afm-helper" \
  apps/desktop/native-checks/apple-foundation-models-helper.swift

node --import tsx packages/local-runner/src/apple-foundation-models/live-probe.ts "$probe_tmp/afm-helper"
```

The device check uses the public on-device API and an unbundled development
helper. Signed app launch, egress observation, hardened entitlements and
actual launch on macOS 14–25 remain open.
