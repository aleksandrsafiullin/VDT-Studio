# VDT Studio Agent Rules

These rules apply to every coding or maintenance agent working in this repository.

## Start Here

1. Read `docs/README.md` to identify the authoritative document for the area being changed.
2. Inspect the current working tree before editing. Preserve unrelated and pre-existing changes.
3. Treat executable code, schemas, tests, generated manifests and release metadata as the source of truth for implemented behavior. Documentation describes that truth; it must not overrule it with an unsupported claim.
4. Read the relevant normative specification before changing agent runtime, skills, research, data ingestion, formula, storage, provider or desktop contracts.

## Documentation Is Part of Every Change

Every material code or configuration change must include a documentation impact check before the task is considered complete.

- Update documentation in the same change when behavior, user workflow, API, schema, storage, security boundary, provider status, release gate or limitation changes.
- If no documentation edit is needed, record `Documentation impact: none` in the final handoff and explain why.
- Never mark a planned or partially wired capability as implemented. Use explicit labels such as `implemented`, `prototype`, `partial`, `blocked`, `experimental` or `planned`.
- Do not update verification dates, test counts or support claims unless the corresponding command or live check was executed in the same work.
- Keep known limitations and release blockers visible. Do not remove them merely because a happy-path test passes.

## Documentation Update Matrix

| Change area | Documents that must be reviewed and normally updated |
|---|---|
| Product workflow or user-facing capability | `README.md`, `docs/PRODUCT_SPEC.md`, `docs/ROADMAP.md` |
| Package boundaries, APIs, persistence or state ownership | `docs/ARCHITECTURE.md`, relevant architecture document |
| Formula syntax, calculation or unit validation | `docs/FORMULA_ENGINE.md`, `docs/PRODUCT_SPEC.md`, readiness status |
| Agent loop, tools, skills, research or approvals | `docs/AI_HARNESS.md`, `docs/AGENTIC_VDT_RUNTIME_SPEC.md`, `docs/PRODUCTION_READINESS.md` |
| Data upload, profiling, mapping or baseline calculation | `docs/DATA_INGESTION.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCT_SPEC.md`, `docs/PRODUCTION_READINESS.md` |
| Provider, CLI adapter or model support | `release/provider-certification.json`, `docs/provider-compatibility.md`, `docs/LOCAL_RUNNER.md` |
| Desktop sidecar, native commands or packaging | `docs/architecture/desktop-local-execution.md`, `docs/architecture/runtime-protocol.md`, `docs/desktop-installation.md`, threat model |
| Security control or trust boundary | `docs/security/local-ai-threat-model.md`, `docs/PRODUCTION_READINESS.md`, release checklist |
| Release script, dependency gate or artifact | `docs/RELEASE.md`, `docs/release-checklist.md`, `docs/PRODUCTION_READINESS.md` |
| New or superseded architectural decision | Add/update an ADR and update `docs/README.md` |

## Generated And Historical Documentation

- `packages/vdt-agent/skills/` is the source skill library. `apps/desktop/src-tauri/sidecars/vdt-agent-skills/` is generated; update it with `pnpm desktop:sidecar:prepare`, never by hand.
- Files marked historical, superseded or reference-only must retain that status. Do not treat old migration plans or seed prompts as current implementation truth.
- When a normative specification and current implementation differ, document the gap in `docs/PRODUCTION_READINESS.md` or `docs/ROADMAP.md`; do not silently rewrite the requirement to match the bug.

## Required Documentation Verification

After documentation changes, run at minimum:

```bash
pnpm docs:verify
git diff --check
```

Also run the tests and gates relevant to the changed behavior. Provider status changes require `pnpm certification:verify`; task/schema changes require `pnpm phase7:verify`; desktop bundle changes require `pnpm desktop:sidecar:prepare` and `pnpm desktop:sidecar:verify`.

The final handoff must list updated documents, verification commands and any claims that remain unverified.
