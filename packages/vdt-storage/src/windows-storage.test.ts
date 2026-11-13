import { expect, test, vi } from "vitest";
import { acquireWindowsStorageProfile, getWindowsStorageForProfile, type WindowsStorageDirectory } from "./windows-storage";

test("overlapping database owners share a pinned Windows capability and release it exactly once", () => {
  const profile = String.raw`C:\Users\app\vdt`;
  const close = vi.fn();
  const directory = { close } as unknown as WindowsStorageDirectory;
  const open = vi.fn(() => directory);

  expect(() => acquireWindowsStorageProfile(profile, () => { throw new Error("open failed"); })).toThrow("open failed");
  expect(() => getWindowsStorageForProfile(profile)).toThrow("no admitted native session");

  const first = acquireWindowsStorageProfile(profile, open);
  const second = acquireWindowsStorageProfile(profile.toUpperCase(), open);
  expect(first.directory).toBe(directory);
  expect(second.directory).toBe(directory);
  expect(open).toHaveBeenCalledTimes(1);

  first.release();
  first.release();
  expect(getWindowsStorageForProfile(profile)).toBe(directory);
  expect(close).not.toHaveBeenCalled();
  second.release();
  second.release();
  expect(close).toHaveBeenCalledTimes(1);
  expect(() => getWindowsStorageForProfile(profile)).toThrow("no admitted native session");
});
