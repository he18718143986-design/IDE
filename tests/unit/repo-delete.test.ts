import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteRepoPath,
  tryMoveToTrash,
} from "../../daemon/editor/repo-delete";
import { deleteMenuLabel } from "../../src/lib/file-tree-delete";
import {
  addProtectionEntry,
  saveProtectionList,
} from "../../daemon/protection/protection-list";

describe("deleteRepoPath (TASK-C.10h)", () => {
  let root: string;
  afterEach(() => {
    safeRmSync(root);
  });

  function makeRepo(): string {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-repo-del-")),
    );
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, "keep.md"), "x\n");
    return root;
  }

  it("注入废纸篓替身 → method=trash，盘上文件消失", () => {
    const repo = makeRepo();
    const trashed: string[] = [];
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "src/a.ts",
      // 替身：搬到自己记的数组里，绝不碰真实 ~/.Trash（见下一条回归用例）
      moveToTrash: (abs) => {
        trashed.push(abs);
        fs.rmSync(abs, { force: true });
        return true;
      },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.method).toBe("trash");
    expect(out.message).toMatch(/废纸篓/);
    expect(trashed).toEqual([path.join(repo, "src", "a.ts")]);
    expect(fs.existsSync(path.join(repo, "src", "a.ts"))).toBe(false);
  });

  it("防回归：测试环境下默认实现绝不调用真实废纸篓", () => {
    // 历史事故：用例调 deleteRepoPath 时夹具被 /usr/bin/trash 搬进用户真实废纸篓，
    // 累积数千条并污染回收站。默认 tryMoveToTrash 在 VITEST 下必须直接放弃，
    // 让流程回退到 unlink（只在本用例自己的临时目录里删）。
    const repo = makeRepo();
    // 传一个不存在的路径：即使将来闸门被人删掉，也绝不会把任何真实文件送进废纸篓
    const probe = path.join(repo, "not-a-real-file.md");

    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "src/a.ts",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.method).toBe("unlink");
    expect(out.message).toMatch(/永久删除/);
    expect(fs.existsSync(path.join(repo, "src", "a.ts"))).toBe(false);
    // 兜底闸门本身也必须拒绝，避免将来有人绕过 deleteRepoPath 直接调它
    expect(tryMoveToTrash(probe)).toBe(false);
  });

  it("保护清单命中 → 拒绝 + 白话，文件仍在", () => {
    const repo = makeRepo();
    saveProtectionList(repo, { version: 1, entries: [] });
    addProtectionEntry(repo, "登录", ["src/**"]);
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "src/a.ts",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("PROTECTED_PATH");
    expect(out.message).toMatch(/保护清单|登录/);
    expect(fs.existsSync(path.join(repo, "src", "a.ts"))).toBe(true);
  });

  it("系统目录拒绝", () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".stagent", "x.json"), "{}\n");
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: ".stagent/x.json",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("E_SYSTEM_PATH");
  });

  it("路径穿越拒绝", () => {
    const repo = makeRepo();
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "../outside",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("PATH_TRAVERSAL_DETECTED");
  });

  it("菜单文案：Mac 说废纸篓，其它说删除", () => {
    expect(deleteMenuLabel("MacIntel")).toMatch(/废纸篓/);
    expect(deleteMenuLabel("Linux x86_64")).toMatch(/删除/);
  });
});
