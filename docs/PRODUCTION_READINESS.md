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

No credentialed live-provider, browser E2E, native installer or clean-machine desktop test was executed during this review. Windows W0.1 storage durability is unverified.

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

## Working-Tree Data Correctness Update

The 2026-08-10 focused data-harness/API checks close the known 4096-byte preview defect in the current working tree: text parsers prefer immutable full bytes, and a 1,000-row CSV regression passes. The incoming-category path also refuses to materialize Baselines from tables marked `truncated`.

This is not release evidence: the checks ran on local Node 26 outside the supported Node 24 range, adapter snapshots do not yet expose separate original/parsed/sample counts everywhere, and the broader upload security and parser-isolation gates remain open.

## P0 Correctness Blockers

### Agent/manual-change race

More than one decision loop can operate on a run, base revision is not enforced at apply, and stale agent snapshots can overwrite unsupported manual-change types.

Required: per-run coordinator/lease, serialized attempt, operation-level merge and revision CAS.

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
