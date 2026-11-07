/**
 * TASK-DS.2：macOS 本机助手 · 新建空项目目录（非 Electron/Tauri）。
 *
 * 在已解析的父目录下创建空目录：名校验 → 存在检查 → mkdir（非 recursive）。
 * 已存在 / 非法名 / 父不存在 → 明确失败；失败不半创建。
 * 打开工作区不在本模块职责内（由调用方走 recent-projects/open / #token=）。
 * 本切片 ≠ TASK-D.1e 完成；不宣称桌面壳闭环。
 */
import fs from "node:fs";
import path from "node:path";

export type CreateEmptyProjectOk = { ok: true; path: string };
export type CreateEmptyProjectUnsupported = {
  ok: false;
  code: "E_UNSUPPORTED_PLATFORM";
  message: string;
};
export type CreateEmptyProjectInvalidName = {
  ok: false;
  code: "E_INVALID_NAME";
  message: string;
};
export type CreateEmptyProjectParentMissing = {
  ok: false;
  code: "E_PARENT_NOT_FOUND";
  message: string;
};
export type CreateEmptyProjectParentNotDir = {
  ok: false;
  code: "E_PARENT_NOT_DIR";
  message: string;
};
export type CreateEmptyProjectExists = {
  ok: false;
  code: "E_EXISTS";
  message: string;
};
export type CreateEmptyProjectFailed = {
  ok: false;
  code: "E_CREATE_FAILED";
  message: string;
};
export type CreateEmptyProjectResult =
  | CreateEmptyProjectOk
  | CreateEmptyProjectUnsupported
  | CreateEmptyProjectInvalidName
  | CreateEmptyProjectParentMissing
  | CreateEmptyProjectParentNotDir
  | CreateEmptyProjectExists
  | CreateEmptyProjectFailed;

export interface CreateEmptyProjectOptions {
  parentPath: string;
  name: string;
  /** 默认 process.platform；测试可注入。产品门禁与 DS.1 同口径：仅 darwin。 */
  platform?: NodeJS.Platform;
}

/** 校验项目名：禁空、路径分隔、`.` / `..`。 */
export function validateEmptyProjectName(
  raw: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) {
    return { ok: false, message: "请填写项目名称。" };
  }
  if (name === "." || name === "..") {
    return { ok: false, message: "项目名称不能是 . 或 ..。" };
  }
  if (name.includes("/") || name.includes("\\")) {
    return {
      ok: false,
      message: "项目名称不能包含路径分隔符（/ 或 \\）。",
    };
  }
  if (name.includes("\0")) {
    return { ok: false, message: "项目名称含非法字符。" };
  }
  return { ok: true, name };
}

/**
 * 在父目录下创建空项目目录。
 * 成功只回绝对 path；不返回会话钥匙或唤起 URL。
 */
export function createEmptyProject(
  options: CreateEmptyProjectOptions,
): CreateEmptyProjectResult {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      ok: false,
      code: "E_UNSUPPORTED_PLATFORM",
      message: `新建空项目仅支持 macOS（当前平台：${platform}）`,
    };
  }

  const validated = validateEmptyProjectName(options.name);
  if (!validated.ok) {
    return {
      ok: false,
      code: "E_INVALID_NAME",
      message: validated.message,
    };
  }

  const parentRaw =
    typeof options.parentPath === "string" ? options.parentPath.trim() : "";
  if (!parentRaw) {
    return {
      ok: false,
      code: "E_PARENT_NOT_FOUND",
      message: "请先选择父目录。",
    };
  }

  const parentPath = path.resolve(parentRaw);
  let parentStat: fs.Stats;
  try {
    parentStat = fs.statSync(parentPath);
  } catch {
    return {
      ok: false,
      code: "E_PARENT_NOT_FOUND",
      message: `父目录不存在：${parentPath}`,
    };
  }
  if (!parentStat.isDirectory()) {
    return {
      ok: false,
      code: "E_PARENT_NOT_DIR",
      message: `父路径不是目录：${parentPath}`,
    };
  }

  const targetPath = path.join(parentPath, validated.name);
  // 目标已存在 → 明确失败（不覆盖、不合并）
  if (fs.existsSync(targetPath)) {
    return {
      ok: false,
      code: "E_EXISTS",
      message: `目标已存在，未覆盖：${targetPath}`,
    };
  }

  try {
    // 非 recursive：父已校验存在；失败不半创建多层树
    fs.mkdirSync(targetPath, { recursive: false });
  } catch (err) {
    // 竞态：mkdir 前不存在、mkdir 时被人建了
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return {
        ok: false,
        code: "E_EXISTS",
        message: `目标已存在，未覆盖：${targetPath}`,
      };
    }
    const message =
      err instanceof Error ? err.message : `创建失败：${String(err)}`;
    return {
      ok: false,
      code: "E_CREATE_FAILED",
      message,
    };
  }

  // 成功后再确认是目录（防半创建误报）
  try {
    const st = fs.statSync(targetPath);
    if (!st.isDirectory()) {
      return {
        ok: false,
        code: "E_CREATE_FAILED",
        message: `创建后目标不是目录：${targetPath}`,
      };
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : `创建后无法读取：${String(err)}`;
    return {
      ok: false,
      code: "E_CREATE_FAILED",
      message,
    };
  }

  return { ok: true, path: targetPath };
}
