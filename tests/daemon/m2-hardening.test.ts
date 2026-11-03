import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 清理尽力而为：沙箱安全策略可能拒绝删除临时目录，不影响断言 */
function safeRm(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  runCommand,
  redactSecrets,
  KILL_GRACE_MS,
} from "../../daemon/runner/command-runner";
import { LoopGuard } from "../../daemon/guard/loop-guard";
import { CostMonitor } from "../../daemon/guard/cost-monitor";
import { buildBreakerOutcome } from "../../daemon/guard/state-store";
import {
  createTaskWorktree,
  inspectMainWorktree,
  DirtyWorktreeConfirmationRequiredError,
} from "../../daemon/git/worktree-manager";
import { createContractDraft } from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

describe("M2 / TASK-A.2 stagent_read_file 大小与二进制保护", () => {
  let root: string;
  let gateway: ScopedWorktreeGateway;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m2-read-"));
    // 1.5 MiB 文本 + 二进制文件
    fs.writeFileSync(path.join(root, "big.txt"), "a".repeat(1.5 * 1024 * 1024));
    fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 3, 0]));

    const contract = createContractDraft({
      title: "read protection",
      description: "x",
      acceptanceCriteria: ["y"],
      writablePaths: ["src/**"],
      readonlyPaths: ["big.txt", "blob.bin"],
    });
    gateway = new ScopedWorktreeGateway(root, contract);
  });

  afterEach(() => {
    try {
      safeRm(root);
    } catch {
      // 沙箱环境可能拒绝删除临时目录：清理尽力而为，不影响断言
    }
  });

  it("超过 1 MiB 的文本被截断并标记 truncated", async () => {
    const res = await gateway.callTool("stagent_read_file", {
      path: "big.txt",
    });
    expect(res.isError).toBe(false);
    const data = res.data as {
      truncated: boolean;
      binary: boolean;
      size_bytes: number;
    };
    expect(data.truncated).toBe(true);
    expect(data.binary).toBe(false);
    expect(data.size_bytes).toBe(1.5 * 1024 * 1024);
    expect(res.content[0]?.text).toContain("truncated at 1048576");
  });

  it("二进制文件仅返回元数据与哈希，不做文本解码", async () => {
    const res = await gateway.callTool("stagent_read_file", {
      path: "blob.bin",
    });
    expect(res.isError).toBe(false);
    const data = res.data as {
      truncated: boolean;
      binary: boolean;
      sha256: string;
    };
    expect(data.binary).toBe(true);
    expect(data.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.content[0]?.text).not.toContain("\u0000");
  });
});

describe("M2 / TASK-A.2 stagent_declare_complete", () => {
  let root: string;
  let contract: ReturnType<typeof createContractDraft>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m2-declare-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    contract = createContractDraft({
      title: "declare complete",
      description: "x",
      acceptanceCriteria: ["y"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "ok",
          executable: "node",
          args: ["-e", "console.log('ok')"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
  });

  afterEach(() => {
    try {
      safeRm(root);
    } catch {
      // 沙箱环境可能拒绝删除临时目录：清理尽力而为，不影响断言
    }
  });

  it("暴露 7 个受控工具（W.2 delete_file + L.17a web_ingest）", () => {
    const gateway = new ScopedWorktreeGateway(root, contract);
    const names = gateway.getToolDefinitions().map((t) => t.name);
    expect(names).toContain("stagent_declare_complete");
    expect(names).toContain("stagent_delete_file");
    expect(names).toContain("stagent_web_ingest");
    expect(names).toHaveLength(7);
  });

  it("未运行验证时返回 VERIFICATION_NOT_RUN blocker", async () => {
    const gateway = new ScopedWorktreeGateway(root, contract);
    const res = await gateway.callTool("stagent_declare_complete", {});
    const data = res.data as {
      ready_for_audit: boolean;
      blockers: Array<{ code: string }>;
    };
    expect(data.ready_for_audit).toBe(false);
    expect(data.blockers.map((b) => b.code)).toContain("VERIFICATION_NOT_RUN");
  });

  it("越权 touched_paths 返回 SCOPE 违规 blocker", async () => {
    const gateway = new ScopedWorktreeGateway(root, contract);
    const res = await gateway.callTool("stagent_declare_complete", {
      touched_paths: ["../outside.ts"],
    });
    const data = res.data as {
      ready_for_audit: boolean;
      blockers: Array<{ code: string }>;
    };
    expect(data.ready_for_audit).toBe(false);
    expect(data.blockers.length).toBeGreaterThan(0);
  });

  it("验证通过且范围合规时 ready_for_audit=true", async () => {
    const loopGuard = new LoopGuard({ maxRetries: 3 });
    const gateway = new ScopedWorktreeGateway(root, contract, { loopGuard });
    await gateway.callTool("stagent_write_file", {
      path: "src/index.ts",
      content: "export const ok = true;",
    });
    const cmd = [
      contract.verification_spec.commands[0]?.executable,
      ...(contract.verification_spec.commands[0]?.args ?? []),
    ].join(" ");
    const execRes = await gateway.callTool(
      "stagent_exec_command",
      { command: cmd },
      { internal: true },
    );
    expect(execRes.isError).toBe(false);

    const res = await gateway.callTool("stagent_declare_complete", {});
    const data = res.data as { ready_for_audit: boolean; blockers: unknown[] };
    expect(data.ready_for_audit).toBe(true);
    expect(data.blockers).toHaveLength(0);
  });
});

describe("M2 / TASK-A.4 输出脱敏、截断与网络策略", () => {
  it("先脱敏后截断，并返回 secretRedacted/truncated 标志", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m2-run-"));
    try {
      const script =
        "process.stdout.write('API_KEY=supersecretvalue123\\n' + 'x'.repeat(200))";
      const res = await runCommand(`node -e "${script}"`, {
        cwd,
        maxOutputChars: 100,
        networkPolicy: "DENY",
      });
      expect(res.secretRedacted).toBe(true);
      expect(res.stdout).toContain("API_KEY=[REDACTED]");
      expect(res.stdout).not.toContain("supersecretvalue123");
      expect(res.truncated).toBe(true);
      // DENY 策略注入离线环境变量
      expect(res.sanitizedEnvKeys).toContain("HTTP_PROXY");
      expect(res.sanitizedEnvKeys).toContain("npm_config_offline");
    } finally {
      safeRm(cwd);
    }
  });

  it("脱敏规则覆盖常见凭据格式", () => {
    const { text, redacted } = redactSecrets(
      "token=ghp_abcdefghijklmnopqrstuvwxyz0123 sk-abcdefghijklmnopqrstuv",
    );
    expect(redacted).toBe(true);
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123");
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuv");
  });

  it("SIGTERM→SIGKILL 宽限为 3s", () => {
    expect(KILL_GRACE_MS).toBe(3000);
  });
});

describe("M2 / TASK-A.5 熔断持久化与状态联动", () => {
  it("LoopGuard 重启后计数不重置", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m2-loop-"));
    const statePath = path.join(dir, ".stagent", "loop.json");
    try {
      const first = new LoopGuard({ maxRetries: 3, statePath });
      first.recordAttempt({ passed: false, exitCode: 1 });
      first.recordAttempt({ passed: false, exitCode: 1 });

      const second = new LoopGuard({ maxRetries: 3, statePath });
      expect(second.getConsecutiveFailures()).toBe(2);
      second.recordAttempt({ passed: false, exitCode: 1 });
      expect(second.isTripped()).toBe(true);

      const third = new LoopGuard({ maxRetries: 3, statePath });
      expect(third.isTripped()).toBe(true);
    } finally {
      safeRm(dir);
    }
  });

  it("CostMonitor 重启后累计费用不重置，并按最小货币单位判定", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m2-cost-"));
    const statePath = path.join(dir, ".stagent", "cost.json");
    try {
      const first = new CostMonitor({
        maxCostMinorUnits: 150,
        currency: "CNY",
        statePath,
      });
      first.recordUsage(1000, 1000, 1.0); // 100 minor units
      expect(first.isTripped()).toBe(false);

      const second = new CostMonitor({
        maxCostMinorUnits: 150,
        currency: "CNY",
        statePath,
      });
      expect(second.getTotals().totalCostMinorUnits).toBe(100);
      second.recordUsage(1000, 1000, 1.0); // 200 > 150
      expect(second.isTripped()).toBe(true);
    } finally {
      safeRm(dir);
    }
  });

  it("熔断结果映射到 PENDING_RESUME + BLOCKED + 规范原因码", () => {
    expect(buildBreakerOutcome("budget")).toMatchObject({
      lifecycle_state: "PENDING_RESUME",
      verdict: "BLOCKED",
      reason_code: "BUDGET_EXHAUSTED",
      error_code: "E_BUDGET_EXCEEDED",
    });
    expect(buildBreakerOutcome("retry")).toMatchObject({
      reason_code: "VERIFICATION_RETRY_LIMIT",
      error_code: "E_RETRY_LIMIT_EXCEEDED",
    });
  });
});

describe("M2 / TASK-A.1 脏工作区确认", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-m2-dirty-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    safeRm(repo);
  });

  it("检测脏工作区并给出文件清单与警告", async () => {
    fs.writeFileSync(path.join(repo, "dirty.txt"), "uncommitted");
    const inspection = await inspectMainWorktree(repo);
    expect(inspection.clean).toBe(false);
    expect(inspection.files).toContain("dirty.txt");
    expect(inspection.warning).toContain("不会包含在任务 Worktree 中");
  });

  it("未确认时拒绝创建，确认后创建且不复制脏文件", async () => {
    fs.writeFileSync(path.join(repo, "dirty.txt"), "uncommitted");

    await expect(
      createTaskWorktree({ repoRoot: repo, contractId: "c-dirty" }),
    ).rejects.toBeInstanceOf(DirtyWorktreeConfirmationRequiredError);

    const info = await createTaskWorktree({
      repoRoot: repo,
      contractId: "c-dirty",
      acknowledgeDirty: true,
    });
    expect(info.warnings.length).toBe(1);
    expect(fs.existsSync(path.join(info.worktreePath, "dirty.txt"))).toBe(
      false,
    );
  });
});
