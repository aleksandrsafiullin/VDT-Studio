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

## Protected Assets

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
| CLI argv injection/path traversal | Shared validation rejects NUL, traversal and reviewed dangerous flags |
| Provider reads repository | Fresh temp workspaces, filtered environment and no browser-supplied cwd/path |
| Sidecar stdout corrupts protocol | Bounded framed JSON on stdout; structured logs on stderr |
| Sidecar startup hangs/crashes | Handshake timeout, child termination, pending rejection and crash-loop fail-closed |
| Sidecar resource is stale/tampered | Manifest SHA-256 verification before launch and release bundle scanning |
| Secret material ships | Bundle scanner, checksums and SBOM tooling |
| BYOK target performs SSRF/redirect | DNS validation/pinning, private-range rejection, redirect and size limits |
| Provider returns malformed graph | Closed schemas, local validation, bounded repair and calculation checks |
| Research disabled by user | Tool-layer rejection before provider call |
| Conflicting revision overwrites an existing file | W0.1 strict CAS/idempotency commit boundary; final publication uses `O_CREAT | O_EXCL`, never overwrite-capable atomic rename; 100-process conflict and SIGKILL recovery tests pass on macOS Node 24 |

## Open Critical Risks

| Risk | Status and required control |
|---|---|
| Concurrent agent/stale snapshot overwrites manual changes | P0: per-run serialization, operation-level merge and conflict state required |
| Untrusted XLS/XLSX parser vulnerabilities | P0-release: replace/update dependency and isolate parser before external upload |
| Request/workbook materialized before effective limits | P0-release: streaming ingress and decompression/CPU/RAM budgets required |
| ID-only dataset/run access | P0-release for hosted mode: project/user ownership or local-only enforcement required |
| Plaintext files without retention/delete/encryption policy | P0-release: lifecycle, storage permissions and encryption policy required |
| Partial preview analysed as full source | P0 correctness: parsers must read immutable full bytes and disclose sampling |
| Web/file prompt injection | P1: mark source content as untrusted, isolate policy and add adversarial tests |
| Provider receives sensitive sample/profile | P1: data minimization, explicit consent, DLP/redaction and egress audit required |
| Dangerous existing-project mutation auto-applies | P1: risk-based approval and base-revision validation required |

## Provider And CLI Boundary

- The browser never supplies executable paths, static arguments, environment or credentials to local CLI adapters.
- Subscription backends remain at the status in `release/provider-certification.json`; fake tests are not live evidence.
- Tool-capable Cursor receives a fresh ephemeral workspace, not the repository cwd or VDT MCP configuration.
- Other reviewed subscription manifests deny tools through provider-owned flags/policies and validate output locally.
- An unavailable required sandbox produces `UNSAFE_CONFIGURATION`.

## Research Boundary

Search results currently return snippets that are fed back to the model. Until a Research Broker and immutable Evidence Store exist:

- snippets must be treated as untrusted quoted data;
- they must not change system/tool policy;
- they must not be accepted as audited benchmark evidence;
- source opening, claim extraction, corroboration and user acceptance remain required roadmap controls.

## Data-Ingestion Boundary

The current `.vdt/data-discovery` storage and API are suitable only for single-user local alpha evaluation on non-sensitive copies. Hosted/public data ingestion requires all controls listed in `docs/release-checklist.md` and `docs/DATA_INGESTION.md`.

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
