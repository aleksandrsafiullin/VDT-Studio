# Tree-to-skill workflow — implementation plan

Waiting-budget amendment: the user's follow-up extends local/CLI Skill Author
preparation from the original 90 seconds to five minutes, with elapsed waiting
time, cancellation and explicit deadline errors. The original acceptance below
is retained; current corrections and live Qwen evidence are tracked in
[the follow-up](SKILL_AUTHOR_LOCAL_TIMEOUT_2026-11-03.md).

Date: 2026-11-03. Status: implemented locally; developer gates, independent
re-reviews and browser acceptance passed. Owned harness cleanup is recorded below.

## Requested outcome

An explicit **Work with skills** button in the open tree's Context area opens a
dedicated workflow. It offers **Save as new skill** and **Update used skill**.
Excel export remains its own existing action. Settings → Skills remains the
shared file library.

New skills generalize the tree's modelling method, relationships, units,
descriptions, assumptions and checks. Project baseline/scenario values, source
rows and paths are excluded. The user reviews and edits an unsaved draft before
saving to the library or downloading SKILL.md.

Updates compare the pinned source skill, its latest working version and the
current tree. They propose individually selectable, editable changes with a
reason and source node IDs. Missing tree branches do not imply deletion from
the methodology. Universal fallback trees create a thematic skill instead of
updating universal guidance. Accepted updates create a new immutable version;
existing tree pins and the source graph are unchanged.

## Small work packages and review gates

1. **D1 — persistence and explicit update admission.** Harden managed saving
   against stale versions, changed/deleted/invalid files and rejected updates;
   add an explicit scoped update API and meaningful regression tests. Preserve
   file identity and supporting resources. Independent code review follows.
2. **D2 — authoring and semantic change proposals.** Enrich bounded tree context,
   extend new-skill drafting and implement a read-only update author. Validate
   every response and change anchor, preserve untouched content, and attach
   executable topology only from host-validated original tree formulas.
   Independent code review follows.
3. **D3 — dedicated user workflow.** Add the Context button and accessible modal,
   create/review/edit/save/download a new skill, review/select/edit proposed
   updates, reject stale responses and preserve recoverable drafts/errors.
   Independent code review follows.
4. **Integration and documentation.** Reconcile contracts, complete relevant
   documentation and exercise targeted tests, lint, web typecheck and docs gates.
5. **Final acceptance.** Run real browser checks of creation, selective update,
   conflicts and cancel; inspect screenshots and console errors. Distinguish
   deterministic provider fixtures from live model evidence. Re-review fixes.

Root agent orchestrates and performs final acceptance. Developers own separate
files; reviewers inspect completed work without editing it. Fixes return to the
owning developer before the next approval. No task is complete solely because
its author reports success.

## Shared integration contract

- Browser-safe helpers/types: `apps/web/lib/skill-workflow.ts` (D2).
- Existing new draft: `POST /api/skills/from-vdt` (D2). Existing fields remain;
  optional `feedback` can guide authoring. Returns `{ ok, raw, warnings }`.
- New update draft: `POST /api/skills/update-from-vdt` (D2). Same scope, project
  and execution fields as new drafting, plus `base: { id, version, contentHash }`
  and `selectionRevision`, optional `feedback`. The host verifies the pin,
  loads base and current working content, and rejects universal or stale pins.
  Returns `{ ok, proposal }`.
- `proposal` includes `summary`, `raw` (exact latest working Markdown),
  `warnings`, `changes` and `target`. Each change has `id`, `title`, `reason`,
  `nodeIds`, `before`, `after`, `kind` (`add`, `replace`, `remove`, `topology`).
  A nonempty `before` must occur exactly once; empty `before` means append.
  Ambiguous, overlapping, no-op and unbounded changes are rejected. Model output
  cannot author YAML metadata or executable topology. A separately identified
  host-owned topology proposal may use only validated original tree formulas.
- `target` is `{ id, version, contentHash, fileHash, baseVersion,
  baseContentHash, selectionRevision }`. Version/hash refer to latest admitted
  runtime content; fileHash refers to exact current working bytes. Base fields
  identify the pinned source. A selected subset is applied to `proposal.raw`
  by a shared deterministic helper; unrelated content stays byte-identical.
- New save continues to use `POST /api/skills` with `raw` and `sourceVdt`.
- Update save: `POST /api/skills/update` (D1), `{ projectId, vdtId, target, raw }`.
  It revalidates selection revision/base pin, latest version/content/file hash,
  working file presence and valid final Markdown. Successful response is
  `{ ok: true, skill }`. Conflicts return HTTP 409 without changing the graph or
  selection. Universal updates through this tree workflow are rejected.
- Source fields are bounded. Drafts/proposals are never automatically saved or
  selected. Existing local-only/same-origin request guards remain required.
- The UI compares captured scope, tree semantic source and selection before
  accepting async results or saving. Graph/selection changes require regeneration;
  late responses cannot appear in another tree. It uses the selected existing
  provider/transport with no substitution.

## Verification and disk policy

Use Node 24 and the existing pnpm dependencies. Before a heavy run, verify at
least 10 GiB free. Initial check: about 33 GiB free on system volume and 748 GiB
on workspace volume. No Xcode build is planned. Owned browser/runtime fixtures
use unique paths; user data, developer caches and other agents' files are kept.
Retain acceptance screenshots/reports under `output/playwright/skill-workflow-*`.

## Execution evidence

- Baseline: clean `main` checkout; initial repository and owning skill workflow
  specifications inspected. Existing basic Skill Author and immutable local V1
  versions are implemented; this dedicated review/update workflow is new work.
- D1 developer gate: initial 63 focused tests; final 68 cases passed across the
  combined run and focused reruns. Storage/agent typechecks passed. Independent
  review requested post-link fsync outcome handling and retry when a released
  lock disappears. Both were corrected; the reviewer repeated its original fault
  reproductions and issued **PASS**. Visible/unknown publication outcomes retain
  working bytes and report explicit HTTP 503; only confirmed absence compensates.
- D2 developer gate: 38 final tests passed. Independent review reproduced a
  topology promotion through prose boundaries, redacted executable period and
  redacted browser invalidation key. Assembled guidance/final topology invariants,
  exact original period metadata and separate exact browser-only semantic text
  were added, with promotion/split/deletion/subset/host-masking regressions.
  Independent re-review issued **PASS**.
- D3 developer gate: 23 final targeted tests and owned ESLint passed. A fresh
  preflight mismatch now refreshes parent Context while retaining drafts, and
  Context/preflight both use the actual graph root name. Independent re-review
  issued **PASS**; browser acceptance reproduced successful external-selection
  recovery. The root's final web typecheck passed after D2 test corrections.
- Root combined gate: 9 files / **129 tests passed**, using Node 24 with one
  worker/no file parallelism and a 60-second test ceiling for host-load tolerance.
  Command: `pnpm exec vitest run packages/vdt-storage/src/skill-library.test.ts
  packages/vdt-agent/src/managed-skills.test.ts apps/web/app/api/skills/route.test.ts
  apps/web/app/api/skills/update/route.test.ts apps/web/lib/skill-workflow.test.ts
  apps/web/lib/skill-author.test.ts apps/web/app/api/skills/update-from-vdt/route.test.ts
  apps/web/components/vdt/skill-workflow-dialog.test.tsx
  apps/web/components/vdt/setup-rail.test.tsx --maxWorkers=1 --no-file-parallelism
  --testTimeout=60000`.
- `pnpm --filter @vdt-studio/web typecheck --incremental false` passed.
  `pnpm lint` passed with 0 errors. Two new test-only warnings were corrected
  and independently re-reviewed; remaining warnings are in existing unrelated files.
  `pnpm docs:verify` passed (31 verified documents); final post-documentation
  verification is recorded in the acceptance report. `git diff --check` passed.
- Root browser harness uses owned temporary build/storage on localhost:3127;
  evidence is under `output/playwright/skill-workflow-20261103-z96r1zwb/`.
  Generation responses in browser checks were deterministic fixtures; actual
  create/update APIs, disk writes, immutable history and conflict checks were used.
  Passed: separate Context action/universal restriction; editable new draft;
  close/reopen retention and Escape focus restoration; downloaded bytes equal
  saved portable bytes; source values omitted and original pin preserved;
  empty-selection block; selected/edited-only version update with historical pin
  preserved; node links retain review; external file edits cause 409 and preserve
  both external bytes and draft; external selection refresh permits regeneration;
  semantic tree edits block stale saving; pending preparation cancellation retains
  the prior review and ignores its late response. Screenshots were visually reviewed.
- Separate live author-service checks used the actual managed **Codex CLI
  0.166.0-alpha.5.1** provider. Create passed in **11.809 seconds** and update in
  **10.126 seconds**, with validated outputs, original formulas and no source
  input values. The model was the host default, not explicitly selected/captured.
  Neither live draft/proposal was published. This is a service/transport check;
  browser generation fixtures and HTTP guard tests establish separate boundaries.
- Two live Ollama `qwen3.5:4b-q4_K_M` creation attempts (provider-default reasoning,
  then explicit Off) were cancelled at deadlines with no accepted output. One CLI
  HTTP probe also failed in the restricted-PATH browser harness; the successful
  direct service checks explicitly included the bundled CLI in PATH. None of
  these results promote general provider or packaged-native qualification.
- Cleanup verified: both owned browser sessions closed; the launcher confirmed
  child process-group shutdown and removed its owned temporary app view, Next
  build output and data. Its source Next/TypeScript config hashes were unchanged.
  Only small evidence files (about 1 MiB) remain in the report directory; no large
  files or Xcode build artifacts were retained. See `cleanup.json` in the report.

## Updated documentation

`README.md`, `docs/PRODUCT_SPEC.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
`docs/AI_HARNESS.md`, `docs/AGENTIC_VDT_RUNTIME_SPEC.md`,
`docs/PRODUCTION_READINESS.md`, `docs/security/local-ai-threat-model.md`,
`docs/adr/ADR-010-local-skill-library-and-context-selection.md`, new ADR-014,
`docs/README.md` and this plan were reconciled with implemented behavior and its
local V1/live-model/native qualification limits.
