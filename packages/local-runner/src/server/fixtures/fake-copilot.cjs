#!/usr/bin/env node
// Copilot's current ACP entrypoint, backed by the shared protocol fixture.
if (process.argv.includes("--version")) {
  process.stdout.write("GitHub Copilot CLI 1.0.74\n");
  process.exit(0);
}
if (!process.argv.includes("--acp")) {
  process.stderr.write("The Copilot fixture requires ACP.\n");
  process.exit(2);
}
const mode = process.env.VDT_FAKE_COPILOT_MODE ?? "ok";
process.env.VDT_HARNESS_FIXTURE_MODE = mode === "auth-required" ? "auth" : mode;
process.env.VDT_HARNESS_FIXTURE_PROJECT_TITLE = "Fake Copilot tree";
require("../../../../model-bridge/src/harness/fixtures/fake-harness.cjs");
