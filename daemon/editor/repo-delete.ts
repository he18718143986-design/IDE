import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { resolveSafeWorktreePath } from "../mcp/path-resolver";
import { matchProtected } from "../protection/protection-list";
import { SYSTEM_SEGMENTS } from "./worktree-files";

/**
 * TASK-C.10h：资源管理器右键删除（用户主动）。
 * - 鉴权由 HTTP 层保证；本模块只做路径安全 + P.1 保护清单 + 尽量废纸篓。
 * - 保护清单命中：拒绝并返回白话（不绕过、不替用户摘保护）。
 * - macOS 优先 `/usr/bin/trash`（移到废纸篓）；失败再尝试 Finder；再失败则
 *   仅对普通文件做 unlink，并诚实标明「已永久删除」；目录在无法废纸篓时拒绝。
 */

export type DeleteMethod = "trash" | "unlink";

export type DeleteRepoPathOutcome =
  | {
      ok: true;
      path: string;
      method: DeleteMethod;
      message: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus: number;
    };

/**
 * 把文件/文件夹移到废纸篓的实现；返回 true 表示原路径已不存在（移动成功）。
 *
 * 抽成可注入类型是为了让测试能换掉真实废纸篓：
 * 历史事故——单元测试直接调 deleteRepoPath，夹具被 /usr/bin/trash 搬进**用户真实的
 * ~/.Trash**，越跑越多（实测累积了数千条 a.ts / schema / probe.lock）。
 * 后果不只是脏：清空废纸篓时会连用户的真文件一起抹掉，且本机没有 Time Machine
 * 本地快照可兜底。
 */
export type TrashMover = (absolutePath: string) => boolean;

export function tryMoveToTrash(absolutePath: string): boolean {
  // 测试环境一律不碰真实废纸篓。
  // 这是兜底闸门：即使某个用例忘了注入替身，也不会把夹具丢进用户的 ~/.Trash。
  // 测试要覆盖「废纸篓成功」分支时，请通过 deleteRepoPath({ moveToTrash }) 注入替身。
  if (process.env["VITEST"] || process.env["NODE_ENV"] === "test") return false;

  // 1) macOS 系统 trash（本机有 /usr/bin/trash）
  try {
    if (fs.existsSync("/usr/bin/trash")) {
      execFileSync("/usr/bin/trash", [absolutePath], {
        stdio: "ignore",
        timeout: 15_000,
      });
      if (!fs.existsSync(absolutePath)) return true;
    }
  } catch {
    // fall through
  }
  // 2) Finder AppleScript（仍算废纸篓）
  if (process.platform === "darwin") {
    try {
      const escaped = absolutePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      execFileSync(
        "osascript",
        [
          "-e",
          `tell application "Finder" to delete (POSIX file "${escaped}" as alias)`,
        ],
        { stdio: "ignore", timeout: 15_000 },
      );
      if (!fs.existsSync(absolutePath)) return true;
    } catch {
      // fall through
    }
  }
  return false;
}

/**
 * @param protectionRoot 主仓根（保护清单所在）；与文件根可能不同（合同 Worktree）
 * @param fileRoot 实际删除所在根（主仓或 Worktree）
 * @param moveToTrash 移到废纸篓的实现；默认走系统 trash。测试注入替身可避免污染真实废纸篓。
 */
export function deleteRepoPath(args: {
  protectionRoot: string;
  fileRoot: string;
  relPath: string;
  moveToTrash?: TrashMover;
}): DeleteRepoPathOutcome {
  const raw = String(args.relPath ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "请选择要删除的文件或文件夹。",
      httpStatus: 400,
    };
  }

  let safe;
  try {
    safe = resolveSafeWorktreePath(args.fileRoot, raw);
  } catch (err) {
    return {
      ok: false,
      code: "PATH_TRAVERSAL_DETECTED",
      message: `路径不安全，已拒绝删除：${(err as Error).message}`,
      httpStatus: 400,
    };
  }

  const segs = safe.relativePath.split(/[\\/]/);
  if (segs.some((s) => SYSTEM_SEGMENTS.includes(s))) {
    return {
      ok: false,
      code: "E_SYSTEM_PATH",
      message: "系统目录（.git / .stagent）不能删。",
      httpStatus: 403,
    };
  }

  // P.1：与 stagent_delete_file 同权——保护清单命中则拦，白话说明
  try {
    const hit = matchProtected(args.protectionRoot, safe.relativePath);
    if (hit.hit) {
      const name = hit.entryName ?? "受保护文件";
      return {
        ok: false,
        code: "PROTECTED_PATH",
        message: hit.selfLock
          ? "保护清单本身不能删（自锁）。请在「项目审阅 / 保护」里用界面改清单。"
          : `「${name}」在保护清单里，不能直接删。请先在保护设置里拿掉对应项，或走助手授权流程。`,
        httpStatus: 403,
      };
    }
  } catch (err) {
    return {
      ok: false,
      code: "PROTECTED_PATH",
      message: `保护门卫读清单失败，按拒绝处理：${(err as Error).message}`,
      httpStatus: 403,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(safe.absolutePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "ENOENT",
        message: `找不到「${safe.relativePath}」，可能已被删。`,
        httpStatus: 404,
      };
    }
    return {
      ok: false,
      code: "EIO",
      message: `无法读取「${safe.relativePath}」：${(err as Error).message}`,
      httpStatus: 400,
    };
  }

  if (stat.isSymbolicLink()) {
    return {
      ok: false,
      code: "E_NOT_A_FILE",
      message: `「${safe.relativePath}」是符号链接，为安全起见不支持从资源管理器删除。`,
      httpStatus: 400,
    };
  }

  // 优先废纸篓（文件与文件夹都可以）；默认实现见 tryMoveToTrash，测试可注入替身
  const moveToTrash = args.moveToTrash ?? tryMoveToTrash;
  if (moveToTrash(safe.absolutePath)) {
    return {
      ok: true,
      path: safe.relativePath,
      method: "trash",
      message: `已将「${safe.relativePath}」移到废纸篓。`,
    };
  }

  // 回退：仅普通文件永久删除；目录拒绝（与 stagent_delete_file 一致的安全底线）
  if (stat.isDirectory()) {
    return {
      ok: false,
      code: "E_TRASH_UNAVAILABLE",
      message: `本机没法把「${safe.relativePath}」移到废纸篓；文件夹不能直接永久删除（安全起见）。`,
      httpStatus: 400,
    };
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      code: "E_NOT_A_FILE",
      message: `「${safe.relativePath}」不是普通文件，已拒绝删除。`,
      httpStatus: 400,
    };
  }

  try {
    fs.unlinkSync(safe.absolutePath);
  } catch (err) {
    return {
      ok: false,
      code: "EIO",
      message: `删除失败：${(err as Error).message}`,
      httpStatus: 400,
    };
  }

  return {
    ok: true,
    path: safe.relativePath,
    method: "unlink",
    message: `本机没法移到废纸篓，已永久删除普通文件「${safe.relativePath}」。`,
  };
}
