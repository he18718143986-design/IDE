import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import {
  addProtectionEntry,
  closeRound,
  decideApproval,
  ensureRoundStarted,
  guardAgentFileOperation,
  guardAgentWrite,
  loadProtectionList,
  loadRoundState,
  matchProtected,
  protectionMode,
  recommendProtections,
  removeProtectionEntry,
  requestApproval,
  ProtectionStoreError,
} from "../../daemon/protection/protection-list";
import {
  createCheckpoint,
  ensureCheckpoint,
  getCheckpoint,
  undoLatestCheckpoint,
} from "../../daemon/protection/auto-checkpoint";
import { execGit } from "../../daemon/git/worktree-manager";
import { assertIsolatedGitCwd } from "../../daemon/git/test-isolation";

/**
 * TASK-P.1 验收（注入式）：
 * - 4 类绕过（原生写工具 / Shell / 改名删除 / 符号链接）在门卫层全部失败关闭；
 * - 一张卡 + 补充卡、同意仅覆盖清单、拒绝不重复弹、断线/重启持久化；
 * - 整轮快照撤销（含用户手改）；
 * - 清单损坏 → 全拦截（失败关闭）。
 * 运行时真实 CLI 的完整负例属 TASK-W.4。
 */

async function initRepo(): Promise<string> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p1-"));
  // 宿主仓库隔离守卫：临时仓库必须在隔离根内，否则下面的 user.name 写入
  // 可能落到开发者真实仓库的 .git/config（见 daemon/git/test-isolation.ts）
  assertIsolatedGitCwd(repo);
  await execGit(["init", "-b", "main"], repo);
  await execGit(["config", "user.name", "Stagent Test"], repo);
  await execGit(["config", "user.email", "test@stagent.local"], repo);
  fs.mkdirSync(path.join(repo, "src", "auth"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "auth", "login.ts"), "// login\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
  await execGit(["add", "-A"], repo);
  await execGit(["commit", "-m", "chore: init"], repo);
  return repo;
}

describe("TASK-P.1 保护清单与本轮授权", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await initRepo();
  });

  afterEach(() => {
    try {
      safeRmSync(repo);
    } catch {
      // 临时目录清理是尽力而为（与仓库其他测试一致）
    }
  });

  it("加锁后进入保护模式，清单原子落盘；解锁后回到自由模式", () => {
    expect(protectionMode(repo)).toBe("VIBE");
    const entry = addProtectionEntry(repo, "登录", ["src/auth/**"]);
    expect(fs.existsSync(path.join(repo, ".stagent", "protection.json"))).toBe(
      true,
    );
    expect(protectionMode(repo)).toBe("PROTECTED");
    expect(loadProtectionList(repo).entries.map((e) => e.id)).toContain(
      entry.id,
    );
    expect(removeProtectionEntry(repo, entry.id)).toBe(true);
    expect(protectionMode(repo)).toBe("VIBE");
  });

  it("清单损坏时按全部拦截处理（失败关闭），绝不静默当空清单", () => {
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      "{not-json",
    );
    expect(() => matchProtected(repo, "src/auth/login.ts")).toThrow(
      ProtectionStoreError,
    );
    const gate = guardAgentWrite(repo, "src/anything.ts");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("按拒绝处理");
  });

  it("保护清单自身恒受保护（自锁），任何 Agent 写通道都改不了", () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    const gate = guardAgentWrite(repo, ".stagent/protection.json");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("只能在 Stagent 界面里修改");
  });

  it("首次导入推荐：按目录/文件名规则扫描，零模型调用", () => {
    fs.mkdirSync(path.join(repo, "src", "payment"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".env"), "SECRET=1\n");
    const recs = recommendProtections(repo);
    const names = recs.map((r) => r.name);
    expect(names).toContain("登录");
    expect(names).toContain("支付");
    expect(names).toContain("密码和密钥");
    const login = recs.find((r) => r.name === "登录");
    expect(login?.patterns).toContain("src/auth/**");
  });

  it("注入式 4 类绕过：原生写 / Shell / 改名删除 / 符号链接全部失败关闭", () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    ensureRoundStarted(repo, "test");

    // 1. AI 自带写文件工具直写
    const native = guardAgentFileOperation(repo, "src/auth/login.ts");
    expect(native.allowed).toBe(false);
    expect(native.cardId).toBeTruthy();

    // 2. Shell 改写（命令行写入同一路径）
    const shell = guardAgentFileOperation(repo, "src/auth/login.ts");
    expect(shell.allowed).toBe(false);

    // 3. 改名 / 删除（含整目录改名）
    const del = guardAgentFileOperation(repo, "src/auth/login.ts");
    expect(del.allowed).toBe(false);
    const dirRename = guardAgentFileOperation(repo, "src/auth");
    expect(dirRename.allowed).toBe(false);

    // 4. 符号链接指向保护区（真实路径判定）
    fs.symlinkSync(
      path.join(repo, "src", "auth"),
      path.join(repo, "alias-auth"),
      "dir",
    );
    const viaLink = guardAgentFileOperation(repo, "alias-auth/login.ts");
    expect(viaLink.allowed).toBe(false);
    expect(viaLink.entryName).toBe("登录");

    // 逃逸出仓库的路径同样拒绝
    const escape = guardAgentFileOperation(repo, "../outside.ts");
    expect(escape.allowed).toBe(false);
  });

  it("一张卡列全部；同意只放行卡上文件，清单外再弹补充卡；同轮不重复问", () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    fs.mkdirSync(path.join(repo, "src", "auth2"), { recursive: true });
    ensureRoundStarted(repo, "test");

    const g1 = guardAgentFileOperation(repo, "src/auth/login.ts");
    expect(g1.allowed).toBe(false);
    const card = loadRoundState(repo).pending[0]!;
    expect(card.files).toEqual(["src/auth/login.ts"]);

    // 第二个受保护文件并入同一张卡（不是第二张）
    const g2 = guardAgentFileOperation(repo, "src/auth/session.ts");
    expect(g2.allowed).toBe(false);
    const state = loadRoundState(repo);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]!.files).toEqual([
      "src/auth/login.ts",
      "src/auth/session.ts",
    ]);

    // 同意 → 卡上两个文件本轮放行，且不再弹卡
    decideApproval(repo, card.id, "approve");
    expect(guardAgentFileOperation(repo, "src/auth/login.ts").allowed).toBe(
      true,
    );
    expect(guardAgentFileOperation(repo, "src/auth/session.ts").allowed).toBe(
      true,
    );
    expect(loadRoundState(repo).pending).toHaveLength(0);

    // 清单内的新文件（未在卡上）→ 补充卡，仍拒绝
    const supplement = guardAgentFileOperation(repo, "src/auth/oauth.ts");
    expect(supplement.allowed).toBe(false);
    expect(loadRoundState(repo).pending).toHaveLength(1);
  });

  it("不同意 → 本轮直接拒，不重复弹卡", () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    ensureRoundStarted(repo, "test");
    guardAgentFileOperation(repo, "src/auth/login.ts");
    const card = loadRoundState(repo).pending[0]!;
    decideApproval(repo, card.id, "deny");
    const again = guardAgentFileOperation(repo, "src/auth/login.ts");
    expect(again.allowed).toBe(false);
    expect(again.reason).toContain("已被你拒绝");
    expect(loadRoundState(repo).pending).toHaveLength(0);
  });

  it("待审批卡持久化：断线/重启（重新读盘）后仍在，永不自动放行", () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    ensureRoundStarted(repo, "test");
    requestApproval(repo, ["src/auth/login.ts"], ["登录"]);
    // 模拟 Daemon 重启：直接读磁盘状态
    const onDisk = JSON.parse(
      fs.readFileSync(
        path.join(repo, ".stagent", "protection-state.json"),
        "utf8",
      ),
    ) as { pending: Array<{ files: string[] }> };
    expect(onDisk.pending).toHaveLength(1);
    expect(onDisk.pending[0]!.files).toEqual(["src/auth/login.ts"]);
    // 没有授权记录时门卫仍然拒绝
    expect(guardAgentFileOperation(repo, "src/auth/login.ts").allowed).toBe(
      false,
    );
  });

});

describe("TASK-P.1 Auto-Checkpoint 与整轮撤销", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await initRepo();
  });

  afterEach(() => {
    try {
      safeRmSync(repo);
    } catch {
      // 临时目录清理是尽力而为（与仓库其他测试一致）
    }
  });

  it("撤销整轮：恢复已跟踪文件（含用户手改），删除本轮新建文件", async () => {
    ensureRoundStarted(repo, "chat");
    const cp = await createCheckpoint(repo, loadRoundState(repo).roundId);
    expect(cp.headCommit).toBeTruthy();

    // 本轮：AI 改登录文件、用户手改 README、AI 新建文件
    fs.writeFileSync(path.join(repo, "src", "auth", "login.ts"), "// ai\n");
    fs.writeFileSync(path.join(repo, "README.md"), "# 用户手改\n");
    fs.writeFileSync(path.join(repo, "new-page.tsx"), "export {};\n");

    const result = await undoLatestCheckpoint(repo);
    expect(result.undone).toBe(true);
    expect(
      fs.readFileSync(path.join(repo, "src", "auth", "login.ts"), "utf8"),
    ).toBe("// login\n");
    // 用户手改也被撤回（v0.1 定稿：整轮回退）
    expect(fs.readFileSync(path.join(repo, "README.md"), "utf8")).toBe(
      "# demo\n",
    );
    expect(fs.existsSync(path.join(repo, "new-page.tsx"))).toBe(false);
    expect(result.deletedFiles).toContain("new-page.tsx");
  });

  it("撤销后本轮关闭：授权作废、快照清除，下一轮重新问", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    ensureRoundStarted(repo, "chat");
    await ensureCheckpoint(repo);
    guardAgentFileOperation(repo, "src/auth/login.ts");
    const card = loadRoundState(repo).pending[0]!;
    decideApproval(repo, card.id, "approve");
    await undoLatestCheckpoint(repo);
    expect(getCheckpoint(repo)).toBeNull();
    // 下一轮：同一个文件需要重新弹卡
    ensureRoundStarted(repo, "chat");
    const again = guardAgentFileOperation(repo, "src/auth/login.ts");
    expect(again.allowed).toBe(false);
    expect(again.cardId).toBeTruthy();
  });

  it("快照可重复获取；没有快照时撤销给出白话提示", async () => {
    ensureRoundStarted(repo, "chat");
    const a = await ensureCheckpoint(repo);
    const b = await ensureCheckpoint(repo);
    expect(b.at).toBe(a.at);
    const res = await undoLatestCheckpoint(repo);
    expect(res.undone).toBe(true);
    const none = await undoLatestCheckpoint(repo);
    expect(none.undone).toBe(false);
    expect(none.reason).toContain("没有可撤销");
  });

  it("静默合同：本轮开始/快照/决策/关闭都有后台备案（前端无感）", async () => {
    addProtectionEntry(repo, "登录", ["src/auth/**"]);
    ensureRoundStarted(repo, "chat");
    await ensureCheckpoint(repo);
    guardAgentFileOperation(repo, "src/auth/login.ts");
    const card = loadRoundState(repo).pending[0]!;
    decideApproval(repo, card.id, "deny");
    closeRound(repo, "DISCARDED");
    const log = fs
      .readFileSync(
        path.join(repo, ".stagent", "silent-contracts.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind: string });
    const kinds = log.map((l) => l.kind);
    expect(kinds).toContain("round_start");
    expect(kinds).toContain("checkpoint");
    expect(kinds).toContain("approval_decision");
    expect(kinds).toContain("round_close");
  });
});
