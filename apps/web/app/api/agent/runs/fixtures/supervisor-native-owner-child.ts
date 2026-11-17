import { admitPackagedWindowsStorage } from "@vdt-studio/storage";
import { supervisorControllerFenceToken, supervisorProcessOwner } from "../supervisor-controller-owner";

const [runtime, profile] = process.argv.slice(2);
if (!runtime || !profile) throw new Error("Expected verified runtime and owned profile.");
const admission = admitPackagedWindowsStorage(runtime, profile);

if (!process.send || !supervisorProcessOwner()) {
  admission.close();
  process.stderr.write("Native supervisor owner discovery failed.\n");
  process.exitCode = 1;
} else {
  process.send(supervisorControllerFenceToken());
  process.on("disconnect", () => { admission.close(); process.exit(0); });
}
