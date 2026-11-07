import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  OSASCRIPT_BIN,
  buildChooseFolderScript,
  escapeAppleScriptString,
  pickFolderMacOS,
  type SyncExecFile,
} from "../../daemon/desktop/macos-folder-picker";

describe("TASK-DS.1 macos-folder-picker (DS1-P1 / DS1-P4)", () => {
  it("darwin：调起 /usr/bin/osascript choose folder 并归一绝对路径", () => {
    const execFileSync = vi.fn<SyncExecFile>(
      () => "/Users/tina/Desktop/demo/\n",
    );
    const result = pickFolderMacOS({
      platform: "darwin",
      execFileSync,
    });
    expect(result).toEqual({
      ok: true,
      path: path.resolve("/Users/tina/Desktop/demo/"),
    });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = execFileSync.mock.calls[0]!;
    expect(bin).toBe(OSASCRIPT_BIN);
    expect(args[0]).toBe("-e");
    expect(String(args[1])).toContain("choose folder");
    expect(String(args[1])).toContain("POSIX path of");
    expect(opts?.timeout).toBeGreaterThan(0);
    expect(opts?.encoding).toBe("utf8");
  });

  it("用户取消 → CANCELLED（不假装成功）", () => {
    const err = Object.assign(new Error("User canceled."), {
      status: 1,
      stderr: "execution error: User canceled. (-128)",
    });
    const execFileSync = vi.fn<SyncExecFile>(() => {
      throw err;
    });
    const result = pickFolderMacOS({
      platform: "darwin",
      execFileSync,
    });
    expect(result).toEqual({ ok: false, code: "CANCELLED" });
  });

  it("非 darwin → E_UNSUPPORTED_PLATFORM，且不调用 osascript", () => {
    const execFileSync = vi.fn<SyncExecFile>(() => {
      throw new Error("should not run");
    });
    for (const platform of ["linux", "win32"] as const) {
      const result = pickFolderMacOS({ platform, execFileSync });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("E_UNSUPPORTED_PLATFORM");
      }
    }
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("prompt / 路径转义：双引号与反斜杠被转义", () => {
    expect(escapeAppleScriptString('a"b\\c')).toBe('a\\"b\\\\c');
    const script = buildChooseFolderScript('选 "夹"');
    expect(script).toContain('with prompt "选 \\"夹\\""');
  });

  it("DS1-P4：源码无 electron/tauri 依赖导入；无 Token 明文落盘字面量", () => {
    const src = fs.readFileSync(
      path.resolve("daemon/desktop/macos-folder-picker.ts"),
      "utf8",
    );
    // 允许注释里出现否定措辞；禁止真实依赖导入 / require
    expect(src).not.toMatch(
      /from\s+["']electron["']|require\(["']electron["']\)/i,
    );
    expect(src).not.toMatch(
      /from\s+["'][^"']*tauri[^"']*["']|require\(["'][^"']*tauri[^"']*["']\)/i,
    );
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/\?token=/);
    // 本模块不直接 import child_process（由 server 注入）
    expect(src).not.toMatch(/from\s+["'](node:)?child_process["']/);
  });

  it("空输出 → E_PICK_FOLDER_FAILED", () => {
    const execFileSync = vi.fn<SyncExecFile>(() => "   \n");
    const result = pickFolderMacOS({
      platform: "darwin",
      execFileSync,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("E_PICK_FOLDER_FAILED");
  });
});
