import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureGitInit,
  ensureUsableMainRefSync,
} from "../../daemon/git/ensure-git-repo";
import { safeRmSync } from "../helpers/tmp";

/**
 * TASK-J.24 缺口 2 验收测试：空仓库无 main ref 问题修复。
 *
 * 验证：
 * 1. 确认初始化后生成合法的 refs/heads/main；
 * 2. 空仓内已有未跟踪文件（.env、secret 等）不被意外暂存与提交；
 * 3. 基于 main 的 git worktree add 能够立即成功；
 * 4. 幂等性：已有提交或已有 main 时不重复建提交。
 */

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j24-main-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

describe("TASK-J.24 缺口 2：空目录初始化与可用 main ref", () => {
  it("T-J24-EMPTY-001 确认初始化后自动建立 main ref 并支持创建 worktree", () => {
    const root = makeTmpDir();
    const res = ensureGitInit(root, { confirm: true });

    expect(res.ok).toBe(true);
    expect(res.initialized).toBe(true);
    expect(res.main_created).toBe(true);

    const mainRev = execFileSync(
      "git",
      ["rev-parse", "--verify", "refs/heads/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    expect(mainRev).toMatch(/^[0-9a-f]{40}$/);

    const wtDir = makeTmpDir();
    expect(() => {
      execFileSync(
        "git",
        ["worktree", "add", "-b", "task-wt-1", wtDir, "main"],
        { cwd: root, stdio: "pipe" },
      );
    }).not.toThrow();

    expect(fs.existsSync(path.join(wtDir, ".git"))).toBe(true);
  });

  it("T-J24-EMPTY-002 空提交绝不包含主工作区现有未跟踪文件", () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "secret.txt"), "SECRET_TOKEN=xyz\n");
    fs.writeFileSync(path.join(root, "app.ts"), "console.log('hello');\n");

    const res = ensureGitInit(root, { confirm: true });
    expect(res.ok).toBe(true);
    expect(res.initialized).toBe(true);

    const committedFiles = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    expect(committedFiles).toBe("");

    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(status).toContain("?? secret.txt");
    expect(status).toContain("?? app.ts");
  });

  it("T-J24-EMPTY-003 已有无提交的 .git 时补充 main ref 且调用幂等", () => {
    const root = makeTmpDir();
    execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });

    // 此时尚无任何 commit
    expect(() => {
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: root,
        stdio: "pipe",
      });
    }).toThrow();

    const first = ensureGitInit(root, { confirm: true });
    expect(first.ok).toBe(true);
    expect(first.skipped).toBe(true);
    expect(first.main_created).toBe(true);

    const head1 = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    // 再次调用，幂等且不追加新 commit
    const second = ensureGitInit(root, { confirm: true });
    expect(second.ok).toBe(true);
    expect(second.main_created).toBeUndefined();

    const head2 = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    expect(head2).toBe(head1);
  });

  it("T-J24-EMPTY-004 已有历史提交但无 main 分支时自动补齐 main 指向当前 HEAD", () => {
    const root = makeTmpDir();
    execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Tester",
        "-c",
        "user.email=tester@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "existing commit on master",
      ],
      { cwd: root, stdio: "pipe" },
    );
    // 重命名当前分支为 master（模拟旧版本 Git 默认分支名）
    execFileSync("git", ["branch", "-M", "master"], {
      cwd: root,
      stdio: "pipe",
    });

    const masterRev = execFileSync("git", ["rev-parse", "master"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    const created = ensureUsableMainRefSync(root);
    expect(created).toBe(true);

    const mainRev = execFileSync("git", ["rev-parse", "main"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    expect(mainRev).toBe(masterRev);
  });
});
