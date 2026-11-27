/**
 * TASK-C.14e：扫描器 OS 级只读 + 断网沙盒证明。
 *
 * 平台策略（诚实登记）：
 * - **Darwin**：`sandbox-exec` Seatbelt。写拒绝常见为 `EPERM`（Operation not permitted），
 *   **不是** Linux 的 `EROFS`；出站失败常见 `ENOTFOUND` / 网络不可达。
 * - **Linux**：优先 `unshare -n` + 只读 bind mount；不可用则 logical_fallback。
 * - 证明失败时不得把「绝不触碰线上业务」写成已兑现硬承诺。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { BaselineOsSandboxProof } from "./types";

export type OsSandboxMode = BaselineOsSandboxProof["mode"];

export type { BaselineOsSandboxProof };

export interface OsSandboxRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  mode: OsSandboxMode;
}

const DARWIN_WRITE_OK = new Set(["EPERM", "EROFS", "EACCES"]);
const DARWIN_NET_OK = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPERM",
  "EACCES",
]);

function which(bin: string): string | null {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const p = (r.stdout || "").trim();
  return p || null;
}

/** sandbox-exec 应用失败时的 stderr 特征（嵌套沙箱 / 权限受限） */
const SANDBOX_LAUNCH_FAILURE =
  /sandbox_apply|sandbox-exec:|Operation not permitted/i;

let sandboxApplicableCache: boolean | null = null;

/**
 * 沙箱能否**真正应用**——区别于「二进制是否存在」。
 *
 * 必须用我们实际使用的配置去探，不能用宽松配置：实测 macOS 26.6 上
 * `(version 1)(allow default)` 能跑，但只要配置里出现任何 `deny` 子句
 * （`(deny default)` 或 `(allow default)(deny network*)` 一样），
 * 内核就拒绝应用：`sandbox-exec: sandbox_apply: Operation not permitted`，
 * 退出码 71。用宽松配置探会得到「可用」的假结论。
 */
export function isOsSandboxApplicable(): boolean {
  if (sandboxApplicableCache !== null) return sandboxApplicableCache;
  if (detectPreferredOsSandboxMode() !== "sandbox-exec") {
    sandboxApplicableCache = false;
    return false;
  }
  const r = runUnderDarwinSandbox(os.tmpdir(), ["/usr/bin/true"], {
    timeoutMs: 5_000,
  });
  sandboxApplicableCache = r.exitCode === 0;
  return sandboxApplicableCache;
}

/** stderr 是否指向「沙箱没能应用」，用于在证明里写明原因 */
export function isSandboxLaunchFailure(stderr: string): boolean {
  return SANDBOX_LAUNCH_FAILURE.test(stderr ?? "");
}

/**
 * 探测结果三态判据（TASK-P0.1a P01A-P4）：
 * - ALLOWED: 成功连通/写入（输出匹配 successToken）
 * - DENIED: 确被沙箱规则拦截（返回明确的沙箱拦截错误码，如 EPERM, EROFS, EACCES）
 * - UNKNOWN: 无法证明是被沙箱拦截还是外部环境故障（如空输出、TIMEOUT、ENOTFOUND、EAI_AGAIN、网络不可达等）
 */
export type ProbeVerdict = "DENIED" | "UNKNOWN" | "ALLOWED";

export interface ProbeVerdictOptions {
  /** 外部宿主基线是否连通；若为 false 则表明宿主自身网络不可达，任何网络探测失败均降级为 UNKNOWN */
  hostReachable?: boolean | undefined;
}

/**
 * 依据探测输出与成功标识判定三态裁决。
 * 针对网络探测（如 api.anthropic.com 或 example.com），因外部网络不可达、DNS 失败或超时
 * 导致的报错，判定为 UNKNOWN，严禁误判为沙箱规则生效。
 */
export function probeVerdictFromOutput(
  stdout: string,
  successToken: string,
  opts?: ProbeVerdictOptions,
): ProbeVerdict {
  const out = (stdout ?? "").trim();
  if (out.length === 0) {
    return "UNKNOWN";
  }
  if (out === successToken) {
    return "ALLOWED";
  }

  // 超时型输出在任何情况下均判定为 UNKNOWN，不能证明是规则拦截
  if (out === "TIMEOUT" || out === "ETIMEDOUT") {
    return "UNKNOWN";
  }

  // 若宿主环境已被标记为网络不可达，任何网络探测失败均降级为 UNKNOWN，严禁记入 denied
  if (opts?.hostReachable === false && successToken === "CONNECTED") {
    return "UNKNOWN";
  }

  if (successToken === "CONNECTED") {
    // 明确的内核沙箱拦截码（如 EPERM, EACCES, ERR_ACCESS_DENIED）
    if (out === "EPERM" || out === "EACCES" || out === "ERR_ACCESS_DENIED") {
      return "DENIED";
    }

    // 若进行了交叉校验并证实宿主环境可连通（hostReachable === true），
    // 则沙箱内出现的任何网络失败（如 ENOTFOUND/ECONNREFUSED/ERR）均确由沙箱规则阻断所致
    if (opts?.hostReachable === true) {
      return "DENIED";
    }

    // 既非明确拦截码、又无宿主连通证明时，对未知网络错误保守判定为 UNKNOWN
    return "UNKNOWN";
  }

  if (successToken === "WROTE") {
    if (out === "EPERM" || out === "EROFS" || out === "EACCES") {
      return "DENIED";
    }
    return "UNKNOWN";
  }

  return "UNKNOWN";
}
export function probeDeniedFromOutput(
  stdout: string,
  successToken: string,
  opts?: ProbeVerdictOptions,
): boolean {
  return probeVerdictFromOutput(stdout, successToken, opts) === "DENIED";
}

/** 生成 Darwin Seatbelt：默拒绝；允许读；仅允许 /tmp 写入；禁网；禁写 repoRoot */
export function buildDarwinSeatbeltProfile(repoRoot: string): string {
  const root = path.resolve(repoRoot);
  return `(version 1)
(deny default)
(allow process*)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read*)
(allow file-write-data (literal "/dev/null"))
(allow file-ioctl (literal "/dev/null"))
(allow file-write* (subpath "/private/tmp") (subpath "/tmp"))
(deny file-write* (subpath "${root}"))
(deny network*)
`;
}

export function detectPreferredOsSandboxMode(
  platform: NodeJS.Platform = process.platform,
): OsSandboxMode {
  if (platform === "darwin" && which("sandbox-exec")) {
    return "sandbox-exec";
  }
  if (platform === "linux" && which("unshare")) {
    return "unshare-ro";
  }
  return "logical_fallback";
}

function writeTempProfile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-sb-"));
  const file = path.join(dir, "profile.sb");
  fs.writeFileSync(file, content, "utf8");
  return file;
}

function runUnderDarwinSandbox(
  repoRoot: string,
  argv: string[],
  opts?: { timeoutMs?: number },
): OsSandboxRunResult {
  const profile = buildDarwinSeatbeltProfile(repoRoot);
  const profilePath = writeTempProfile(profile);
  try {
    const r = spawnSync("/usr/bin/sandbox-exec", ["-f", profilePath, ...argv], {
      encoding: "utf8",
      timeout: opts?.timeoutMs ?? 15_000,
      env: { ...process.env, STAGENT_OS_SANDBOX: "1" },
    });
    return {
      ok: r.status === 0,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      exitCode: r.status,
      mode: "sandbox-exec",
    };
  } finally {
    try {
      fs.rmSync(path.dirname(profilePath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * 在 OS 沙盒内尝试写入业务树探针文件；期望失败。
 * 返回平台错误码（Darwin 多为 EPERM）。
 */
export function proveScanWriteDenied(repoRoot: string): {
  denied: boolean;
  code: string | null;
  mode: OsSandboxMode;
  detail: string;
} {
  const root = path.resolve(repoRoot);
  const mode = detectPreferredOsSandboxMode();
  const probeRel = `.stagent-c14e-write-probe-${process.pid}.tmp`;
  const probeAbs = path.join(root, probeRel);
  // 确保父目录存在且探针不预先存在
  if (fs.existsSync(probeAbs)) {
    try {
      fs.unlinkSync(probeAbs);
    } catch {
      // ignore
    }
  }

  if (mode === "sandbox-exec") {
    const script = `
const fs = require("node:fs");
try {
  fs.writeFileSync(${JSON.stringify(probeAbs)}, "should-fail");
  process.stdout.write("WROTE");
  process.exit(0);
} catch (e) {
  process.stdout.write(String(e && e.code ? e.code : "ERR"));
  process.exit(2);
}
`;
    const r = runUnderDarwinSandbox(root, [process.execPath, "-e", script]);
    const code = (r.stdout || "").trim() || null;
    const denied = probeDeniedFromOutput(r.stdout, "WROTE");
    const stillMissing = !fs.existsSync(probeAbs);
    return {
      denied: denied && stillMissing,
      code: denied ? code : null,
      mode,
      detail: r.stderr || `stdout=${r.stdout}`,
    };
  }

  if (mode === "unshare-ro") {
    // Linux：unshare 网络 + 尝试在只读场景写（若无 mount 权限则记 fallback）
    const script = `
const fs = require("node:fs");
try {
  fs.writeFileSync(${JSON.stringify(probeAbs)}, "should-fail");
  process.stdout.write("WROTE");
} catch (e) {
  process.stdout.write(String(e && e.code ? e.code : "ERR"));
  process.exitCode = 2;
}
`;
    const r = spawnSync(
      "unshare",
      ["-n", "--", process.execPath, "-e", script],
      { encoding: "utf8", timeout: 10_000 },
    );
    // unshare alone does not make FS read-only; try mount if root
    const code = (r.stdout || "").trim();
    if (
      code &&
      code !== "WROTE" &&
      (DARWIN_WRITE_OK.has(code) || code === "EROFS")
    ) {
      return {
        denied: !fs.existsSync(probeAbs),
        code,
        mode,
        detail: r.stderr || "",
      };
    }
    // cleanup if wrote
    if (fs.existsSync(probeAbs)) {
      try {
        fs.unlinkSync(probeAbs);
      } catch {
        // ignore
      }
    }
    return {
      denied: false,
      code: null,
      mode: "logical_fallback",
      detail:
        "Linux unshare 无 RO mount 权限或写仍成功；登记为 logical_fallback",
    };
  }

  return {
    denied: false,
    code: null,
    mode: "logical_fallback",
    detail: `平台 ${process.platform} 无可用 OS 沙盒二进制`,
  };
}

/** 在 OS 沙盒内尝试出站；期望失败 */
/**
 * 宿主网络连通性快速交叉校验（用于排除外部断网导致的假阳性拦截证明）。
 */
export function checkHostNetworkConnectivity(
  host: string,
  port: number,
  timeoutMs = 1500,
): boolean {
  try {
    const testScript = `
const net = require("node:net");
const s = net.connect({ host: ${JSON.stringify(host)}, port: ${port} }, () => {
  process.stdout.write("OK");
  s.end();
  process.exit(0);
});
s.on("error", () => process.exit(1));
setTimeout(() => process.exit(2), ${timeoutMs});
`;
    const r = spawnSync(process.execPath, ["-e", testScript], {
      timeout: timeoutMs + 1000,
      encoding: "utf8",
    });
    return r.status === 0 && (r.stdout || "").trim() === "OK";
  } catch {
    return false;
  }
}

export function proveScanNetworkDenied(
  repoRoot: string,
  opts?: {
    targetHost?: string;
    targetPort?: number;
    hostReachable?: boolean | undefined;
  },
): {
  denied: boolean;
  verdict: ProbeVerdict;
  code: string | null;
  mode: OsSandboxMode;
  detail: string;
} {
  const root = path.resolve(repoRoot);
  const mode = detectPreferredOsSandboxMode();
  const targetHost = opts?.targetHost ?? "example.com";
  const targetPort = opts?.targetPort ?? 80;

  let hostReachable = opts?.hostReachable;
  if (hostReachable === undefined && mode === "sandbox-exec") {
    hostReachable = checkHostNetworkConnectivity(targetHost, targetPort);
  }
  const script = `
const net = require("node:net");
const s = net.connect({ host: ${JSON.stringify(targetHost)}, port: ${targetPort} }, () => {
  process.stdout.write("CONNECTED");
  s.end();
  process.exit(0);
});
s.on("error", (e) => {
  process.stdout.write(String(e && e.code ? e.code : "ERR"));
  process.exit(2);
});
setTimeout(() => { process.stdout.write("TIMEOUT"); process.exit(3); }, 2500);
`;

  if (mode === "sandbox-exec") {
    const r = runUnderDarwinSandbox(root, [process.execPath, "-e", script], {
      timeoutMs: 8_000,
    });
    const code = (r.stdout || "").trim() || null;
    const verdict = probeVerdictFromOutput(r.stdout, "CONNECTED", {
      ...opts,
      hostReachable,
    });
    const denied = verdict === "DENIED";
    return {
      denied,
      verdict,
      code: denied ? code : null,
      mode,
      detail: r.stderr || "",
    };
  }

  if (mode === "unshare-ro") {
    const r = spawnSync(
      "unshare",
      ["-n", "--", process.execPath, "-e", script],
      { encoding: "utf8", timeout: 8_000 },
    );
    const code = (r.stdout || "").trim() || null;
    const verdict = probeVerdictFromOutput(r.stdout, "CONNECTED", {
      ...opts,
      hostReachable,
    });
    const denied = verdict === "DENIED";
    return {
      denied,
      verdict,
      code: denied ? code : null,
      mode,
      detail: r.stderr || "",
    };
  }

  return {
    denied: false,
    verdict: "UNKNOWN",
    code: null,
    mode: "logical_fallback",
    detail: "无 OS 网络隔离能力",
  };
}

/**
 * 跑完整 OS 沙盒证明（写 + 网）。供扫描落盘与单测。
 */
export function proveOsSandbox(repoRoot: string): BaselineOsSandboxProof {
  const preferred = detectPreferredOsSandboxMode();
  const notes: string[] = [];
  if (process.platform === "darwin") {
    notes.push(
      "Darwin 使用 sandbox-exec；写失败码多为 EPERM（平台等价于 EROFS），并非 Linux EROFS。",
    );
  } else if (process.platform === "linux") {
    notes.push(
      "Linux 优先 unshare -n；只读 bind mount 需权限，失败则 logical_fallback。",
    );
  }

  const write = proveScanWriteDenied(repoRoot);
  const net = proveScanNetworkDenied(repoRoot);
  let mode: OsSandboxMode = preferred;
  if (!write.denied || !net.denied) {
    mode = "logical_fallback";
    notes.push(write.detail);
    notes.push(net.detail);
  } else {
    mode = write.mode === net.mode ? write.mode : preferred;
  }

  // 沙箱没应用成功时，把「为什么没证明」写清楚，避免归档只剩一条假证据
  if (
    isSandboxLaunchFailure(write.detail) ||
    isSandboxLaunchFailure(net.detail) ||
    !isOsSandboxApplicable()
  ) {
    notes.push(
      "OS 沙箱无法应用（内核拒收含 deny 子句的 seatbelt 配置），本轮不构成只读/断网证明。",
    );
  }

  if (
    write.denied &&
    write.code &&
    !DARWIN_WRITE_OK.has(write.code) &&
    write.code !== "EROFS"
  ) {
    notes.push(`写拒绝码 ${write.code} 非常见集合，已如实记录`);
  }
  if (
    net.denied &&
    net.code &&
    !DARWIN_NET_OK.has(net.code) &&
    net.code !== "TIMEOUT"
  ) {
    notes.push(`断网码 ${net.code} 非常见集合，已如实记录`);
  }

  return {
    platform: process.platform,
    mode: write.denied && net.denied ? mode : "logical_fallback",
    write_denied: write.denied,
    write_error_code: write.code,
    network_denied: net.denied,
    network_error_code: net.code,
    proven_at: new Date().toISOString(),
    notes,
  };
}

/** 是否可将「只读/断网」升级为已兑现硬承诺文案 */
export function osSandboxFullyProven(proof: BaselineOsSandboxProof): boolean {
  return (
    proof.write_denied &&
    proof.network_denied &&
    proof.mode !== "logical_fallback"
  );
}

/**
 * 在 Darwin sandbox-exec 下跑 node -e 脚本（stdout 回收）。
 * 供扫描子进程使用。
 */
export function runNodeInOsSandbox(
  repoRoot: string,
  nodeSource: string,
  opts?: { timeoutMs?: number },
): OsSandboxRunResult {
  const mode = detectPreferredOsSandboxMode();
  if (mode === "sandbox-exec") {
    return runUnderDarwinSandbox(
      repoRoot,
      [process.execPath, "-e", nodeSource],
      opts,
    );
  }
  if (mode === "unshare-ro") {
    const r = spawnSync(
      "unshare",
      ["-n", "--", process.execPath, "-e", nodeSource],
      {
        encoding: "utf8",
        timeout: opts?.timeoutMs ?? 15_000,
        env: { ...process.env, STAGENT_OS_SANDBOX: "1" },
      },
    );
    return {
      ok: r.status === 0,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      exitCode: r.status,
      mode: "unshare-ro",
    };
  }
  // fallback：同进程不可证明；返回失败让调用方走逻辑扫描
  return {
    ok: false,
    stdout: "",
    stderr: "OS sandbox unavailable",
    exitCode: null,
    mode: "logical_fallback",
  };
}

export const __testOnly = {
  DARWIN_WRITE_OK,
  DARWIN_NET_OK,
  which,
  buildDarwinSeatbeltProfile,
};
