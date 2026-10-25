import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SkillLibraryError, skillContentHash } from "./skill-library";

export interface SkillFileIssue { path: string; message: string }
export interface SkillFileSnapshot { folders: string[]; files: { path: string; raw: string }[]; issues: SkillFileIssue[] }

/** Editable working files, separate from immutable runtime versions. No path
 * supplied by a browser may escape this root or traverse a symbolic link. */
export class LocalSkillFiles {
  constructor(readonly rootPath: string, private readonly ensureParent: () => void) {}

  folder(relative = ""): string {
    const parts = this.parts(relative);
    this.ensureParent();
    try { fs.mkdirSync(this.rootPath, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    let current = this.rootPath;
    for (const part of ["", ...parts]) {
      if (part) current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SkillLibraryError("UNSAFE_SKILL_PATH", "Skill folders cannot contain symbolic links.");
    }
    return current;
  }

  createFolder(parent: string, name: string): string {
    if (this.parts(name).length !== 1) throw new SkillLibraryError("INVALID_SKILL_PATH", "Enter a folder name without path separators.");
    const relative = [parent, name].filter(Boolean).join("/");
    this.parts(relative);
    try { fs.mkdirSync(path.join(this.folder(parent), name), { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SkillLibraryError("SKILL_CONFLICT", "A folder with this name already exists."); throw error; }
    return relative;
  }

  scan(): SkillFileSnapshot {
    const result: SkillFileSnapshot = { folders: [""], files: [], issues: [] };
    let count = 0;
    const walk = (relative: string, inPackage = false) => {
      const entries = fs.readdirSync(this.folder(relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      const packageFiles = inPackage || entries.some(entry => entry.isFile() && entry.name.toLocaleLowerCase() === "skill.md");
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue; // Atomic editor saves and our own staging files.
        if (++count > 2000) throw new SkillLibraryError("SKILL_LIBRARY_LIMIT", "The skills folder supports at most 2,000 entries.");
        const item = [relative, entry.name].filter(Boolean).join("/");
        try {
          this.parts(item);
          if (entry.isSymbolicLink()) throw new SkillLibraryError("UNSAFE_SKILL_PATH", "Symbolic links are not imported.");
          if (entry.isDirectory()) { result.folders.push(item); walk(item, packageFiles); }
          else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name) && (!packageFiles || entry.name.toLocaleLowerCase() === "skill.md")) result.files.push({ path: item, raw: this.read(item) });
        } catch (error) { result.issues.push({ path: item, message: error instanceof Error ? error.message : "File could not be read." }); }
      }
    };
    walk("");
    return result;
  }

  read(relative: string): string {
    const filename = this.filePath(relative);
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new SkillLibraryError("UNSAFE_SKILL_PATH", "Only regular, unlinked Markdown files can be opened.");
      if (stat.size > 128 * 1024) throw new SkillLibraryError("SKILL_TOO_LARGE", "Skill files must be at most 128 KiB.");
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(fd));
    } finally { fs.closeSync(fd); }
  }

  create(folder: string, title: string, id: string, raw: string): string {
    const slug = title.normalize("NFKC").replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "skill";
    const name = `${slug}-${id.replace(/^user\./, "").slice(0, 8)}-${randomUUID().slice(0, 8)}.md`;
    const relative = [folder, name].filter(Boolean).join("/");
    const fd = fs.openSync(this.filePath(relative), "wx", 0o600);
    try { fs.writeFileSync(fd, raw, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return relative;
  }

  createPackage(folder: string, name: string, raw: string): string {
    const slug = name.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/[\s_]+/g, "-").slice(0, 60) || "new-skill";
    const relative = this.createFolder(folder, slug);
    try { this.writeSeedFile(`${relative}/SKILL.md`, raw); }
    catch (error) { fs.rmdirSync(this.folder(relative)); throw error; }
    return `${relative}/SKILL.md`;
  }

  /** Fixed, validated relative paths only. Existing files are always retained,
   * including user edits to supplied instructions and supporting resources. */
  writeSeedFile(relative: string, raw: string): boolean {
    const parts = this.parts(relative), name = parts.pop();
    if (!name || !/\.(md|markdown|yaml|yml|json)$/i.test(name) || Buffer.byteLength(raw, "utf8") > 1024 * 1024) throw new SkillLibraryError("INVALID_SKILL_PATH", "Unsupported skill resource.");
    let parent = "";
    for (const part of parts) {
      const next = [parent, part].filter(Boolean).join("/");
      try { this.createFolder(parent, part); } catch (error) { if (!(error instanceof SkillLibraryError) || error.code !== "SKILL_CONFLICT") throw error; }
      this.folder(next); parent = next;
    }
    const filename = path.join(this.folder(parent), name);
    let fd: number;
    try { fd = fs.openSync(filename, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    try { fs.writeFileSync(fd, raw, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return true;
  }

  replace(relative: string, raw: string, expectedRaw: string): void {
    const filename = this.filePath(relative), temporary = path.join(path.dirname(filename), `.skill-save-${randomUUID()}`);
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, raw, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (this.read(relative) !== expectedRaw) throw new SkillLibraryError("SKILL_CONFLICT", "The file changed in another application. Refresh the library before saving.");
      fs.renameSync(temporary, filename);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  moveFile(relative: string, folder: string): string {
    this.read(relative);
    const next = [folder, path.posix.basename(relative)].filter(Boolean).join("/");
    if (relative === next) return next;
    // link/unlink gives no-clobber publication even across host processes.
    try { fs.linkSync(this.filePath(relative), this.filePath(next)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SkillLibraryError("SKILL_CONFLICT", "A file with this name already exists in that folder."); throw error; }
    fs.unlinkSync(this.filePath(relative));
    return next;
  }

  renameFolder(relative: string, name: string): string {
    if (!relative || this.parts(name).length !== 1) throw new SkillLibraryError("INVALID_SKILL_PATH", "Choose a folder and enter its new name.");
    const parent = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative);
    const next = [parent, name].filter(Boolean).join("/");
    this.parts(next);
    if (relative === next) return next;
    const source = this.folder(relative), destination = path.join(this.folder(parent), name);
    if (fs.existsSync(destination)) throw new SkillLibraryError("SKILL_CONFLICT", "A folder with this name already exists.");
    fs.renameSync(source, destination);
    return next;
  }

  filePath(relative: string): string {
    const parts = this.parts(relative), name = parts.pop();
    if (!name || !/\.(md|markdown)$/i.test(name)) throw new SkillLibraryError("INVALID_SKILL_PATH", "Choose a Markdown file in the skills folder.");
    return path.join(this.folder(parts.join("/")), name);
  }

  removeIfUnchanged(relative: string, expectedRaw: string): void {
    try { if (skillContentHash(this.read(relative)) === skillContentHash(expectedRaw)) fs.unlinkSync(this.filePath(relative)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  private parts(relative: string): string[] {
    if (typeof relative !== "string" || relative.length > 700 || relative.startsWith("/") || relative.includes("\\")) throw new SkillLibraryError("INVALID_SKILL_PATH", "Invalid relative skills path.");
    const parts = relative === "" ? [] : relative.split("/");
    if (parts.length > 12 || parts.some(part => !part || part.startsWith(".") || /[\x00-\x1f\x7f<>:"|?*]/.test(part) || /[. ]$/.test(part) || Buffer.byteLength(part) > 220 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new SkillLibraryError("INVALID_SKILL_PATH", "Use ordinary folder names, up to 12 levels, without reserved characters or traversal segments.");
    }
    return parts;
  }
}
