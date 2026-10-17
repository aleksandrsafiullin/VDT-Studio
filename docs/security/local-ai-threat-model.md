# Local AI And Data Threat Model

Last reviewed against the working tree: **2026-07-24**.

This threat model covers API/BYOK providers, subscription CLIs, local-model execution, desktop sidecar execution, web research and experimental data ingestion.

## Security Boundaries

- Hosted web is API/BYOK only and must not detect or execute local CLIs.
- Seamless Local AI is hosted by the desktop Tauri boundary and private sidecar protocol.
- Standalone loopback runner is an explicit development/headless fallback with pairing.
- Model output, web content and uploaded files are untrusted input.
- Provider/CLI manifests, task schemas and deterministic validators are trusted code/configuration.
- Data upload is not approved for hosted/public or trusted production use in the current alpha.

Trusted-local server catalog discovery admits only manifest-owned Ollama/LM Studio/vLLM model bindings. Hosted mode and production-build evaluation do not probe local catalogs; VDT_LOCAL_MODEL_AGENT_ENABLED=false opts out. Local bindings reject providerConfig endpoint overrides. Direct structured turns disable redirects, use no cloud credentials and remain subject to deterministic schema and Gateway validation. This wiring does not promote native packaging, model quality or performance qualification.

## Protected Assets

Local voice input adds microphone audio and downloaded recognition assets to this boundary. Audio remains on the same machine and is temporary; recognized text stays a draft until Send. The localhost route enforces mode, local hostname, same origin, JSON and streaming body limits. The native command accepts a closed operation/model/language catalog and bounded PCM, never download URLs or executable fields. Downloads enforce exact size and pinned ZIP/executable/model SHA-256 before use; incomplete files fail readiness. Inference is single-flight with bounded time/output and job-owned temporary cleanup. The community-built native engine's provenance and remaining native/crash qualification limits are explicit in [VOICE_INPUT.md](../VOICE_INPUT.md).

- Provider subscription sessions and API/BYOK credentials.
- Desktop IPC, sidecar handshake and request IDs.
- Project metadata, graph revisions, conversations and generated VDT content.
- Uploaded source files, semantic profiles, dataset versions and future evidence records.
- Repository and user files outside request-scoped temporary directories.
- Release artifacts, sidecar resources, manifests and SBOM/checksum files.

## Implemented Controls

| Threat | Current control |
|---|---|
| Hosted web executes local CLI | App-mode checks fail closed; hosted copy routes users to Desktop |
| Webview invokes arbitrary native capability | Reviewed Tauri commands only; no generic shell/filesystem/opener plugins |
| Frontend supplies executable path/args/env/schema | Runtime parsers reject forbidden fields; manifests own execution details |
| Browser turns provider authentication into arbitrary command execution | `open_provider_auth` accepts only a backend ID; Cursor resolves reviewed aliases and runs only manifest-owned `login`, with bounded time/output, single-flight execution and sanitized failures |
| Provider probe errors expose subprocess command lines or credential guidance | Browser-facing CLI detection maps failures to concise fixed diagnostics and sanitizes version-probe errors; raw subprocess output is not returned in detection diagnostics |
| CLI argv injection/path traversal | Shared validation rejects NUL, traversal and reviewed dangerous flags |
| Provider reads repository | Fresh temp workspaces, filtered environment and no browser-supplied cwd/path |
| Sidecar stdout corrupts protocol | Bounded framed JSON on stdout; structured logs on stderr |
| Sidecar startup hangs/crashes | Handshake timeout, child termination, pending rejection and crash-loop fail-closed |
| Sidecar resource is stale/tampered | Manifest SHA-256 verification before launch and release bundle scanning |
| Secret material ships | Bundle scanner, checksums and SBOM tooling |
| BYOK target performs SSRF/redirect | DNS validation/pinning, private-range rejection, redirect and size limits |
| Provider returns malformed graph | Closed schemas, local validation, bounded repair and calculation checks |
| Research disabled by user | Tool-layer rejection before provider call |
| Hosted request reads or writes local uploaded files | Data upload/list/download/run routes require explicit trusted desktop/development mode; hosted mode fails closed |
| Dataset/run ID crosses project or VDT ownership | Scoped routes verify SQLite workspace/VDT ownership and persisted file/run ownership; unscoped legacy lookups do not fall back to project records |
| File/run ID aliases a path or symlink | Strict safe IDs reject traversal and normalization aliases; storage rejects symlink directories and no-follow regular-file reads reject symlink payloads |
| Retained source changes after analysis | Upload source versions are write-once; full-byte reads check size/SHA-256, and review/staging compare the source hash to the retained run |
| Client skips mapping clarification to stage partial children | Required mapping/provider decisions and complete row/category coverage are deterministic staging gates; target semantic state is compared to the server-retained analysis basis |
| Conflicting revision overwrites an existing file | W0.1 strict CAS/idempotency commit boundary; final publication uses `O_CREAT | O_EXCL`, never overwrite-capable atomic rename; 100-process conflict and SIGKILL recovery tests pass on macOS Node 24 |

## Open Critical Risks

| Risk | Status and required control |
|---|---|
| Concurrent agent/stale snapshot overwrites manual changes | P0: per-run serialization, operation-level merge and conflict state required |
| Untrusted XLS/XLSX parser vulnerabilities | P0-release: replace/update dependency and isolate parser before external upload |
| Request/workbook materialized before effective limits | P0-release: streaming ingress and decompression/CPU/RAM budgets required |
| Hosted multi-user data authorization | P0-release: scoped local project/VDT checks and trusted-mode enforcement exist; authenticated hosted actor/ACL authorization remains unimplemented |
| Plaintext files without retention/delete/encryption policy | P0-release: lifecycle, storage permissions and encryption policy required |
| Partial preview analysed as full source | Full bytes are used for initial/review/stage incoming calculations; P0 remains for adapter-wide original/parsed/sample count disclosure |
| Web/file prompt injection | P1: mark source content as untrusted, isolate policy and add adversarial tests |
| Provider receives sensitive sample/profile | P1: data minimization, explicit consent, DLP/redaction and egress audit required |
| Dangerous existing-project mutation auto-applies | P1: risk-based approval and base-revision validation required |

## Provider And CLI Boundary

- The browser never supplies executable paths, static arguments, environment or credentials to local CLI adapters.
- Codex installation selection considers only reviewed `codex` names in absolute host `PATH` directories. Candidate and resolved real paths must be outside the current workspace and resolve to executable regular files before version probing. Probes use an isolated owned temporary cwd, filtered environment and bounded output/time/concurrency. Timeout/output failures settle after bounded termination grace even when inherited read pipes never close. Cleanup targets the owned POSIX process group or a bounded best-effort Windows tree termination; escaped descendants and native Windows cleanup are not qualified guarantees. Choosing a newer already-installed version does not alter user configuration or provider support status.
- Managed Cursor authentication deliberately inherits the host environment so the provider CLI can use its own browser/keychain flow, but the frontend supplies only `cursor_subscription`; the runtime fixes `agent login`, bounds execution, verifies the resulting session and never returns raw login output or one-time challenges.
- Subscription backends remain at the status in `release/provider-certification.json`; fake tests are not live evidence.
- Tool-capable Cursor receives a fresh ephemeral workspace, not the repository cwd or VDT MCP configuration.
- The experimental checkpoint/resume Cursor engine additionally uses a stable
  private empty workspace, a private HOME/config root and an explicit
  credential environment allowlist; any observed Cursor tool event, workspace
  write, session drift or unknown stream event stops the run. Because Cursor
  print mode still contains built-in tools and no credentialed adversarial
  sandbox evidence exists, this is an unverified default-off canary, not a
  hard-isolation or public-capability claim.
- Codex checkpoint/resume is executable only through the explicitly unverified
  trusted-local canary. Development launchers enable it by default; production
  still rejects it. Model-specific bindings come from the authenticated host
  CLI catalog, never arbitrary browser models or commands. Model identity is
  part of the immutable binding and canary admission check. The transport uses
  a private empty workspace, bounded ActionBatch output and read-only sandbox
  arguments; reported shell, filesystem or foreign-tool activity fails closed.
  A real selected-model connection check reached an assistant response and
  question, but neither an event stream nor that happy path proves absence of
  unreported effects or credential isolation. Hard-isolation and production
  qualification remain open. Claude qualification claims are unchanged.
- Other reviewed subscription manifests deny tools through provider-owned flags/policies and validate output locally.
- An unavailable required sandbox produces `UNSAFE_CONFIGURATION`.

## Research Boundary

Search results currently return snippets that are fed back to the model. Until a Research Broker and immutable Evidence Store exist:

- snippets must be treated as untrusted quoted data;
- they must not change system/tool policy;
- they must not be accepted as audited benchmark evidence;
- source opening, claim extraction, corroboration and user acceptance remain required roadmap controls.

## Data-Ingestion Boundary

The current storage/API are suitable only for single-user local alpha evaluation on non-sensitive copies. Scoped originals live under the SQLite owning project's `files/<datasetId>/`, while discovery runs retain owner IDs and their initial project basis separately. Exact-byte downloads and reanalysis remain available after browser reload, cache reset or client discard. New HTTP uploads always require project/VDT ownership; old global `.vdt/data-discovery` records remain unchanged for trusted-local legacy access. These checks do not create an authenticated hosted tenant/user boundary. Files and run snapshots remain plaintext, with no retention/delete policy, parser isolation or pre-buffer ingress budget. Hosted/public data ingestion requires all controls listed in `docs/release-checklist.md` and `docs/DATA_INGESTION.md`.

## Native Release Blockers

- Node-free self-contained sidecar binary.
- Native Rust/Tauri build verification and pinned CLI.
- macOS signing and Windows installer verification.
- Real Windows Node 24 W0.1 storage capability, concurrency and crash-recovery verification.
- Clean-machine installation and Local AI E2E.
- Passing dependency/security audit and independent review.

## Verification

```bash
pnpm security:audit
pnpm certification:verify
pnpm desktop:verify
pnpm desktop:native:preflight
pnpm release:bundle:verify
pnpm docs:verify
```

The current dependency audit fails with 11 vulnerabilities: 6 high and 5 moderate, including high findings in `xlsx`, `sharp` and `next@15.5.19`. Documentation must not claim this gate is complete.

Original-request numeric grounding is limited to a short exact quotation in the existing source note, with one numeric quantity equal to the written finite value. Only original request text and retained user messages are trusted sources; assistant text and tool results cannot create user evidence. This is literal-source verification, not semantic verification of a metric/value mapping. Gateway mutation checks, approvals and finish verification still apply. Local `hostObservation` is a read-only builder projection, not extra tool authority.

Native new-tree decoding may restrict an initial user-source claim to literal number/quote pairs extracted from the original prompt and business context. It never assigns those pairs to nodes, converts units or fills a value. That initial-source restriction is relaxed after subsequent human input; the canonical trusted-source check remains mandatory. Final brief/dependency diagnostics are model guidance, not evidence of business correctness. Failed input batches report all provenance issues atomically and retain normal subtree scope checks.

The optional native numeric-input map is a transport projection over current unpopulated leaf IDs. Restoring its keys to canonical nodeId fields cannot invent a target or number, alter a formula, expand the allowlist or bypass provenance, scope, approval and revision validation. Canonical arrays remain validated by the Gateway, including duplicate-target rejection.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.
