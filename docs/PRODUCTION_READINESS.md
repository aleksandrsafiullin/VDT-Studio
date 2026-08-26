# Production Readiness

Last verified locally: **2026-07-24**, Node `24.14.0`, pnpm `10.33.2`.

## Decision

**No-Go for production, hosted file upload, trusted KPI baselines or auditable benchmark claims.**

The current `0.1.0-alpha.0` checkout is suitable for development and controlled evaluation on copies of data. It contains substantial implemented foundations, but several P0/P1 correctness and security blockers remain.

The repository does not contain the previously referenced `Technical Specification for Codex.docx`. Current readiness is assessed against executable contracts, current Markdown specs and the [2026-07-23 critical review](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Verified In This Checkout

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

## Implemented Alpha Foundations

- Project/VDT workspace, local SQLite metadata and hashed revision files.
- Canvas editing, basic arithmetic formulas, scenarios, trace and JSON/Markdown/SVG export.
- Bounded model-provider contracts and local output validation.
- Real VDT agent decision/tool/feedback loop, skills and run events.
- Research policy and search provider adapters.
- Paired loopback runner and private-pipe desktop sidecar foundation.
- Provider certification metadata, mock evaluation, package checksums and SBOM tooling.
- Experimental tabular data parsing, semantic model and data-mapping proposals.

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

This is **partial/binding-registry default-off**, not a provider, recovery,
security or performance `GO`:

- a registered server-owned structured Model Agent binding uses the public
  Supervisor path, while provider-ID requests remain explicitly on the legacy
  micro-CLI compatibility runtime only under its separate production opt-in;
  the default Model binding is registered but disabled and undiscoverable until
  `VDT_MODEL_AGENT_ENABLED=true`, and there is no silent fallback;
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
  negative-security evidence and are unavailable as public External profiles.
  The checkpoint adapter's fake-runner tests do not prove that print mode
  cannot execute an unreported built-in tool. Codex/Claude have typed,
  default-unavailable protocol canaries and deterministic negative tests, but
  no executable External session engine, live qualification or hard-isolation
  evidence; and
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

## P0 Release And Security Blockers

`pnpm security:audit` currently reports 11 production-dependency vulnerabilities: 6 high and 5 moderate. The six high findings are:

- `xlsx@0.18.5`: high prototype pollution ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6));
- `xlsx@0.18.5`: high ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9));
- `sharp@0.34.5`: high inherited `libvips` vulnerabilities ([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj));
- `next@15.5.19`: high App Router Server Actions denial of service ([GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj));
- `next@15.5.19`: high Server Actions SSRF on custom servers ([GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x));
- `next@15.5.19`: high SSRF in rewrites with an attacker-controlled destination hostname ([GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)).

The current Next.js high findings require at least `next@15.5.21`; the dependency remains at `15.5.19` in this evidence run.

The upload path also lacks pre-buffer streaming limits, archive expansion budgets, parser isolation, a server-issued actor/ownership boundary, retention/delete and encryption policy. Hosted/public uploads must remain disabled until these findings and controls are closed.

## P1 Product Blockers

- Visual graph, formula dependencies and units are not a unified validated contract.
- Structural `valid` does not guarantee dimensional correctness or calculability.
- Status `approved` is not guarded by calculation/evidence gates.
- Tool JSON Schemas shown to models omit important types/required/enums.
- Skill selection is narrow and unreliable for Russian/Kazakh requests.
- The target single-copy, agent-owned selection repository and CAS/read-ledger contract are documented but not implemented.
- Recipe completeness does not guarantee formula closure.
- Web research stops at snippets and has no immutable evidence/benchmark model.
- Data mappings are not reusable executable bindings. The narrow incoming-category path can materialize an initial filtered aggregate, but refresh, reconciliation, period/grain semantics and general metric execution remain absent.
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

The aggregate `pnpm release:verify` gate is currently expected to fail at `security:audit`. Documentation must not describe the high/critical dependency audit as completed.

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
