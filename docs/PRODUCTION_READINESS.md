# Production Readiness

Last verified locally: **2026-07-23**, Node `24.14.0`, pnpm `10.33.2`.

## Decision

**No-Go for production, hosted file upload, trusted KPI baselines or auditable benchmark claims.**

The current `0.1.0-alpha.0` checkout is suitable for development and controlled evaluation on copies of data. It contains substantial implemented foundations, but several P0/P1 correctness and security blockers remain.

The repository does not contain the previously referenced `Technical Specification for Codex.docx`. Current readiness is assessed against executable contracts, current Markdown specs and the [2026-07-23 critical review](CRITICAL_ARCHITECTURE_AND_AGENT_REVIEW_2026-07-23.md).

## Verified In This Checkout

| Gate | Result |
|---|---|
| `pnpm lint` | Pass with 4 warnings |
| `pnpm typecheck` | Pass across workspace packages |
| `pnpm test` | 117 files passed, 5 skipped; 967 tests passed, 11 live tests skipped |
| `pnpm build` | CLI and Next production build pass |
| `pnpm desktop:sidecar:verify` | Pass |
| `pnpm phase7:verify` | Pass: 18 tasks, 18 schemas, 9 manifests, 12 mock task smokes |
| `pnpm docs:verify` | Pass: 15 required documentation contracts verified |
| `pnpm security:audit` | **Fail: 3 high vulnerabilities** |

No credentialed live-provider, browser E2E, native installer or clean-machine desktop test was executed during this review.

## Implemented Alpha Foundations

- Project/VDT workspace, local SQLite metadata and hashed revision files.
- Canvas editing, basic arithmetic formulas, scenarios, trace and JSON/Markdown/SVG export.
- Bounded model-provider contracts and local output validation.
- Real VDT agent decision/tool/feedback loop, skills and run events.
- Research policy and search provider adapters.
- Paired loopback runner and private-pipe desktop sidecar foundation.
- Provider certification metadata, mock evaluation, package checksums and SBOM tooling.
- Experimental tabular data parsing, semantic model and data-mapping proposals.

## P0 Correctness Blockers

### Revision corruption on conflict

Revision payload is written to a path based only on `revisionNo` before the SQLite insert. A conflicting save can overwrite the existing file, fail the unique constraint and leave the original record unreadable due to hash mismatch.

Required: transaction/CAS reservation, unique temporary files, atomic rename, 409 conflict and crash/concurrency tests.

### Silent partial data analysis

The data API provides both full bytes and a 4096-byte text preview, but text parsing prefers the preview. A 14,900-byte/1000-row reproduction parsed only 280 rows and reported `truncated=false`.

Required: parsers read the immutable full source; preview is UI-only; source/full/sample counts are mandatory.

### Agent/manual-change race

More than one decision loop can operate on a run, base revision is not enforced at apply, and stale agent snapshots can overwrite unsupported manual-change types.

Required: per-run coordinator/lease, serialized attempt, operation-level merge and revision CAS.

## P0 Release And Security Blockers

`pnpm security:audit` currently reports:

- `xlsx@0.18.5`: high prototype pollution ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6));
- `xlsx@0.18.5`: high ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9));
- `sharp@0.34.5`: high inherited `libvips` vulnerabilities ([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)).

The upload path also lacks pre-buffer streaming limits, archive expansion budgets, parser isolation, project ownership, retention/delete and encryption policy. Hosted/public uploads must remain disabled until these are closed.

## P1 Product Blockers

- Visual graph, formula dependencies and units are not a unified validated contract.
- Structural `valid` does not guarantee dimensional correctness or calculability.
- Status `approved` is not guarded by calculation/evidence gates.
- Tool JSON Schemas shown to models omit important types/required/enums.
- Skill selection is narrow and unreliable for Russian/Kazakh requests.
- Recipe completeness does not guarantee formula closure.
- Web research stops at snippets and has no immutable evidence/benchmark model.
- Data mappings are not executable and do not materialize baselines.
- Data-agent UI normally runs deterministic heuristics and is isolated from main skills/research.
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
