/**
 * TASK-L.17f：把 C.23 装配的 playtest 位置参数改成 CLI 旗标，并钉死 `--repo`。
 *
 * 对称 `orchestrator.ts` 内 `resolveKnowledgeCheckArgs`（check-knowledge 旁路）：
 * - C.23 装配口径（只读、不改）：`args = ["check", "playtest", <contract_id>]`
 * - CLI 期望（只读、不改）：`stagent check playtest --contract-id <id> [--repo <path>]`
 *
 * 威胁守卫会拒绝「Worktree 之外的主机路径」参数，因此不能把真实仓根绝对路径
 * 塞进 `--repo`。做法：在 Worktree 内挂一层 `.stagent/{contracts,evidence,releases}`
 * 视图（指向仓根同名目录的相对符号链接，属 Daemon 受控副产物，已在
 * untracked-scope 白名单），再令 `--repo` = worktreePath（落在威胁边界内）。
 *
 * 纪律：零改 `evaluatePlaytestGuard` / `withPlaytestCommand` / `bin/stagent.ts`。
 */
import fs from "node:fs";
import path from "node:path";

const PLAYTEST_STAGENT_DIRS = ["contracts", "evidence", "releases"] as const;

export function isPlaytestCheckCommand(command: {
  alias: string;
  executable: string;
  args: readonly string[];
}): boolean {
  if (command.alias === "playtest") return true;
  return (
    command.executable === "stagent" &&
    command.args[0] === "check" &&
    command.args[1] === "playtest"
  );
}

/**
 * 在 Worktree 内挂上 playtest 只读视图，使 CLI 以 `--repo=worktree` 即可读到
 * 仓根 `.stagent` 下的合同 / 证据 / LIVE 记录。
 */
export function ensurePlaytestStagentView(
  worktreePath: string,
  repoRoot: string,
): void {
  const srcBase = path.join(path.resolve(repoRoot), ".stagent");
  const dstBase = path.join(path.resolve(worktreePath), ".stagent");
  fs.mkdirSync(srcBase, { recursive: true });
  fs.mkdirSync(dstBase, { recursive: true });
  for (const name of PLAYTEST_STAGENT_DIRS) {
    const src = path.join(srcBase, name);
    const dst = path.join(dstBase, name);
    fs.mkdirSync(src, { recursive: true });
    let skip = false;
    try {
      const st = fs.lstatSync(dst);
      if (st.isSymbolicLink() || st.isDirectory()) skip = true;
    } catch {
      skip = false;
    }
    if (skip) continue;
    const rel = path.relative(dstBase, src);
    fs.symlinkSync(rel, dst);
  }
}

/**
 * 将 C.23 位置参数（或已含旗标的残缺形式）规范为 CLI 可执行 argv。
 * `contractId` / `repoRoot` 一律取编排器上下文（此处 repoRoot = worktreePath），
 * 不信任调用方伪造值。
 */
export function resolvePlaytestCheckArgs(
  args: readonly string[],
  ctx: { contractId: string; repoRoot: string },
): string[] {
  const repoRoot = path.resolve(ctx.repoRoot);
  const next: string[] = [];
  let i = 0;

  if (args[0] === "check") {
    next.push("check");
    i = 1;
  }
  if (args[i] === "playtest") {
    next.push("playtest");
    i += 1;
  }

  while (i < args.length) {
    const tok = args[i]!;
    if (tok === "--contract-id" || tok === "--repo") {
      i += 2;
      continue;
    }
    if (tok.startsWith("-")) {
      next.push(tok);
      i += 1;
      continue;
    }
    // 裸位置参数 = C.23 写入的 contract_id；丢弃，改用 ctx.contractId
    i += 1;
  }

  next.push("--contract-id", ctx.contractId);
  next.push("--repo", repoRoot);
  return next;
}
