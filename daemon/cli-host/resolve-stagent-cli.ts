import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 把官方 verify 中的产品 CLI 裸名 `stagent` 解析为当前 Daemon 入口。
 * 包根公式与 `daemon/guard/baseline-gates.ts` 未导出的 `stagentPackageRoot()`
 * 同源（`import.meta.url` 上两级到仓库根），但不改那个文件。
 */

export type StagentResolveReason =
  "missing_exec_path" | "missing_tsx" | "missing_bin";

/**
 * TASK-J.62：合同 `execute` 路径的解析/启动失败码。
 *
 * 与图核销路径（J.59）同名同义，排障口径一致；常量收在本模块，
 * `daemon/graph/illumination-verifier.ts` 里的同名字面量保持不动。
 */
export const E_COMMAND_NOT_RESOLVED = "E_COMMAND_NOT_RESOLVED";
export const E_COMMAND_SPAWN_FAILED = "E_COMMAND_SPAWN_FAILED";

export type ResolveStagentCliInput = {
  executable: string;
  args: readonly string[];
  execPath?: string;
  packageRoot?: string;
};

export type ResolvedStagentCommand = {
  ok: true;
  executable: string;
  args: string[];
};

export type UnresolvedStagentCommand = {
  ok: false;
  reason: StagentResolveReason;
};

export type ResolveStagentCliResult =
  ResolvedStagentCommand | UnresolvedStagentCommand;

/** 与 baseline-gates.ts 的 stagentPackageRoot() 同源：dirname(import.meta.url)/../.. */
export function stagentPackageRootFromModuleUrl(
  moduleUrl: string = import.meta.url,
): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../..");
}

export function packageLocalTsxPath(packageRoot: string): string {
  return path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");
}

export function packageLocalStagentBin(packageRoot: string): string {
  return path.join(packageRoot, "bin", "stagent.ts");
}

export function resolvedCommandString(resolved: {
  executable: string;
  args: readonly string[];
}): string {
  return [resolved.executable, ...resolved.args].join(" ").trim();
}

/** 把已解析命令串加入白名单；否则 runCommand 会精确匹配失败并报 E_UNAUTHORIZED_COMMAND。 */
export function ensureAllowedCommand(
  allowedCommands: string[],
  commandStr: string,
): string[] {
  if (!allowedCommands.includes(commandStr)) {
    allowedCommands.push(commandStr);
  }
  return allowedCommands;
}

export function resolveStagentCli(
  input: ResolveStagentCliInput,
): ResolveStagentCliResult {
  if (input.executable !== "stagent") {
    return {
      ok: true,
      executable: input.executable,
      args: [...input.args],
    };
  }

  const execPath = input.execPath ?? process.execPath;
  if (typeof execPath !== "string" || execPath.trim() === "") {
    return { ok: false, reason: "missing_exec_path" };
  }

  const packageRoot = input.packageRoot ?? stagentPackageRootFromModuleUrl();
  const tsxCli = packageLocalTsxPath(packageRoot);
  if (!fs.existsSync(tsxCli)) {
    return { ok: false, reason: "missing_tsx" };
  }

  const binEntry = packageLocalStagentBin(packageRoot);
  if (!fs.existsSync(binEntry)) {
    return { ok: false, reason: "missing_bin" };
  }

  return {
    ok: true,
    executable: execPath,
    args: [tsxCli, binEntry, ...input.args],
  };
}
