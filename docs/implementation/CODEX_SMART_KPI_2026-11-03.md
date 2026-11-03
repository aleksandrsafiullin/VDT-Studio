# Codex Suggested KPI startup fix — 2026-11-03

Status: implemented; focused local verification passed.

## Cause

`gpt-5.6-luna` / Low failed before inference because the authenticated Codex
catalog declares `tool_mode: code_mode_only`, while Smart policy v1 disabled
`code_mode_host`. CLI `0.166.0-alpha.5.1` emitted an error item:
`Code Mode is unavailable because code-mode host is disabled.` The adapter
classified it as `SUGGESTIONS_UNAVAILABLE`; `/api/ai/suggestions` returned 503.
Successful `/api/ai/suggestions/execution` only established model/reasoning
identity, not completion compatibility. A direct before-fix reproduction failed
in 95 ms without output. No reasoning or model fallback explains the failure.

## Change and boundary

Smart policy `smart-codex-readonly.v2` keeps the standalone Code Mode host
available. Code Mode remains disabled for ordinary models; the model catalog
can require its V8 wrapper. The entire built-in `functions` namespace is
excluded from nested tool exposure, image reading is disabled, and in-process
host fallback is forbidden. The selected model/reasoning are unchanged.

The private owner-only HOME/CODEX_HOME/workspace still copies only the reviewed
auth/installation/catalog files, ignores user config/rules, disables
shell/delegation/apps/plugins/hooks/browser/search, uses the read-only sandbox,
and admits one bounded structured completion. All reported tool events,
including Code Mode, remain terminal failures. Later valid output cannot
override that failure. Cancellation waits for owned child closure before
directory cleanup; unconfirmed closure retains/quarantines the directory.
The policy version participates in binding identity so v1 preparations cannot
be reused as v2 results. No agent loop or new Apply authority is introduced.

## Local verification

- A local loopback response-capture server with no provider credentials and no
  inference confirmed the exact `gpt-5.6-luna` request. Required Code Mode
  exposed only the V8 `exec`/`wait` wrappers, with **zero nested tools**.
  The wrapper description confirms no Node, filesystem or network access.
- One live diagnostic request with the proposed profile, the canonical
  measured-output fixture, exact Luna model and Low reasoning completed in
  **5,244 ms**, returned a schema-valid two-component proposal, and emitted only
  thread-start, turn-start, assistant-result and turn-completed events. There
  was no output repair or tool activity. Contextual/materialization quality is
  assessed separately from this wire-level result.
- The existing in-app browser was reloaded and its saved Suggested KPI
  settings confirmed `gpt-5.6-luna` / Low, independently of chat High.
  In the user's `Ore Excavation — full-depth QA` project, explicit Prepare for
  `Ore excavator productivity` produced two new proposed inputs:
  `Average ore payload per excavation cycle` (`t/cycle`) and
  `Excavation cycles per productive hour` (`cycle/h`). Their product passed
  contextual validation; the preview displayed `200 → 200 t/h` and enabled
  **Add 2 KPIs**. Add was not clicked and the six-node graph stayed unchanged.
  Screenshot: `output/codex-luna-20261103/suggested-kpi-live.jpg`.
- Focused regression: **8 files / 103 tests passed**, including streaming
  Code Mode rejection, later-success denial, child-close cleanup ownership,
  metadata identity, CLI selection, client/service and HTTP admission.
  The initial sandboxed process-probe test had two false failures because `ps`
  was restricted; the same file and final matrix passed with process inspection
  available. Its one escaped fixture child was identified by PID, start time
  and exact owned cwd, then stopped. It is not a retained background service.
- Node `24.15.0`: local-runner and model-bridge typechecks passed;
  `pnpm docs:verify` passed (31 documents), `pnpm certification:verify` passed
  (23 records), and `git diff --check` passed.

Commands used, with Node 24 first on PATH:

```sh
pnpm exec vitest run packages/local-runner/src/server/smart-suggestions.test.ts packages/local-runner/src/server/executor.codex-selection.test.ts packages/local-runner/src/server/executor.codex-claude.test.ts packages/model-bridge/src/subscription-cli/codex/smart-policy.test.ts packages/model-bridge/src/subscription-cli/codex/executable-selection-smart.test.ts apps/web/lib/smart-kpi-client.test.ts apps/web/lib/smart-kpi-service.test.ts apps/web/app/api/ai/suggestions/execution/route.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=output/codex-luna-20261103/tests.json
pnpm --filter @vdt-studio/local-runner typecheck
pnpm --filter @vdt-studio/model-bridge typecheck
pnpm docs:verify
pnpm certification:verify
git diff --check
```

Verification artifacts are retained under `output/codex-luna-20261103/`.
Temporary private process homes and schema files are removed only after their
owned processes have terminated. No user Codex config, sessions or caches are
modified by the diagnostic.

## Documentation impact

Updated together with this provider-policy fix:

- `docs/LOCAL_RUNNER.md`: private v2 invocation and identity invalidation;
- `docs/HARNESS_CONNECTIONS.md`: current evidence alongside the historical v1 failure;
- `docs/provider-compatibility.md`: narrow Luna qualification boundary;
- `docs/security/local-ai-threat-model.md`: restricted host/tool exposure;
- `docs/AI_HARNESS.md`: one-completion Code Mode contract;
- `docs/PRODUCTION_READINESS.md`: local verification and unchanged release blockers;
- `release/provider-certification.json`: evidence only; alpha/status flags unchanged;
- this report: diagnosis, commands, browser evidence and limits.

## Qualification limits and sources

This is local transport evidence for the tested CLI/model/reasoning, not a
provider-status promotion, arbitrary-model semantic certification, hard OS
isolation guarantee, native package qualification or release approval.
Codex remains alpha with `liveVerified: false`; existing release blockers remain.

Official OpenAI documentation used for the CLI options and configuration shape:
[non-interactive execution](https://learn.chatgpt.com/docs/developer-commands#codex-exec),
[configuration schema](https://learn.chatgpt.com/docs/config-schema.json).
The installed CLI's local request capture, rather than documentation alone,
establishes the observed tool exposure for this version.
