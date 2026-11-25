import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import {
  ensureAllowedCommand,
  packageLocalStagentBin,
  packageLocalTsxPath,
  resolveStagentCli,
  resolvedCommandString,
  stagentPackageRootFromModuleUrl,
} from "../../daemon/cli-host/resolve-stagent-cli";
import {
  E_COMMAND_FAILED,
  E_COMMAND_NOT_RESOLVED,
  E_COMMAND_SPAWN_FAILED,
  evaluateIllumination,
} from "../../daemon/graph/illumination-verifier";
import {
  VERIFY_COMMAND_SNIPPET_MAX,
  VERIFY_COMMAND_SNIPPET_MIN_LENGTH,
  buildCommandOutputSnippet,
  buildVerifyCommandLogDetail,
} from "../../daemon/graph/verify-command-snippet";
import { appendDaemonLog, daemonLogPath } from "../../daemon/core/debug-log";
import {
  WORKER_PARSE_FAILURE_SNIPPET_MAX,
  WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH,
} from "../../daemon/worker/parse-worker-output";
import type { TaskNode } from "../../src/lib/graph/task-graph";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      safeRmSync(dir);
    } catch {
      // ignore: sandbox policy may block recursive deletion
    }
  }
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function commandNode(aliases: string[] = ["baseline-gate"]): TaskNode {
  return {
    node_id: "n1",
    title: "示例",
    kind: "CODE_MODIFICATION",
    depends_on: [],
    functional_area: "auth",
    target_files: ["src/auth.ts"],
    verification_mode: "COMMAND",
    verification_commands: aliases,
    state: "RUNNING",
    executed_at: null,
    commit_sha: null,
  };
}

function evaluateCommands(
  results: Parameters<typeof evaluateIllumination>[0]["command_results"],
) {
  const node = commandNode(results.map((result) => result.alias));
  return evaluateIllumination({
    node,
    files_written: ["src/auth.ts"],
    file_hashes: { "src/auth.ts": "sha256-src/auth.ts" },
    scope_valid: true,
    command_results: results,
    commit_sha: "c0ffee1234567890",
    now: "2026-11-25T12:00:00.000Z",
  });
}

function fixturePackageRoot(options: {
  withTsx?: boolean;
  withBin?: boolean;
}): string {
  const root = tmpDir("stagent-j59-pkg-");
  if (options.withTsx !== false) {
    const tsxDir = path.join(root, "node_modules", "tsx", "dist");
    fs.mkdirSync(tsxDir, { recursive: true });
    fs.writeFileSync(path.join(tsxDir, "cli.mjs"), "// fixture tsx\n");
  }
  if (options.withBin !== false) {
    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "stagent.ts"), "// fixture bin\n");
  }
  return root;
}

describe("J59-R1 / J59-P1: stagent 解析为当前 Daemon 入口", () => {
  it("J59-R1: executable 为 stagent 时解析为 process.execPath + tsx + 包内 bin/stagent.ts，args 保持 check baseline-gate --id …", () => {
    const packageRoot = fixturePackageRoot({});
    const args = ["check", "baseline-gate", "--id", "no-unused-forbidden"];
    const resolved = resolveStagentCli({
      executable: "stagent",
      args,
      packageRoot,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.executable).toBe(process.execPath);
    expect(resolved.args).toEqual([
      packageLocalTsxPath(packageRoot),
      packageLocalStagentBin(packageRoot),
      "check",
      "baseline-gate",
      "--id",
      "no-unused-forbidden",
    ]);
    expect(resolved.args.slice(2)).toEqual(args);
  });

  it("包根公式与 baseline-gates.ts 的 dirname(import.meta.url)/../.. 同源", () => {
    const packageRoot = stagentPackageRootFromModuleUrl();
    const guardPath = path.join(packageRoot, "daemon/guard/baseline-gates.ts");
    const hostPath = path.join(
      packageRoot,
      "daemon/cli-host/resolve-stagent-cli.ts",
    );
    const fromGuard = path.resolve(path.dirname(guardPath), "../..");
    const fromHost = path.resolve(path.dirname(hostPath), "../..");
    expect(fromGuard).toBe(fromHost);
    expect(fromGuard).toBe(packageRoot);
    expect(fs.existsSync(packageLocalStagentBin(packageRoot))).toBe(true);
  });
});

describe("J59-R3: 非 stagent 不改写", () => {
  it("J59-R3: executable 不是 stagent 时原样返回，不改写", () => {
    const resolved = resolveStagentCli({
      executable: "npm",
      args: ["test"],
    });
    expect(resolved).toEqual({
      ok: true,
      executable: "npm",
      args: ["test"],
    });
  });
});

describe("J59-R2 / J59-P3: 解析失败不给出可 spawn 的 argv", () => {
  it("J59-R2: 缺 bin/stagent.ts 时返回 missing_bin，不给出可 spawn 的 argv", () => {
    const packageRoot = fixturePackageRoot({ withBin: false });
    const resolved = resolveStagentCli({
      executable: "stagent",
      args: ["check", "baseline-gate", "--id", "x"],
      packageRoot,
    });
    expect(resolved).toEqual({ ok: false, reason: "missing_bin" });
    expect("executable" in resolved).toBe(false);
    expect("args" in resolved).toBe(false);
  });

  it("J59-R2: 缺 tsx 时返回 missing_tsx，不给出可 spawn 的 argv", () => {
    const packageRoot = fixturePackageRoot({ withTsx: false });
    const resolved = resolveStagentCli({
      executable: "stagent",
      args: ["check", "baseline-gate", "--id", "x"],
      packageRoot,
    });
    expect(resolved).toEqual({ ok: false, reason: "missing_tsx" });
    expect("executable" in resolved).toBe(false);
  });

  it("J59-R2: 缺 execPath 时返回 missing_exec_path，不给出可 spawn 的 argv", () => {
    const packageRoot = fixturePackageRoot({});
    const resolved = resolveStagentCli({
      executable: "stagent",
      args: ["check", "baseline-gate", "--id", "x"],
      packageRoot,
      execPath: "",
    });
    expect(resolved).toEqual({ ok: false, reason: "missing_exec_path" });
    expect("executable" in resolved).toBe(false);
  });
});

describe("J59-P2: 已解析命令串加入白名单", () => {
  it("J59-P2: 已解析命令串加入该别名白名单，改写本身不触发 E_UNAUTHORIZED_COMMAND", () => {
    const packageRoot = fixturePackageRoot({});
    const args = ["check", "baseline-gate", "--id", "no-unused-forbidden"];
    const contractCommand = ["stagent", ...args].join(" ").trim();
    const resolved = resolveStagentCli({
      executable: "stagent",
      args,
      packageRoot,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const rewritten = resolvedCommandString(resolved);
    const allowedCommands = [contractCommand];
    expect(allowedCommands.includes(rewritten)).toBe(false);
    ensureAllowedCommand(allowedCommands, rewritten);
    expect(allowedCommands).toContain(rewritten);
    const trimmedCmd = [resolved.executable, ...resolved.args].join(" ");
    const isWhitelisted = allowedCommands.some(
      (allowed) => trimmedCmd === allowed.trim(),
    );
    expect(isWhitelisted).toBe(true);
  });
});

describe("J59-O4 / J59-P3 / J59-P4: 独立错误码可区分，不记假 exit 1", () => {
  it("J59-O4: 解析失败记为 E_COMMAND_NOT_RESOLVED，不记成 exit 1，白话锁定", () => {
    const result = evaluateCommands([
      {
        alias: "no-unused-forbidden",
        error: E_COMMAND_NOT_RESOLVED,
        reason: "missing_bin",
      },
    ]);
    expect(result.illuminated).toBe(false);
    if (result.illuminated) return;
    expect(result.code).toBe(E_COMMAND_NOT_RESOLVED);
    expect(result.code).not.toBe(E_COMMAND_FAILED);
    expect(result.message).toBe(
      "节点 n1 的验证命令无法解析到当前 Daemon 入口: no-unused-forbidden（missing_bin）",
    );
    expect(result.message).not.toContain("验证命令未通过");
    expect(result.message).not.toContain("exit 1");
  });

  it("J59-O4: spawn ENOENT 记为 E_COMMAND_SPAWN_FAILED，与检查体 exit 1 的 E_COMMAND_FAILED（白话不变）可区分", () => {
    const spawnResult = evaluateCommands([
      {
        alias: "no-unused-forbidden",
        error: E_COMMAND_SPAWN_FAILED,
        spawn_code: "ENOENT",
      },
    ]);
    expect(spawnResult.illuminated).toBe(false);
    if (spawnResult.illuminated) return;
    expect(spawnResult.code).toBe(E_COMMAND_SPAWN_FAILED);
    expect(spawnResult.message).toBe(
      "节点 n1 的验证命令无法启动: no-unused-forbidden(ENOENT)",
    );

    const bodyFailed = evaluateCommands([
      { alias: "no-unused-forbidden", exit_code: 1 },
    ]);
    expect(bodyFailed.illuminated).toBe(false);
    if (bodyFailed.illuminated) return;
    expect(bodyFailed.code).toBe(E_COMMAND_FAILED);
    expect(bodyFailed.message).toBe(
      "节点 n1 的验证命令未通过: no-unused-forbidden(exit 1)",
    );

    expect(spawnResult.code).not.toBe(bodyFailed.code);
    expect(
      new Set([
        E_COMMAND_NOT_RESOLVED,
        E_COMMAND_SPAWN_FAILED,
        E_COMMAND_FAILED,
      ]).size,
    ).toBe(3);
  });

  it("判定顺序：先未解析，再启动失败，最后才是检查体非零", () => {
    const mixed = evaluateCommands([
      { alias: "a", exit_code: 1 },
      {
        alias: "b",
        error: E_COMMAND_SPAWN_FAILED,
        spawn_code: "EACCES",
      },
      {
        alias: "c",
        error: E_COMMAND_NOT_RESOLVED,
        reason: "missing_tsx",
      },
    ]);
    expect(mixed.illuminated).toBe(false);
    if (mixed.illuminated) return;
    expect(mixed.code).toBe(E_COMMAND_NOT_RESOLVED);
    expect(mixed.message).toContain("无法解析到当前 Daemon 入口");

    const spawnThenBody = evaluateCommands([
      { alias: "a", exit_code: 1 },
      {
        alias: "b",
        error: E_COMMAND_SPAWN_FAILED,
        spawn_code: "ENOENT",
      },
    ]);
    expect(spawnThenBody.illuminated).toBe(false);
    if (spawnThenBody.illuminated) return;
    expect(spawnThenBody.code).toBe(E_COMMAND_SPAWN_FAILED);
  });
});

describe("J59-P5 / J59-O1 / J59-O2 / J59-O3: 片段口径与脱敏", () => {
  it("常量与 J.56 的 40/80 相等", () => {
    expect(VERIFY_COMMAND_SNIPPET_MAX).toBe(40);
    expect(VERIFY_COMMAND_SNIPPET_MIN_LENGTH).toBe(80);
    expect(VERIFY_COMMAND_SNIPPET_MAX).toBe(WORKER_PARSE_FAILURE_SNIPPET_MAX);
    expect(VERIFY_COMMAND_SNIPPET_MIN_LENGTH).toBe(
      WORKER_PARSE_FAILURE_SNIPPET_MIN_LENGTH,
    );
  });

  it("J59-O1: 长度大于 80 的 stdout/stderr 各写最多 40 字符的 head/tail，中段不出现，无 text/raw/full，不把原文写入 message", () => {
    const mid = "MIDDLE_SEGMENT_MUST_NOT_APPEAR";
    const stdout = `${"H".repeat(40)}${mid}${"T".repeat(40)}X`;
    expect(stdout.length).toBeGreaterThan(80);
    const snippet = buildCommandOutputSnippet(stdout);
    expect(snippet.head).toBe("H".repeat(40));
    expect(snippet.tail).toBe(`${"T".repeat(39)}X`);
    expect(snippet.head?.length).toBeLessThanOrEqual(40);
    expect(snippet.tail?.length).toBeLessThanOrEqual(40);
    expect(`${snippet.head ?? ""}${snippet.tail ?? ""}`).not.toContain(mid);
    const detail = buildVerifyCommandLogDetail({
      alias: "no-unused-forbidden",
      stdout,
      stderr: stdout,
      includeSnippets: true,
      exit_code: 1,
    });
    expect(detail).not.toHaveProperty("text");
    expect(detail).not.toHaveProperty("raw");
    expect(detail).not.toHaveProperty("full");
    expect(JSON.stringify(detail)).not.toContain(mid);
    const blocked = evaluateCommands([
      { alias: "no-unused-forbidden", exit_code: 1 },
    ]);
    if (!blocked.illuminated) {
      expect(blocked.message).not.toContain(stdout);
      expect(blocked.message).not.toContain(mid);
    }
  });

  it("J59-O2: 片段中的 sk- / Bearer / api_key= 被脱敏", () => {
    const raw =
      "Bearer supersecret-token-value " +
      "api_key=abcdEFGHijklMNOP " +
      "sk-abcdefghijklmnop " +
      "X".repeat(80);
    const snippet = buildCommandOutputSnippet(raw);
    const blob = `${snippet.head ?? ""}${snippet.tail ?? ""}`;
    expect(blob).not.toContain("supersecret-token-value");
    expect(blob).not.toContain("abcdEFGHijklMNOP");
    expect(blob).not.toContain("sk-abcdefghijklmnop");
    expect(blob).toMatch(
      /Bearer \[REDACTED\]|api_key=\[REDACTED\]|sk-\[REDACTED\]/,
    );
  });

  it("J59-O3: 原文长度等于 80 时不写 head/tail；81 才写各最多 40 字符", () => {
    const exact = "a".repeat(80);
    const over = "a".repeat(81);
    const atLimit = buildCommandOutputSnippet(exact);
    expect(atLimit.text_length).toBe(80);
    expect(atLimit.head).toBeUndefined();
    expect(atLimit.tail).toBeUndefined();
    const overLimit = buildCommandOutputSnippet(over);
    expect(overLimit.text_length).toBe(81);
    expect(overLimit.head).toBe("a".repeat(40));
    expect(overLimit.tail).toBe("a".repeat(40));
    expect(overLimit.head?.length).toBeLessThanOrEqual(40);
    expect(overLimit.tail?.length).toBeLessThanOrEqual(40);
  });

  it("成功路径只写长度和退出码、不写片段；失败路径在长度规则允许时写片段，只落 daemon.jsonl", () => {
    const repoRoot = tmpDir("stagent-j59-log-");
    const longOut = `${"H".repeat(40)}MID${"T".repeat(41)}`;
    const successDetail = buildVerifyCommandLogDetail({
      alias: "ok-gate",
      stdout: longOut,
      stderr: longOut,
      includeSnippets: false,
      exit_code: 0,
    });
    expect(successDetail).toEqual({
      alias: "ok-gate",
      stdout_length: longOut.length,
      stderr_length: longOut.length,
      exit_code: 0,
    });
    expect(successDetail).not.toHaveProperty("stdout_head");
    expect(successDetail).not.toHaveProperty("stdout_tail");
    expect(successDetail).not.toHaveProperty("text");

    const failDetail = buildVerifyCommandLogDetail({
      alias: "fail-gate",
      stdout: longOut,
      stderr: "",
      includeSnippets: true,
      exit_code: 1,
    });
    expect(failDetail["stdout_head"]).toBeDefined();
    expect(failDetail["stdout_tail"]).toBeDefined();

    appendDaemonLog(repoRoot, {
      level: "info",
      kind: "graph_verify_command",
      detail: successDetail,
    });
    appendDaemonLog(repoRoot, {
      level: "error",
      kind: "graph_verify_command",
      code: E_COMMAND_FAILED,
      detail: failDetail,
    });
    const logFile = daemonLogPath(repoRoot);
    expect(logFile).toBe(path.join(repoRoot, ".stagent/logs/daemon.jsonl"));
    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const success = JSON.parse(lines[0] as string) as {
      kind: string;
      detail: Record<string, unknown>;
    };
    const failure = JSON.parse(lines[1] as string) as {
      kind: string;
      detail: Record<string, unknown>;
    };
    expect(success.kind).toBe("graph_verify_command");
    expect(success.detail["exit_code"]).toBe(0);
    expect(success.detail).not.toHaveProperty("stdout_head");
    expect(failure.detail["stdout_head"]).toBeDefined();
  });
});
