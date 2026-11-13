import { supervisorControllerFenceToken, supervisorProcessOwner } from "../supervisor-controller-owner";

if (!process.send || !supervisorProcessOwner()) {
  process.stderr.write("Native supervisor owner discovery failed.\n");
  process.exitCode = 1;
} else {
  process.send(supervisorControllerFenceToken());
  process.on("disconnect", () => process.exit(0));
}
