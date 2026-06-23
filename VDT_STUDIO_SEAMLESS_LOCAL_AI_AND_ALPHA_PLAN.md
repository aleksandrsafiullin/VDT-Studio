# VDT Studio — Remediation, Seamless Local AI, and Public Alpha Plan

**Repository:** `aleksandrsafiullin/VDT-Studio`  
**Plan date:** 2026-06-22  
**Target:** Secure public alpha with seamless subscription CLI usage  
**Primary validation backend:** Cursor Agent CLI on macOS  
**Primary distribution:** Desktop application  
**Secondary distribution:** Hosted web application with BYOK/API-only capabilities

---

## 1. Objective

Finish VDT Studio as a focused AI-first product for building, reviewing, explaining, and calculating Value Driver Trees.

The product must preserve the core operating principle:

```text
AI proposes.
User reviews.
User approves.
The deterministic engine applies changes and calculates.
```

The next development cycle must address two categories of work:

1. Close the security and architecture gaps found in the current implementation.
2. Remove all visible Local Runner setup from the normal user journey.

A production user must not have to:

- open Terminal;
- run `vdt runner start`;
- copy a pairing code;
- understand what the Local Runner is;
- manually reconnect the application after each restart;
- manage ports, origins, tokens, or background processes.

The desktop application must automatically start, supervise, and stop the local AI execution component.

---

## 2. Non-negotiable product decision

### 2.1 Local AI requires a native host

A normal hosted browser application cannot securely and silently:

- start a local executable;
- inspect installed CLIs;
- access provider subscription sessions;
- launch or terminate local provider processes;
- enforce an OS sandbox around those processes.

Therefore, seamless Local CLI and local-model support must be delivered through a native VDT Studio desktop application.

### 2.2 Product modes

VDT Studio will have two explicit product modes.

#### Desktop application

Supports:

- Cursor subscription;
- Codex subscription;
- Claude subscription;
- Gemini CLI where available;
- GitHub Copilot CLI where available;
- Ollama;
- LM Studio;
- vLLM;
- BYOK providers;
- local project storage;
- automatic local AI runtime lifecycle.

The user launches only VDT Studio.

#### Hosted web application

Supports:

- OpenAI-compatible API;
- Anthropic API;
- Gemini API;
- Azure OpenAI;
- Alibaba Cloud Coding Plan;
- other reviewed API presets.

The hosted web application must not directly detect or execute local CLIs.

For the public alpha, Local CLI and local-model sections should either be hidden in hosted web mode or replaced by:

```text
Local subscriptions and local models are available in VDT Studio Desktop.
```

Do not attempt to make a public web page silently launch a local runner.

---

## 3. Target user experience

### 3.1 First launch

```text
User installs VDT Studio Desktop
        ↓
User launches VDT Studio
        ↓
Desktop host starts the embedded AI runtime automatically
        ↓
VDT Studio detects installed providers and local model servers
        ↓
Settings → AI shows connection cards
        ↓
User selects an available provider
        ↓
User creates or reviews a VDT
```

There is no Local Runner setup panel.

There is no pairing code.

There is no port configuration.

### 3.2 Provider authentication

Provider authentication remains provider-owned.

Possible states:

```text
Installed and connected
Installed — sign-in required
Installed — unsupported version
Installed — organization policy disabled
Not installed
Rate limited
Temporarily unavailable
```

When sign-in is required, VDT Studio may provide a reviewed provider-specific action such as:

```text
[Authenticate]
```

That action may launch only the provider’s official authentication flow or show precise instructions.

It must never expose a generic shell or arbitrary command field.

### 3.3 Normal AI use

```text
Select backend
        ↓
Run bounded VDT task
        ↓
Desktop bridge forwards the request to the embedded runtime
        ↓
Provider returns structured output
        ↓
Local schema and business validation
        ↓
One bounded repair attempt if needed
        ↓
Preview
        ↓
User selects changes
        ↓
Version snapshot
        ↓
Apply
        ↓
Deterministic recalculation
```

---

## 4. Current implementation status

The repository already contains substantial implementation:

- `vdt-core`;
- `ai-harness`;
- `model-bridge`;
- a local runner;
- five subscription CLI adapters;
- 12 bounded AI tasks;
- change-set preview and apply;
- version snapshots;
- deterministic formula parsing;
- package and release workflows.

The following gaps must be treated as release blockers.

### 4.1 Direct CLI execution from the Next.js process

`/api/ai/detect-clis` currently performs detection, version probing, authentication probing, and model discovery through Node execution in the web application process.

This violates the intended rule:

```text
The local runtime is the only component allowed to execute subscription CLIs.
```

It also detects binaries on the Next.js host rather than on the user’s machine when the web app is hosted remotely.

### 4.2 Manual Local Runner and pairing UX

The current UI requires the user to:

```text
vdt runner start
→ read a six-digit code
→ enter the code
→ pair the browser session
```

This is acceptable only as a developer fallback, not as a product workflow.

### 4.3 Cursor end-to-end blocker

Cursor authentication detection works, but protected execution is blocked because Cursor requires workspace state under a home-directory path such as:

```text
~/.cursor/projects
```

The current sandbox correctly denies that write.

Cursor must remain blocked or beta until provider state can be safely redirected to an ephemeral location without copying credentials.

### 4.4 Inconsistent provider support statuses

Status differs between:

- model registry;
- local runner manifests;
- provider compatibility documentation;
- release certification JSON.

A provider can currently appear as `supported` even when only fake-binary tests exist.

### 4.5 macOS sandbox is not strict enough

The current Seatbelt profile uses:

```text
(allow default)
```

with selected deny rules.

This is useful defense in depth but is not a complete default-deny boundary.

### 4.6 Missing repair pipeline

Invalid model output is rejected immediately.

The plan requires one bounded repair request before failure.

### 4.7 Shallow runner schemas

Several runner-level JSON schemas validate only top-level fields and arrays of generic objects.

The local runtime should validate the same detailed structures as `ai-harness`.

### 4.8 Certification is mostly synthetic

Codex, Claude, Gemini, and Copilot statuses are not fully supported by maintainer live tests.

---

## 5. Architecture decision: desktop-owned local execution

Create a desktop host that owns the full local execution lifecycle.

Recommended target:

```text
apps/
├── web/
└── desktop/
    ├── src/
    ├── src-tauri/
    └── sidecars/

packages/
├── vdt-core/
├── ai-harness/
├── model-bridge/
├── local-runtime/
├── desktop-bridge/
└── cli/
```

The existing `packages/local-runner` may be renamed to `packages/local-runtime` after the transport split.

Do not rename it during the first remediation phase unless the rename is isolated and low risk.

---

## 6. Seamless local runtime design

### 6.1 Preferred production transport

Use desktop IPC instead of a browser-accessible localhost HTTP service.

Target flow:

```text
VDT webview
    ↓ Tauri invoke
Tauri/Rust command boundary
    ↓ validated internal request
Embedded Node/Bun sidecar over stdin/stdout
    ↓ reviewed backend adapter
Provider CLI or local model endpoint
```

The webview must never receive:

- runner authentication tokens;
- provider credentials;
- executable paths;
- command arguments;
- environment values;
- sandbox paths.

### 6.2 Sidecar lifecycle

The desktop host must:

1. start the runtime during application startup;
2. wait for a readiness handshake;
3. keep the runtime process handle private;
4. restart it once after an unexpected crash;
5. expose a clear unavailable state after repeated failure;
6. terminate it during application exit;
7. terminate all active provider subprocesses during shutdown;
8. clean temporary directories after crash recovery.

### 6.3 Sidecar protocol

Use framed JSON messages over pipes.

Recommended format:

```json
{
  "protocolVersion": 1,
  "type": "request",
  "requestId": "uuid",
  "method": "complete",
  "payload": {}
}
```

Responses:

```json
{
  "protocolVersion": 1,
  "type": "response",
  "requestId": "uuid",
  "ok": true,
  "payload": {}
}
```

Cancellation:

```json
{
  "protocolVersion": 1,
  "type": "cancel",
  "requestId": "uuid"
}
```

Runtime events:

```json
{
  "protocolVersion": 1,
  "type": "event",
  "event": "backend_status_changed",
  "payload": {}
}
```

Requirements:

- one JSON object per framed message;
- bounded message size;
- no logs on stdout;
- structured logs only on stderr;
- strict protocol version validation;
- reject unknown fields and methods;
- reject duplicate request IDs;
- no arbitrary executable or argument fields.

### 6.4 Bootstrap security

Because the runtime is a child process connected through private pipes, browser pairing is unnecessary.

The desktop host should still perform a private handshake:

```text
Desktop host starts sidecar
→ sidecar emits random nonce
→ host replies with expected protocol version and nonce proof
→ runtime enters ready state
```

The handshake must remain between the native host and sidecar.

Do not inject a token into the webview.

### 6.5 Development fallback

Retain the existing loopback HTTP runner only for:

- local web development;
- automated HTTP boundary tests;
- troubleshooting;
- advanced headless workflows.

Enable it only through an explicit development flag:

```text
VDT_ENABLE_STANDALONE_RUNNER=true
```

The manual pairing screen must be hidden in production desktop builds.

It may remain available in developer mode under:

```text
Settings → Developer → Standalone runner
```

---

## 7. Desktop packaging strategy

### 7.1 Tauri shell

Use Tauri as the default desktop shell because the application already has a web frontend and needs a narrow native trust boundary.

The desktop shell must not expose generic filesystem or shell plugins to the webview.

Allowed native commands should be explicit:

```text
ai_list_backends
ai_test_backend
ai_list_models
ai_complete
ai_cancel
ai_get_run
open_provider_auth
get_app_mode
```

No command such as:

```text
execute
shell
run_command
read_file
write_file
open_path
```

may be available to frontend code.

### 7.2 Runtime packaging

Near-term option:

- bundle the TypeScript local runtime as a reviewed executable sidecar;
- produce one binary per target platform;
- sign it with the desktop application;
- verify its hash before launch.

Possible build approach:

- bundle runtime code;
- compile to a self-contained sidecar using a reviewed compiler;
- avoid requiring the user to install Node separately.

Do not ship a desktop application that silently depends on a global Node installation.

### 7.3 Supported alpha platform

The first subscription-enabled public alpha should target:

```text
macOS arm64
```

This matches the primary Cursor validation environment.

Additional targets may be built, but subscription backends must fail closed unless their isolation and live tests are complete.

Suggested sequence:

1. macOS arm64;
2. macOS x64;
3. Windows x64;
4. Linux x64.

---

## 8. New product capability matrix

### 8.1 Desktop alpha

| Backend | Target status |
|---|---|
| Mock | Supported in development only |
| OpenAI-compatible API | Supported |
| Anthropic API | Supported |
| Gemini API | Supported |
| Azure OpenAI | Supported |
| Alibaba Coding Plan | Beta |
| Ollama | Supported |
| LM Studio | Supported |
| vLLM | Beta |
| Cursor subscription | Beta-blocked until end-to-end live gate passes |
| Codex subscription | Alpha until live gate passes |
| Claude subscription | Alpha until live gate passes |
| Gemini subscription | Experimental |
| GitHub Copilot subscription | Experimental |
| Custom CLI | Disabled |

### 8.2 Hosted web alpha

| Backend | Target status |
|---|---|
| OpenAI-compatible API | Supported |
| Anthropic API | Supported |
| Gemini API | Supported |
| Azure OpenAI | Supported |
| Alibaba Coding Plan | Beta |
| Subscription CLI | Not available |
| Local models | Not available in public hosted mode |
| Custom CLI | Not available |

---

## 9. Workstream A — remove direct CLI execution from web

### Goal

The web application must never execute subscription CLIs directly.

### Tasks

1. Remove Node CLI execution from:

```text
apps/web/app/api/ai/detect-clis/route.ts
```

2. Replace it with an app-mode-aware provider status source.

Desktop mode:

```text
webview → Tauri invoke → desktop bridge → local runtime
```

Hosted web mode:

```text
return only API backend availability
```

3. Move all of the following into the local runtime:

- executable discovery;
- version probing;
- auth probing;
- model discovery;
- provider test requests.

4. Ensure auth probes use the same isolation policy as normal execution.

5. A provider auth fallback must not send a live model prompt outside the protected runtime.

6. Remove production imports of:

```text
@vdt-studio/model-bridge/node
```

from the hosted Next.js server.

### Done when

- hosted Next.js cannot spawn Cursor, Codex, Claude, Gemini, or Copilot;
- subscription CLI detection works through desktop IPC;
- provider discovery runs on the user’s machine;
- direct-route tests prove no `child_process` use in hosted web code.

---

## 10. Workstream B — replace pairing with automatic runtime ownership

### Goal

Remove manual runner startup and pairing from the production desktop UX.

### Tasks

1. Add desktop startup orchestration.
2. Launch the bundled runtime automatically.
3. Implement private pipe-based handshake.
4. Implement backend list and test commands over desktop IPC.
5. Store runtime state only in the desktop process.
6. Remove pairing token from normal frontend state.
7. Hide the current pairing panel in desktop production mode.
8. Add a runtime health indicator only when an error occurs.

### New UI

Replace:

```text
Local runner
Start vdt runner start...
Pairing code
[000000] [Pair]
```

with:

```text
Your AI subscriptions

Cursor Agent
Installed
Connected
Managed automatically by VDT Studio
[Test] [Use]

Codex CLI
Installed
Sign-in required
[Authenticate]

Claude Code
Not installed
[Installation instructions]
```

No runner terminology should appear in normal user-facing copy.

### Done when

A clean user can:

1. install VDT Studio Desktop;
2. launch it;
3. select an already authenticated CLI;
4. run a VDT task;

without opening Terminal or entering a pairing code.

---

## 11. Workstream C — unify backend status and certification

### Goal

Create one source of truth for provider maturity.

### Canonical record

Create:

```text
release/provider-certification.json
```

as the authoritative source for:

- release status;
- platforms;
- tested versions;
- live verification;
- limitations;
- security requirements;
- last verification date.

Recommended shape:

```ts
export interface BackendCertification {
  backendId: string;
  releaseStatus:
    | "supported"
    | "beta"
    | "alpha"
    | "experimental"
    | "blocked"
    | "disabled";
  testedVersions: string[];
  platforms: Array<{
    os: "macos" | "windows" | "linux";
    architecture: string;
    status: string;
  }>;
  liveVerified: boolean;
  lastVerifiedAt?: string;
  authMode: string;
  toolsDisabled: boolean;
  osSandboxRequired: boolean;
  tests: {
    detection: boolean;
    authentication: boolean;
    structuredOutput: boolean;
    cancellation: boolean;
    schemaValidation: boolean;
    noProjectRead: boolean;
    noExternalFileRead: boolean;
    noExternalFileWrite: boolean;
    noShellExecution: boolean;
    noChildProcess: boolean;
    noMcp: boolean;
    quotaNormalization: boolean;
  };
  blockers: string[];
}
```

### Tasks

1. Stop hard-coding conflicting support levels in multiple registries.
2. Generate or validate public registry metadata against certification JSON.
3. Fail CI when:
   - registry status differs;
   - a backend is marked supported without live verification;
   - required security tests are false;
   - documentation status differs.
4. Render provider UI status from the canonical record.
5. Do not advertise provider support based only on fake executable tests.

### Done when

Every backend has exactly one visible support status across:

- settings UI;
- manifests;
- docs;
- release metadata;
- onboarding.

---

## 12. Workstream D — Cursor end-to-end completion

### Goal

Make Cursor the first subscription backend that works end to end in the desktop application.

### Investigation

Determine whether the installed Cursor CLI supports an official location override for:

```text
~/.cursor/projects
```

Check only official CLI options, documented environment variables, and reviewed runtime behavior.

Do not:

- copy Cursor credentials;
- relocate credential files;
- disable the sandbox;
- open write access to the full home directory;
- trust the repository;
- use `--force`;
- use ACP merely to bypass the issue.

### Preferred solution

Redirect non-credential workspace state into the ephemeral request directory.

Possible reviewed pattern:

```text
HOME=<minimal synthetic home>
CURSOR_CONFIG_DIR=<ephemeral non-secret config>
provider auth path mounted read-only
provider workspace state path writable in temp
```

This is allowed only if live tests confirm that authentication remains available without copying secrets.

### Alternative

If Cursor cannot operate with isolated state:

- keep Cursor `blocked`;
- ship Codex or Claude as the first supported subscription backend;
- document the Cursor limitation;
- continue investigation separately.

### Required live tests

- detect installed CLI;
- detect version;
- detect authentication;
- list models;
- generate Production Volume tree;
- deepen one node;
- review a model;
- cancel a long request;
- normalize auth error;
- normalize rate-limit error;
- cannot read repository honey file;
- cannot read SSH key honey file;
- cannot write outside temp;
- cannot execute shell;
- cannot create an unrelated child process;
- leaves no state outside approved provider directories;
- cleans temp directory.

### Done when

Cursor can complete all required VDT tasks in a clean macOS test environment without weakening security controls.

---

## 13. Workstream E — strengthen OS sandboxing

### Goal

Move from deny-list isolation to a reviewed default-deny model where practical.

### macOS target profile

Prefer:

```text
(deny default)
```

Then allow only:

- provider executable and required runtime libraries;
- read-only provider authentication paths;
- read/write access to request temp directory;
- required network access;
- required system APIs;
- explicitly required child processes, if any.

If provider runtime cannot function under strict default deny, document each additional permission.

### Mandatory tests

1. Read file in repository.
2. Read file in `~/.ssh`.
3. Read file elsewhere in home.
4. Read file in `/tmp` outside request directory.
5. Write file in repository.
6. Write file in home.
7. Write file in `/tmp` outside request directory.
8. Execute `/bin/sh`.
9. Execute an unrelated binary.
10. Spawn a child process.
11. Access MCP configuration.
12. Access project instructions.
13. Preserve required provider authentication.
14. Preserve provider network access.

### Fail-closed rule

Any backend requiring OS sandboxing must return:

```text
unsafe_configuration
```

when the certified sandbox is unavailable.

Do not silently run it unsandboxed.

---

## 14. Workstream F — live qualification for Codex and Claude

### Codex

Verify the installed CLI supports the reviewed equivalents of:

```text
codex exec
--json
--color never
--ephemeral
--sandbox read-only
--output-schema
--output-last-message
```

Confirm:

- ChatGPT subscription login;
- no repository context;
- no `AGENTS.md`;
- no MCP;
- no writable sandbox;
- native structured output;
- cancellation;
- quota and auth diagnostics.

### Claude

Verify the installed CLI supports the reviewed equivalents of:

```text
claude -p
--output-format json
--json-schema
--no-session-persistence
--tools ""
--disallowedTools "*"
--strict-mcp-config
```

Confirm:

- subscription login;
- all tools disabled;
- no MCP;
- no session persistence;
- structured output;
- cancellation;
- quota and auth diagnostics.

### Status rule

Before live verification:

```text
alpha
```

After full live and security gates:

```text
supported
```

---

## 15. Workstream G — Gemini and Copilot qualification

Keep both experimental until all of the following are verified:

- current official authentication flow;
- current subscription or organization allowance;
- stable non-interactive output;
- complete tool disabling;
- no MCP;
- no project instructions;
- cancellation;
- sandbox compatibility;
- policy and quota diagnostics.

Do not promote them based only on parser fixtures.

Do not silently substitute another Google or GitHub product.

---

## 16. Workstream H — implement bounded repair

### Goal

Recover from small formatting and schema errors without hiding invalid business output.

### Flow

```text
Provider response
    ↓
Extract bounded JSON
    ↓
Detailed schema validation
    ↓ invalid
One repair request
    ↓
Detailed schema validation
    ↓ invalid
Return normalized provider output error
```

### Repair request rules

Include only:

- task type;
- schema ID;
- validation errors;
- truncated invalid JSON;
- instruction to return one corrected JSON object.

Do not include:

- API credentials;
- pairing or desktop tokens;
- environment values;
- file paths;
- full project if not required;
- unrelated prior conversation.

### Limits

- exactly one repair attempt;
- shorter timeout than the original request;
- bounded invalid output excerpt;
- separate repair latency and token metrics;
- no graph mutation before final validation.

### Metrics

Track:

- initial schema pass rate;
- repair attempt rate;
- repair success rate;
- second-failure rate;
- backend-specific failure categories.

---

## 17. Workstream I — use one detailed schema source

### Goal

Prevent divergence between:

- Zod schemas;
- JSON schemas;
- local runtime validators;
- provider native structured-output schemas.

### Tasks

1. Generate JSON Schema from the authoritative Zod schemas.
2. Remove hand-maintained shallow schema definitions where possible.
3. Validate nested:
   - nodes;
   - edges;
   - warnings;
   - findings;
   - formula proposals;
   - change sets.
4. Use `additionalProperties: false` unless a field is explicitly extensible.
5. Keep deterministic semantic validation after structural validation.
6. Add schema snapshot tests.

### Done when

A result cannot be reported as `schemaValid: true` by the runtime and then fail only because nested object structure was never checked.

---

## 18. Workstream J — complete VDT AI quality evaluation

Create a checked-in evaluation dataset for at least:

- Production Volume;
- OEE;
- Availability;
- Maintenance Cost;
- Unit Cost;
- Inventory Level;
- Service Level;
- Working Capital;
- EBITDA;
- Revenue;
- Retention;
- Conversion Rate;
- Delivery Time;
- Safety Incident Rate;
- Energy Consumption;
- Recovery;
- Throughput;
- Yield;
- Procurement Savings;
- Workforce Productivity.

For each KPI define:

- input context;
- expected root unit;
- minimum depth;
- acceptable node-count range;
- required business drivers;
- prohibited duplicate patterns;
- formula expectations where deterministic;
- unit consistency expectations.

Track:

```text
schema pass rate
repair rate
formula validity
unit completeness
duplicate rate
graph validity
average depth
average node count
latency
user acceptance
```

Do not use model-generated scores as authoritative quality metrics.

---

## 19. Workstream K — UI redesign

### 19.1 AI settings structure

```text
AI Connections

1. Your subscriptions
2. API keys
3. Local models
4. Advanced
```

### 19.2 Desktop subscription cards

Example:

```text
Cursor Agent
Installed
Connected
Version 1.2.3
Usage managed by Cursor
Security: isolated local execution
[Test connection] [Use for VDT]
```

### 19.3 Status language

Use:

```text
Connected
Sign-in required
Not installed
Unsupported version
Organization policy disabled
Rate limited
Temporarily unavailable
Security configuration unavailable
Blocked in this release
```

Avoid technical copy such as:

```text
Runner unavailable
Pairing token
Loopback service
Port 8765
Origin allowlist
```

unless Developer Mode is enabled.

### 19.4 Runtime failures

Normal user message:

```text
Local AI could not start. Restart VDT Studio.
```

Expandable diagnostics:

```text
Runtime version
Provider version
Normalized error code
Request ID
```

Do not display prompts, credentials, or raw stderr by default.

### 19.5 Hosted web mode

Show only API connections.

Optional desktop promotion:

```text
Use Cursor, Codex, Claude, or local models with VDT Studio Desktop.
[Get desktop app]
```

---

## 20. Workstream L — persistence and secrets

### May persist

- selected backend ID;
- selected model;
- non-secret API base URL;
- provider UI preferences;
- last successful connection date;
- support status metadata;
- VDT projects;
- version snapshots.

### Must not persist in browser storage

- API keys;
- provider access tokens;
- desktop IPC secrets;
- runtime session secrets;
- raw provider auth responses;
- pairing tokens.

### Desktop future option

Use OS keychain only after a separate security review.

Default BYOK mode remains:

```text
Session only
```

---

## 21. API and contract changes

### 21.1 Frontend provider abstraction

Create one frontend service:

```ts
export interface AiExecutionClient {
  getEnvironment(): Promise<"desktop" | "hosted_web" | "development_web">;
  listBackends(): Promise<PublicBackendStatus[]>;
  testBackend(backendId: string): Promise<BackendTestResult>;
  listModels(backendId: string): Promise<ModelOption[]>;
  complete(request: AiCompletionRequest, signal?: AbortSignal): Promise<AiCompletionResult>;
  cancel(requestId: string): Promise<void>;
}
```

Implementations:

```text
DesktopAiExecutionClient
HostedApiExecutionClient
DevelopmentRunnerClient
```

Components must not know whether execution uses:

- Tauri IPC;
- local sidecar;
- Next API route;
- standalone development runner.

### 21.2 Runtime execution contract

The runtime accepts only:

```ts
export interface RuntimeCompletionRequest {
  requestId: string;
  backendId: string;
  taskType: VdtAiTaskType;
  schemaId: VdtSchemaId;
  input: unknown;
  model?: string;
  timeoutMs?: number;
}
```

It must reject:

```text
command
args
cwd
env
schema
systemPrompt override
shell
mcpServers
skills
sessionId
extraArgs
workspacePath
repositoryPath
```

Prompt templates and schemas are resolved from reviewed registries.

---

## 22. Proposed implementation phases

## Phase 0 — freeze and baseline

### Tasks

- create a release-blocker issue list;
- record current test status;
- run lint, typecheck, tests, build, E2E, package verification;
- do not promote provider statuses;
- freeze new providers;
- add this plan to the repository.

### Done when

The current baseline is reproducible and all known failures are documented.

---

## Phase 1 — security remediation

### Tasks

- remove direct subscription CLI execution from Next.js;
- route detection through the local runtime abstraction;
- mark Cursor blocked;
- mark Codex and Claude alpha;
- mark Gemini and Copilot experimental;
- unify certification metadata;
- add missing status-drift CI checks.

### Done when

Hosted web cannot execute local CLIs and status labels are honest.

---

## Phase 2 — desktop shell foundation

### Tasks

- create `apps/desktop`;
- integrate the existing web frontend;
- expose only reviewed Tauri commands;
- add app-mode detection;
- add signed build configuration;
- disable generic shell/filesystem access.

### Done when

VDT Studio runs as a desktop app without changing normal VDT editing behavior.

---

## Phase 3 — embedded runtime sidecar

### Tasks

- split runtime execution from HTTP transport;
- implement pipe protocol;
- package the runtime as a sidecar;
- auto-start on app launch;
- private handshake;
- cancellation;
- crash recovery;
- shutdown cleanup;
- frontend desktop execution client.

### Done when

The desktop app lists mock/local backends without a port or pairing code.

---

## Phase 4 — seamless settings UX

### Tasks

- remove Local Runner panel from production desktop mode;
- add subscription cards;
- add local-model cards;
- add provider authentication actions;
- add concise runtime error state;
- keep standalone pairing only in Developer Mode.

### Done when

A user never sees runner startup or pairing instructions during normal use.

---

## Phase 5 — Cursor completion

### Tasks

- investigate safe workspace-state redirection;
- implement the approved solution;
- strengthen macOS sandbox;
- run the complete Cursor certification harness;
- update status only after all tests pass.

### Done when

Cursor completes generate, deepen, and review tasks end to end under isolation.

---

## Phase 6 — Codex and Claude live support

### Tasks

- run live auth and completion tests;
- verify exact installed CLI versions;
- verify no project context;
- verify cancellation;
- verify quota/auth errors;
- complete security tests;
- update support status.

### Done when

Both providers pass the shared certification contract.

---

## Phase 7 — Gemini and Copilot

### Tasks

- validate current official CLI behavior;
- validate account eligibility;
- confirm tool disabling;
- confirm sandbox behavior;
- keep fail-closed on unsupported platforms.

### Done when

Each backend is either honestly beta/supported or remains experimental.

---

## Phase 8 — schema and repair hardening

### Tasks

- generated JSON schemas;
- detailed nested validation;
- one bounded repair attempt;
- repair metrics;
- schema drift tests.

### Done when

Provider output handling is consistent across all transports.

---

## Phase 9 — evaluation and release gates

### Tasks

- add 20-KPI evaluation dataset;
- run provider evaluation;
- complete desktop E2E;
- complete clean install;
- sign application and sidecar;
- produce SBOM and checksums;
- verify no secrets in bundle;
- verify auto-start and cleanup.

### Done when

A clean macOS machine can install, launch, connect, create a VDT, apply a reviewed change, and exit without manual runtime setup.

---

## 23. Testing requirements

### 23.1 Unit tests

- runtime protocol parser;
- request size limits;
- unknown field rejection;
- status registry;
- certification drift;
- app-mode routing;
- desktop client;
- sidecar lifecycle;
- repair loop;
- detailed schema generation;
- provider error normalization.

### 23.2 Integration tests

- sidecar startup;
- readiness handshake;
- backend listing;
- provider test;
- complete request;
- cancellation;
- crash restart;
- repeated crash failure;
- shutdown cleanup;
- no stdout log corruption;
- malformed protocol message;
- oversized protocol message.

### 23.3 Security tests

- command injection;
- argument injection;
- NUL;
- path traversal;
- symlink swap;
- executable substitution;
- environment leakage;
- arbitrary file read;
- arbitrary file write;
- repository read;
- SSH key read;
- shell execution;
- child process execution;
- MCP access;
- project instruction access;
- stale request ID;
- forged desktop IPC request;
- sidecar binary hash mismatch;
- malicious provider output;
- prompt injection;
- formula injection.

### 23.4 Desktop E2E

- first launch;
- runtime auto-start;
- no pairing UI;
- backend detection;
- provider selection;
- generate tree;
- preview changes;
- apply selected changes;
- version restore;
- cancellation;
- runtime restart;
- offline API handling;
- app restart preserves only non-secret preferences.

### 23.5 Hosted web E2E

- no Local CLI execution;
- no Local CLI detection route;
- API provider setup;
- session-only key behavior;
- no key persistence;
- no silent fallback;
- desktop availability messaging.

---

## 24. CI changes

Add or update workflows:

```text
quality.yml
e2e-web.yml
e2e-desktop.yml
security.yml
package-cli.yml
package-desktop.yml
release-alpha.yml
```

### Required gates

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:web
pnpm test:e2e:desktop
pnpm security:audit
pnpm certification:verify
pnpm package:alpha
pnpm package:verify
```

Desktop matrix:

```text
macOS arm64 — required
macOS x64 — optional alpha
Windows x64 — package build, subscription backends experimental
Linux x64 — package build, subscription backends experimental
```

Do not run maintainer subscription credentials on untrusted pull requests.

Live provider tests must remain explicit, protected jobs.

---

## 25. Migration from the current pairing implementation

### Keep temporarily

- pairing manager;
- loopback HTTP API;
- Host and Origin controls;
- standalone runner CLI;
- HTTP transport tests.

### Change

- production desktop no longer uses pairing;
- pairing UI hidden by default;
- standalone runner classified as development/advanced;
- normal local execution moves to private desktop IPC;
- web no longer executes CLI probes.

### Remove later

After desktop IPC is stable and documented:

- production dependency on pairing token storage;
- production local-runner connection form;
- normal user copy mentioning `vdt runner start`;
- Local CLI tab that only represents runner setup.

Do not delete the standalone runner until desktop IPC and headless CLI workflows have replacement coverage.

---

## 26. Documentation updates

Create or update:

```text
docs/architecture/desktop-local-execution.md
docs/architecture/runtime-protocol.md
docs/security/local-ai-threat-model.md
docs/provider-compatibility.md
docs/desktop-installation.md
docs/development/standalone-runner.md
docs/release-checklist.md
```

README positioning:

```text
VDT Studio Desktop connects to selected existing AI subscriptions and local models automatically.
The hosted web app supports API-based providers.
```

Do not advertise:

```text
21 agents
MCP control
manual Local Runner setup
all providers supported
```

---

## 27. Definition of done

The application is ready for public desktop alpha when all statements are true.

1. The user does not manually start a Local Runner.
2. The user does not enter a pairing code.
3. The desktop host starts and owns the local runtime.
4. The hosted web app cannot execute local CLIs.
5. The webview cannot access executable paths or runtime secrets.
6. Subscription CLI requests use reviewed manifests only.
7. No supported backend receives repository access.
8. No supported backend can execute arbitrary shell commands.
9. No AI response silently mutates a project.
10. Every graph mutation has preview and selection.
11. A version snapshot is created before applying changes.
12. Calculations remain deterministic.
13. Detailed schemas are shared across harness and runtime.
14. One bounded repair attempt is implemented.
15. Provider support statuses come from one source.
16. Cursor is either fully certified or visibly blocked.
17. Codex and Claude are not marked supported without live verification.
18. Gemini and Copilot remain fail-closed until qualified.
19. API keys and provider credentials are not persisted in project data.
20. Desktop package works on a clean supported machine.
21. The embedded runtime requires no separate Node installation.
22. CI, E2E, security, certification, and package gates pass.
23. Release artifacts include signatures, checksums, and SBOM.
24. Compatibility documentation matches the shipped build.

---

## 28. Codex execution rules

- Work phase by phase.
- Stop after each phase and report.
- Do not implement a new provider while a release blocker remains.
- Do not weaken isolation to make Cursor work.
- Do not expose a generic shell through Tauri.
- Do not pass executable names or arguments from the frontend.
- Do not store desktop runtime secrets in the webview.
- Do not run subscription CLI probes in Next.js.
- Do not mark fake-tested backends as supported.
- Do not silently fall back from subscription usage to a billable API.
- Preserve the strict minimal Apple-like design.
- Preserve left-to-right VDT layout.
- Preserve deterministic calculations in `vdt-core`.
- Preserve preview-before-apply.
- Use small commits with tests.
- Update certification and compatibility docs with every provider change.

---

## 29. First Codex task

Implement only **Phase 1 — security remediation**.

### Required deliverables

1. Remove direct subscription CLI execution from the Next.js detection route.
2. Introduce an `AiExecutionClient` abstraction with:
   - hosted web implementation;
   - current standalone-runner development implementation;
   - placeholder desktop implementation.
3. Ensure hosted web mode exposes API backends only.
4. Move CLI detection, auth probing, and model discovery behind the local runtime interface.
5. Make provider certification JSON the canonical release-status source.
6. Add CI checks for status drift.
7. Set current statuses to:
   - Cursor: `blocked`;
   - Codex: `alpha`;
   - Claude: `alpha`;
   - Gemini CLI: `experimental`;
   - Copilot CLI: `experimental`.
8. Hide the manual runner pairing panel outside development mode.
9. Add a temporary desktop-mode placeholder message:
   ```text
   Local subscriptions will be managed automatically by VDT Studio Desktop.
   ```
10. Preserve the standalone runner for tests and development.
11. Run:
   ```text
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm test:e2e
   pnpm certification:verify
   ```
12. Stop after completion.

### Completion report

Report:

- changed files;
- removed execution paths;
- new execution-client architecture;
- tests executed;
- current failures;
- migration risks;
- proposed Phase 2 file structure.

Do not begin the Tauri implementation until Phase 1 is reviewed.
