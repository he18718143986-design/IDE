import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";
import {
  createEmptyProject,
  validateEmptyProjectName,
} from "../../daemon/desktop/create-empty-project";

describe("TASK-DS.2 create-empty-project (DS2-P1 / DS2-P4)", () => {
  const temps: string[] = [];

  afterEach(() => {
    while (temps.length) {
      const p = temps.pop();
      if (p) safeRmSync(p);
    }
  });

  function mkParent(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-ds2-parent-"));
    temps.push(dir);
    return dir;
  }

  it("合法名：在父目录下创建空目录并回绝对 path", () => {
    const parent = mkParent();
    const result = createEmptyProject({
      platform: "darwin",
      parentPath: parent,
      name: "my-app",
    });
    expect(result).toEqual({
      ok: true,
      path: path.join(parent, "my-app"),
    });
    expect(fs.statSync(path.join(parent, "my-app")).isDirectory()).toBe(true);
    expect(fs.readdirSync(path.join(parent, "my-app"))).toEqual([]);
  });

  it("非法名：空 / 分隔符 / . / .. → E_INVALID_NAME，且不创建", () => {
    const parent = mkParent();
    const cases = ["", "  ", "a/b", "a\\b", ".", ".."];
    for (const name of cases) {
      const before = fs.readdirSync(parent);
      const result = createEmptyProject({
        platform: "darwin",
        parentPath: parent,
        name,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("E_INVALID_NAME");
      expect(fs.readdirSync(parent)).toEqual(before);
    }
    expect(validateEmptyProjectName("ok-name")).toEqual({
      ok: true,
      name: "ok-name",
    });
  });

  it("父目录不存在 → E_PARENT_NOT_FOUND；父路径是文件 → E_PARENT_NOT_DIR", () => {
    const missing = path.join(
      os.tmpdir(),
      `stagent-ds2-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const miss = createEmptyProject({
      platform: "darwin",
      parentPath: missing,
      name: "x",
    });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.code).toBe("E_PARENT_NOT_FOUND");

    const parent = mkParent();
    const filePath = path.join(parent, "not-a-dir");
    fs.writeFileSync(filePath, "x");
    const notDir = createEmptyProject({
      platform: "darwin",
      parentPath: filePath,
      name: "child",
    });
    expect(notDir.ok).toBe(false);
    if (!notDir.ok) expect(notDir.code).toBe("E_PARENT_NOT_DIR");
    expect(fs.existsSync(path.join(filePath, "child"))).toBe(false);
  });

  it("目标已存在 → E_EXISTS，不覆盖、不半创建", () => {
    const parent = mkParent();
    const existing = path.join(parent, "taken");
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, "keep.txt"), "keep");
    const result = createEmptyProject({
      platform: "darwin",
      parentPath: parent,
      name: "taken",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("E_EXISTS");
    expect(fs.readFileSync(path.join(existing, "keep.txt"), "utf8")).toBe(
      "keep",
    );
  });

  it("非 darwin → E_UNSUPPORTED_PLATFORM，且不创建", () => {
    const parent = mkParent();
    for (const platform of ["linux", "win32"] as const) {
      const result = createEmptyProject({
        platform,
        parentPath: parent,
        name: "nope",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("E_UNSUPPORTED_PLATFORM");
    }
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("DS2-P4：源码无 electron/tauri 依赖导入；无 Token 明文落盘字面量", () => {
    const src = fs.readFileSync(
      path.resolve("daemon/desktop/create-empty-project.ts"),
      "utf8",
    );
    expect(src).not.toMatch(
      /from\s+["']electron["']|require\(["']electron["']\)/i,
    );
    expect(src).not.toMatch(
      /from\s+["'][^"']*tauri[^"']*["']|require\(["'][^"']*tauri[^"']*["']\)/i,
    );
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/\?token=/);
    // 允许注释里出现否定措辞；禁止把钥匙写进响应字段字面量
    expect(src).not.toMatch(/\blaunchUrl\s*:/);
  });
});
