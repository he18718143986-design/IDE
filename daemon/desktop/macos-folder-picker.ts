/**
 * TASK-DS.1：macOS 本机助手 · 系统文件夹选择器（非 Electron/Tauri）。
 *
 * 纪律对齐 repo-delete 废纸篓：固定系统二进制 `/usr/bin/osascript`、超时、
 * 路径/提示转义。本模块**不**直接引入子进程模块（由调用方注入
 * `execFileSync`，生产路径由已白名单的 `daemon/server.ts` 传入），避免越权
 * 扩大 spawn 面。
 *
 * 非 darwin → E_UNSUPPORTED_PLATFORM（不假装成功）。
 * 用户取消 → CANCELLED（调用方映射为 HTTP 200 { cancelled: true }）。
 */
import path from "node:path";

export const OSASCRIPT_BIN = "/usr/bin/osascript";
export const DEFAULT_PICK_FOLDER_TIMEOUT_MS = 120_000;
export const DEFAULT_PICK_FOLDER_PROMPT = "选择项目文件夹";

/** 与 Node execFileSync 兼容的最小注入面（测试可 mock；由 server 注入） */
export type SyncExecFile = (
  file: string,
  args: readonly string[],
  options?: {
    timeout?: number;
    encoding?: BufferEncoding;
    stdio?: "pipe" | "ignore" | "inherit" | readonly ["pipe" | "ignore" | "inherit", ...Array<"pipe" | "ignore" | "inherit" | "ipc" | number | null | undefined>];
  },
) => string | Buffer;

export type PickFolderOk = { ok: true; path: string };
export type PickFolderCancelled = { ok: false; code: "CANCELLED" };
export type PickFolderUnsupported = {
  ok: false;
  code: "E_UNSUPPORTED_PLATFORM";
  message: string;
};
export type PickFolderFailed = {
  ok: false;
  code: "E_PICK_FOLDER_FAILED";
  message: string;
};
export type PickFolderResult =
  | PickFolderOk
  | PickFolderCancelled
  | PickFolderUnsupported
  | PickFolderFailed;

export function escapeAppleScriptString(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 构造 `choose folder` AppleScript；prompt 经转义后嵌入双引号。 */
export function buildChooseFolderScript(
  prompt: string = DEFAULT_PICK_FOLDER_PROMPT,
): string {
  const escaped = escapeAppleScriptString(prompt);
  return `POSIX path of (choose folder with prompt "${escaped}")`;
}

function isUserCancelled(err: unknown): boolean {
  const e = err as {
    message?: string;
    stderr?: string | Buffer;
    status?: number | null;
  };
  const msg = String(e?.message ?? "");
  const stderr =
    typeof e?.stderr === "string"
      ? e.stderr
      : Buffer.isBuffer(e?.stderr)
        ? e.stderr.toString("utf8")
        : "";
  const blob = `${msg}\n${stderr}`;
  // AppleScript user canceled → status 1，文案含 User canceled. / (-128)
  return (
    /User canceled/i.test(blob) ||
    /\(-128\)/.test(blob) ||
    /用户取消/.test(blob) ||
    e?.status === -128
  );
}

export interface PickFolderMacOSOptions {
  /** 默认 process.platform；测试可注入 */
  platform?: NodeJS.Platform;
  /** 必填：由 server 注入 execFileSync，单测注入 mock */
  execFileSync: SyncExecFile;
  timeoutMs?: number;
  prompt?: string;
  osascriptBin?: string;
}

/**
 * 在 darwin 上调起系统文件夹对话框；取消 → CANCELLED；非 darwin → unsupported。
 */
export function pickFolderMacOS(
  options: PickFolderMacOSOptions,
): PickFolderResult {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      ok: false,
      code: "E_UNSUPPORTED_PLATFORM",
      message: `系统选夹仅支持 macOS（当前平台：${platform}）`,
    };
  }

  const bin = options.osascriptBin ?? OSASCRIPT_BIN;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PICK_FOLDER_TIMEOUT_MS;
  const script = buildChooseFolderScript(
    options.prompt ?? DEFAULT_PICK_FOLDER_PROMPT,
  );

  try {
    const out = options.execFileSync(bin, ["-e", script], {
      timeout: timeoutMs,
      encoding: "utf8",
    });
    const raw = String(out).trim();
    if (!raw) {
      return {
        ok: false,
        code: "E_PICK_FOLDER_FAILED",
        message: "系统选夹未返回路径。",
      };
    }
    // choose folder 常带尾斜杠；resolve 归一为绝对路径
    const resolved = path.resolve(raw);
    return { ok: true, path: resolved };
  } catch (err) {
    if (isUserCancelled(err)) {
      return { ok: false, code: "CANCELLED" };
    }
    const message =
      err instanceof Error ? err.message : `系统选夹失败：${String(err)}`;
    return {
      ok: false,
      code: "E_PICK_FOLDER_FAILED",
      message,
    };
  }
}
