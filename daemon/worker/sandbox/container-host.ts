/**
 * TASK-W.5c-ii：容器运行时 `runInSandbox` —— OS 级隔离执行面。
 *
 * 纪律（§4.2.3 P-17 + ADR-0003）：
 * - **普通本地子进程严禁自称沙箱**。`daemon/worker/cli-host/process-host.ts`
 *   是普通子进程宿主，本模块**不**包装它、也不复用它冒充容器隔离。
 * - 本模块只做「围栏校验 + 编排宿主调用」；真实容器宿主的绑定
 *   （Docker / Podman）归 **`W.5c-iii`**，本卡以 `ContainerHostPort` 注入，
 *   mock / stub 即可确定性验收（CH-04：不要求本机容器运行时）。
 * - `daemon/baseline/os-sandbox.ts` 是**基线扫描器的自证工具**（证明扫描器
 *   自身只读/断网），不是执行沙箱，边界不同、不混用。
 */

import path from "node:path";
import type { NetworkPolicy } from "../../../src/lib/contract.schema";

/** 挂载失败原因码（围栏拒绝，一律失败关闭） */
export type SandboxRejectionCode =
  | "MOUNT_OUTSIDE_WORKTREE"
  | "MOUNT_PROTECTED_PATH"
  | "MOUNT_PATH_TRAVERSAL"
  | "CWD_OUTSIDE_WORKTREE"
  | "NETWORK_TARGET_NOT_ALLOWED"
  | "EMPTY_ARGV"
  /**
   * TASK-W.5c-iii：宿主自报不可用（探测失败 / 守护式复查失败）。
   * 与门禁的 `E_ADAPTER_SANDBOX_LOCKED` 互补：门禁在派工前拒，本码在执行时拒；
   * 两者都失败关闭，任何一方都不得降级为「本地照常执行」。
   */
  | "HOST_UNAVAILABLE";

export class SandboxRejectedError extends Error {
  readonly code: SandboxRejectionCode;
  constructor(code: SandboxRejectionCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SandboxRejectedError";
    this.code = code;
  }
}

/** 容器内挂载项：`source` 必须落在任务 Worktree 内 */
export interface SandboxMount {
  /** 宿主源路径（必须在 worktreeRoot 内且非保护区） */
  source: string;
  /** 容器内目标路径 */
  target: string;
  readonly?: boolean;
}

export interface SandboxRunInput {
  /** 任务 Worktree 绝对路径：唯一允许挂载进容器的宿主根 */
  worktreeRoot: string;
  /** 容器内工作目录（绝对或相对 worktreeRoot，必须在 Worktree 内） */
  cwd?: string;
  /** 待执行命令 argv（已分离，禁止 shell 字符串拼接） */
  argv: string[];
  /** 额外挂载请求（逐项经围栏校验） */
  mounts?: SandboxMount[];
  /** 网络策略（缺省 DENY） */
  networkPolicy?: NetworkPolicy;
  /** `EXPLICIT_TARGETS` 时允许的出口目标 */
  allowedTargets?: string[];
  /** 超时毫秒（缺省 60_000） */
  timeoutMs?: number;
  /** 容器内环境变量（不含任何宿主凭据） */
  env?: Record<string, string>;
}

export interface SandboxRunOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** 终止方式：`rejected` 表示未执行、被围栏拒绝（失败关闭） */
  via: "exit" | "timeout" | "SIGKILL" | "rejected";
  /** `via === "rejected"` 时的拒绝原因码 */
  rejection?: SandboxRejectionCode;
  durationMs: number;
}

/**
 * 容器宿主注入接口（W.5c-ii 定义，W.5c-iii 绑定真实实现）。
 *
 * 编排器持有并注入；`AdapterRegistry` 不持有执行能力（W.6 约束不变）。
 */
export interface ContainerHostPort {
  /** 宿主自报标识（如 `docker/29.6.1`）；能力有限、缺省视为 `unknown` */
  readonly kind?: string;
  /**
   * 宿主可用性（**同步**判定，保持派工门禁的同步语义）。
   * mock/stub 可确定性返回；真实宿主（`W.5c-iii`）在构造/注入前完成探测并缓存结果。
   */
  isAvailable(): boolean;
  /** 在隔离环境执行一次命令 */
  run(input: SandboxRunInput, signal?: AbortSignal): Promise<SandboxRunOutcome>;
}

/**
 * 沙箱执行见证（TASK-W.5c-iii）。
 *
 * 目的：让「`SANDBOX_ENFORCED` 派工未走 `runInSandbox`」**可被断言**，而不是靠
 * 代码评审的口头承诺。见证只能由 `sandboxWitness()` 依据「宿主实际返回的
 * `SandboxRunOutcome`」产出：没有宿主执行就没有 outcome，也就造不出见证。
 *
 * 局限（不虚报）：进程内无法做到密码学意义上的不可伪造；本见证是**结构性**约束
 * ——派工结果携带它、测试断言它、缺它即视为未入沙箱，配合「适配器无本地执行路径」
 * 共同封住「绕过容器本地执行」的口子。
 */
export interface SandboxWitness {
  /** 宿主自报标识（`unknown` = 宿主持有者未报告，不得据此宣称具体运行时） */
  readonly host_kind: string;
  readonly via: SandboxRunOutcome["via"];
  readonly exit_code: number | null;
  readonly duration_ms: number;
  /** 实际挂载进容器的唯一宿主根 */
  readonly worktree_root: string;
}

/** 依据宿主实际执行结果产出见证（唯一产出点） */
export function sandboxWitness(
  host: ContainerHostPort,
  input: SandboxRunInput,
  outcome: SandboxRunOutcome,
): SandboxWitness {
  return {
    host_kind: host.kind ?? "unknown",
    via: outcome.via,
    exit_code: outcome.exitCode,
    duration_ms: outcome.durationMs,
    worktree_root: input.worktreeRoot,
  };
}

/** 保护区：宿主这些路径一律不得挂载进容器 */
const PROTECTED_SEGMENTS = [".git", ".stagent"];

function normalize(p: string): string {
  return path.resolve(p);
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 挂载围栏：只放行任务 Worktree 内的路径，宿主根 / `.git` / `.stagent` 一律拒绝。
 * 抛出 `SandboxRejectedError`（失败关闭，不降级到「照常挂载」）。
 */
export function assertMountAllowed(worktreeRoot: string, source: string): void {
  const root = normalize(worktreeRoot);
  const target = normalize(source);

  // 路径穿越（含 `..` 解析后逃逸）
  if (source.includes("..")) {
    throw new SandboxRejectedError(
      "MOUNT_PATH_TRAVERSAL",
      `mount source must not contain '..': ${source}`,
    );
  }
  if (!isInside(root, target)) {
    throw new SandboxRejectedError(
      "MOUNT_OUTSIDE_WORKTREE",
      `mount source must stay inside task worktree (${root}): ${target}`,
    );
  }
  const rel = path.relative(root, target);
  const segments = rel === "" ? [] : rel.split(path.sep);
  for (const seg of segments) {
    if (PROTECTED_SEGMENTS.includes(seg)) {
      throw new SandboxRejectedError(
        "MOUNT_PROTECTED_PATH",
        `mount source must not include protected segment '${seg}': ${target}`,
      );
    }
  }
}

/** 网络围栏：`DENY` 禁止任何出口；`EXPLICIT_TARGETS` 只放行白名单 */
export function assertNetworkAllowed(
  policy: NetworkPolicy,
  targets: string[] | undefined,
): void {
  if (policy === "DENY") {
    if (targets !== undefined && targets.length > 0) {
      throw new SandboxRejectedError(
        "NETWORK_TARGET_NOT_ALLOWED",
        "network policy DENY: no egress target is allowed",
      );
    }
    return;
  }
  if (policy === "EXPLICIT_TARGETS") {
    if (targets === undefined || targets.length === 0) {
      throw new SandboxRejectedError(
        "NETWORK_TARGET_NOT_ALLOWED",
        "network policy EXPLICIT_TARGETS requires non-empty allowedTargets",
      );
    }
  }
}

/**
 * 围栏校验（纯逻辑，可在无容器环境下确定性断言 CH-01 / CH-02）。
 * 返回归一化后的输入；任何违规直接抛 `SandboxRejectedError`。
 */
export function validateSandboxInput(input: SandboxRunInput): SandboxRunInput {
  const root = normalize(input.worktreeRoot);

  if (!Array.isArray(input.argv) || input.argv.length === 0) {
    throw new SandboxRejectedError("EMPTY_ARGV", "argv must be non-empty");
  }

  if (input.cwd !== undefined) {
    const cwd = path.isAbsolute(input.cwd)
      ? normalize(input.cwd)
      : normalize(path.join(root, input.cwd));
    if (!isInside(root, cwd)) {
      throw new SandboxRejectedError(
        "CWD_OUTSIDE_WORKTREE",
        `cwd must stay inside task worktree (${root}): ${cwd}`,
      );
    }
  }

  for (const mount of input.mounts ?? []) {
    assertMountAllowed(root, mount.source);
  }

  assertNetworkAllowed(input.networkPolicy ?? "DENY", input.allowedTargets);

  return { ...input, worktreeRoot: root };
}

/**
 * 唯一执行入口：围栏校验（失败关闭）→ 交宿主执行 → 原样透出宿主终止态。
 *
 * 职责边界（不虚报）：
 * - **本模块不启动任何进程**，因此也不声称回收进程树：超时熔断与进程树回收
 *   （`killProcessTree` 纪律，W.1/A.4）属**宿主职责**，由 `W.5c-iii` 绑定真实
 *   容器宿主时落实；本模块把 `signal` / `timeoutMs` 透传给宿主，并把宿主返回的
 *   `via` 终止态如实回传（含 `timeout` / `SIGKILL`）。
 * - 取消发生在启动前时**不进入宿主执行**（返回 `SIGKILL` 终止态），避免孤儿。
 *
 * @param host 注入的容器宿主；**未注入或不通过围栏时不执行**（失败关闭）
 */
export async function runInSandbox(
  host: ContainerHostPort,
  input: SandboxRunInput,
  signal?: AbortSignal,
): Promise<SandboxRunOutcome> {
  const started = Date.now();
  const safe = validateSandboxInput(input);

  if (signal?.aborted === true) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "aborted before start",
      via: "SIGKILL",
      durationMs: Date.now() - started,
    };
  }

  const outcome = await host.run(safe, signal);
  return { ...outcome, durationMs: outcome.durationMs ?? Date.now() - started };
}
