# Skill Author local waiting budget — 2026-11-03

Status: implemented locally. Independent reviews, automated checks, browser
acceptance and real HTTP Qwen creation/update passed. Owned temporary application
views, build output and fixture storage were cleaned after child processes exited.

## User correction

The earlier tree-to-skill acceptance timed out two Qwen creation attempts at
90 seconds. A slow local model needs an appropriate waiting budget; reporting
that limitation alone does not make the workflow usable.

The owning author routes imposed a 90-second controller/provider timeout while
the managed/paired local runtime already admits 300 seconds. This follow-up
aligns local Skill Author preparation with that existing five-minute ceiling.
Cloud API preparation keeps its 90-second budget. General chat, Suggested KPI,
runtime ceilings, selected model and reasoning settings are outside this change.

## Small tasks and review gates

1. **D2 backend:** shared browser-safe deadline policy; consistent controller,
   provider and route lifetime for creation/update; explicit safe HTTP 504 on
   exhausted deadline; paired runner preserves only the known TIMEOUT code;
   fake-clock regressions including local results later than 90 seconds.
2. **D3 interface:** display elapsed preparation time and the captured request's
   maximum wait; keep cancellation available; retain drafts/fences and clean up
   timer subscriptions on every terminal path without per-second live narration.
3. Independent code reviewer checks each completed slice; corrections return to
   the developer before re-review.
4. Root runs focused integration/type/lint/docs checks, verifies waiting/cancel in
   the browser and repeats actual Qwen preparation serially, without concurrent
   heavy compilers/tests. Retain outcomes honestly, including failures.

## Contract

- Skill Author local execution: 300,000 ms; remote API: 90,000 ms.
- Both author routes use the same policy for AbortController and provider timeout.
  Their static route maximum includes cleanup/response headroom above 300 seconds.
- This is a preparation budget, not a guarantee of model completion. Explicit
  timeout messages distinguish deadline exhaustion from provider/validation errors.
- Manual cancellation and scope/semantic invalidation continue to abort pending
  work and preserve any existing unsaved review.
- The legacy Settings → Skills author path gets the same server budget.
- No global runtime limit, provider/model fallback, automatic publication or
  reasoning override is introduced.

## Evidence and limits

- Initial disk check: about 31 GiB free on the system volume and 747 GiB on the
  workspace volume. Node 24 is required; no Xcode/native build is planned.
- Previous failed Qwen attempts used the legacy generic local HTTP adapter. The
  second request included `modelReasoning:false`, but that adapter does not map
  the flag to its outgoing request. The earlier evidence establishes a requested
  Off setting, not verified Off execution. This follow-up does not silently change
  that adapter or global Ollama settings.
- D2 backend: 26 focused route/paired-provider tests passed, including local
  create/update completion at 110 seconds, exact five-minute timeout/abort,
  retained API 90-second deadline, caller cancellation precedence, late-result
  rejection and timer/listener cleanup. Owned lint passed. Independent reviewer
  issued **PASS**; no global ceiling or reasoning change was introduced.
- D3 interface: 22 focused tests passed, owned lint passed. The waiting panel
  captures provider/model/reasoning and budget before asynchronous Context reads;
  elapsed wall time is outside the live status. Lifecycle cleanup and captured
  configuration regressions passed. Independent reviewer issued **PASS**.
- Root combined gate: **156 tests passed in 10 files**, single worker/no file
  parallelism, with a 60-second per-test ceiling for host-load tolerance. The
  earlier skill persistence/authoring/review suites and the new paired timeout
  regression ran together. Web typecheck passed with `--incremental false`.
- Final code gate after the native-budget correction: **193 tests passed in 12
  files** (including generic HTTP and native Ollama author regressions), one
  worker/no file parallelism. Web typecheck with `--incremental false` and local
  runner typecheck passed. Full web lint completed with zero errors and 30
  pre-existing warnings outside the changed files.
- Owned acceptance harness: localhost:3137, isolated temporary application view,
  Next output and storage. Evidence is retained under
  `output/playwright/skill-author-timeout-20261103-a138aw64/`.
- Final Qwen and browser outcomes, cleanup and qualifications are recorded below.

## Live diagnosis and necessary local budget correction

The first real HTTP retry reached a provider response after **214.740 seconds**,
within the new deadline, but failed registered-schema validation. A wire capture
reproduced the cause: empty final content, 15,686 characters of thinking,
`finish_reason=length`, 579 prompt tokens + 3,517 completion tokens = the default
4,096-token window. No permissive parse/validation fallback is appropriate.

A controlled native Ollama probe kept the exact messages, registered schema,
model and provider-default thinking while requesting 16,384 context tokens and
7,000 output tokens. It finished in **213.009 seconds**, with `done_reason=stop`,
1,749 final-content characters and a valid `skill.author_draft`. Model metadata
declares a 262,144-token context limit and default thinking=true. Source project
values were absent from the validated instructions. Raw requests/results and
summary metrics are retained in the acceptance directory.

This establishes a second local transport issue beyond waiting: the old generic
OpenAI-compatible call supplied neither an adequate context nor output allowance.
D2 implemented a narrow native Ollama profile only for the two exact Skill
Author roles. It preserves the current model/thinking, uses bounded 16K/32K
context and 7,000 output tokens, checks full prompt fit without trimming, and
retains registered validation/audit/cancel. Other local tasks/transports remain
unchanged. Both backend slices received independent **PASS** reviews. The native
correction developer's 78 focused tests and owned ESLint passed before the final
root gate. The prompt explicitly names the existing flat `argsJson` contract,
bounded to 12,000 characters; schema, task IDs and tool authority are unchanged.
The paired provider safely forwards only TIMEOUT and the two fixed Author budget
codes. Final real HTTP acceptance passed with the final reviewed source after
restarting the isolated server to avoid stale development singletons.

Browser waiting/cancel and explicit-timeout draft retention passed using a
controlled delayed/error response fixture. The actual selected provider/model
were local_runner/Ollama/qwen3.5:4b-q4_K_M; the five-minute label and 0:02 elapsed
counter were observed, Cancel remained enabled and the timer stopped on cancel
and error. Evidence: `01-waiting-local.png`, `02-timeout-retains-draft.png`.

## Final real HTTP acceptance

The installed `qwen3.5:4b-q4_K_M` ran serially through the application's managed
local author routes, with no concurrent compiler/test/browser inference. Thinking
used the provider default; neither selected model nor global Ollama configuration
was changed. A synthetic three-node sales-revenue tree supplied the source.

| Operation | Outcome | Elapsed |
| --- | --- | --- |
| Create new draft | HTTP 200; runtime audit `schemaValid:true`; no warnings | 223.832 seconds |
| Prepare update | HTTP 200; runtime audit `schemaValid:true`; two applicable changes; no warnings | 284.811 seconds including source-skill setup; route 284.108 seconds |

Both exceed the former 90-second cutoff and finish within the new 300-second
budget. `validate-live.mts` applied the actual returned changes to an in-memory
preview and checked executable topology: original formula, USD root, USD/unit
price and original bounded period remain exact. Source values `123456` and `789`
are absent. Exact working-file bytes/hash, immutable version/content hash and the
VDT pin/revision remain unchanged after proposal preparation. A manually written
portable seed was created only in owned fixture storage; generated model output
and proposals were never published.

This establishes functional completion for this model/task/host, not arbitrary
tree size, model quality or latency under other host load. The update is close
to the five-minute limit. Review caught a prose error in the created draft:
Qwen reversed the wording of the price unit; the host-owned topology correctly
retains `USD/unit`. The editable review step remains necessary. Explicit author
reasoning forwarding, native packaged execution and production/release
qualification are not established. Canonical provider certification is unchanged.

Evidence: `live-qwen.json`, `live-validation.json`, native runtime audit lines in
`vdt-skill-author-timeout-e2e-Xq197D.log`, and the two earlier diagnosis captures.
The pre-native failed retry is retained as `live-qwen-before-native.json`.

## Verification and documentation impact

Final source gates executed under Node 24:

- `pnpm exec vitest run` for the 12 affected storage, managed-skills, route,
  author, review UI, paired-provider and native/generic HTTP suites, with
  `--maxWorkers=1 --no-file-parallelism --testTimeout=60000`: **193/193 passed**.
- `pnpm --filter @vdt-studio/web typecheck --incremental false`: passed.
- `pnpm --filter @vdt-studio/local-runner typecheck`: passed.
- `pnpm lint`: zero errors; 30 existing warnings in unrelated web files.
- `pnpm docs:verify`: 31 documents passed.
- `pnpm certification:verify`: 23 records verified against registry/manifests/docs.
- `git diff --check`: passed.

Updated workflow and contracts: `README.md`, `docs/PRODUCT_SPEC.md`,
`docs/ROADMAP.md`, `docs/AI_HARNESS.md`, `docs/AGENTIC_VDT_RUNTIME_SPEC.md`,
`docs/ARCHITECTURE.md`, `docs/LOCAL_RUNNER.md`, `docs/provider-compatibility.md`,
`docs/security/local-ai-threat-model.md`, `docs/PRODUCTION_READINESS.md`,
`docs/adr/ADR-014-tree-to-skill-review-and-updates.md`, and the pointer in
`docs/implementation/SKILL_WORKFLOW_2026-11-03.md`. The release certification
manifest was reviewed; its support/live-verification status was not changed.

Both owned harness reports record `cleaned:true`; their private process groups
exited, temporary roots are absent and source Next/TypeScript config hashes match
before/after. No Xcode build or simulator was used. The retained evidence is
under 1 MiB; no large files are retained by this follow-up.
