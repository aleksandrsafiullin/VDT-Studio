import { openVdtDatabase } from "./index";

const [projectRoot, dataDir, startAtText] = process.argv.slice(2);
if (!projectRoot || !dataDir || !startAtText) {
  throw new Error("Migration concurrency child requires projectRoot, dataDir, and startAt.");
}
const startAt = Number(startAtText);
if (!Number.isFinite(startAt)) throw new Error("Migration concurrency start time is invalid.");
if (Date.now() < startAt) {
  await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()));
}
const db = openVdtDatabase(projectRoot, { dataDir, busyTimeoutMs: 30_000 });
db.close();
process.stdout.write('{"opened":true}\n');
