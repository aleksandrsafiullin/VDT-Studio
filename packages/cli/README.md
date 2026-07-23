# VDT Studio CLI

The Node 24 product CLI exposes deterministic VDT operations and the standalone loopback runner:

```bash
vdt validate project.json
vdt calculate project.json
vdt export project.json --format markdown
vdt runner start
vdt doctor
```

The CLI does not install MCP servers or external skills and does not run coding agents. Subscription/local model execution belongs to the reviewed local-runner manifests; the in-product VDT agent is served through the application runtime, not the CLI command surface.

Package and clean-install instructions live in `docs/RELEASE.md`.
