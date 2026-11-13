import { afterEach, expect, it, vi } from "vitest";
import { clearSupportErrors, readSupportErrors } from "./support-error-events";
import { listProjectFiles, MAX_PROJECT_FILE_BYTES, uploadProjectFile } from "./project-files-client";

afterEach(() => { vi.unstubAllGlobals(); clearSupportErrors(); });

it("records a bounded file error code without retaining its message or source name", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "DATA_PARSER_LIMIT", message: "Private financial source.xlsx /Users/person" } }, { status: 422 })));
  await expect(listProjectFiles("private-project")).rejects.toThrow("Private financial");
  expect(readSupportErrors()).toEqual([{ code: "DATA_PARSER_LIMIT", at: expect.any(String) }]);
  expect(JSON.stringify(readSupportErrors())).not.toContain("Private");
});

it("records local upload-size rejection without uploading or retaining the file", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const file = new File([], "private-salary-source.csv");
  Object.defineProperty(file, "size", { value: MAX_PROJECT_FILE_BYTES + 1 });
  await expect(uploadProjectFile("private-project", file)).rejects.toThrow("50 MB");
  expect(fetcher).not.toHaveBeenCalled();
  expect(readSupportErrors()).toEqual([{ code: "DATA_FILE_TOO_LARGE", at: expect.any(String) }]);
});
