# Standalone Runner

The standalone localhost runner is retained for development, tests, troubleshooting and headless CLI workflows. It is not the production desktop Local AI user journey.

## When To Use It

Use the standalone runner for:

- local web development without Tauri;
- HTTP boundary tests;
- package clean-install verification;
- diagnosing provider manifests and schema handling;
- advanced headless workflows.

Do not use it as evidence that the desktop product has seamless Local AI. Desktop readiness requires the private Tauri IPC and sidecar path documented in `docs/architecture/desktop-local-execution.md`.

## Development Startup

```bash
pnpm local-runner:start
```

The web UI may expose standalone runner pairing only in explicit development mode. Production desktop mode should hide runner startup and pairing copy.

## Security Properties

- The runner binds only to loopback.
- Protected routes require pairing.
- Browser requests cannot supply executable paths, arguments, schemas, environment values or provider configuration fields.
- Subscription CLI execution uses reviewed manifests.
- Sandbox-required manifests fail closed when the required OS sandbox profile is not usable.

## Verification

```bash
pnpm test
pnpm package:verify
```

In restricted local sandboxes, loopback health checks may be skipped after install/export checks pass. CI must fail closed when loopback binding is unavailable.
