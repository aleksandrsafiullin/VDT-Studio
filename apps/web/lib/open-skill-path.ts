import { execFile } from "node:child_process";
import path from "node:path";
import { SkillLibraryError } from "@vdt-studio/storage";

/** Only the skills route calls this, after resolving a library-owned file or
 * directory. No shell, application name, URL or command comes from the client. */
export async function openSkillPath(filename: string): Promise<void> {
  if (!path.isAbsolute(filename)) throw new SkillLibraryError("INVALID_SKILL_PATH", "An absolute library path is required.");
  const command = process.platform === "darwin" ? "/usr/bin/open"
    : process.platform === "linux" ? "/usr/bin/xdg-open"
    : process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe") : undefined;
  if (!command) throw new SkillLibraryError("SKILL_OPEN_UNAVAILABLE", "Open the displayed skills folder in your file manager.");
  await new Promise<void>((resolve, reject) => {
    execFile(command, [filename], { timeout: 10_000, maxBuffer: 8 * 1024, windowsHide: true }, error => {
      if (error) reject(new SkillLibraryError("SKILL_OPEN_UNAVAILABLE", "The default application could not open this item. Choose an application for .md files in your operating system."));
      else resolve();
    });
  });
}
