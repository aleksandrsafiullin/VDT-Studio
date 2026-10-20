# Local Runner

## Smart suggestion completion profile

`suggest_incoming_kpis` / `suggest-incoming-kpis-v1` is a separate one-completion
read-only contract through `/v1/completions`, managed development execution and
the desktop `complete` pipe method. It never boots/resumes an agent, researches,
retains conversation or repairs output. API/BYOK uses the same compact task via
the guarded `/api/ai/suggestions` service. Input/final output are 24/16 KiB and
transport envelopes 64 KiB. API/local generation is capped at 2048 tokens; Codex's
2048 is prompt-requested only. HTTP/CLI execution is bounded by 15/30 s or the
lower raw user timeout, including CLI version selection.

Smart Codex uses a private 0700 HOME/CODEX_HOME/workspace, copies only reviewed auth/
installation/catalog artifacts, ignores config/rules, preserves the selected or
configured default model explicitly, uses read-only sandbox, disables reviewed tool
features/web search, and rejects reported tools/unknown events/multiple turns or
malformed UTF-8. One invocation does not establish an opaque provider hard token
limit or OS isolation. Other subscription adapters return typed unavailable for
Smart; their existing general task profiles are unchanged.

`POST /v1/smart-execution` admits Codex metadata only and requires the same pairing/
Origin/JSON controls as other protected routes. Its closed body is
`{backendId:"codex_subscription",model?,timeoutMs?}`; executable paths, flags,
endpoints and credentials stay host-owned. Metadata admission is a separate
settings-time step, capped at 5 s/lower raw budget plus bounded owned cleanup.
Shared host admission ownership deduplicates concurrent probes and quarantines
unknown cleanup before any workspace identity/scheduler exists. Exact defaults
are used when provable; otherwise `host_default` is an explicitly qualified alias
bound to nonsecret config/catalog/CLI/policy metadata. Re-admission uses no one-use
session ID or secret hash.

For Smart, `/v1/completions/:requestId/cancel` waits for actual executor cleanup and
returns `cleanupConfirmed`; ordinary full-agent cancellation retains its 202
signal-acknowledgement contract. The common runtime enforces one active Smart job
per workspace and sticky execution quarantine, covering managed, paired and native
callers. It retains at most 64 workspace quarantine lanes, up to 32 execution keys
per lane; completed empty lanes are released. A missing request is never cleanup
proof. `CLEANUP_UNCONFIRMED` preserves owned private evidence and blocks reuse until
privileged host confirmation or an actual different execution. HTTP closure means
our request/reader, not remote GPU termination. These are host-session boundaries,
not durable crash/reboot coordination. Native metadata admission/revalidation uses
the new `ai_smart_execution` -> `smart_execution` pipe method; it shares probe
ownership and accepts only Codex/model/deadline. The original metadata request
stays pending until cleanup, with a separate framed cancel writer at the Rust
host. Real pipe/synthetic native invoke/parser checks passed, not a Rust/native
build. Local Chrome prepared-control and stored editor/recovery evidence passed;
native-package and live-inference qualification remain separate gates. See
[validation](PRODUCTION_READINESS.md#smart-kpi-validation).

## Codex checkpoint wire amendment (2026-10-17)

The web-hosted Codex session transport places `--search` before `exec`/`exec resume`, pins the native shell feature off and supplies a private per-segment `--output-schema`. The strict wire uses `argsJson` for model-authored Gateway argument objects and at most three calls; decoding is followed by canonical argument, scope, mutation and finish validation. One envelope-only same-session correction is bounded and never retries native tool violations or ambiguous output. Each temporary schema file is removed after the child exits. These changes do not certify CLI hard isolation, native packaging or the standalone runner's separate execution path.


Last reviewed against the working tree: **2026-07-23**.

The local runner is a loopback-only execution boundary for approved local HTTP and subscription-CLI model backends. It is used for repository development, headless CLI workflows and the alpha CLI package. Normal production desktop UX uses the managed sidecar over private IPC instead of browser pairing.

Start the development runner with:

```bash
pnpm local-runner:start
# packaged CLI equivalent
vdt runner start
```

The terminal prints a short-lived pairing code. In explicit standalone-runner Developer Mode, exchange it in `Settings -> AI`. The returned high-entropy token remains in browser memory, expires and is revoked on restart/unpair.

## v1 API

| Endpoint | Purpose |
|---|---|
| `GET /v1/health` | Public loopback health |
| `POST /v1/pair` | Exchange one-time code for session token |
| `POST /v1/unpair` | Revoke session |
| `GET /v1/backends` | Public backend capabilities without executable details |
| `POST /v1/backends/:id/test` | Fixed reviewed connection probe |
| `POST /v1/smart-execution` | Paired, bounded Smart Codex metadata admission |
| `POST /v1/completions` | Execute registered task/schema contract |
| `POST /v1/completions/:requestId/cancel` | Cancel active request |
| `GET /v1/runs/:requestId` | Bounded status/result lookup |

All endpoints except health and pair require `Authorization: Bearer <session-token>`.

The web and desktop clients fail closed on subscription-CLI readiness. Finding an executable is not sufficient: the selected backend must also report runtime status `ready` before the composer or another AI action can submit a request. Detection that is pending, failed, missing, unauthenticated, rate-limited, unsupported, unsafe or unavailable remains non-executable. Install guidance appears only after an explicit completed `not_installed` result.

Provider auth probes must reflect request capability, not merely the presence of stored tokens. In particular, Cursor's `authenticated` status is mapped to `authentication_required` when the same payload reports that user details could not be fetched, because protected Cursor commands reject that session until `agent login` succeeds.

Cursor's **Authenticate** action is not a dashboard/documentation link. The trusted desktop or development runtime resolves the reviewed Cursor executable, runs only the manifest-owned `login` argument, waits up to five minutes for Cursor's browser confirmation, verifies the resulting CLI session and then lets the client rescan models. The frontend cannot provide an executable, arguments, environment or credentials. Other providers remain instruction-only and are labelled **Sign-in help**.

Settings **Test** checks subscription CLI/session readiness through the development runtime or desktop sidecar. It runs the reviewed detection/auth probe and succeeds only for an installed backend with status `ready`; it does not start a separate model-completion run or prove that a selected model can generate a VDT. Providers without a usable status command can still require the adapter's bounded minimal connection prompt. Local HTTP tests and the standalone `POST /v1/backends/:id/test` diagnostic retain the registered `connection-test-v1` completion probe.

Development rescans deduplicate simultaneous identical probes but do not cache completed account/session results. Responses use `Cache-Control: no-store`, so a rescan after sign-in sees fresh state. Protected model-list probes run only after CLI readiness is verified. Browser-facing detection diagnostics contain concise, fixed guidance rather than raw subprocess commands, credential output or environment instructions. Empty or unrecognized successful status output remains unverified; negative states such as `unauthenticated` cannot be mistaken for `authenticated`. Cursor's stored-session/account-validation failure remains non-executable and its summary explains why reconnecting is required.

Subscription model choices are provider-owned. Codex and Cursor adapters populate Settings only from their reviewed model-list commands. Adapters without a confirmed machine-readable list command, and any failed/auth-blocked list probe, expose `auto` and manual entry instead of a hardcoded catalog. Local HTTP backends continue to load models from their manifest-owned `/models` or native Ollama endpoint.

Trusted-local web/desktop hosts admit immutable Ollama/LM Studio/vLLM Model Agent bindings from their fixed-endpoint server catalogs (up to 100 valid model IDs per backend, plus the equivalent untagged alias for an installed Ollama :latest model). Catalogs refresh at most once per ten seconds on binding requests, including after an empty catalog or installation. Hosted mode, production-build evaluation and VDT_LOCAL_MODEL_AGENT_ENABLED=false disable this admission. Browser Settings cannot provision bindings. Starts require an exact backend/model match and use the existing Supervisor/Gateway without a runner/API/default fallback. Native packaging, model quality and performance remain unqualified; provider certification is unchanged.

The model-facing catalog preserves Zod types, enums and required fields (nested cards bounded to three object levels, catalog below 35,000 characters). Local transports retain the immutable brief/catalog, the last confirmed reply and the new semantic-checkpoint delta, without sharing history across runs. Ollama uses native `/api/chat`, direct structured actions (`think=false`), model sampling defaults unless the binding overrides temperature, a 16,384-token context and native JSON-schema format. The Model Agent allows up to 4,096 predicted tokens for the compact JSON action, three tool calls and 512 characters of semantic state. Private thinking frames maintain stream liveness but are never parsed or executed as actions. Native decoding requires a non-null opening assistant message capped at 500 characters; subsequent turns omit that duplicate prose, while questions and the verified final retain their dedicated actions. All tool cards are visible; read-only `tools.describe` retrieves full schemas for 1–6 selected public names. Native decoding includes introspection, finish and core structural/value/formula schemas upfront, then unlocks other tools after successful schema discovery; `vdt.create_draft` stays unavailable in continuation mode. Control calls, numeric-input batches and draft/topology/recipe seeding use singleton native batches, so returned IDs are observed before further mutations. Hidden tools cannot be admitted. The Gateway still checks arguments, provenance, scope and mutations.

Ollama responses stream with independent bounds: 300 seconds to the first valid frame, 60 seconds of stream inactivity, 480 seconds total and 1 MB of response bytes. Healthy generation may pass five minutes; missing completion, truncated output, malformed frames, inactivity and caller cancellation fail closed. Other local HTTP exchanges keep their 180-second limit. Endpoints remain manifest-owned loopback URLs with redirects disabled and no inherited cloud credentials. Every local turn receives `hostObservation`, a read-only current-revision view of up to 80 node rows and bounded calculation errors. It supplies confirmed IDs, formulas, zero values, a bounded explicit list of unpopulated inputs and a formula backlog, without authoring changes or replacing finish verification. Larger graphs are explicitly marked truncated. Project-tool results retain the lossless `project-tables-v1` transport projection; canonical Gateway payloads, hashes and receipts are unchanged. Models are installed only by an explicit user-authorized operation, never by the application automatically.

On a Mac under memory pressure, Ollama supports optional host tuning with `launchctl setenv OLLAMA_FLASH_ATTENTION 1` and `launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0`, followed by an Ollama restart while inference is idle. This global Ollama setting halves the K/V-cache allocation compared with f16, with a precision tradeoff; it does not change the selected weights or the requested context length. See the [Ollama FAQ](https://docs.ollama.com/faq#how-can-i-set-the-quantization-type-for-the-kv-cache). VDT does not silently change these host settings. The 2026-10-17 local run confirmed the same qwen3:8b weights and 16,384-token context with a loaded allocation of about 6.3 GB instead of 7.4 GB; decoding on this Mac fell from about 5–6 to about 3 tokens/second and another exchange hit the 300-second deadline. The host tuning was reverted to its original unset values. This is not provider qualification or a task-quality guarantee.


For chat, CLI authentication and execution availability are separate checks. The composer shows **Chat ready** only after the selected backend/model resolves to a server-owned session binding. `pnpm dev` and `run.command` enable the unverified CLI session canary by default; `VDT_CLI_SESSION_CANARY_ENABLED=false` opts out, and production builds reject it. Codex registers its provider-default binding (`auto`, omitted from native `--model` arguments) plus up to 100 validated model IDs from an authenticated CLI catalog. A browser cannot supply executable arguments or invent model bindings. Explicit `VDT_CODEX_SESSION_MODEL` pins the default binding. Restart the local server to refresh its startup model bindings after catalog failure or model-catalog changes. This is development wiring, not hard-isolation or provider certification.

When multiple Codex installations are already on `PATH`, detection and default runtime execution share one selector: choose the newest recognizable semantic version, prefer a stable release over a prerelease with the same core version, and retain `PATH` order for equivalent versions. The selector inspects only absolute `PATH` directories and reviewed `codex` names, resolves executable regular files outside the current workspace, and deduplicates realpaths before probing. It considers at most 128 directories and eight candidates, with at most two concurrent version probes bounded to 1.5 seconds and 64 KiB each. Unknown or failed versions cannot outrank recognizable versions; if none are recognizable, detection retains the first safe installation with `version: null` and a sanitized error. This detection fallback does not change independent auth probing or execution-profile qualification. Explicit trusted-host executor overrides remain authoritative. This policy does not install or update a CLI, modify global `PATH` or user configuration, discover app-specific locations, or add model IDs to the provider's response.

Probe termination adds at most 1.25 seconds of grace, then closes the owned read pipes and settles even if process `close` never arrives. POSIX cleanup kills the owned process group; Windows tree termination uses a separately bounded one-second `taskkill` attempt. Descendants that deliberately escape the owned POSIX process group, and native Windows tree-cleanup behavior, are not qualified cleanup guarantees.

Example completion request:

```json
{
  "requestId": "018f3f58-c81d-7a73-a8d0-915253744906",
  "backendId": "ollama",
  "taskType": "generate_tree",
  "schemaId": "generate-tree-v1",
  "input": {},
  "model": "qwen3",
  "timeoutMs": 60000
}
```

The browser supplies IDs and bounded input only. Manifests own executable aliases, arguments, endpoints, environment and supported tasks/schemas.

## Security Contract

- Bind only to `127.0.0.1`; reject non-local `Host` values.
- Require allowlisted browser origins for mutations in addition to pairing.
- Accept JSON only; bound bodies, prompts, lines, stdout, stderr and validated results.
- Resolve reviewed executable aliases to regular files outside the repository and spawn with `shell: false`.
- Use a fresh owner-only temporary directory for every request and clean it after completion.
- Filter environment variables and never accept browser-supplied commands, paths, arguments or environment.
- Disable redirects for local HTTP providers; built-in endpoints are manifest-owned.
- Enforce timeout and cancellation with `SIGTERM`, bounded grace and `SIGKILL`.
- Log only redacted request/backend/task/timing/schema/error metadata.
- Reject manifests that require an unavailable OS-specific sandbox with `UNSAFE_CONFIGURATION`.

Provider-specific tool/session restrictions vary. Release status and live evidence are canonical in `release/provider-certification.json` and summarized in `provider-compatibility.md`.

## Verification

```bash
pnpm test
pnpm certification:verify
pnpm package:verify
```

Passing fake-executable and schema tests proves the bounded adapter contract, not live provider quality or production support.

The generic `vdt.fill_input_values_batch` fills 1–8 existing unpopulated non-calculated input leaves in one atomic mutation with a finite number, explicit user/default provenance and a source note. User values require the same trusted quote/answer grounding as single writes. Unknown IDs, duplicate writes, computed/root nodes, non-leaf nodes, ungrounded user values and invalid arguments reject the whole batch. It cannot add nodes, change formulas or bypass mutation approval, scoped `deepen_node` checks, revision fencing or finish verification. Single/batch driver additions reject collisions in their normalized IDs instead of silently suffixing a copied input ID; distinct quantities require explicit unique IDs.

Local native tool availability is grounded in the current server observation: value/formula writes are withheld while a new placeholder still needs real structure. Existing-target arguments use current node-ID enums only when the graph view is complete; truncated views are not treated as exhaustive. `vdt.fill_input_values_batch` is restricted to currently unpopulated leaves and becomes unavailable when none remain, preventing repeated successful refill operations. Intentional corrections use `vdt.update_node`. The Gateway continues to validate every call against the actual fenced revision. A server-derived finish requirement rejects `ROOT_NOT_DERIVED` for a new tree represented by a standalone constant or root without driver references.

The native local transport retains bounded read evidence across semantic deltas: confirmed tool argument schemas, discovered skill IDs/titles and the latest bounded skill excerpt. Rendered `confirmedKnowledge` is capped at 10,000 characters with omissions/truncation explicit; it is isolated per provider/run and does not write graph state, select skills or alter canonical receipts. Only successful/replayed, admitted Gateway results can populate it. Skill discovery/read/compile and schema introspection run in singleton native batches so dependent IDs can be observed before use. This prevents forgetting exact schemas and skill IDs after an unrelated tool result; restart auto-resume and cross-process hydration remain unqualified.

Native local response schemas namespace opaque turn/message/batch IDs by the server exchange ID. Call arrays use positional tuple schemas with a distinct stable externalCallId per exchange/position, preventing a small model from reusing a prior call ID for changed arguments. Exact-exchange retry IDs remain stable. Tool names, graph IDs, formulas, estimates and other business arguments remain model-authored and pass the unchanged Gateway authority/revision/idempotency checks. A live native format probe confirmed tuple-position ID constraints on Ollama.

New-tree native construction also exposes generic single/batch driver creation schemas upfront. Once a skill has actually been read and the root still has no structure, repeated listing/searching and rereading are withheld; additional unread discovered skills remain available so the actor can cover the full process scope. Compilation, schema discovery and model-chosen structural tools remain available. Review/deepen runs retain their ordinary discovery access. This generic progress gate selects no domain, recipe, business parameter or formula.

Native new-tree driver batches run alone, contain at most four nodes and require short model-authored lowercase formula identifiers, with bounded optional metadata. Native structural additions omit formulas and numeric baselines; the model fills inputs and assigns formulas in subsequent calls against observed IDs. Canonical tool schemas remain unchanged. The initial prompt and business context are both retained; exact numeric excerpts guide user-source claims, while estimates and semantic mapping remain the model's responsibility. A fresh brief/root-dependency review precedes finish but does not certify business completeness.

Native Ollama construction of a new blank tree now requires a successful model-selected skill read before structural tools unlock. Confirmed failure output cannot satisfy that gate. List/search/read schemas are upfront; the initial native phase offers discovery, then a read constrained to actual returned skill IDs, before introspection/construction unlocks. The model still chooses the search and skill. A sibling batch uses per-parent schema alternatives when the working graph view is complete: the model chooses the parent, but every item must use that same ID. Truncated graph views retain canonical scope checks without claiming an exhaustive parent list. A bounded read-only calculationAssumptions projection retains up to eight calculated/root nodes, two notes of 160 characters each, with explicit truncation; it neither supplies new facts nor chooses formulas.

Initial goal clarification remains available. After discovery begins in a new blank tree, native questions wait until the chosen skill is actually read; planning the decomposition stays the model's responsibility. A final action is available only after an admitted successful/replayed finish receipt with a valid hash. That receipt fixes the native final ID and closes tool choices; new human work, stale-revision feedback or a committed graph mutation invalidates the native receipt projection. Canonical Supervisor verification remains authoritative.

For a fully visible new-tree input set, native Ollama numeric batches use a values object keyed by model-selected input IDs from one bounded page (up to eight keys). This prevents repeated targets in a generated batch. A pure wire decoder restores the canonical values array in stable ID order before engine/Gateway validation; it preserves every selected target, value, provenance and note, performs no arithmetic and changes no formulas. Other tools, existing-tree/partial-view fallbacks, canonical API arguments, receipts and approval/scope/revision checks retain their contracts.

The experimental local Model Agent can explicitly select `skill.seed_topology` after reading a skill with a complete `vdt-topology` block. The canonical English artifact owns the declarative formulas; the host does not select a domain or skill from keywords. The actor selects the skill and each illustrative reference estimate with `defaults:{inputId:true}`. Defaults require `continueWithAssumptions=true`, remain editable `default_assumption` values, and are never user facts or verified benchmarks. Unselected inputs stay unknown. The tool accepts only a blank root with a matching unit/period, validates bounded IDs, parents, formula references/cycles and root dependency coverage, and proposes one atomic mutation through the existing approval/CAS pipeline. Its skill-defined depth exception never bypasses selected-node decomposition scope. Existing work cannot be overwritten.

`mining.load_and_haul` supplies an annual joint excavation/truck-haulage topology: both fleet counts, separate annual repair/shift/unplanned losses, bucket loading productivity, payload-dependent loading time, loaded and empty travel over one route, dumping/positioning/queue time, and the minimum of both capacities. It is a steady-state draft model with continuous equivalent bucket loading, not dispatch simulation. Its numeric reference values are illustrative estimates accepted explicitly by the actor. Site fleet counts, distance, both speeds and truck planned repair have no reference defaults. Formula and sensitivity unit tests do not certify arbitrary model-authored trees or production readiness.

Native transport retains all tool names/purposes and the immutable catalog hash while avoiding a second textual copy of schemas already enforced by `format`. Original literal quantities are sent once in the current observation. The semantic checkpoint allows 512 characters. Construction search asks for 3–6 candidates; additional unread discovered skills can be read before building so the actor can cover a broader process scope. Complete topology/default choices are constrained to successful public skill-read evidence; generic builder tools remain available. Canonical tool arguments, provenance, receipts, approval and scope authority are unchanged.

When the original structured brief already specifies KPI, unit and period, new-tree library discovery/read precedes questions, including the initial turn. Missing core metric definitions can still be clarified immediately. This prevents delegating internal library/tool selection to the user; essential clarification remains available after reading relevant guidance. Final source-quote diagnostics expose equal-value candidates with units as hints, and explicitly preserve the assumption status of numbers labelled as estimates in the brief.

The later successful local test used the smaller `qwen3.5:4b-q4_K_M` model (3,324,173,934 bytes on disk), the direct Ollama Model Agent profile and the complete library workflow. It completed 35 nodes in 10 turns without a timeout, while the earlier qwen3:8b construction had not completed reliably on this Mac. The requested qwen3:8b/qwen3:4b/qwen3:4b-instruct models and task-owned diagnostic alternatives were removed; qwen3.5:4b-q4_K_M remains selected. This is one case, not a universal model recommendation or release qualification; see [live evidence](AI_HARNESS.md#local-library-completion-evidence-2026-10-17).

Direct OpenAI API execution uses a separate experimental trusted-local admission path, not the local CLI runner. It fixes the official endpoint, keeps the supplied key in process memory for the admitted execution, and starts with an opaque one-use ID. GPT-5/GPT-6 and o1/o3/o4 requests use `max_completion_tokens` with provider-default reasoning/sampling; agent exchanges allow 180 seconds and connection probes 1,024 output tokens. The HTTP adapter retains the initial brief/catalog and last confirmed action; runtime validation and bounded repair still apply. Hosted mode/build evaluation are excluded and production needs the host Model Agent flag. See [the 145.436-second gpt-6-luna completion and limitations](AI_HARNESS.md#openai-api-model-agent-evidence-2026-10-17).

Codex private `argsJson` decoding covers both wrapped `action.batch.calls` and direct `action.calls` carriers, including the action type aliases already accepted by the canonical parser. Unknown/duplicate fields and authority arguments still fail canonical validation. One same-session envelope correction receives a bounded validation diagnostic; failed correction stops rather than retrying indefinitely.
