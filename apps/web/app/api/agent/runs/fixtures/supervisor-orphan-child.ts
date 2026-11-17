import { SqliteAgentSupervisorPersistence } from "../sqlite-supervisor-persistence";
import { supervisorProcessOwner } from "../supervisor-controller-owner";
import type { AgentSessionBinding } from "@vdt-studio/vdt-agent-runtime";

async function main() {
const [databasePath, rawBinding, action] = process.argv.slice(2);
const binding = JSON.parse(rawBinding!) as AgentSessionBinding;
const authority = new SqliteAgentSupervisorPersistence(databasePath!);
try {
  if (action === "own") {
    if (!supervisorProcessOwner()) throw new Error("OS process-owner identity is unavailable on this test host.");
    await authority.createBinding(binding);
    await authority.saveCheckpoint({
      schemaVersion: 2, checkpointId: `checkpoint:${binding.runId}`, bindingId: binding.bindingId,
      runId: binding.runId, sessionEpoch: 1, externalSessionId: null,
      lastConfirmedInput: null, lastConfirmedOutput: null,
      activeExchange: null, activeToolCall: null, finishReceipt: null, createdAt: new Date().toISOString()
    });
    process.stdout.write(JSON.stringify({ ready: true }) + "\n");
    setInterval(() => undefined, 1_000);
  } else {
    const state = await authority.cancelOrphanedRun(binding.runId);
    process.stdout.write(JSON.stringify({ ok: true, epoch: state.binding.sessionEpoch, events: state.eventOutbox?.length }) + "\n");
    authority.close();
  }
} catch (error) {
  authority.close();
  process.stdout.write(JSON.stringify({ ok: false, code: error && typeof error === "object" && "code" in error ? error.code : "ERROR", message: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
}

}
void main();
