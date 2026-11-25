import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRmSync } from "../helpers/tmp";

import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  packageLocalStagentBin,
  packageLocalTsxPath,
  stagentPackageRootFromModuleUrl,
} from "../../daemon/cli-host/resolve-stagent-cli";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

// 只把 runCommand 换成 spy（保留其余导出，CommandSecurityError 的 instanceof
// 语义不变），用于直接断言「网关交给执行器的 argv 是什么」。
vi.mock("../../daemon/runner/command-runner", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../daemon/runner/command-runner")>();
  return { ...actual, runCommand: vi.fn(actual.runCommand) };
});

const { runCommand } = await import("../../daemon/runner/command-runner");
const runCommandSpy = vi.mocked(runCommand);

/**
 * TASK-J.62：合同 `execute` 路径解析产品 CLI。
 *
 * 防的是「合同验收命令写 `stagent`、网关却直接 spawn 裸名」导致九条命令全部
 * ENOENT、execute 永远拿不到 PASSED 证据：
 * - 只在原始命令串已在合同白名单时解析，且已解析串进白名单；
 * - 解析失败 → E_COMMAND_NOT_RESOLVED，且不产生子进程；
 * - spawn ENOENT / EACCES → E_COMMAND_SPAWN_FAILED（带 spawn_code）；
 * - 非 `stagent` 命令与白名单逐字不变；检查体非零语义零漂移；
 * - 未授权的 `stagent` 命令仍被白名单拒（不因解析而放宽）。
 */

const PACKAGE_ROOT = stagentPackageRootFromModuleUrl();
const TSX = packageLocalTsxPath(PACKAGE_ROOT);
const BIN = packageLocalStagentBin(PACKAGE_ROOT);

interface CommandSpec {
  alias: string;
  executable: string;
  args: string[];
  expected_exit_code: number;
  timeout_seconds: number;
}

function makeContract(commands: CommandSpec[]) {
  const draft = createContractDraft({
    title: "J.62 execute 解析",
    description: "验证 execute 路径解析产品 CLI",
    acceptanceCriteria: ["命令可被解析并执行"],
    writablePaths: ["src/**"],
    commands: commands as never,
  });
  const approved = softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
  return approved;
}

let worktree: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-j62-"));
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  fs.mkdirSync(path.join(worktree, ".git"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "package.json"), "{}\n");
  runCommandSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    safeRmSync(worktree);
  } catch {
    // 沙箱可能拦递归删除；临时目录由系统回收
  }
});

function gatewayFor(commands: CommandSpec[]) {
  return new ScopedWorktreeGateway(worktree, makeContract(commands));
}

describe("TASK-J.62 execute 路径解析产品 CLI", () => {
  it("J62-P1：stagent 解析为 process.execPath 与包内 tsx/bin，白名单含已解析串", async () => {
    const args = ["check", "baseline-gate", "--id", "baseline-safety-secrets"];
    const gateway = gatewayFor([
      {
        alias: "baseline-safety-secrets",
        executable: "stagent",
        args,
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ]);

    expect(fs.existsSync(TSX)).toBe(true);
    expect(fs.existsSync(BIN)).toBe(true);

    await gateway.callTool(
      "stagent_exec_command",
      { executable: "stagent", args },
      { internal: true },
    );

    expect(runCommandSpy).toHaveBeenCalledTimes(1);
    const [commandArg, options] = runCommandSpy.mock.calls[0]!;
    const argv = options?.argv as { executable: string; args: string[] };
    expect(argv.executable).toBe(process.execPath);
    expect(argv.args[0]).toBe(TSX);
    expect(argv.args[1]).toBe(BIN);
    expect(argv.args.slice(2)).toEqual(args);
    // 已解析串必须在白名单里（否则会被精确匹配拒掉）
    const resolvedString = [process.execPath, TSX, BIN, ...args].join(" ");
    expect(options?.allowedCommands).toContain(resolvedString);
    // 原始串仍在白名单（合同口径未改）
    expect(options?.allowedCommands).toContain(`stagent ${args.join(" ")}`);
    expect(commandArg).toBe(`stagent ${args.join(" ")}`);
  });

  it("J62-P2：非 stagent 命令 argv 与白名单逐字不变", async () => {
    const args = ["-e", "console.log('ok')"];
    const gateway = gatewayFor([
      {
        alias: "node-probe",
        executable: "node",
        args,
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ]);

    const result = await gateway.callTool(
      "stagent_exec_command",
      { executable: "node", args },
      { internal: true },
    );

    expect(result.isError).toBe(false);
    expect((result.data as { exitCode: number }).exitCode).toBe(0);
    const [, options] = runCommandSpy.mock.calls[0]!;
    const argv = options?.argv as { executable: string; args: string[] };
    expect(argv).toEqual({ executable: "node", args });
    expect(options?.allowedCommands).toEqual([`node ${args.join(" ")}`]);
  });

  it("J62-P3：解析失败返回 E_COMMAND_NOT_RESOLVED 且不产生子进程", async () => {
    const args = ["check", "baseline-gate", "--id", "baseline-safety-secrets"];
    const gateway = gatewayFor([
      {
        alias: "baseline-safety-secrets",
        executable: "stagent",
        args,
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ]);

    // 模拟「找不到 node 可执行路径」→ missing_exec_path
    const spy = vi.spyOn(process, "execPath", "get");
    spy.mockReturnValue("");

    const result = await gateway.callTool(
      "stagent_exec_command",
      { executable: "stagent", args },
      { internal: true },
    );

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("E_COMMAND_NOT_RESOLVED");
    expect(
      (result.error?.details as { reason?: string } | undefined)?.reason,
    ).toBe("missing_exec_path");
    // 解析在 runCommand 之前返回 → 执行器一次都没被调用
    expect(runCommandSpy).not.toHaveBeenCalled();
  });

  it("J62-P4：spawn ENOENT 返回 E_COMMAND_SPAWN_FAILED 并带 spawn_code", async () => {
    const gateway = gatewayFor([
      {
        alias: "gone",
        executable: "stagent-does-not-exist-j62",
        args: [],
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ]);

    const result = await gateway.callTool(
      "stagent_exec_command",
      { executable: "stagent-does-not-exist-j62", args: [] },
      { internal: true },
    );

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("E_COMMAND_SPAWN_FAILED");
    expect(
      (result.error?.details as { spawn_code?: string } | undefined)
        ?.spawn_code,
    ).toBe("ENOENT");
  });

  it("J62-P5：检查体非零仍是 E_VERIFICATION_FAILED、白名单外仍是 E_UNAUTHORIZED_COMMAND", async () => {
    const failArgs = ["-e", "process.exit(3)"];
    const gateway = gatewayFor([
      {
        alias: "fails",
        executable: "node",
        args: failArgs,
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ]);

    const failing = await gateway.callTool(
      "stagent_exec_command",
      { executable: "node", args: failArgs },
      { internal: true },
    );
    expect(failing.isError).toBe(true);
    expect((failing.data as { exitCode?: number }).exitCode).toBe(3);
    expect(failing.error?.code).toBe("E_VERIFICATION_FAILED");

    const notWhitelisted = await gateway.callTool(
      "stagent_exec_command",
      { executable: "node", args: ["-e", "console.log('nope')"] },
      { internal: true },
    );
    expect(notWhitelisted.isError).toBe(true);
    expect(notWhitelisted.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
  });

  it("J62-P6：未授权的 stagent 命令不被解析放宽，仍按白名单拒", async () => {
    const args = ["check", "baseline-gate", "--id", "baseline-safety-secrets"];
    const gateway = gatewayFor([
      {
        alias: "baseline-safety-secrets",
        executable: "stagent",
        args,
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ]);

    // 合同里没有这一条 → 不得因「解析后自动入白名单」而放行
    const result = await gateway.callTool(
      "stagent_exec_command",
      {
        executable: "stagent",
        args: ["check", "baseline-gate", "--id", "other"],
      },
      { internal: true },
    );

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("E_UNAUTHORIZED_COMMAND");
  });
});
