import { createLocalRunnerServer, readLocalRunnerConfig } from "./app";

const { host, port } = readLocalRunnerConfig();
const server = createLocalRunnerServer({ host, port });

server.listen(port, host, () => {
  process.stdout.write(`VDT local runner listening at http://${host}:${port}\n`);
});
