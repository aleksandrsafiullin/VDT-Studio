# W2 bounded upload and parsing

RA-01 implementation and focused macOS source verification, 13 November 2026. Installed Mac and Windows acceptance remains open.

The upload API counts the actual multipart stream before decoding and rejects an oversized declared length before reading. It allows one file up to 50 MiB with 64 KiB of multipart overhead and caps the read at 30 seconds. It checks part count, header sizes and metadata lengths. Discovery passes request cancellation into the parser. The worker receives the original bytes over stdin, with no parser-side source files. Failed analysis leaves the retained source and its SHA-256 intact. An invalid workbook can produce a failed discovery record with no change set.

The worker uses the application Node executable, a verified bundled script, a restricted environment and a 256 MiB V8 old-generation limit. The host enforces a 15-second deadline, 16 MiB output ceiling and two-child admission cap. On cancellation or timeout it requests process termination and waits for the child close event before releasing the slot. The worker validates the supplied parent PID on startup and runs a separate watchdog event loop. ZIP entry count and declared and actual expansion are checked before workbook decode. Sheet count, dimensions and aggregate cell count are checked before dense worksheet conversion.

## Verification

Node 24.15.0 on macOS, with test temporary directories on Corsair-SSD and core dumps disabled for parser checks.

- `node packages/data-harness/scripts/build-parser-worker.mjs --check` passed. The generated 878,073-byte CJS asset has SHA-256 `21eebfa9e75506a93a3db8b685e68a87219446bc704c1fad8f3a4f378cb04304`.
- `pnpm exec vitest run packages/data-harness apps/web/app/api/data scripts/copy-parser-worker.test.ts --maxWorkers=2` passed 109 tests across nine files. Tests cover the original 3,921-byte sparse workbook, excessive sheets, malformed ZIP metadata, dishonest expansion declarations, byte-counted multipart overrun with absent or false length, upload cancellation and deadline, parser timeout and cancellation with child reaping, saturation, oversized result, and copied worker integrity. The route regression checks that a concurrent VDT read succeeds, workbook rejection cannot be staged, cancellation returns 499, the active project remains unchanged, and retained bytes match the original.
- `pnpm exec tsx eval/open-alpha/verify-downtime.mjs` passed all seven cases. CSV, elapsed XLSX and timestamp JSON preserve full 10-row coverage and 2.75 h/day. Reviewed eight-row TSV gives 1.9375 h/day. Invalid duration and duplicate ID cases block apply. The oracle's initial three-way preflight received the intended busy error. The final run sequences those same preflight assertions. The wizard issues one analysis per operation, with retry guidance when concurrent requests fill the two slots.
- `pnpm --filter @vdt-studio/data-harness exec tsc --noEmit` passed.
- A bounded standalone Mac probe spawned the verified worker with stdin pending, killed its synthetic parent with SIGKILL and observed the worker PID disappear after 27 ms. Unit tests separately confirmed reaping after request cancellation and deadline.
- `pnpm docs:verify` and `git diff --check` passed. The normative ingestion and local threat-model documents now describe the implemented limits.

The original readiness evidence records the old parser aborting in a capped process after 2.709 seconds. The first attempt to regenerate a giant range through SheetJS's writer stalled during fixture setup. The regression now reads the small synthetic audit fixture from source control and never asks the writer to expand that range. An initial route-test setup omitted the fixture storage path in the retained-source assertion. The full 109-test rerun passed with the path corrected.

## Remaining qualification

The old-generation limit does not cap process RSS. Native decoder allocations, buffers and bounded host-side multipart copies are outside that V8 limit. The fallback watchdog polls the numeric parent PID and also has an independent 16-second hard deadline. PID reuse can delay liveness detection until that deadline. The Mac parent-death probe covers a child with a pending pipe. It does not isolate the watchdog path while synchronous decoding is active. Packaged-runtime asset resolution, termination semantics on Windows, and installed app quit/crash cleanup on both platforms still require integrated evidence.

Owned temporary test directories and the standalone probe processes were cleaned. No large diagnostic or build files were retained. The bundled worker and sparse workbook are source assets.

## Independent review corrections and integration

Retained-file analysis now reserves a request slot before opening a payload and checks the stored metadata size and the open file descriptor before a bounded, cancel-aware read. Byte count and SHA-256 remain mandatory. The original download route still verifies the retained bytes. The unused process-wide full-file cache was removed. Discovery checks cancellation again before persisting its snapshot.

Workbook preflight matches the ZIP signatures and last EOCD search of the bundled SheetJS reader. It rejects unsupported ZIP64 extra fields and validates local sizes and data descriptors before SheetJS can allocate or inflate their contents. The multipart decoder now preserves mixed-case browser delimiters and file bytes that resemble delimiter prefixes. An initial Chromium run reproduced a 400 caused by the old Blob MIME normalization.

The final generated worker is 879,321 bytes, SHA-256 `928aa4aa9ae14d8c8531ee20bb187f0e4d899192c73b106c4045d3c4e32f5b56`. A Next webpack hook preserves this byte identity before the server minifier. Focused verification passed 114 tests across nine files. Narrow reruns after follow-up changes passed all 18 route tests and eight multipart tests. All seven downtime oracles passed again. The earlier hash, focused count, and resource probe above describe the initial implementation.

## Windows data-store adapter

The data store has a Windows-specific dispatch through the W7 admitted storage profile. It keeps the database lease and relative directory handles open for the operation. Upload publication uses an exclusive dataset directory and writes payload before atomically publishing its metadata. Association, archive, display-name and discovery snapshot updates use verified, same-directory staged replacement under a native lock. Retained source reads pass the metadata size as the native buffer ceiling and verify the full SHA-256. Analysis rejects oversized metadata before any payload read and checks cancellation around the synchronous native operation.

The Windows adapter diagnostic uses the actual addon under a disposable standard-user profile and mocks database admission only inside the test. It exercises both initial publication and replacement, retained byte bounds, pre-cancellation, immutable collisions and junction rejection. The production Windows database guard remains in force. The diagnostic and full SQLite/application acceptance are distinct.

## Installed Mac offline import follow-up

The installed `8c60019` candidate attached and downloaded the exact 345-byte CSV in a host-only guest. **From file** then displayed `fetch failed` with Stage disabled. The selected preset was default OpenAI Direct, with no credentials. The guest did not capture the HTTP response. Before the source fix, a route regression using that default preset and an unavailable outbound transport reproduced the same message as HTTP 400 `INVALID_DATA_REQUEST`. The same request without a provider parsed all 10 rows and returned the review without a network call.

**Analyze file locally** now opens the deterministic bounded review without sending provider configuration. **Analyze with AI** explicitly uses the selected provider without automatic fallback. A direct OpenAI preset with no key produces actionable configuration guidance, and an unreachable AI transport produces a separate HTTP 502 response. Both leave the retained source available. The route regression verifies all ten CSV rows, zero local outbound calls, one failed assisted call, absence of an assisted snapshot/change set, and an unchanged active graph. All 19 discovery route tests passed, along with web typecheck and documentation verification. The Playwright scenario now checks both action payloads and blocked staging after failed AI. Compiled browser and installed-app verification of this source delta remain pending.
