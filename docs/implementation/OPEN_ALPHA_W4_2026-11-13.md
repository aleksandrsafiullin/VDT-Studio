# W4: Help, feedback and local diagnostics

Implementation date: 13 November 2026. Baseline: `4fc92513f8df347620edff982ce25d11bcac5cc5`; implemented in the shared remediation working tree. Finding: RA-06 in [the readiness assessment](OPEN_ALPHA_READINESS_2026-11-13.md). Native installed-artifact acceptance remains W6's responsibility.

## User-visible behavior

Settings now contains **Help & feedback**. The page shows application version and source commit, identifies modified source where known, provides short first-use instructions and gives copyable setup/report addresses. Copying a link never opens or submits a report. If clipboard access is denied, the address becomes selected for ordinary copy/paste. This works within the existing native navigation policy without adding an arbitrary URL-opening command.

**Prepare diagnostic report** creates a local snapshot and focuses **Diagnostic report preview**. **Download diagnostics** remains disabled until a preview exists. The download contains exactly that preview; it does not read changing state a second time. **Refresh diagnostic preview** is explicit. Nothing is automatically sent to GitHub or a telemetry service. Reports may be attached manually after the user reviews them.

The preview includes a compact build/platform identity, selected chat and Suggested KPI backends and reasoning, current run status and timestamps, random UUID run/revision identifiers, revision generation and bounded error codes. The OS release is the kernel release. Model names are omitted by default for both selections, and the report records that omission. **Include model names** starts unchecked and warns that custom names may contain private names, paths or domains. Changing the option clears the preview and disables download until the user prepares a new preview. The new report records explicit opt-in and includes only names that pass the credential and format checks.

## Privacy and authority

`apps/web/lib/support-diagnostics.ts` constructs a new object from an explicit field list. It never serializes a store snapshot, provider configuration, event metadata, vault, raw error, user prompt, project, filename, source bytes or log. When the user opts in, model identifiers still reject whitespace, URLs, absolute paths, recognized credential signatures and known credential values from the selected configuration. Eligible custom names can resemble private identifiers, relative paths or domains, which is why they require opt-in and a new preview. Custom backend names and arbitrary reasoning strings are not exported. Only UUID-shaped run/revision identifiers are retained.

`support-error-events.ts` immediately maps error codes to a fixed allowlist and keeps at most 20 code/timestamp entries in memory. There is no new localStorage, IndexedDB, server history or telemetry. HTTP client hooks record only the structured code for agent requests, file library requests and data discovery; unknown codes become `UNCLASSIFIED_ERROR`. Existing user-facing errors and request behavior are preserved. A failed discovery snapshot records a generic validation code, never its source description.

`GET /api/support/build` returns only sanitized version, commit, dirty flag, build timestamp, platform, architecture, kernel release and Node version. It does not open user storage or enumerate environment variables. It rejects hosted/nonlocal and cross-origin requests and uses `Cache-Control: no-store`. The coordinator owns build-time identity injection in `scripts/build-identity.mjs` and `apps/web/next.config.mjs`; missing identity is never replaced with a fabricated release commit.

W1 recovery codes and W2 ingestion codes have fixed next-action guidance. The diagnostic path cannot authorize recovery, mutate a project, change providers, upload source data or bypass the desktop loopback boundary.

## Changed paths

- Settings navigation/modal and new `support-settings.tsx` / CSS module.
- `apps/web/lib/support-diagnostics.ts` and `support-error-events.ts`.
- `apps/web/app/api/support/build/route.ts`.
- Narrow structured-code hooks in `agent-client.ts`, `project-files-client.ts` and `data-import-wizard.tsx`, agreed with W1/W2 owners.
- Focused unit/route/render tests and `tests/e2e/support-settings.spec.ts`.

No changes to `vdt-store.ts`, `generate-activity-panel.tsx`, native command permissions, source-generation behavior or provider selection are part of W4.

## Verification and limits

Node 24.15.0 and the repository pnpm version were used. Evidence is retained in `output/release/audits/2026-11-13-remediation-w4`.

The focused suite command is:

```sh
pnpm exec vitest run apps/web/lib/support-diagnostics.test.ts apps/web/components/vdt/support-settings.test.tsx apps/web/app/api/support/build/route.test.ts apps/web/lib/agent-client.test.ts apps/web/lib/project-files-client.test.ts apps/web/components/vdt/execution-mode-settings.test.tsx apps/web/components/data-import/incoming-kpi-mapping-review.test.tsx --maxWorkers=1
```

Result: **31 tests passed across seven files**. Coverage includes synthetic credential/path/project/message exclusion, unknown-code suppression, bounded and detached session-error snapshots, valid model/reasoning preservation, unknown build metadata, local route admission, no-cache response, keyboard-operable navigation, preview-before-download controls, and unchanged agent cancellation receipt/import rendering behavior.

The privacy follow-up passed **25 tests across three files** on Node 24.15.0 (diagnostics, Settings render and support build route). It covers default omission for both model selections, guarded opt-in and the unchecked accessible checkbox.

The new browser scenarios check keyboard opt-in, invalidation and download gating on both checkbox transitions, keyboard focus and Escape return, preview/download byte equality, no automatic GitHub request, metadata redaction, and useful fallback when platform metadata fails. They are prepared for the coordinator's integrated browser run; this slice does not claim that browser or native checks have run.

The full web typecheck (`pnpm --filter @vdt-studio/web exec tsc --noEmit --incremental false`) passed. Focused ESLint passed with zero errors and two pre-existing unused-disable warnings in `data-import-wizard.tsx`; the same directives are present in the baseline. `pnpm docs:verify` and whitespace checks passed. Initial strict typecheck fixture errors were corrected; failure logs are retained. Native Windows display scaling, native clipboard/download handling and the final installed-build identity remain W6 gates. No live provider call or real credential was used.

## Documentation impact for integration

The coordinator should integrate the new **Help & feedback → Prepare diagnostic report → review → Download diagnostics** path into `README.md` and `docs/PRODUCT_SPEC.md`, mark RA-06 implemented pending native acceptance in readiness/roadmap, and describe the allowlist, session-only error retention and manual sharing boundary in `docs/security/local-ai-threat-model.md`. Build identity/release documentation should identify the four immutable `NEXT_PUBLIC_VDT_BUILD_*` values and preserve unknown/dirty states. W9 owns public feedback instructions and issue forms.

## Cleanup

No dependencies, browser engines or native build tools were installed, and no native/full web build was run by this slice. An initial small internal `/tmp` typecheck log was transferred to the SSD evidence directory and verified removed. Subsequent `TMPDIR` and all retained diagnostics are under the owned SSD evidence directory. No shared caches, user data or another agent's artifacts were removed. The final handoff reports any residual owned temporary files and evidence size.
