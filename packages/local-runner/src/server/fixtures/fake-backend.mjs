const mode = process.argv[2] ?? "valid";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);

if (mode === "slow") {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
if (mode === "large") {
  await new Promise((resolve) => process.stdout.write(JSON.stringify({ ok: true, padding: "x".repeat(2 * 1024 * 1024) }), resolve));
  process.exit(0);
}
if (mode === "stderr") {
  process.stderr.write("sensitive prompt must not be exposed");
  process.exit(7);
}

const output = request.schemaId === "connection-test-v1"
  ? { ok: true, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() }
  : {
      projectTitle: "Fake tree",
      rootNodeId: "root",
      nodes: [{ id: "root" }],
      edges: [],
      assumptions: [],
      questionsForUser: [],
      warnings: []
    };
process.stdout.write(JSON.stringify(output));
