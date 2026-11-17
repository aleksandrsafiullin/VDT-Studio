import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function currentWorkspaceRoot(): Promise<string> {
  const cwd = await realpath(process.cwd());
  let root = cwd;
  let directory = cwd;
  for (let level = 0; level < 12; level += 1) {
    if (await lstat(path.join(directory, ".git")).catch(() => undefined) ||
        await lstat(path.join(directory, "pnpm-workspace.yaml")).catch(() => undefined)) root = directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return root;
}
