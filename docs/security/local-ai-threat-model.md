# Local AI Threat Model

This threat model covers subscription CLI, local-model and desktop-sidecar execution for VDT Studio alpha work.

## Security Boundary

The trusted boundary for seamless Local AI is the desktop host:

- Tauri exposes only reviewed commands listed in `docs/architecture/desktop-local-execution.md`.
- The webview never receives provider credentials, executable paths, command arguments, environment values, runner tokens or sidecar handshake material.
- Hosted web mode is API/BYOK only and must not detect or execute local CLIs.
- Standalone localhost runner pairing remains a development and headless fallback, not the production desktop user journey.

## Protected Assets

- Provider subscription sessions and auth state.
- API keys and BYOK credentials.
- Desktop IPC request integrity.
- Sidecar protocol nonce and request IDs.
- Project data, version history and generated VDT content.
- Repository files and local user files outside the ephemeral request directory.
- Release artifacts, sidecar bundle resources and integrity manifests.

## Threats And Controls

| Threat | Control |
| --- | --- |
| Hosted web executes a local subscription CLI | `/api/ai/detect-clis` fails closed outside explicit development web mode; hosted copy points users to Desktop. |
| Webview invokes arbitrary native capabilities | Tauri capability file enables no generic shell, filesystem or opener plugins; `pnpm desktop:verify` scans command/capability surface. |
| Frontend supplies executable path, args, schema or env | Runtime request parsing rejects forbidden fields; manifests own executable aliases, static args, schema IDs and task support. |
| Manifest or adapter argv injects NUL/path traversal/dangerous flags | Shared CLI argument validation rejects NUL bytes, `..` path traversal segments and reviewed dangerous flags before spawn. |
| Provider output mutates a VDT silently | AI output is schema-validated, optionally repaired once, previewed as a change set and applied only after user selection. |
| Provider reads repository or unrelated user files | Local AI requests run in fresh temp directories with filtered env and no browser-supplied paths. Tool-capable Cursor is constrained to a fresh temp `--workspace`; other subscription manifests must disable tools through reviewed CLI flags/policies before certification. |
| OS-specific sandbox dependency enters a manifest | Runtime rejects sandbox-required manifests with `UNSAFE_CONFIGURATION`; supported Local AI execution must stay cross-platform. |
| Sidecar stdout log corrupts protocol | Sidecar protocol accepts only bounded framed JSON messages; logs are structured on stderr. |
| Sidecar never completes startup handshake | TS and Rust hosts enforce bounded startup-handshake timeouts and terminate the child on startup failure. |
| Stale or tampered sidecar resource ships | `pnpm desktop:verify` rebuilds and hashes the sidecar bundle; the Rust desktop host verifies manifest SHA-256 digests before sidecar launch; `pnpm release:bundle:verify` scans declared desktop resources. |
| Secret material ships in release artifacts | Release bundle verifier scans CLI tarball entries and desktop resources for secret-like files, private keys and common token patterns. |
| Desktop installer claim hides native gaps | `pnpm desktop:native:preflight` fails closed until Rust/Cargo, pinned Tauri CLI, signing and a self-contained sidecar binary are present. |

## Current Alpha Status

Implemented controls:

- Hosted/local execution split.
- Desktop reviewed command allowlist.
- Sidecar private pipe protocol foundation.
- Sidecar startup timeout and crash-loop failure controls.
- Sidecar bundle integrity checks in packaging gates and host launch path.
- Runtime schema hardening and bounded repair.
- Provider certification status verification.
- Release SBOM/checksum/bundle secret checks.
- Cross-platform Local AI certification gate that rejects OS-specific sandbox-required manifests.

Open release blockers:

- Live-provider certification for subscription CLIs.
- Self-contained sidecar binary with no separate Node requirement.
- Native Tauri build verification with Rust/Cargo and pinned Tauri CLI.
- macOS signing identity and Windows installer target verification.
- Clean-machine desktop installer E2E.

The sidecar preparation script supports ingesting a reviewed Node-free runtime binary through `VDT_DESKTOP_SELF_CONTAINED_SIDECAR`, but the checked-in default development sidecar remains a Node runtime bundle until that compiler output is produced.

## Verification Commands

```bash
pnpm desktop:verify
pnpm desktop:native:preflight
pnpm certification:verify
pnpm release:bundle:verify
pnpm docs:verify
```
