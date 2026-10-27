# Local AI And Data Threat Model

## API/local model capability and reasoning admission

The new `/api/agent/bindings/provider` route requires trusted-local mode, exact
same origin, JSON and the production host gate. It bounds streamed input to
8 KiB/10 seconds and rejects unknown fields. API requests carry an explicitly
scoped key; no ambient key can accompany a browser-selected endpoint. Endpoints
must match an official/preset URL, an exact host-configured value, or both explicit
host override flags. Credentials in URLs, queries, fragments and redirects are
rejected. This is endpoint admission, not new DNS-pinning or hosted authorization.
Local input accepts only a known backend, model and selected value; no endpoint,
command, environment or key is accepted, and the runtime owns its manifest URL.

Metadata fetches are bounded to 10 seconds/256 KiB and fixed error messages omit
upstream bodies. Only curated capability values enter public responses. Direct
OpenAI may consult its exact public model card (5 seconds/128 KiB); Gemini may
consult the fixed official English thinking guide (5 seconds/1 MiB) after model
metadata confirms thinking. Documentation requests have no API authorization
headers; gateway/private model IDs are not sent to OpenAI documentation. Parsed
capabilities are data and cannot add instructions or tools. Unknown formats do
not create guessed controls. Selected values are revalidated at admission.

API pending definitions are immutable, unlisted, bounded to 16 entries/60 seconds
and consumed once. Their private execution copy retains credentials only in
process memory; public start bodies and run evidence contain only binding IDs.
API research admission still requires explicit enablement and direct OpenAI; keys
for other vendors cannot establish OpenAI research. Local model/value bindings
contain no browser endpoint configuration. False and zero remain explicit
values; unsupported reasoning cannot silently fall back. Browser preferences
contain only model/value choices and the separate existing encrypted key vault.
Readiness is ephemeral and stale requests are aborted/ignored after credential
rotation. No provider certification or native isolation claim follows.

## Catalog discovery boundary

The composer reuses the existing credential-scoped BYOK model-list route and
manifest-owned local/CLI probes. Model/effort choices do not grant executable,
argument, environment or endpoint authority. API keys remain transient in the
request to their configured provider; catalog identities and diagnostics exclude
credentials, and late results are discarded after source/credential changes.
macOS Codex discovery additionally checks only the reviewed ChatGPT bundled-CLI
locations under `/Applications` and the host home’s `Applications`, applying the
same realpath, executable-file, outside-workspace, candidate and probe bounds as
PATH discovery. An explicit host PATH suppresses extra app discovery unless the
host opts in. No installation, global PATH edit or cache deletion is performed.
New Codex/Cursor catalog bindings are appended; existing runs retain their pinned
engine. This remains local development wiring, not app provenance verification
or a production isolation claim.

## Local skill management

Skill routes are restricted to the trusted local application. JSON writes use
bounded streamed admission. A direct local Host can reconcile Next's
localhost/127.0.0.1 reconstruction only when both authorities are local, their
ports agree, the supplied Origin matches that Host and fetch metadata is not
cross-site. Forwarded headers cannot grant this exception; other AI routes keep
their default origin policy.

Custom Markdown is untrusted guidance and cannot add tools, read arbitrary
paths, grant research or authorize mutations. All working skills, including the
supplied seed, are editable. Admitted versions and any retained fork lineage
live in the immutable local repository. Path segments are validated, symlinks
rejected, content hashes checked and stale version/selection writes rejected. This is single-user local
storage, not tenant authorization or the V2 acceptance/read-ledger protocol.

The editable `<VDT_DATA_DIR>/skills` directory admits at most 2,000 entries, 12
path components and 128 KiB per Markdown file. It rejects traversal, absolute paths, reserved names,
symbolic links and hard-linked files. Invalid/duplicate working files remain on
disk and cannot replace last valid versions. Host versioning retains the exact
admitted working hash and does not rewrite externally saved bytes. A trusted
local filesystem user can edit those files; this is not isolation from the owner
of the machine. An OS-launch POST must pass the same local/same-origin JSON
guard. It resolves a skill ID or a validated relative file/folder only under the
repository; no arbitrary URL, command, application or shell is accepted. Launch
uses `/usr/bin/open`, `/usr/bin/xdg-open` or the fixed Windows Explorer executable
with one absolute-path argument and a deadline. The supplied library is copied
once into writable packages with declared relative resources (at most 1 MiB
each), using exclusive no-overwrite writes.
Seed markers prevent later overwrites/restoration after user edits/deletion.
Only the working library is used for live catalog access; reviewed distribution
sources are not opened for editing. Portable frontmatter cannot grant capability:
missing VDT metadata is host-normalized only in the immutable runtime artifact.
Only open actions remain in the file endpoint; file/folder management is external.
The previous `skill-library-v1/files` root is renamed as a whole into `skills`.
Migration rejects symlinked roots and stops without changing either directory
when both roots exist. Private version/selection history stays in place.

Skill Author receives bounded node names, units, formulas and relationships;
source numerical values, dataset rows and file paths are omitted. Its only
admitted structured result is an editable draft, never an executed model tool
or automatic publication. The user explicitly chooses Create and open to save
the draft for external review. The existing selected provider owns inference. API transport
uses the existing pinned-destination policy; local CLI uses its current managed
runtime controls. Original topology can be attached only after deterministic
validation, without numeric source defaults. Provider error details are not
returned to the UI. Model-authored prose still needs review; the feature does
not strengthen general CLI isolation or native/hosted qualification. See
[ADR-010](../adr/ADR-010-local-skill-library-and-context-selection.md).

## Smart editor quota fallback

`smart_kpi_storage.v1` is a private quota-only encoding of repeated Smart editor
payloads. It retains base/current projects, all history needed for Undo and the
same immutable request. Decoding restores property order and checks expanded
length/checksum before hydration/readback. The checksum detects corruption;
it is not a signature or authentication control. Unsupported/corrupt records
are retained and blocked from automatic overwrite. No keys, raw model prompts,
permissions, actor authority, revision CAS or API payload policy are added by
this encoding. If normal and compact writes both fail, no new request is sent.

## Smart KPI bounded preparation (partial product integration)

Smart proposal data contains no numeric defaults, write/CAS/provider authority or
commands. Explicit context-bound recipe provenance is required; names/keywords
cannot grant applicability. Bounded context contains mapping hashes/knownness,
not raw rows, file bytes or credentials. The validated cache retains no raw prompts,
keys, partial streams or pending jobs. Stable encrypted credential epochs survive
passive reload, rotate on real replacement/removal/restoration, and use CAS so an
identity migration cannot resurrect a removed credential. Codex identity hashes
only nonsecret config/CLI/policy metadata, never credential bytes. Routine Codex
model-catalog refresh metadata does not represent binding replacement; selected
model, actual config/executable/policy changes and credential epoch stay guarded.

All Next web AI Smart entries (`suggestions`, generic `run-task`, development
runtime, metadata and cancel) enforce same Origin and JSON content type before
bounded stream reading; their upload stalls are capped at 2 s. The paired runner
keeps its existing authenticated JSON/body policy (1 MiB limit). Prepared request IDs are random
capabilities. The host registry keeps at most 32 active/terminal metadata records;
normal terminal records expire after 5 minutes or LRU capacity pressure. Unknown
cleanup records are not evicted into success. Cancel404 is not cleanup proof;
client reconciliation either obtains the same request's terminal acknowledgement
or reports unconfirmed cleanup. Common runner/sidecar workspace lanes also prevent
bypass of active/quarantined ownership. Quarantine reconciliation is a privileged
host hook, absent from model tools/wire input. These lanes are host-session state,
not W0.2 durable coordination or a reboot/crash guarantee.

Smart API requests use explicit selected destination/model/key and DNS-pinned
transport, with no env key or hidden API fallback. Local HTTP destinations are
manifest-owned. Their cancellation proves closure of our HTTP request/reader,
not remote GPU termination. An abnormal read or malformed UTF-8 before EOF also
cancels and awaits that reader; unconfirmed cancellation quarantines execution.
Codex uses one private invocation, read-only sandbox,
reviewed tool-feature/web-search disables and fail-closed stream gates. Aborted
owned probes/process trees must close before releasing the lane; bounded unknown
cleanup retains the private owned directory/evidence and quarantines execution.
The directory can still contain copied auth artifacts until owned descendants are
confirmed stopped; it must not be removed early. This is trusted-local policy,
not hard OS isolation or a provider token/cost guarantee. Full-agent trust controls
and release `NO-GO` are unchanged. See [ADR-008](../adr/ADR-008-smart-kpi-preparation-and-explicit-apply.md).

BYOK retention uses the separate encrypted origin-local vault in [ADR-007](../adr/ADR-007-encrypted-browser-api-keys.md): AES-256-GCM with non-extractable Web Crypto keys persisted by IndexedDB. Ordinary state/exports/server records exclude plaintext keys. Destination changes clear inherited credentials; deletion removes ciphertext and its key; unreadable data is retained with a visible error/retry. This does not defend against same-origin script execution, malicious extensions or a compromised browser/profile/OS, and is not OS Keychain or hosted authorization. Profile/site-data clearing and eviction are outside normal session retention; native qualification remains open.

## Retained-source and ephemeral research amendment (2026-10-17)

The host derives file ownership from the admitted run and validates immutable retained bytes/hash; `data.*` arguments cannot carry filesystem, project or execution authority. Full-table bounded aggregation uses no SQL/eval. Numeric materialization accepts a query and empty-leaf bindings only and enters the existing approval/revision Gateway. File cells and search results are untrusted observations, never instructions. Semantic units/grain and existing parser/privacy weaknesses remain unresolved.

An explicitly admitted OpenAI research session retains its key only inside a provider closure in trusted-local process memory for at most one hour (timer plus lazy expiry), with fixed Responses endpoint, `store:false`, required search and cited-result checks. No env/file key writes or public key projection are introduced. Explicit environment research configuration takes precedence. This is not hosted multi-user credential authorization. Codex private output-schema files contain only the public wire contract/allowlisted tool names, use owner-only creation and are removed after child completion. Serialized arguments still face canonical validation. Shell feature disabling and schema framing do not establish hard native tool isolation.


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
| Cached migration-backup verification trusts changed files or evidence | Only ready-state admission retains immutable backup generations, with 32 bounded entries keyed to exact proof/schema, path, inode/device, ownership/mode/link count, size and nanosecond mtime/ctime. Changed files/evidence and any SQLite journal sidecar force full verification. Migration/recovery never reuse the cache. Live revisions still verify bytes and hashes. Local filesystem metadata is trusted; unchanged-metadata media corruption is rechecked on cold admission and before recovery use. |
| Project cleanup bypasses AI audit ownership or leaves deletion enabled | Sequence 5 scopes complete-project cleanup to ownership-checked run IDs inside one immediate transaction; startup rejects committed unfinished scopes, ordinary audit mutation stays blocked, and COMMIT enforces all remaining foreign keys. Legacy membership hashes are retained and checked against the original migration result. Backups remain retained; secure erasure and individual-VDT audit cleanup remain open. See [ADR-009](../adr/ADR-009-project-deletion-with-agent-history.md). |
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

The current storage/API are suitable only for single-user local alpha evaluation on non-sensitive copies. Scoped originals live under the SQLite owning project's `files/<datasetId>/`, while discovery runs retain owner IDs and their initial project basis separately. Exact-byte downloads and reanalysis remain available after browser reload, cache reset or client discard. New HTTP uploads require a real project; an optional supplied VDT must belong to it. Explicit associations make one project source available to multiple trees. Tree reads require current or historical association; project library reads are project scoped. Analysis/run ownership remains specific to the analysis VDT, independent of the upload's original VDT.

File upload/list/download/library edits reject a foreign supplied browser Origin and cross-site markers, retain the trusted-local mode gate, and accept existing local clients without an Origin header. Display labels, archive state and tree availability use checked sidecars rather than changes to original bytes/metadata. Labels remain text and never become paths. Archive hides sources from new selections and blocks attachment until restored. Detach changes current availability, preserving historical reads; neither archive nor detach is secure deletion or authority revocation. Project-only uploads require explicit attachment before existing tree-bound agent `data.*` discovery. Library upload/list/management does not parse files or send bytes to a provider; analysis retains the existing egress limitations.

Old global `.vdt/data-discovery` records remain unchanged for trusted-local legacy access. These checks do not create an authenticated hosted tenant/user boundary. Files and run snapshots remain plaintext, with no permanent retention/delete policy, parser isolation or pre-buffer ingress budget. Hosted/public data ingestion requires all controls listed in `docs/release-checklist.md` and `docs/DATA_INGESTION.md`.

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

### Dependency audit evidence

`pnpm security:audit` passed on 2026-10-19 with zero reported production vulnerabilities. Next.js is pinned to `15.5.28`, SheetJS to its official `0.20.3` tarball, and the lockfile selects `sharp@0.35.5`, `fflate@0.8.3` and patched PostCSS dependencies. Full development-tool audit findings remain separate in `PRODUCTION_READINESS.md`; no advisory is suppressed. Rerun both audits for a new candidate. This closes the known production-dependency blocker, not the remaining upload, hosted actor, CLI isolation or native qualification gaps.

Release resources are scanned recursively for secret-like files and values, including nested skill resources; resource symlinks reject instead of following paths outside the bundle. Skill copies and integrity hashes exclude only named platform metadata (`.DS_Store`, AppleDouble `._*`, `Thumbs.db`, `desktop.ini`), retain product-file tamper checks, and use fixed LF checkout bytes plus deterministic filename ordering. Existing unexpected product files block preparation instead of being silently deleted. Artifact packaging refuses nonempty output directories and cleans only its unique temporary stage after synchronous children finish.

Original-request numeric grounding is limited to a short exact quotation in the existing source note, with one numeric quantity equal to the written finite value. Only original request text and retained user messages are trusted sources; assistant text and tool results cannot create user evidence. This is literal-source verification, not semantic verification of a metric/value mapping. Gateway mutation checks, approvals and finish verification still apply. Local `hostObservation` is a read-only builder projection, not extra tool authority.

Native new-tree decoding may restrict an initial user-source claim to literal number/quote pairs extracted from the original prompt and business context. It never assigns those pairs to nodes, converts units or fills a value. That initial-source restriction is relaxed after subsequent human input; the canonical trusted-source check remains mandatory. Final brief/dependency diagnostics are model guidance, not evidence of business correctness. Failed input batches report all provenance issues atomically and retain normal subtree scope checks.

The optional native numeric-input map is a transport projection over current unpopulated leaf IDs. Restoring its keys to canonical nodeId fields cannot invent a target or number, alter a formula, expand the allowlist or bypass provenance, scope, approval and revision validation. Canonical arrays remain validated by the Gateway, including duplicate-target rejection.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

Direct OpenAI session admission is experimental and trusted-local only. `POST /api/agent/bindings/openai` requires the exact application Origin and JSON, rejects cross-site requests, bounds both declared and streamed bodies to 8 KiB, and permits only a model, session key and output limit. The endpoint is server-fixed to the official OpenAI API; endpoint, shell, environment and nested configuration overrides are rejected. Hosted mode and production builds are excluded; production additionally requires the explicit host Model Agent flag. Up to 16 immutable pending admissions live for 60 seconds. Their IDs are omitted from discovery and consumed once at start. The execution copy can retain the key only in process memory; run requests, receipts, capability metadata, SQLite and ordinary browser preferences do not contain it. Browser reload restores the separately encrypted BYOK copy through ADR-007; server admission and execution remain memory-only. Active-run cancellation/restart semantics remain the existing runtime contract.

Local Origin matching uses the direct HTTP `Host` authority when present because Next can reconstruct the internal request URL as `localhost` for a browser using `127.0.0.1`. Both internal and direct authorities must be local, the direct port must equal the server URL port, and the browser Origin must match that direct authority exactly. Forwarded proxy headers cannot override it. Foreign hosts, mismatched local origins/ports and cross-site requests remain rejected.

The development launcher defaults to the loopback interface `127.0.0.1`; only an explicit `--hostname`/`-H` argument changes that binding. This does not add authentication or make the trusted single-user mode suitable for a network deployment.

OpenAI HTTP diagnostics admit only a small allowlist of protocol error codes and parameter identifiers. Upstream free-form messages, response bodies, keys and request headers are not exposed. The agent transport's retained initial prompt, last confirmed action, source excerpts, tool-read knowledge and current graph contain business context rather than provider credentials; Gateway provenance/approval/scope/revision authority is unchanged. The successful local API case is evidence of this bounded workflow, not a production security or provider certification.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.
