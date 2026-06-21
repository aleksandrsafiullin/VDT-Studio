import { createLocalRunnerServer, getRunnerPairingInfo, readLocalRunnerConfig } from "./app";

const { host, port } = readLocalRunnerConfig();
const server = createLocalRunnerServer({ host, port });

server.listen(port, host, () => {
  const pairing = getRunnerPairingInfo(server);
  process.stdout.write(`VDT local runner listening at http://${host}:${port}\n`);
  process.stdout.write(`Pairing code: ${pairing.code} (expires ${pairing.expiresAt})\n`);
});
