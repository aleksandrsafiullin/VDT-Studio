# VDT Studio — дальнейший план разработки для Codex

**Repository:** `aleksandrsafiullin/VDT-Studio`  
**Date:** 2026-06-21  
**Status:** Release-focused implementation plan  
**Primary test backend:** Cursor Agent CLI

---

## 1. Главная цель

Перестроить VDT Studio из широкой платформы управления coding agents в сфокусированный AI-first продукт для построения, проверки и объяснения Value Driver Trees.

Пользователь должен иметь возможность подключить ИИ четырьмя способами:

1. Через собственный API key.
2. Через локальную модель.
3. Через официальный CLI, использующий лимиты уже оплаченной подписки.
4. Через subscription-backed endpoint, если провайдер предоставляет совместимый API.

VDT Studio **не должен управляться внешними агентами**. MCP, skills, agent-to-agent orchestration и возможность внешнему агенту изменять проект не являются частью продукта.

Целевой workflow:

```text
User action in VDT Studio
        ↓
Bounded VDT AI task
        ↓
Selected model backend
        ↓
Structured proposal
        ↓
Schema + business validation
        ↓
Preview and user confirmation
        ↓
Deterministic VDT engine applies changes and calculates
```

Ключевой принцип:

```text
AI proposes.
User approves.
Deterministic engine calculates.
```

---

## 2. Что именно требуется от ИИ

ИИ может:

- создать первый черновик VDT;
- углубить выбранный узел;
- упростить ветку;
- предложить альтернативную декомпозицию;
- предложить формулу;
- предложить единицы измерения;
- проверить бизнес-логику;
- найти недостающие драйверы;
- найти возможные дубликаты;
- объяснить узел;
- объяснить результат сценария;
- подготовить executive summary;
- сформулировать уточняющие вопросы;
- обозначить assumptions, warnings и confidence.

ИИ не должен:

- выполнять авторитетные расчёты;
- автоматически менять граф;
- запускать произвольный shell;
- читать пользовательские файлы;
- получать доступ к репозиторию VDT Studio;
- использовать MCP;
- устанавливать skills;
- выполнять Git-операции;
- сохранять agent sessions;
- управлять интерфейсом;
- менять provider settings;
- сохранять credentials.

Все числовые расчёты остаются в `vdt-core`.

---

## 3. Поддерживаемые способы подключения

### 3.1 Subscription CLI backends — обязательные

| Backend | Priority | Используемый allowance |
|---|---:|---|
| Cursor Agent CLI | P0 | Cursor account/subscription |
| Codex CLI | P0 | ChatGPT subscription |
| Claude Code | P0 | Claude Pro/Max/Team/Enterprise |
| Gemini CLI | P0 | Google account / Gemini Code Assist |
| GitHub Copilot CLI | P0 | GitHub Copilot plan |

Cursor обязателен и реализуется первым, поскольку он будет основной средой тестирования связки AI ↔ VDT.

### 3.2 API backends — обязательные

- OpenAI-compatible
- Anthropic
- Gemini
- Azure OpenAI
- Custom compatible endpoint

### 3.3 Local backends — обязательные

- Ollama
- LM Studio
- vLLM
- любой OpenAI-compatible localhost endpoint

### 3.4 Subscription-backed API presets

Первый preset:

- Alibaba Cloud Coding Plan через dedicated OpenAI-compatible endpoint.

Не нужно запускать Qwen Code только ради использования Coding Plan. Если подписка предоставляет совместимый endpoint и key, подключать её напрямую безопаснее и проще.

### 3.5 Advanced

- Custom JSON stdin/stdout CLI adapter.

Он отключён по умолчанию и доступен только в Advanced settings.

---

## 4. Какие текущие agent-функции больше не нужны

Убрать из production scope:

- 21-agent runtime catalog;
- MCP installation for external agents;
- MCP write access к VDT-проектам;
- skills distribution;
- Pi RPC;
- универсальный ACP runtime;
- session resume между coding agents;
- tool-call lifecycle UI;
- возможность external agents управлять VDT Studio;
- Git/repository operations;
- arbitrary agent extra args.

Не удалять код сразу. Переместить неиспользуемый runtime в:

```text
packages/experimental-agent-runtime/
```

Исключить его из:

- web dependencies;
- default build;
- README feature list;
- release acceptance criteria;
- local runner production path.

Оставить небольшой product CLI:

```text
vdt validate project.json
vdt calculate project.json
vdt export project.json --format markdown
vdt runner start
vdt doctor
```

---

## 5. Новая архитектура

```text
packages/
├── vdt-core/
│   ├── graph/
│   ├── formula/
│   ├── validation/
│   ├── scenario/
│   ├── versioning/
│   └── export/
├── ai-harness/
│   ├── tasks/
│   ├── prompts/
│   ├── schemas/
│   ├── validation/
│   ├── repair/
│   └── routing/
├── model-bridge/
│   ├── contract/
│   ├── api/
│   ├── local-http/
│   ├── subscription-cli/
│   ├── custom-cli/
│   ├── detection/
│   ├── security/
│   ├── diagnostics/
│   └── registry/
├── local-runner/
│   ├── server/
│   ├── pairing/
│   ├── sandbox/
│   ├── execution/
│   └── audit/
└── cli/
```

Dependency direction:

```text
web
 ├── vdt-core
 ├── ai-harness
 └── model-bridge contracts

local-runner
 └── model-bridge execution

product CLI
 ├── vdt-core
 └── local-runner launcher
```

`apps/web` не должен зависеть от широкого `@vdt-studio/cli` agent runtime.

---

## 6. Общий контракт model backend

```ts
export type ModelBackendMode =
  | "api"
  | "subscription_cli"
  | "local_http"
  | "custom_cli";

export type ModelBackendStatus =
  | "not_installed"
  | "installed"
  | "authentication_required"
  | "ready"
  | "rate_limited"
  | "unsupported_version"
  | "unsafe_configuration"
  | "unavailable"
  | "error";

export interface ModelBackendCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  modelSelection: boolean;
  accountBasedUsage: boolean;
  localExecution: boolean;
  toolsCanBeDisabled: boolean;
  requiresOsSandbox: boolean;
}

export interface ModelBackendDetectionResult {
  backendId: string;
  status: ModelBackendStatus;
  executable?: string;
  version?: string;
  authSummary?: string;
  diagnostics: string[];
}

export interface StructuredCompletionRequest<TInput> {
  requestId: string;
  taskType: VdtAiTaskType;
  input: TInput;
  systemPrompt: string;
  userPrompt: string;
  schemaId: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface StructuredCompletionResult<TOutput> {
  requestId: string;
  backendId: string;
  model?: string;
  output: TOutput;
  rawText?: string;
  latencyMs: number;
  validation: {
    schemaValid: boolean;
    repaired: boolean;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    providerReported?: boolean;
  };
}

export interface ModelBackend {
  detect(): Promise<ModelBackendDetectionResult>;
  testConnection(signal?: AbortSignal): Promise<ModelBackendDetectionResult>;
  completeStructured<TInput, TOutput>(
    request: StructuredCompletionRequest<TInput>,
    signal?: AbortSignal
  ): Promise<StructuredCompletionResult<TOutput>>;
}
```

Не включать в product-facing contract:

```text
cwd
sessionId
mcpServers
skills
tools
allowAllTools
dangerouslyAutoApprove
workspaceTrust
gitRepository
shellCommand
arbitraryExtraArgs
```

---

## 7. Закрытый список AI tasks

```ts
export type VdtAiTaskType =
  | "generate_tree"
  | "deepen_node"
  | "simplify_branch"
  | "suggest_alternative"
  | "suggest_formula"
  | "review_model"
  | "check_units"
  | "identify_missing_drivers"
  | "identify_duplicate_drivers"
  | "explain_node"
  | "explain_scenario"
  | "generate_executive_summary";
```

Для каждой задачи создать:

- input Zod schema;
- output Zod schema;
- JSON Schema;
- prompt template;
- deterministic post-validator;
- maximum input/output size;
- maximum number of changes;
- preview renderer;
- unit tests;
- golden test cases.

Generic chat в первом релизе не нужен.

---

## 8. Workflow изменения VDT

Ни один ответ модели не меняет проект сразу.

```text
AI response
    ↓
JSON extraction
    ↓
Zod validation
    ↓
Graph/formula validation
    ↓
VdtChangeSet
    ↓
Visual diff
    ↓
User selection
    ↓
Apply selected changes
    ↓
Version snapshot
    ↓
Deterministic recalculation
```

```ts
export interface VdtChangeSet {
  id: string;
  taskType: VdtAiTaskType;
  backendId: string;
  createdAt: string;
  additions: VdtNodeAddition[];
  updates: VdtNodeUpdate[];
  deletions: VdtNodeDeletion[];
  edgeChanges: VdtEdgeChange[];
  assumptions: string[];
  questions: string[];
  warnings: VdtWarning[];
}
```

Модель не может:

- менять React Flow positions;
- менять API keys;
- менять provider settings;
- менять versions;
- менять data sources;
- менять scenarios вне явно заданного task;
- записывать рассчитанные значения как authoritative.

---

## 9. Local runner: обязательная безопасность

Local runner — единственный компонент, который может запускать subscription CLIs.

### 9.1 Binding

- bind only to `127.0.0.1`;
- never bind to `0.0.0.0`;
- reject non-local Host;
- enforce Origin allowlist;
- require `application/json`;
- cap body size;
- disallow redirects;
- disallow remote runner URLs in production.

### 9.2 Pairing

Добавить pairing:

```text
Runner starts
→ creates short-lived pairing code
→ user enters code in VDT Studio
→ runner returns scoped session token
→ browser keeps token only for active session
```

Требования:

- pairing code expires;
- attempts rate-limited;
- token high entropy;
- runner restart revokes tokens;
- token not stored in project;
- CORS remains enabled in addition to pairing.

### 9.3 Browser sends backend ID, not a command

Allowed:

```json
{
  "backendId": "cursor_subscription",
  "taskType": "generate_tree",
  "schemaId": "generate-tree-v1",
  "input": {}
}
```

Forbidden:

```json
{
  "command": "/bin/sh",
  "args": ["-c", "..."]
}
```

Commands and arguments come only from reviewed adapter manifests.

### 9.4 Process execution

Always:

```ts
spawn(executable, args, { shell: false });
```

Reject:

- NUL;
- browser-controlled extra args;
- project-local executables;
- unknown symlinks;
- shell strings;
- relative command injection.

### 9.5 Temporary working directory

Each request:

1. creates new owner-only temp directory;
2. contains only bounded request/schema files;
3. receives no VDT Studio repository;
4. receives no unrelated project files;
5. cleans up after success, failure, timeout, or cancellation;
6. is never reused.

### 9.6 Environment

Deny by default.

Allow common variables only:

```text
PATH
HOME
USER
LOGNAME
TMPDIR
TEMP
TMP
LANG
LC_ALL
LC_CTYPE
NO_COLOR
```

Use provider CLI's existing local authentication.

Do not:

- inspect tokens;
- copy credentials;
- log environment values;
- inherit unrelated API keys;
- send credentials to browser.

### 9.7 Limits

Recommended defaults:

```text
Prompt:        512 KB
Single line:   1 MB
Stdout:        4 MB
Stderr:        1 MB
Result JSON:   1 MB
Timeout:       120 sec
Kill grace:    3 sec
```

### 9.8 Cancellation

- AbortSignal;
- provider graceful cancel if available;
- SIGTERM;
- SIGKILL after grace period;
- mandatory cleanup;
- normalized cancellation error.

### 9.9 Logs

Log only:

- request ID;
- backend ID;
- adapter and executable version;
- task;
- time;
- latency;
- exit code;
- output size;
- schema result;
- normalized error.

Never log credentials or full prompts by default.

---

## 10. OS sandbox policy

Empty `cwd` is not a sufficient security boundary.

Preferred approach:

- disable shell;
- disable read/write tools;
- disable MCP;
- disable plugins;
- disable user hooks;
- disable project instructions;
- disable session persistence.

If provider cannot fully disable these capabilities, use OS sandbox.

Sandbox must:

- allow provider network access;
- allow provider executable/runtime;
- allow authentication mechanism;
- allow write only in temp directory;
- deny arbitrary user files;
- deny VDT Studio repository;
- deny child processes unless required;
- deny writes outside temp.

Implementation order:

1. macOS, because Cursor testing is primarily on the project owner's Mac.
2. Linux via bubblewrap or reviewed equivalent.
3. Windows restricted process/AppContainer/job strategy.

A backend without tool disabling or certified sandbox remains `experimental`.

---

## 11. Cursor Agent CLI — first implementation

### Goal

Use existing Cursor subscription inside VDT Studio for tree generation and AI actions.

### Detection

Probe aliases:

```text
agent
cursor-agent
cursor
```

Record tested CLI versions in:

```text
docs/provider-compatibility.md
```

### Authentication

Do not read Cursor credentials.

Use official status/auth command if available. Otherwise execute a minimal safe request and classify:

- ready;
- login required;
- rate limited;
- unsupported version;
- error.

### Execution

Verify installed-version support for:

```text
--print
--output-format stream-json
--stream-partial-output
--model
```

Remove unconditional:

```text
--force
--trust
```

If trust is required:

- trust only generated temp directory;
- never trust repo;
- never trust home;
- do not persist broad trust.

Do not use Cursor ACP unless it is demonstrably safer and more stable than direct output mode.

No VDT MCP server is required.

### Cursor release gate

Cursor becomes `supported` only when:

- tools are disabled; or
- OS sandbox is verified.

### Cursor acceptance tests

- detects user's installed `agent`;
- works without API key;
- uses Cursor account allowance;
- generates Production Volume tree;
- deepens a node;
- reviews a tree;
- cannot read honey file;
- cannot write outside temp;
- does not change repo;
- does not use MCP;
- does not execute shell;
- handles cancellation;
- handles quota/auth errors;
- returns valid change set.

Cursor is the default backend in local development, not necessarily for all users.

---

## 12. Codex CLI

Authentication modes:

- ChatGPT sign-in for subscription access;
- API key for usage-based access.

Run only through local runner.

Verify current CLI equivalents of:

```text
codex exec
--json
--color never
--ephemeral
--sandbox read-only
--output-schema
--output-last-message
```

Requirements:

- no repo;
- no AGENTS.md;
- no MCP;
- no project instructions;
- native structured output where possible;
- local Zod validation;
- clear quota/auth errors;
- no token inspection.

---

## 13. Claude Code

Support existing Claude subscription login.

Verify current equivalents of:

```text
claude -p
--output-format json
--json-schema
--no-session-persistence
--tools ""
--disallowedTools "*"
--strict-mcp-config
```

Requirements:

- all tools disabled;
- no MCP;
- no persistent sessions;
- only task prompt and schema;
- local validation;
- clear quota/auth errors.

---

## 14. Gemini CLI

Support:

- Google account;
- personal allowance;
- Gemini Code Assist;
- organization Code Assist.

Mandatory:

- remove `--yolo`.

Use non-interactive JSON/stream-JSON mode.

Find official method to disable:

- filesystem;
- shell;
- web;
- MCP;
- Google Search tools.

If disabling is incomplete, require sandbox.

---

## 15. GitHub Copilot CLI

Support Copilot plan authentication.

Mandatory:

- remove `--allow-all-tools`.

Use current equivalents of:

```text
copilot -p
-s
--no-ask-user
--model
```

Do not grant tools.

Handle:

- plan unavailable;
- org policy disabled;
- premium request limit;
- authentication required.

If stable JSON output is unavailable:

1. request exactly one JSON document;
2. capture silent output;
3. extract bounded JSON;
4. validate;
5. perform one repair attempt.

---

## 16. Alibaba Cloud Coding Plan

Implement as OpenAI-compatible preset, not Qwen agent execution.

```ts
{
  id: "alibaba_coding_plan",
  protocol: "openai_compatible",
  baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
  credentialMode: "session_only"
}
```

Never store Coding Plan key in project, export, or localStorage.

---

## 17. Provider qualification backlog

A new CLI is added only if it passes:

### Commercial

- official provider CLI;
- official account/subscription auth;
- local use of allowance permitted;
- no credential extraction.

### Technical

- non-interactive;
- cancellable;
- bounded output;
- stable parser;
- no shell wrapper;
- temp cwd;
- version detection.

### Safety

- tools disabled or sandboxed;
- no external file access;
- no MCP;
- no repo mutation.

Candidates:

- Kimi Code CLI;
- Qoder CLI;
- Kiro CLI;
- Devin;
- Trae;
- Mistral Vibe;
- others.

Kiro is not included as subscription CLI until official headless subscription authentication is confirmed; current headless automation documentation is API-key oriented.

Qwen OAuth free allowance is discontinued. Qwen Coding Plan should be supported through direct endpoint preset.

---

## 18. Provider certification harness

Create:

```ts
export interface BackendCertification {
  backendId: string;
  testedVersion: string;
  testedAt: string;
  platform: "macos" | "linux" | "windows";
  architecture: string;
  accountMode: string;
  tests: {
    detection: boolean;
    authentication: boolean;
    nonInteractive: boolean;
    cancellation: boolean;
    structuredOutput: boolean;
    schemaValidation: boolean;
    noProjectMutation: boolean;
    noExternalFileRead: boolean;
    noExternalFileWrite: boolean;
    noShellExecution: boolean;
    noMcp: boolean;
    quotaErrorNormalization: boolean;
  };
  supportLevel: "supported" | "beta" | "experimental";
}
```

Add honey-file tests:

- file outside temp with unique secret;
- protected write target;
- malicious KPI prompt asking to read SSH keys;
- verify no leak or mutation.

Maintain:

```text
docs/provider-compatibility.md
```

Include tested version, OS, auth mode, support status, limitations, and verification date.

---

## 19. UI redesign

`Settings → AI`:

```text
AI Connections
1. Your subscriptions
2. API keys
3. Local models
4. Advanced
```

Subscription card example:

```text
Cursor Agent
Installed: Yes
Version: x.y.z
Authentication: Connected
Usage: Managed by Cursor
Security: Isolated local execution
[Test connection] [Use for VDT]
```

States:

- not installed;
- login required;
- connected;
- policy disabled;
- unsupported version;
- rate limited;
- unsafe configuration;
- runner unavailable;
- not paired;
- failed.

Never show numeric remaining quota unless official machine-readable data exists.

Use copy:

```text
Usage and limits are managed by the provider and depend on the user's plan,
selected model, and current provider policy.
```

No silent switch from subscription CLI to billable API.

Optional per-task routing later:

```text
Generate tree      → Cursor
Review model       → Claude
Explain scenario   → Gemini
```

MVP: all tasks use selected backend.

---

## 20. Validation and repair

```text
Provider response
    ↓
Extract JSON
    ↓
Parse
    ↓
Zod validate
    ↓
Graph-size limits
    ↓
Reference validation
    ↓
Formula validation
    ↓
Business validation
    ↓
Preview
```

On invalid output:

1. send one bounded repair request;
2. include only schema errors and truncated invalid result;
3. never include credentials;
4. after second failure, show provider error.

Track repair rate per backend.

---

## 21. Deterministic formula security

Initial grammar:

```text
node_reference
number
+
-
*
/
(
)
```

Do not permit:

- JavaScript;
- Python;
- eval;
- property access;
- arbitrary functions;
- network;
- file access;
- executable code.

AI suggests formula. `vdt-core` validates and calculates it.

---

## 22. Tests

### Unit

- registry;
- detection;
- version parser;
- command builder;
- environment allowlist;
- output parser;
- schema validation;
- repair;
- timeout;
- cancel;
- quota/auth normalization;
- pairing;
- Host/Origin checks.

### Fake binary tests

Simulate:

- valid JSON;
- JSONL;
- plain text plus JSON;
- malformed JSON;
- large output;
- slow output;
- stderr;
- exit failure;
- auth error;
- quota error;
- hang;
- file read/write attempt;
- child process attempt.

### Shared contract

Every backend passes:

```text
detect
testConnection
completeStructured
invalidOutput
timeout
cancel
quotaError
authError
noMutation
```

### Live tests

Opt-in only:

```text
VDT_LIVE_TEST_CURSOR=true
VDT_LIVE_TEST_CODEX=true
VDT_LIVE_TEST_CLAUDE=true
VDT_LIVE_TEST_GEMINI=true
VDT_LIVE_TEST_COPILOT=true
```

Never run maintainer credentials on untrusted PRs.

### VDT eval dataset

At least 20 KPIs:

- Production Volume
- OEE
- Availability
- Maintenance Cost
- Unit Cost
- Inventory Level
- Service Level
- Working Capital
- EBITDA
- Revenue
- Retention
- Conversion Rate
- Delivery Time
- Safety Incident Rate
- Energy Consumption
- Recovery
- Throughput
- Yield
- Procurement Savings
- Workforce Productivity

Track:

- schema pass rate;
- formula validity;
- unit completeness;
- duplicate rate;
- depth;
- node count;
- repair rate;
- latency;
- user acceptance.

---

## 23. Security test suite

Mandatory:

- SSRF;
- DNS rebinding;
- private-IP redirect;
- oversized body;
- oversized stream;
- malicious endpoint;
- command injection;
- argument injection;
- NUL;
- path traversal;
- symlink swap;
- Origin spoofing;
- Host attack;
- runner CSRF;
- pairing brute force;
- stale token;
- environment leakage;
- prompt injection;
- formula injection;
- cleanup after timeout;
- log redaction;
- attempted SSH-key read;
- attempted repo read;
- attempted external write.

No supported backend may ship with:

```text
--yolo
--allow-all-tools
--force
--trust
bypass_permissions
dangerous
```

unless an independent review proves that the specific isolated use is safe. Default action is removal.

---

## 24. Local runner API

```text
GET  /v1/health
GET  /v1/backends
POST /v1/pair
POST /v1/unpair
POST /v1/backends/:id/test
POST /v1/completions
POST /v1/completions/:requestId/cancel
GET  /v1/runs/:requestId
```

Completion request:

```json
{
  "requestId": "uuid",
  "backendId": "cursor_subscription",
  "taskType": "generate_tree",
  "schemaId": "generate-tree-v1",
  "input": {}
}
```

Browser sends approved `schemaId`, not arbitrary executable schema or command.

---

## 25. Persistence and secrets

May persist:

- selected backend;
- model name;
- non-secret endpoint;
- UI preferences;
- last successful test;
- version/support status;
- VDT projects.

Must not persist in localStorage:

- API keys;
- access tokens;
- provider tokens;
- runner pairing tokens;
- credential contents;
- auth responses.

BYOK modes:

```text
Session only — default
OS keychain — future desktop mode
Environment variable — advanced local mode
```

Never store secrets in project export.

---

## 26. GitHub Actions

Add:

```text
.github/workflows/quality.yml
.github/workflows/e2e.yml
.github/workflows/security.yml
.github/workflows/package.yml
.github/workflows/release.yml
```

Quality:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

E2E:

- Chromium;
- WebKit;
- desktop;
- mobile;
- mocked runner;
- mocked subscription backends.

Platform matrix:

- macOS arm64;
- macOS x64 if available;
- Ubuntu x64;
- Windows x64.

Packaging:

```text
vdt --help
vdt doctor
vdt runner start
vdt validate example.json
```

Fix package exports so published package does not reference omitted `src` files.

Enable:

- CodeQL;
- dependency review;
- Dependabot;
- secret scanning;
- SBOM;
- release checksums.

---

## 27. Implementation phases

### Phase 0 — Scope freeze

- freeze new agent runtimes;
- inventory existing MCP/skills/runtime code;
- create ADR:
  `docs/adr/ADR-001-model-backends-not-agent-orchestration.md`;
- update README;
- mark external agent control out of scope.

**Done when:** production docs no longer position VDT Studio as a 21-agent platform.

### Phase 1 — Extract `model-bridge`

- create package;
- common contracts;
- registry;
- safe parsing;
- fake backends;
- remove web dependency on broad CLI runtime;
- preserve existing API/local HTTP behavior.

**Done when:** web builds without agent runtime dependency.

### Phase 2 — Harden local runner

- v1 API;
- pairing;
- IDs;
- cancellation;
- manifests;
- environment isolation;
- temp directories;
- output caps;
- logs;
- doctor command;
- security tests.

**Done when:** browser cannot select executable or args.

### Phase 3 — Cursor end-to-end

- detect installed Cursor CLI;
- version compatibility;
- auth test;
- direct non-interactive mode;
- parser;
- remove force/trust;
- macOS sandbox;
- settings card;
- live tests;
- compatibility docs.

**Done when:** owner can generate, deepen, and review VDT through Cursor without repo/shell/MCP access.

### Phase 4 — Codex and Claude

- subscription adapters;
- native structured output;
- tools/session disabled;
- cards;
- fake/live tests.

**Done when:** both work without API keys and return valid VDT output.

### Phase 5 — Gemini and Copilot

- remove yolo/allow-all;
- safe execution;
- sandbox where required;
- plan/policy diagnostics;
- tests.

**Done when:** both use account allowance without tools.

### Phase 6 — Consolidate API/local UX

- cloud API settings;
- local presets;
- Alibaba Coding Plan;
- session-only keys;
- no silent fallback;
- consistent diagnostics.

### Phase 7 — Complete AI actions

- task schemas;
- change previews;
- version snapshots;
- review;
- unit checks;
- scenario explanation;
- summary;
- missing/duplicate drivers.

### Phase 8 — Release packaging

- package runner;
- fix CLI exports;
- CI;
- E2E;
- security;
- clean install;
- provider certification;
- alpha release.

---

## 28. First public alpha support matrix

| Backend | Target status |
|---|---|
| Mock | Supported |
| OpenAI-compatible API | Supported |
| Anthropic API | Supported |
| Gemini API | Supported |
| Azure OpenAI | Supported |
| Ollama | Supported |
| LM Studio | Supported |
| vLLM | Beta |
| Cursor subscription | Supported on tested macOS configuration |
| Codex ChatGPT subscription | Supported |
| Claude subscription | Supported |
| Gemini account/Code Assist | Beta |
| GitHub Copilot plan | Beta |
| Alibaba Coding Plan | Beta |
| Custom JSON CLI | Experimental |
| Kimi Code | Qualification backlog |
| Kiro | Excluded until subscription headless auth exists |
| Remaining agents | Excluded pending certification |

Do not advertise “21 agents.”

Use:

```text
Connect through API keys, local models, or selected existing AI subscriptions.
```

---

## 29. Definition of done

1. External agents do not control VDT Studio.
2. Web no longer depends on broad agent runtime.
3. Subscription CLIs are model backends.
4. Cursor works end to end.
5. Codex and Claude use existing subscriptions.
6. Gemini and Copilot have bounded safe adapters.
7. Alibaba Coding Plan works through direct endpoint.
8. No supported backend has unrestricted tools.
9. No supported backend receives repo access.
10. No AI response silently changes project.
11. Calculations remain deterministic.
12. Runner pairing is implemented.
13. Credentials remain local and uninspected.
14. CI/E2E/security/package gates pass.
15. Compatibility matrix is published.

---

## 30. Codex working rules

- Work in small commits.
- Run relevant tests after every slice.
- Do not add next backend before current one passes contract and security tests.
- Never weaken safety gates to make a CLI work.
- Never use dangerous auto-approval flags in production.
- Never move calculations into prompts.
- Never store credentials.
- Never silently fall back to billable API.
- Preserve strict minimal Apple-like UI.
- Preserve left-to-right VDT layout.
- Prefer native structured output, always validate locally.
- Treat CLI behavior as versioned external dependency.
- Update compatibility docs after adapter changes.
- Keep unsupported providers out of onboarding.

---

## 31. First task for Codex

Implement only Phase 0 and Phase 1.

Deliver:

1. ADR.
2. Full inventory of runtime/MCP/skills code.
3. Migration map.
4. `packages/model-bridge`.
5. Common backend contract.
6. Fake backend.
7. Contract tests.
8. Remove web dependency on broad CLI runtime.
9. Updated README positioning.
10. Do not delete old runtime code yet.
11. Passing lint, typecheck, tests, and build.

After completion, stop and report:

- changed files;
- architecture summary;
- tests executed;
- unresolved issues;
- proposed Phase 2 sequence.

Do not start Cursor execution before the model-bridge contract is reviewed.

---

## 32. Official references

- OpenAI Codex authentication:  
  https://developers.openai.com/codex/auth/

- OpenAI Codex non-interactive mode:  
  https://developers.openai.com/codex/noninteractive/

- Claude Code quickstart:  
  https://code.claude.com/docs/en/quickstart

- Claude Code CLI reference:  
  https://code.claude.com/docs/en/cli-reference

- Cursor CLI overview:  
  https://cursor.com/docs/cli/overview

- Cursor CLI parameters:  
  https://cursor.com/docs/cli/reference/parameters

- Gemini CLI:  
  https://github.com/google-gemini/gemini-cli

- GitHub Copilot CLI:  
  https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview

- GitHub Copilot programmatic execution:  
  https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically

- Qwen Code authentication and Alibaba Coding Plan:  
  https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/
