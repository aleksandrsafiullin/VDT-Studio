# Production Readiness

## Local alpha browser verification (2026-10-19)

The source-deployed local web browser gate passed on macOS with Node 24 and pnpm 10.33.2: **122 passed, zero failed, zero skipped, zero flaky** in one complete Playwright run (84 Chromium, 20 mobile Chrome emulation, 18 WebKit). Collection tags retain the existing engine/viewport coverage without preparing fixtures for tests restricted to another project. This is local web evidence; production/release `NO-GO`, V2 flags and provider certification levels are unchanged.

Two application blockers were corrected. The editor's Home/back links now await the existing revision commit; a save conflict/failure preserves visible edits and cancels navigation. Successful Back navigation explicitly supersedes a pending newly created VDT route. Direct OpenAI admission now matches the browser's exact local Host/Origin even when Next reconstructs the internal URL as localhost, while foreign origins, different ports and forwarded overrides remain rejected. The development launcher defaults to loopback.

The complete matrix covers project/VDT navigation and creation; formula editing/calculation; scenario rename/clone/delete and persistence; layout/preferences; real Excel parsing, category review, retained-source replay and editable XLSX export; encrypted IndexedDB key restoration/removal and plaintext exclusion; mocked agent progress/questions/retry/bindings; version comparison, guarded restoration, Undo and reopening saved checkpoints; and successful/failed navigation saves, including a read back from SQLite. API admission uses a synthetic key without executing a provider request. CLI/provider UI responses are mocked. WebKit uploads forward the browser's original multipart bytes; the tests verify uploaded size/hash and downloaded original bytes.

| Check | Result |
|---|---|
| `pnpm test:e2e` | 122 passed in 5.5 minutes; no test retries, failures or skips |
| Targeted Vitest regressions | 59 passed in 6 files: launch settings, Origin admission, workspace save and route synchronization |
| `pnpm typecheck` + separate E2E TypeScript check | Pass |
| `pnpm lint` | Zero errors; the same 15 existing warnings |
| `pnpm --filter @vdt-studio/web build` | Pass in the owned source snapshot; build children finished |
| `pnpm security:audit` | Pass; no known production vulnerabilities reported |
| `pnpm docs:verify` / `pnpm ci:verify` / `git diff --check` | Pass; 30 documents and 7 workflow contracts |

Local report: `output/playwright/local-alpha-2026-10-19-_1z3g4zl/report/index.html`, with JSON results, source-review screenshots and per-server cleanup records alongside it. Detailed earlier failures and build logs are retained in local evidence `browser-alpha-_1z3g4zl`. Test stores are unique and cleaned after their owned Next processes close. E2E and production build use a separate source snapshot so the running app's data and Next cache are preserved. CI retains HTML/JSON reports and failure traces for seven days.

This follow-up does not rerun the full unit suite or CLI packaging sequence, and does not qualify real provider generation, autonomous business-scenario correctness, physical microphones/devices, browser-history/crash recovery, native installers or Windows/Linux execution. Those gates and the broader W0.5 draft/durable-ownership work remain open; a fresh aggregate release gate is still required before publishing a candidate.

## Dependency and release-chain remediation (2026-10-19)

### Dependency audit evidence

`pnpm security:audit` passed with zero reported production vulnerabilities after upgrading Next.js to `15.5.28`, replacing npm SheetJS with the official `0.20.3` tarball, upgrading sharp to `0.35.5` and fflate to `0.8.3`, and updating PostCSS and its transitive dependencies. Vitest is updated to `4.1.12`; targeted development-only overrides update the affected YAML, glob expansion, selector parsing, browser metadata, quoting and esbuild versions. The SheetJS adapter preserves raw Excel serial durations in XLSX and XLS despite the newer library's date conversion. This dependency pass does not change the existing production `No-Go` or qualify hosted uploads.

The full `pnpm audit` reports **one high development-tool finding**, down from 50 total findings before remediation: [`braces@3.0.3`, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through ESLint's `fast-glob`/`micromatch` dependency. Upstream has no patched release as of this check. It is absent from the production audit, but the full audit still fails and must not be described as clean. No advisory is suppressed and no production security gate is waived.

Release verification now recursively scans directory resources instead of reading a directory as a file. Canonical skill hashes and copies exclude platform metadata, use deterministic ordering and fixed LF checkout bytes, and preserve unexpected files for review. Windows package scripts re-enter pnpm through Node and avoid POSIX execute-bit checks on Windows. Packaging refuses nonempty candidate directories and uses a unique temporary stage; a clean install requires a loopback runner health check and child shutdown before cleanup. `VDT_RELEASE_DIR` selects a separate candidate without replacing previous artifacts.

Verified locally on Node **24.15.0**, pnpm **10.33.2**:

| Check | Result |
|---|---|
| `pnpm lint` / `pnpm typecheck` | Pass; lint retains 15 existing warnings, zero errors |
| `pnpm test --maxWorkers=2` | 228 files passed, 5 skipped; 2,370 tests passed, 4 existing expected failures, 11 live tests skipped |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` + `pnpm desktop:verify` + `pnpm build` | Pass in a unique source snapshot without ignored local metadata; original dev server/cache preserved; child processes finished and the temporary snapshot was removed |
| `pnpm ci:verify` / `pnpm phase7:verify` / `pnpm docs:verify` / `pnpm certification:verify` | Pass: 7 workflows, 18 tasks/schemas, 30 documents, 15 provider records; metadata checks do not certify live providers |
| `pnpm evaluation:verify` | Pass: 20 deterministic mock cases |
| `pnpm security:audit` / full `pnpm audit` | Production: zero vulnerabilities; full audit: one unpatched high dev-tool advisory described above |
| `pnpm package:alpha` / `pnpm release:bundle:verify` / `pnpm package:verify` | Pass for a new candidate directory; checksums/SBOM, installed CLI commands, runner startup and `/v1/health` verified |

The aggregate `release:verify` command was not rerun against the live checkout because it shares the running app's `.next` directory; its constituent non-browser checks passed as described above. Local evidence: `alpha-fixes-NvXxlV`; candidate: `output/release/candidates/2026-10-19-NvXxlV/`. The prior `output/release/v0.1.0-alpha.0/` artifacts were preserved. The subsequent local browser gate is recorded above. Windows/Linux execution of the changed code, native installers, restart recovery and business-scenario acceptance remain separate gates; no support level is raised by this maintenance work.

## Encrypted local API-key persistence (2026-10-18)

BYOK keys now use a separate origin-local IndexedDB vault with AES-256-GCM and non-extractable Web Crypto keys. Startup restoration, endpoint isolation, replacement/deletion, failure/retry status and stale-operation fencing are implemented. Plaintext keys remain excluded from ordinary preferences, VDTs, exports and durable server runs. This is browser-profile protection, not OS Keychain or hosted authorization. Packaged native/WebView, Windows and compromised-profile protection remain unqualified; existing production/release NO-GO is unchanged. See [ADR-007](adr/ADR-007-encrypted-browser-api-keys.md).

## Source-aware autonomy work (2026-10-17, experimental)

Shared retained-file tools, deterministic aggregates and guarded query-to-empty-input writes are implemented locally. Bounded working context retains untrusted source/citation evidence; explicitly enabled OpenAI web research is process-memory-only with a one-hour expiry. Codex framing uses a private strict output schema, correct root search flag and one bounded envelope correction. Existing no-progress/failure and verified-finish checks remain active.

Model-specific completion and independent source/semantic audits are required before claiming an autonomous scenario passed. Failed/cancelled attempts must remain visible and separate from successful timings. Production build, packaged/native behavior, hosted credential/ownership authorization, parser hardening, refresh, general joins and hard CLI isolation remain unverified or incomplete. Existing production/release NO-GO is unchanged.

Literal-zero dependency hardening (2026-10-18): the 44-node CLI follow-up finished under the earlier syntactic-reference rule but used `0 * factor` terms to attach inactive branches. Current protected hierarchy checks fold literal constants and reject these ineffective dependencies; ordinary numeric evaluation and baseline-zero factors remain unchanged. A later blank CLI run stopped on an `argsJson` envelope error. Wire decoding now covers both canonical call carriers and existing action aliases, with strict validation and at most one bounded envelope correction. Fresh CLI/API results are recorded below; these earlier runs are not full-scenario successes.

**Hierarchy correction (experimental):** the earlier saved-project diagnosis established that finite arithmetic could pass with a flat, mismatching visual graph. New full-tree public Supervisor runs now require an agent-authored plan, matching ordered factor construction, explicit context/shared-reference classification and hierarchy agreement before finish. Atomic branch reparenting preserves node/source data through the ordinary mutation Gateway. Targeted tests cover flat-but-calculable rejection, shared inputs, layer ordering, plan approval, source preservation and invalid moves, plus JSON and strict SQLite revision round-trips for unfinished plans. Structural acceptance does not certify domain semantics or business correctness. Existing manual/legacy files and historical receipts are not rewritten. The one-layer `deepen_node` and read-only review contracts remain separate. Production/provider qualification is unchanged.

Fresh local evaluation on 2026-10-18: Codex CLI `gpt-6-luna` run `bf4bd79e-e4c9-4634-97ae-d18c5bdca9fa` started from one blank root and finished in 679.38 seconds without operator formula/value/plan edits. The saved 28-node tree has two edge levels, a valid plan/visual/formula hierarchy and a 138,600 t root. This passes the hierarchy scenario, not the complete source/causal scenario: it mislabeled the combined fleet's 2,352 calendar hours as excavator hours (correct excavator total: 672), left time/cycle/downtime in contextual branches, and recorded 11 file-derived inputs without replayable query lineage; 10 other file inputs replayed successfully. The first CLI attempt exposed a dropped-plan importer bug, now fixed with persistence regressions, and remains a separate cancelled attempt. The first fresh API attempt stopped after a 180-second provider timeout while still on a blank root; its released controller could not accept the legacy retry/cancel controls. This initial attempt did not qualify API completion; separate fresh follow-up results are recorded below. Local evidence bundle: `hierarchy-contract-2026-10-18-16_jk2fi`.

The next API attempt (`36ada87e-6686-4a28-91ff-731e6d6eda16`) exposed a context-container repair loop: numerical missing-value checks encouraged deleting reference groups and moving their children to the root. It was interrupted and retained as a failed attempt, not a completion or performance success. All 22 committed reparent operations preserved the complete node arrays exactly and changed only the intended parent/edge relation. Non-numerical planned context containers and the root reference-grouping policy now address that cause; targeted regressions cover numerical leaf enforcement, active-group rejection, legacy readability and host finish. Fresh final CLI/API evaluation is still required. Cancellation also failed to return before the owned development server was stopped; no manual database status rewrite or recovery-fence bypass was used.


Historical verification baseline: **2026-07-24**, Node `24.14.0`, pnpm `10.33.2`.

## Decision

**No-Go for production, hosted file upload, trusted KPI baselines or auditable benchmark claims.**

The current `0.1.0-alpha.0` checkout is suitable for development and controlled evaluation on copies of data. It contains substantial implemented foundations, but several P0/P1 correctness and security blockers remain.

The repository does not contain the previously referenced `Technical Specification for Codex.docx`. Current readiness is assessed against executable contracts, current Markdown specs and the [2026-07-23 critical review](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Historical Verification (2026-07-24)

| Gate | Result |
|---|---|
| `pnpm lint` | Pass with 0 errors and 3 pre-existing warnings |
| `pnpm typecheck` | Pass across workspace packages |
| `pnpm test` | Clean rerun: 120 files passed, 5 skipped; 1,119 tests passed, 11 live tests skipped |
| `pnpm build` | Isolated CLI and Next production build pass; built W0.1 route import passes |
| `pnpm desktop:sidecar:prepare` + `pnpm desktop:sidecar:verify` | Pass; generated local-runtime manifest refreshed |
| `pnpm phase7:verify` | Pass: 18 tasks, 18 schemas, 9 manifests, 12 mock task smokes |
| `pnpm docs:verify` | Pass: 26 required documentation contracts verified |
| `pnpm security:audit` | **Fail: 11 vulnerabilities: 6 high, 5 moderate** |

No credentialed live-provider run passed during this review. Cursor and Codex agent-decision-v2 qualification attempts were executed but failed structured terminal-output validation; browser E2E, native installer and clean-machine desktop tests were not executed. Windows W0.1 storage durability is unverified.

Codex now selects the newest recognizable safe installation already on host `PATH` consistently for detection and default execution. A newer CLI's model-list metadata can expose models absent from an older installation; metadata-only catalog checks do not establish inference, VDT schema quality or execution-profile qualification. Native Windows process-tree cleanup and packaged desktop validation of this selector remain unverified, and provider certification statuses are unchanged.

## Implemented Alpha Foundations

- Project/VDT workspace, local SQLite metadata and hashed revision files.
- Direct canvas editing with Properties/Warnings, basic arithmetic formulas, scenarios, trace and editable Excel export with Source inputs, compact selected/scratch scenario analysis and matching VDT Potential. Workbook values retain full precision with a maximum two-decimal display and space-separated thousands (CLI: JSON/Markdown). The legacy AI inspector tab, per-node Accept/Reject, standalone review/explanation and editor JSON import/JSON/Markdown download controls are removed; full project archive import/export with attached sources remains planned.
- Bounded model-provider contracts and local output validation.
- Real VDT agent decision/tool/feedback loop, skills and run events.
- Research policy and search provider adapters.
- Paired loopback runner and private-pipe desktop sidecar foundation.
- Provider certification metadata, mock evaluation, package checksums and SBOM tooling.
- Experimental tabular data parsing, semantic model and data-mapping proposals.

## Local Voice Input Alpha

Local whisper.cpp dictation, incremental draft updates, confirmed model downloads and the desktop private-IPC path are implemented. Targeted automated checks cover the request/download/audio/cancellation boundaries. Windows native execution, packaged WebView microphone permissions, real-user Russian accuracy/latency and abrupt-shutdown cleanup remain unqualified. This capability does not change the production/release decision. See [VOICE_INPUT.md](VOICE_INPUT.md).

## W0.1 Atomic Revision Closure

W0.1 is complete with independent implementation/test `GO`. All production manual, combined-create and agent revision writers use `commitVdtRevision()`; non-test `apps/web` contains zero calls to the compatibility `saveVdtRevision(` surface. Publication creates the final revision-ID path with exact `O_CREAT | O_EXCL` semantics, not overwrite-capable atomic rename, then fsyncs the final file and directory before the SQLite head commit.

Independent Node 24 evidence passed 182/182 W0.1 tests: storage 59/59 with 100-process contention and real `SIGKILL` recovery, client/store 26/26, core 103/103 and agent packages 91/91. Package/workspace typechecks, isolated production build plus built-route import, strict DTO/error matrices, hosted fail-closed tests and the zero-writer audit also pass.

This closes F-01 and W0.1 only. Wave 0 remains in progress; W0.2–W0.5 are open, V2 flags remain OFF, and real Windows Node 24 durability/capability evidence is absent.

## Sequence 3 Local Migration Core

Sequence 3 is production-wired on supported local platforms and advances an
exact version-2 database to `user_version=3`. Production verifies the manifest,
SQL, WASM, ABI, static module profile and frozen vector identity/checksum, then
transforms actual database rows without loading the 121,310,783-byte golden
registry. The 55 ABI and 204 host vectors run only in explicit offline tests.

Local Node `24.15.0` checks on 2026-08-10 passed storage typecheck, focused
assets/transform/migration tests (`11/11`) and the focused legacy migration
regression (`62/62`). This is not release evidence: native Windows durability,
the complete platform crash matrix, package/bundle equality and transport for
the over-100-MiB offline artifact remain unverified. Production/release remains
`NO-GO` and all V2 feature flags remain OFF.

## Sequence 4 Bounded-Execution Schema

The additive Sequence 4 migration is production-wired as a separate fenced
attempt after unchanged Sequence 3. Storage tests cover immutable bindings,
exact-next session epochs, checkpoints, contiguous exchange/tool/finish receipt
transitions, Event V2 sequence/hash predecessors, V1 readability and fail-
closed External binding admission (`qualified + hard_verified + evidence`).

For a SQLite-backed AgentRunStore, this is now also normalized runtime-authority
`GO`: the public structured Supervisor writes all seven Sequence 4 tables as its
primary authority, uses the authoritative `agent_runs.project_id`, projects the
effective current session epoch, records a fresh 30-second audit fence on each
write and atomically reserves each tool call. This is not yet the ADR-005
shared ownership lease with acquisition, heartbeat, expiry takeover and
release. Failure to establish normalized authority is fail-closed; there is no
silent fallback. The V1 run row remains a readable secondary projection.

This is still not recovery `GO`. The route does not yet coordinate a safe
restart/epoch advance and resume, reconstruct the builder at its persisted
revision, restore paused question/approval state or hydrate a verified finish
receipt.

## Working-Tree Data Correctness Update

The 2026-08-10 focused data-harness/API checks close the known 4096-byte preview defect in the current working tree: text parsers prefer immutable full bytes, and a 1,000-row CSV regression passes. The incoming-category path also refuses to materialize Baselines from tables marked `truncated`.

This is not release evidence: the checks ran on local Node 26 outside the supported Node 24 range, adapter snapshots do not yet expose separate original/parsed/sample counts everywhere, and the broader upload security and parser-isolation gates remain open.

## Working-Tree File-Based Incoming KPI Workflow

The local experimental file workflow retains immutable project/VDT-owned originals, supports exact-byte download/reanalysis after cache reset, validates strict ownership/path/hash boundaries and rejects hosted data access. It adds complete multi-level additive numeric/duration partitions, explicit compatible-unit, timestamp and per-day decisions, required mapping/provider questions, server-side full-byte review/stage reruns and provenance in every generated KPI Description. Hierarchies are capped at four category levels and 200 nodes; invalid/truncated rows and incomplete coverage block staging rather than producing partial children. Card movement is excluded from semantic stale-target checks.

This is an implementation boundary, not new release certification. Focused API/storage/domain/UI checks are required after independent code review. General executable mappings, automatic refresh/joins, adapter-wide source/sample counts, isolated parsing, ingress budgets, lifecycle/encryption and authenticated hosted authorization remain open. Legacy global discovery data is preserved for trusted-local compatibility.

## Working-Tree Agent Decision V2 Update

The current working tree adds provider-neutral `agent-decision-v2` batching, atomic sibling-plus-parent-formula proposals, a bottom-up formula backlog, compact decision context, resumable step-limit pauses and informational per-run performance summaries. The v1 schema remains registered. Deterministic runtime/model-bridge/AI-harness tests cover normalization, strict API payloads, sequential execution, first-error/approval stops, formula rollback and continuation.

This does not promote any provider certification. On 2026-08-26, Cursor failed both partial-output A/B variants (`BACKEND_PARSE_FAILED`, 83,678 ms with the flag and 91,657 ms without it), and Codex returned `SCHEMA_INVALID` after 91,444 ms; all three attempts produced zero schema-valid output bytes. The Cursor flag was retained. Three successful credentialed haulage runs per available provider/model, browser/native checks and the aggregate release gates are still required before release claims change.

## Working-Tree Session Execution Foundation

The working tree adds the ADR-006 session-oriented foundation: immutable
execution bindings and capability evidence, `VdtRunSupervisor`, a strict
`VdtToolGateway`, bounded engine/tool/checkpoint receipts, Event V2 hash-chain
projection, `InProductModelAgentEngine`, deterministic finish receipts, compact
public snapshots and default-off Cursor ACP plus checkpoint/resume engine
canaries. It also adds
deterministic subtree instantiation, strict enum-field diagnostics, safe numeric
comma parsing and a sanitized fixed-fixture benchmark harness.

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged.

The model-facing catalog preserves Zod types, enums and required fields (nested cards bounded to three object levels, catalog below 35,000 characters). Local transports retain the immutable brief/catalog, the last confirmed reply and the new semantic-checkpoint delta, without sharing history across runs. Ollama uses native `/api/chat`, direct structured actions (`think=false`), model sampling defaults unless the binding overrides temperature, a 16,384-token context and native JSON-schema format. The Model Agent allows up to 4,096 predicted tokens for the compact JSON action, three tool calls and 512 characters of semantic state. Private thinking frames maintain stream liveness but are never parsed or executed as actions. The opening assistant message is capped at 500 characters; subsequent turns omit that duplicate prose, while questions and the verified final retain their dedicated actions. All tool cards are visible; read-only `tools.describe` retrieves full schemas for 1–6 selected public names. Native decoding includes introspection, finish and core value/formula update schemas upfront, then unlocks other tools after successful schema discovery; `vdt.create_draft` stays unavailable in continuation mode. Control calls, numeric-input batches and draft/topology/recipe seeding use singleton native batches, so returned IDs are observed before further mutations. Hidden tools cannot be admitted. The Gateway still checks arguments, provenance, scope and mutations.

Ollama responses stream with independent bounds: 300 seconds to the first valid frame, 60 seconds of stream inactivity, 480 seconds total and 1 MB of response bytes. Healthy generation may pass five minutes; missing completion, truncated output, malformed frames, inactivity and caller cancellation fail closed. Other local HTTP exchanges keep their 180-second limit. Endpoints remain manifest-owned loopback URLs with redirects disabled and no inherited cloud credentials. Every local turn receives `hostObservation`, a read-only current-revision view of up to 80 node rows and bounded calculation errors. It supplies confirmed IDs, formulas, zero values, a bounded explicit list of unpopulated inputs and a formula backlog, without authoring changes or replacing finish verification. Larger graphs are explicitly marked truncated. Project-tool results retain the lossless `project-tables-v1` transport projection; canonical Gateway payloads, hashes and receipts are unchanged. Models are installed only by an explicit user-authorized operation, never by the application automatically.

**Live Ollama limitation (2026-10-17):** native argument constraints prevent malformed field names, but do not prove correct node selection, provenance or autonomous completion. A live qwen3:8b continuation still attempted a missing node and later reached the 300-second deadline on a memory-constrained Mac. The requested draft was completed as an explicitly manual revision with editable assumptions and independently checked with the formula engine; this must not be presented as an autonomous Ollama build. A subsequent read-only Ollama run validated and calculated all 54 nodes and completed with a verified finish receipt, without changing that manual revision. This does not qualify autonomous construction; large-task continuation and recovery remain unverified. The optional q8_0 host-cache experiment was reverted because it reduced memory but slowed decoding on that host.


Structured Model Agent loop protection now terminates after three repeated
tool/constraint failures, independently of call IDs and changed invalid values,
and obeys the public `maxSteps` bound (default 40, cap 60). Optional checkpoint
counters retain consumed budgets across supported resumes; older checkpoints
start at zero. Tests cover repeated native-Ollama responses through the public
API/Gateway, correction from a one-driver batch to `vdt.add_driver`, preserved
existing values, terminal status and controller cleanup. These provider replies
are mocked; they do not establish live model quality or full-tree completion.
`MAX_MODEL_TURNS_EXCEEDED` is still terminal in this profile, so the target's
explicit same-session budget-extension pause remains missing. Backoff,
legacy/external-loop retry limits and restart orchestration remain open.
A separate short-context live `qwen3:8b` check repaired a one-driver batch
with a fresh call ID and passed the actual Gateway against an isolated
in-memory fixture (one driver added with the supplied value). This does not
verify full-tree quality, the full production prompt, or end-to-end latency.

This is **trusted-local canary wiring**, not a provider, recovery,
security or performance `GO`:

- a registered server-owned structured Model Agent binding uses the public
  Supervisor path, while provider-ID requests remain explicitly on the legacy
  micro-CLI compatibility runtime only under its separate production opt-in;
  the default Model binding is registered but disabled and undiscoverable until
  `VDT_MODEL_AGENT_ENABLED=true`, and there is no silent fallback;
- trusted-local development `pnpm dev` and `run.command` enable the explicitly
  unverified CLI checkpoint/resume canary and disable legacy fallback. Codex
  registers additional immutable bindings from its authenticated host model
  catalog; the composer requires a compatible selected-model binding before
  enabling Send. A real `gpt-5.6-luna` connection check returned an assistant
  message and a clarifying question without modifying the user VDT. Production
  builds still reject the canary; a missing candidate binding fails closed
  instead of reopening the per-decision CLI loop;
- the legacy orchestrator no longer invokes `orchestrator_first_response`; its
  first `AgentDecision.statusMessage` supplies the first UX reply while the old
  task remains compatibility-registered;
- SQLite-backed Supervisor persistence uses normalized Sequence 4 as primary
  authority with current-epoch checks, per-write fence audit metadata, atomic
  tool reservation and a durable pre-provider
  `in_flight` exchange checkpoint. Controller-loss recovery nevertheless stays
  fail-closed: the auto-resume coordinator, persisted builder reconstruction,
  and paused question/approval restoration are not implemented. Supervisor and
  Sequence 4 finish-receipt hydration/finalization exist, but no public
  process-loss coordinator invokes them automatically;
- Cursor ACP and Cursor checkpoint/resume have no accepted `hard_verified`
  negative-security evidence. ACP remains unavailable; checkpoint/resume is
  available only as an explicit trusted-local qualification candidate, and
  public start rejects it while it remains `unverified`. A local probe also
  confirmed that the existing Cursor subscription login is unavailable inside
  the required private HOME (`Authentication required`). The checkpoint adapter's fake-runner
  tests do not prove that print mode
  cannot execute an unreported built-in tool. Codex has an executable local
  checkpoint session and connection-check evidence, but no full live VDT,
  performance or hard-isolation qualification. Claude qualification claims
  remain unchanged; and
- no successful post-change External or Model Agent live benchmark was run.
  The historical 903.7-second sample is context only. The release criterion is
  3/3 cold runs at no more than 420 seconds plus at least 20 warm runs with p95
  no more than 420 seconds; approximately 180 seconds is only a stretch median.
  The generic stateless Model Agent transport now sends initial context once,
  then a required server-private semantic checkpoint capped at 16 KiB,
  confirmed hashes/cursor and only the current delta. It does not replay the raw
  project or transcript, but that checkpoint is not durable, so the adapter
  advertises `supportsResume=false`. A provider-native continuation/cached
  session or measured same-model benchmark is still required.

## P0 Correctness Blockers

### Agent/manual-change race

More than one legacy compatibility decision loop can still operate on a public
run, and unsupported manual-change types are not fully merged. The structured
Model Agent path now removes the per-tool loop for its own run, rejects a stale
mutating/finish call before execution, sends a compact reconciliation delta to
the same session and rechecks an approved proposal's base revision. This closes
the narrow in-memory overwrite case, but not the blocker as a whole: the legacy
path remains and the restart coordinator does not yet rehydrate the SQLite
authority into safe resume or complete operation-level reconciliation.

Required: complete public-route adoption, restart-safe builder/interaction
rehydration and auto-resume coordination, operation-level merge and
revision CAS.

## Release Dependency Remediation And Remaining Security Blockers

The previously recorded dependency failures are historical; the 2026-10-19 production audit passed with zero reported vulnerabilities. See the current dependency audit evidence above and the preserved corrective execution log for the earlier counts. Fresh dependency checks are still required for every release candidate.

Scoped upload/read/edit/stage/download/list routes now require trusted local app mode and verify SQLite project/VDT ownership plus safe IDs and source hashes. The upload path still lacks pre-buffer streaming limits, archive expansion budgets, parser isolation, authenticated hosted actor authorization, retention/delete and encryption policy. Hosted/public uploads must remain disabled until these findings and controls are closed.

## P1 Product Blockers

- Visual graph, formula dependencies and units are not a unified validated contract.
- Structural `valid` does not guarantee dimensional correctness or calculability.
- Status `approved` is not guarded by calculation/evidence gates.
- Tool JSON Schemas shown to models omit important types/required/enums.
- Skill selection is narrow and unreliable for Russian/Kazakh requests.
- The target single-copy, agent-owned selection repository and CAS/read-ledger contract are documented but not implemented.
- Recipe completeness does not guarantee formula closure.
- Web research stops at snippets and has no immutable evidence/benchmark model.
- Data mappings are not reusable executable bindings. The bounded incoming additive-sum path materializes a complete hierarchy with explicit period/per-day choices during analysis/review (the period describes the full extract and denominator rather than filtering rows), but refresh, automatic reconciliation, general grain semantics and general metric execution remain absent.
- The composer file flow can use the configured provider for semantic review and category-to-incoming-KPI proposals, but it remains isolated from the main skills/research loop.
- Real Excel report layouts, locale numbers, quality rules and lineage are incomplete.
- SQLite and localStorage remain competing project-state sources.

## Provider And Desktop Gates

- Canonical provider status is `release/provider-certification.json`; most real providers are not live-verified.
- Complete credentialed live generation/agent smokes before raising a provider's support level.
- Treat backend/CLI readiness and External execution-profile qualification as
  separate gates. External requires exact adapter/version/protocol/tool-catalog
  evidence, hard isolation and the negative shell/filesystem/Git/WebFetch/MCP/
  subagent suite; executable detection or permission-only flags are not enough.
- Run an independent security review of BYOK proxy, CLI boundaries and upload/data egress.
- Replace the bundled Node sidecar with a reviewed self-contained binary.
- Pass `pnpm desktop:native:preflight` with Rust/Cargo, pinned Tauri CLI, signing and Windows targets.
- Produce and test signed macOS/Windows installers on clean machines.

## Release Gate Status

`pnpm release:verify` remains a required fresh candidate gate. Its production dependency audit passed in the 2026-10-19 remediation work; this alone does not establish the remaining browser, recovery, data/business or native release gates.

Gate A and W0.1 status is tracked by the [`corrective plan`](VDT_STUDIO_CORRECTIVE_IMPLEMENTATION_PLAN.md), [`ADR-003`](adr/ADR-003-single-copy-skills-and-agent-owned-resolution.md), [`ADR-004`](adr/ADR-004-atomic-revision-commit-and-legacy-migration-adoption.md) and [`execution log`](implementation/VDT_CORRECTIVE_EXECUTION_LOG.md). W0.1 does not enable V2 behavior: all corrective V2 flags remain server-owned, fail-closed and default OFF.

The following are not current production evidence unless rerun for a release candidate:

- Playwright Chromium/WebKit results;
- package clean-install on every target OS;
- live provider output;
- native desktop launch/install;
- real user report baseline reconciliation.

## Rule For Production Claims

Do not label the application or installer production-ready until:

1. every P0/P0-release blocker is closed;
2. factor-tree dimensional/calculation gates are enforced;
3. benchmark and data baselines have auditable provenance;
4. dependency, provider, browser, package and native gates pass in the same release run;
5. documentation and certification metadata match the tested artifacts.

The generic `vdt.fill_input_values_batch` fills 1–8 existing unpopulated non-calculated input leaves in one atomic mutation with a finite number, explicit user/default provenance and a source note. User values require the same trusted quote/answer grounding as single writes. Unknown IDs, duplicate writes, computed/root nodes, non-leaf nodes, ungrounded user values and invalid arguments reject the whole batch. It cannot add nodes, change formulas or bypass mutation approval, scoped `deepen_node` checks, revision fencing or finish verification. Single/batch driver additions reject collisions in their normalized IDs instead of silently suffixing a copied input ID; distinct quantities require explicit unique IDs.

Local native tool availability is grounded in the current server observation: value/formula writes are withheld while a new placeholder still needs real structure. Existing-target arguments use current node-ID enums only when the graph view is complete; truncated views are not treated as exhaustive. `vdt.fill_input_values_batch` is restricted to currently unpopulated leaves and becomes unavailable when none remain, preventing repeated successful refill operations. Intentional corrections use `vdt.update_node`. The Gateway continues to validate every call against the actual fenced revision. A server-derived finish requirement rejects `ROOT_NOT_DERIVED` for a new tree represented by a standalone constant or root without driver references.

Native new-tree steps now separate structure, numeric input filling and formula assignment, with four-node singleton batches and model-authored lowercase IDs. Literal numeric source guidance relaxes after later human input or projection truncation. These implementation guards do not establish autonomous business-model correctness or provider qualification.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.

When the original structured brief already specifies KPI, unit and period, new-tree library discovery/read precedes questions, including the initial turn. Missing core metric definitions can still be clarified immediately. This prevents delegating internal library/tool selection to the user; essential clarification remains available after reading relevant guidance. Final source-quote diagnostics expose equal-value candidates with units as hints, and explicitly preserve the assumption status of numbers labelled as estimates in the brief.

**Case-specific live evidence (2026-10-17):** the later fresh Ollama `qwen3.5:4b-q4_K_M` run `e36dee13-fe78-424e-8733-847ca241c04d` completed the library-backed annual excavation/haulage workflow in 10 turns (950.837 seconds), with a verified persisted finish receipt and 35 fully calculable nodes. There were no operator formula/value edits or human replies during execution. Six site facts and 16 explicit assumptions produce 12,463,829.596412554 t/year, with zero formula-engine calculation errors and no missing inputs; the model recovered from two rejected provenance/status updates. See [the audit, source/default split and limitations](AI_HARNESS.md#local-library-completion-evidence-2026-10-17). This evidence is distinct from the earlier manual 54-node draft and does not qualify arbitrary synthesis, the 420-second benchmark, restart recovery or production release. Existing blockers and canonical provider statuses remain unchanged.

**Direct OpenAI case evidence (2026-10-17):** `gpt-6-luna` run `c0457075-190e-4650-99fc-1377a76357cd` completed the same Russian excavation/haulage brief on a fresh blank-root VDT in 145.436 seconds, 10 turns and 31 successful tool operations. The saved 35-node tree independently calculates 10,804,588.164734107 t/year with no calculation errors or missing inputs; all supplied facts and agreed shift/repair assumptions were checked, and other inputs remain explicit editable assumptions. A verified persisted receipt, zero manual formula/value edits and zero human replies distinguish this successful build from the two earlier failed integration attempts. See [transport/admission changes and evidence](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17). This single sample does not meet the multi-run performance qualification, prove arbitrary synthesis or restart recovery, or change the existing production/release blockers. The same model name in a CLI has a separate adapter/qualification boundary.


Fresh hierarchy follow-up (2026-10-18): CLI `gpt-6-luna` succeeded in 1828.788 s with 50 nodes; API `gpt-6-luna` succeeded in 932.305 s with 35 nodes. Both new drafts have five levels, an accepted saved plan/visual/formula hierarchy, no calculation errors, and 138600 t roots. Operators did not edit plans/formulas/values. All 30 CLI and 23 API retained-file numerical bindings replayed successfully. Complete node preservation was independently checked across 24 CLI and 2 API edge mutations. API shared research completed twice. Trials were sequential, with sampled ChatGPT footprint about 5.13 GiB maximum in these final cases and no resource guard trigger.

Full business acceptance remains partial: CLI cycle/speed branches are contextual and some time units are mislabeled; API uses cycles/speeds in output but scenario changes to calendar/downtime cancel through its time-share formulas. Baseline reconciliation alone does not prove scenario behavior. See `AI_HARNESS.md` for exact run IDs, option differences and local evidence. The experimental status, hosted credential/ownership gaps, hard CLI-isolation gaps and production/release NO-GO remain unchanged.
