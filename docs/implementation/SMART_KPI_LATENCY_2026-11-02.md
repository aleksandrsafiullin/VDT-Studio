# Suggested KPI latency investigation — 2026-11-02

Status: implemented; local verification passed. Independent acceptance is
recorded in the linked reviewer report.

The change removes avoidable foreground queue waiting. It does not claim to
accelerate a cold provider response. The model, reasoning, prompt, canonical
recipes, limits, validation, cache identities and explicit Apply are unchanged.

## Cause and resulting behavior

The previous scheduler immediately started viewport speculation. A subsequent
hover could only promote queued work, so an active background request kept the
slot until completion. Opening a different KPI could wait for the remainder of
that response and then its own full response. The workspace update also
enqueued speculation before an already opened target.

Now an opened target enqueues first. Visible/new-child jobs wait 350 ms; hover,
selection, explicit Prepare and cache hits do not wait for that grace. A
different current eligible hover cache miss may cancel this controller's active
visible/new-child job. It waits for actual terminal acknowledgement before
starting. Unknown cleanup quarantines the execution. Active hover, selected and
explicit jobs are protected; same-target promotion is sticky. The cancelled
target becomes stale with an actionable explanation, without a negative result,
automatic retry or refund of its spent attempt. One active operation, queue 12
and eight automatic attempts remain enforced.

## Live runtime measurements

Nine real Cursor requests used the same synthetic monthly retail project,
`composer-2.5`, explicit Provider default reasoning, canonical input and exact
13,461-byte prompt. No production setting was changed. Cursor was
`2026.10.22-27dcf5f`, vendor Node 26.12.1, host Node 24.15.0 and pnpm 10.33.2.
Every sample produced a valid four-component revenue proposal, passed contextual
materialization including units/direction, and left the graph unchanged.
No failed/empty/timed-out samples were discarded.

| Series | All three times (ms) | Median (ms) | Purpose |
|---|---|---:|---|
| Before | 10,581 / 8,925 / 8,907 | 8,925 | Existing direct runtime |
| Diagnostic shared compile cache | 9,953 / 11,981 / 11,092 | 11,092 | Causal experiment only; not shipped |
| After runtime control | 11,131 / 9,444 / 8,754 | 9,444 | Same direct runtime after scheduling change |

The baseline's pre-spawn overhead was 674 / 3 / 3 ms. Spawn to CLI system frame
was 3,824 / 3,476 / 3,616 ms; the CLI-reported API duration was
5,827 / 5,220 / 5,050 ms. Close followed the terminal result after
246 / 221 / 233 ms, and final validation took 8 / 4 / 4 ms. The system frame
includes CLI/provider initialization; these measurements cannot assign its
whole delay to JavaScript compilation or MCP discovery. A first assistant frame
is recorded separately and is not claimed as token-level TTFT. Token usage was
not supplied in the captured numeric usage fields.

Compile-cache reuse saved only roughly 0.1–0.2 s in warm initialization, while
model variation exceeded it. It was not implemented. There is **no demonstrated
improvement in cold provider generation** and no subsecond cold-model SLA.
Admission already avoids inference and runs on execution/credential changes,
not each hover; native Cursor admission does not list models or probe auth.
Local context/fingerprint CPU was below roughly 1.1 ms p95 on the controlled
200-node fixture, so it was not rewritten.

The [OpenDesign Cursor definition](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/defs/cursor-agent.ts)
was checked at file blob `fc76c28d614b3d528240a115c92d18d0ed1ce727`; it uses the same print/stdio stream
approach and gated trust flag. The available
[Cursor parameters](https://cursor.com/docs/cli/reference/parameters) offer no
reviewed per-run discovery bypass. User MCP/plugin/auth settings were not changed.

## Queue and browser measurements

The controlled scheduler retains provider 120 ms and cleanup 20 ms, with no live
inference. Its baseline source was frozen before edits. All raw samples and
the final source hashes are retained.

| Scenario | Before | After | Meaning |
|---|---:|---:|---|
| Hover immediately after visible prewarm | 244.10 ms | 120.52 ms | Grace lets the intended request start first |
| Hover 40 ms after background start, eight samples, median | 201.80 ms | 141.94 ms | Wait for 20 ms cleanup instead of the background's remaining 80 ms |
| Same active scenario, descriptive p95 | 203.99 ms | 144.32 ms | Eight samples only; no statistical generalization |
| Direct cold scheduler with provider 120 ms | 129.07 ms | 128.72 ms | No claimed provider acceleration |

In all eight after samples the old terminal preceded the next start. Each
sample spent two attempts, including the cancelled one. Two hundred prepared
scheduler activations made zero additional provider calls, with p95 0.31 ms;
this excludes browser layout, IndexedDB initialization and model execution.

Installed Chrome was checked separately in an isolated local app/data view with
real vault, IndexedDB, store and revision routes. Preparation/cancellation and initial CLI detection/admission
were fixtures (provider 800 ms, cleanup 40 ms). A fresh project/VDT avoids an older
frozen proposal being mistaken for the new result. An actual pointer entry to
visible enabled proposal, followed by two animation frames, measured **898.6 ms**.
The old terminal/cleanup receipt preceded the new request by 5 ms. Twenty prepared
reopenings measured median 49.3 ms, p95 **50.7ms**, maximum 52.3 ms, with **zero**
additional provider requests. Viewport was 3200×1600, with the preview visible;
this is one small local fixture, not cross-size/platform qualification. Graphs
were unchanged throughout; no Add was clicked.

The initial locator-polling timing and a rejected observer that counted a
previous frozen list are retained as diagnostics. They are excluded from the
accepted browser results. The final observer requires an in-viewport selectable
row and rejects paint preceding the current provider terminal.

## Verification and evidence

- `pnpm exec vitest run --maxWorkers=3`: **3,378 passed**, 3 expected failures,
  9 skipped; 295 passed files/4 skipped, 96.33 s.
- `pnpm typecheck`: passed across the workspace.
- `pnpm lint`: 0 errors, 30 existing warnings.
- `pnpm docs:verify`: 31 documents passed.
- `pnpm certification:verify`: 23 records passed.
- `pnpm phase7:verify`: 19 tasks/19 schemas/17 manifests passed.
- `pnpm desktop:verify`: 12 commands and the source-matched sidecar passed.
  Runtime/native/generated sources were unchanged; no regeneration was needed.
- `git diff --check`: passed.
- Developer focused checks: 3 files/80 tests passed. Independent reviewer checks:
  4 files/110 tests passed, including native sidecar cancellation fixtures.
- Browser checks passed the new cancellation ordering, visible selectable
  proposal, prepared reopening, no extra calls and unchanged graph.

No production build, installer or native binary was rebuilt for these
browser-scheduler-only changes. The existing multi-provider/native/platform
qualification limits remain. No blanket semantic certification is inferred from
one live retail case or the synthetic timing fixtures.

The [evidence directory](../../output/playwright/smart-latency-20261102-3zobumxx/)
contains [all live summary values](../../output/playwright/smart-latency-20261102-3zobumxx/measurement-summary.json),
[accepted browser results](../../output/playwright/smart-latency-20261102-3zobumxx/browser-acceptance.json),
[active queue comparison](../../output/playwright/smart-latency-20261102-3zobumxx/scheduler-comparison.json),
[independent acceptance](../../output/playwright/smart-latency-20261102-3zobumxx/reviewer-final.md)
and cleanup diagnostics. Raw inputs are fictitious; event collection whitelists
timings/types/numeric usage and retains no account/token event payloads.

## Disk and cleanup

Free space was checked before the heavy suite: about 39 GiB on the system volume
and 751 GiB on the project volume. No Xcode command ran. Only run-owned temporary
views, private compile-cache experiment, run directories and snapshot archive
are removed after processes and review finish. Reports, hashes, small logs and
screenshots stay in the evidence directory; final cleanup status is recorded in
`cleanup.json`. Shared caches, user CLI state, pre-existing development servers,
sources and unrelated worktree changes are preserved.
