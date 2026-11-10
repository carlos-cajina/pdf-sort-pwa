import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  pickFolder,
  saveHandle,
  loadHandle,
  getPermission,
  requestPermission,
} from "../handles";
import { fakeDir, installFakeIndexedDB } from "./fakes";

describe("handles", () => {
  beforeAll(() => {
    installFakeIndexedDB();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("pickFolder delegates to window.showDirectoryPicker", async () => {
    const picked = fakeDir([], { name: "input", permission: "granted" });
    (globalThis as any).window = {
      showDirectoryPicker: async () => picked,
    };

    const result = await pickFolder();
    expect(result).toBe(picked);
  });

  it("getPermission surfaces prompt and granted from the fake", async () => {
    const promptDir = fakeDir([], { permission: "prompt" });
    expect(await getPermission(promptDir)).toBe("prompt");

    const grantedDir = fakeDir([], { permission: "granted" });
    expect(await getPermission(grantedDir)).toBe("granted");
  });

  it("requestPermission returns true when granted and false when denied", async () => {
    const promptDir = fakeDir([], { permission: "prompt" });
    expect(await requestPermission(promptDir)).toBe(true);
    expect(await getPermission(promptDir)).toBe("granted");

    const deniedDir = fakeDir([], { permission: "denied" });
    expect(await requestPermission(deniedDir)).toBe(false);
  });

  it("saveHandle/loadHandle round-trip via IndexedDB", async () => {
    const dir = fakeDir([], { name: "input", permission: "granted" });

    await saveHandle("input", dir);
    const loaded = await loadHandle("input");

    expect(loaded).toBe(dir);
    expect(await loadHandle("output")).toBeNull();
  });
});
