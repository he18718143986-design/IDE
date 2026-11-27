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

import fs from "node:fs";
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
  | "HOST_UNAVAILABLE"
  /**
   * TASK-W.9f：模型/CLI API key 不得以普通 Env 明文进入容器；
   * 必须走 `secretFiles` 只读挂载通道。
   */
  | "SECRET_IN_PLAIN_ENV"
  /** TASK-W.9f：secret 挂载目标非法（非绝对路径 / 覆盖 Worktree 挂载点） */
  | "SECRET_MOUNT_INVALID"
  /**
   * TASK-P0.3b-1: 挂载作用域合法性校验失败（路径逃逸、越出根、非法字符、重复或嵌套冲突）。
   * 坚决拒绝生成细粒度挂载规格并阻止容器启动（fail-closed 门禁）。
   */
  | "MOUNT_SCOPE_INVALID";

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

/**
 * TASK-W.9f：只读 secret 文件挂载（由 DockerContainerHost 物化到宿主临时文件后 `-v :ro`）。
 * 不走 `mounts`/`assertMountAllowed`（那些要求 source 落在 Worktree 内）；
 * 凭据内容只进临时文件与容器内约定路径，不得进普通 Env / 见证 / 日志。
 */
export interface SandboxSecretFile {
  /** 容器内绝对路径，例如 `/run/secrets/LLM_API_KEY` */
  containerPath: string;
  /** 明文内容（仅宿主侧临时文件与容器内文件；禁止写入日志/证据） */
  content: string;
  /**
   * 可选：注入「路径指针」环境变量，值为 `containerPath`（不是密钥明文）。
   * 例如 `LLM_API_KEY_FILE=/run/secrets/LLM_API_KEY`。
   */
  pathEnvKey?: string;
}

/** 不得再经普通 Env 直通的四类 API key（W.9f） */
export const CONTAINER_SECRET_ENV_KEYS = new Set([
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CURSOR_API_KEY",
]);

/** 容器内约定 secret 目录（只读挂载目标前缀） */
export const CONTAINER_SECRET_MOUNT_DIR = "/run/secrets";

/** 由 env 键名构造约定路径的 secret 文件描述 */
export function containerSecretFile(
  envKey: string,
  content: string,
): SandboxSecretFile {
  return {
    containerPath: `${CONTAINER_SECRET_MOUNT_DIR}/${envKey}`,
    content,
    pathEnvKey: `${envKey}_FILE`,
  };
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
  /**
   * TASK-W.9f：只读 secret 文件（宿主物化后挂载；不经 Worktree mounts 围栏）。
   * 与 `env` 互斥于 `CONTAINER_SECRET_ENV_KEYS`：那些键只能出现在这里。
   */
  secretFiles?: SandboxSecretFile[];
  /** 网络策略（缺省 DENY） */
  networkPolicy?: NetworkPolicy;
  /** `EXPLICIT_TARGETS` 时允许的出口目标 */
  allowedTargets?: string[];
  /** 超时毫秒（缺省 60_000） */
  timeoutMs?: number;
  /**
   * 容器内普通环境变量。
   * 不得包含 `CONTAINER_SECRET_ENV_KEYS`（否则 `SECRET_IN_PLAIN_ENV`）；
   * 密钥改走 `secretFiles`。
   */
  env?: Record<string, string>;
  /** TASK-P0.3b-2: 细粒度挂载范围 */
  scope?:
    | {
        writable_paths?: readonly string[] | undefined;
      }
    | undefined;
  /** TASK-P0.3b-2: 容器挂载模式 */
  mountMode?: SandboxMountMode | undefined;
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
  /** TASK-P0.3b-2: 实际生效挂载模式 */
  mountMode?: SandboxMountMode | undefined;
  /** TASK-P0.3b-2: 实际生效挂载项总数 */
  mountCount?: number | undefined;
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
  /** TASK-P0.3b-2: 实际生效挂载模式 */
  readonly mount_mode?: SandboxMountMode | undefined;
  /** TASK-P0.3b-2: 实际生效挂载项总数 */
  readonly mount_count?: number | undefined;
  /** TASK-P1.4: 见证 Nonce 与上下文绑定 */
  readonly nonce?: string | undefined;
  readonly contract_id?: string | undefined;
  readonly contract_revision?: number | undefined;
  readonly session_id?: string | undefined;
}

export interface VerifySandboxWitnessOptions {
  expectedWorktreeRoot?: string | undefined;
  expectedNonce?: string | undefined;
  expectedContractId?: string | undefined;
  expectedContractRevision?: number | undefined;
  expectedSessionId?: string | undefined;
  requireNonce?: boolean | undefined;
}

/** 依据宿主实际执行结果产出见证（唯一产出点） */
export function sandboxWitness(
  host: ContainerHostPort,
  input: SandboxRunInput,
  outcome: SandboxRunOutcome,
): SandboxWitness {
  const mountMode = outcome.mountMode ?? input.mountMode;
  const mountCount = outcome.mountCount;
  return {
    host_kind: host.kind ?? "unknown",
    via: outcome.via,
    exit_code: outcome.exitCode,
    duration_ms: outcome.durationMs,
    worktree_root: input.worktreeRoot,
    ...(mountMode !== undefined ? { mount_mode: mountMode } : {}),
    ...(mountCount !== undefined ? { mount_count: mountCount } : {}),
  };
}

export class SandboxWitnessValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SandboxWitnessValidationError";
    this.code = code;
  }
}

/**
 * TASK-P0.3a: 深度核验沙箱见证（P03A-P4）。
 *
 * 严格断言：
 * 1. witness 必须存在且为对象；
 * 2. via 必须严格等于 "exit"（排除 timeout, rejected, SIGKILL 冒认受控）；
 * 3. host_kind 必须非空且不能为 "unknown" 或包含 "unavailable"（如 "docker/unavailable"）；
 * 4. worktree_root 规范化后与合同工作树严格相等（当提供 expectedWorktreeRoot 时）；
 * 5. exit_code 只记录不断言（见证证明确实在沙箱运行过，Worker 执行失败由 verdict 阻断，不否定见证真实性）。
 *
 * 校验失败抛出 SandboxWitnessValidationError（带错误码）；通过返回合法见证。
 */
export function verifySandboxWitness(
  witness: SandboxWitness | undefined | null,
  expectedWorktreeRootOrOptions?: string | VerifySandboxWitnessOptions,
  optionsInput?: VerifySandboxWitnessOptions,
): SandboxWitness {
  const options: VerifySandboxWitnessOptions =
    typeof expectedWorktreeRootOrOptions === "object" &&
    expectedWorktreeRootOrOptions !== null
      ? expectedWorktreeRootOrOptions
      : {
          expectedWorktreeRoot: expectedWorktreeRootOrOptions,
          ...optionsInput,
        };
  const expectedWorktreeRoot = options.expectedWorktreeRoot;
  if (!witness || typeof witness !== "object") {
    throw new SandboxWitnessValidationError(
      "WITNESS_MISSING",
      "缺少沙箱执行见证（sandbox_witness）",
    );
  }

  if (witness.via !== "exit") {
    throw new SandboxWitnessValidationError(
      "WITNESS_VIA_INVALID",
      `沙箱见证终止方式非法: ${String(witness.via)}，仅允许 "exit"（排除 timeout/rejected/SIGKILL 冒认受控）`,
    );
  }

  const hostKind = witness.host_kind;
  if (
    !hostKind ||
    typeof hostKind !== "string" ||
    hostKind.trim() === "" ||
    hostKind === "unknown" ||
    hostKind.toLowerCase().includes("unavailable")
  ) {
    throw new SandboxWitnessValidationError(
      "WITNESS_HOST_KIND_INVALID",
      `沙箱宿主类型非法: ${String(hostKind)}（不得为 unknown 或 unavailable）`,
    );
  }

  if (
    !witness.worktree_root ||
    typeof witness.worktree_root !== "string" ||
    witness.worktree_root.trim() === ""
  ) {
    throw new SandboxWitnessValidationError(
      "WITNESS_WORKTREE_INVALID",
      "沙箱见证工作树路径非法",
    );
  }

  if (expectedWorktreeRoot !== undefined) {
    const normWitness = path.resolve(witness.worktree_root);
    const normExpected = path.resolve(expectedWorktreeRoot);
    const match =
      process.platform === "win32"
        ? normWitness.toLowerCase() === normExpected.toLowerCase()
        : normWitness === normExpected;
    if (!match) {
      throw new SandboxWitnessValidationError(
        "WITNESS_WORKTREE_MISMATCH",
        `沙箱见证工作树不匹配: 见证挂载=${normWitness}, 预期=${normExpected}`,
      );
    }
  }

  // TASK-P0.3b-2: 挂载模式有效性校验
  if (witness.mount_mode !== undefined) {
    if (
      witness.mount_mode !== "scoped" &&
      witness.mount_mode !== "readonly_enforced" &&
      witness.mount_mode !== "legacy_full_rw"
    ) {
      throw new SandboxWitnessValidationError(
        "WITNESS_MOUNT_MODE_INVALID",
        `沙箱见证挂载模式非法: ${String(witness.mount_mode)}，仅允许 scoped / readonly_enforced / legacy_full_rw`,
      );
    }
  }

  // TASK-P0.3b-2: 挂载点数量有效性校验
  if (witness.mount_count !== undefined) {
    if (
      typeof witness.mount_count !== "number" ||
      !Number.isInteger(witness.mount_count) ||
      witness.mount_count < 0
    ) {
      throw new SandboxWitnessValidationError(
        "WITNESS_MOUNT_COUNT_INVALID",
        `沙箱见证挂载点数量非法: ${String(witness.mount_count)}`,
      );
    }
  }

  // TASK-P1.4: 见证 Nonce 与会话级绑定深度校验
  if (options.requireNonce === true) {
    if (
      !witness.nonce ||
      typeof witness.nonce !== "string" ||
      witness.nonce.trim() === ""
    ) {
      throw new SandboxWitnessValidationError(
        "WITNESS_NONCE_MISSING",
        "沙箱见证缺少 Nonce 绑定（nonce 为空或未设置）",
      );
    }
  }

  if (witness.nonce !== undefined) {
    if (typeof witness.nonce !== "string" || witness.nonce.trim() === "") {
      throw new SandboxWitnessValidationError(
        "WITNESS_NONCE_INVALID",
        "沙箱见证 Nonce 格式非法",
      );
    }
    if (
      options.expectedNonce !== undefined &&
      witness.nonce !== options.expectedNonce
    ) {
      throw new SandboxWitnessValidationError(
        "WITNESS_NONCE_MISMATCH",
        `沙箱见证 Nonce 不匹配: 见证=${witness.nonce}, 预期=${options.expectedNonce}`,
      );
    }
  }

  if (
    options.expectedContractId !== undefined &&
    witness.contract_id !== undefined &&
    witness.contract_id !== options.expectedContractId
  ) {
    throw new SandboxWitnessValidationError(
      "WITNESS_CONTRACT_MISMATCH",
      `沙箱见证合同绑定不匹配: 见证=${witness.contract_id}, 预期=${options.expectedContractId}`,
    );
  }

  if (
    options.expectedContractRevision !== undefined &&
    witness.contract_revision !== undefined &&
    witness.contract_revision !== options.expectedContractRevision
  ) {
    throw new SandboxWitnessValidationError(
      "WITNESS_REVISION_MISMATCH",
      `沙箱见证合同版本绑定不匹配: 见证=${witness.contract_revision}, 预期=${options.expectedContractRevision}`,
    );
  }

  if (
    options.expectedSessionId !== undefined &&
    witness.session_id !== undefined &&
    witness.session_id !== options.expectedSessionId
  ) {
    throw new SandboxWitnessValidationError(
      "WITNESS_SESSION_MISMATCH",
      `沙箱见证会话绑定不匹配: 见证=${witness.session_id}, 预期=${options.expectedSessionId}`,
    );
  }

  return witness;
}

/**
 * 判定沙箱见证是否合法有效（纯布尔判定，不抛错）。
 */
export function isSandboxWitnessValid(
  witness: SandboxWitness | undefined | null,
  expectedWorktreeRootOrOptions?: string | VerifySandboxWitnessOptions,
  options?: VerifySandboxWitnessOptions,
): boolean {
  try {
    verifySandboxWitness(witness, expectedWorktreeRootOrOptions, options);
    return true;
  } catch {
    return false;
  }
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

  for (const key of Object.keys(input.env ?? {})) {
    if (CONTAINER_SECRET_ENV_KEYS.has(key)) {
      throw new SandboxRejectedError(
        "SECRET_IN_PLAIN_ENV",
        `secret key ${key} must not be passed as plain container Env; use secretFiles (TASK-W.9f)`,
      );
    }
  }

  for (const secret of input.secretFiles ?? []) {
    if (
      typeof secret.containerPath !== "string" ||
      !secret.containerPath.startsWith("/") ||
      secret.containerPath === "/" ||
      path.posix.normalize(secret.containerPath) !== secret.containerPath
    ) {
      throw new SandboxRejectedError(
        "SECRET_MOUNT_INVALID",
        `secret containerPath must be a normalized absolute path: ${String(secret.containerPath)}`,
      );
    }
    if (typeof secret.content !== "string") {
      throw new SandboxRejectedError(
        "SECRET_MOUNT_INVALID",
        "secret content must be a string",
      );
    }
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

// ============================================================================
// TASK-P0.3b-1: 容器文件系统 Scope 强制挂载纯函数与宿主占位辅助
// ============================================================================

/**
 * P0-3b-1: 挂载模式枚举。
 * - `scoped`: 细粒度只读根 + 授权路径独立读写绑定（施工阶段默认）；
 * - `readonly_enforced`: 全量只读挂载，严禁任何 :rw 挂载（验收阶段）。
 */
export type MountMode = "scoped" | "readonly_enforced";

/**
 * TASK-P0.3b-2: 容器实际生效的挂载模式枚举（包含向后兼容的全卷读写）。
 */
export type SandboxMountMode = MountMode | "legacy_full_rw";

/**
 * 挂载项条目规格。
 */
export interface MountEntry {
  type: "bind" | "tmpfs";
  /** 宿主绝对路径（bind 挂载必填；tmpfs 无宿主源路径） */
  source?: string;
  /** 容器内绝对路径（如 `/work` 或 `/work/.git` 或 `/work/src/foo.ts`） */
  target: string;
  /** 是否只读挂载（true 对应 `:ro`，false 对应 `:rw`） */
  readonly: boolean;
}

/**
 * 细粒度挂载计算结果规格。
 */
export interface ScopedMountSpec {
  /** 挂载模式 */
  readonly mode: MountMode;
  /** 宿主任务工作树根目录绝对路径 */
  readonly worktreeRoot: string;
  /** 容器内工作树根目录（缺省 `/work`） */
  readonly containerWorkRoot: string;
  /** 规范化后的授权可写相对路径列表（仅 scoped 模式有值；readonly_enforced 模式为空） */
  readonly writablePaths: readonly string[];
  /** 挂载项清单（顺序保真：根只读 -> .git tmpfs 遮蔽 -> 各 writable_paths 读写） */
  readonly entries: readonly MountEntry[];
  /** 需要在宿主侧预创建 0 字节空占位文件的相对路径清单 */
  readonly placeholderPaths: readonly string[];
  /** 预生成的 docker run 挂载参数片段（`-v` 与 `--tmpfs` 参数列表） */
  readonly dockerArgs: readonly string[];
}

export interface ResolveScopedMountsOptions {
  /** 容器内工作区根路径，缺省 `/work` */
  containerWorkRoot?: string;
  /** 挂载模式，缺省 `scoped` */
  mode?: MountMode;
  /**
   * 可选的文件存在性检测函数（用于纯函数单测计算占位路径，不依赖真实磁盘 I/O）。
   * 接受相对路径 relPath，返回 boolean 表示宿主是否存在该文件。
   * 若未传入，默认在宿主文件系统上通过 fs.existsSync 进行检测。
   */
  fileExists?: (relPath: string) => boolean;
}

export interface PreparePlaceholdersResult {
  /** 宿主侧成功创建的空占位文件绝对路径列表 */
  created: string[];
  /** 宿主侧已存在的路径绝对路径列表 */
  existing: string[];
}

/** 非法字符校验正则（禁止空字节、冒号、回车换行等控制字符、反斜杠） */
function hasForbiddenPathChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 31 || str[i] === ":" || str[i] === "\\") {
      return true;
    }
  }
  return false;
}

/**
 * 纯函数：将 worktreeRoot 与 writable_paths 计算为细粒度容器挂载规格。
 *
 * 核心安全规则（fail-closed，任何违规抛出 `MOUNT_SCOPE_INVALID`）：
 * 1. 禁止 `..` 路径遍历逃逸；
 * 2. 禁止绝对路径越出 worktreeRoot；
 * 3. 禁止非法字符（空字符、冒号、控制字符、反斜杠）；
 * 4. 禁止将 Worktree 根目录直接作为 writable 挂载；
 * 5. 禁止包含受保护目录段（如 `.git`、`.stagent`）；
 * 6. 禁止重复挂载路径；
 * 7. 禁止嵌套读写冲突（如父子目录/文件同为可写）。
 *
 * 生成规格：
 * - 根挂载：worktreeRoot -> containerWorkRoot:ro
 * - .git 遮蔽：tmpfs -> containerWorkRoot/.git (rw,noexec,nosuid)
 * - 授权路径：worktreeRoot/path -> containerWorkRoot/path:rw (仅 scoped 模式)
 *
 * @throws SandboxRejectedError (code: MOUNT_SCOPE_INVALID) 当且仅当校验失败时
 */
export function resolveScopedMounts(
  worktreeRoot: string,
  writablePaths: readonly string[] = [],
  options?: ResolveScopedMountsOptions,
): ScopedMountSpec {
  if (
    !worktreeRoot ||
    typeof worktreeRoot !== "string" ||
    worktreeRoot.trim() === ""
  ) {
    throw new SandboxRejectedError(
      "MOUNT_SCOPE_INVALID",
      "worktreeRoot must be a non-empty string",
    );
  }

  const normalizedRoot = path.resolve(worktreeRoot);

  const containerWorkRoot = options?.containerWorkRoot ?? "/work";
  if (
    typeof containerWorkRoot !== "string" ||
    !containerWorkRoot.startsWith("/") ||
    containerWorkRoot === "/" ||
    path.posix.normalize(containerWorkRoot) !== containerWorkRoot
  ) {
    throw new SandboxRejectedError(
      "MOUNT_SCOPE_INVALID",
      `containerWorkRoot must be a normalized absolute path and not root: ${String(containerWorkRoot)}`,
    );
  }

  const mode = options?.mode ?? "scoped";
  if (mode !== "scoped" && mode !== "readonly_enforced") {
    throw new SandboxRejectedError(
      "MOUNT_SCOPE_INVALID",
      `Unsupported mount mode: ${String(mode)}`,
    );
  }

  if (!Array.isArray(writablePaths)) {
    throw new SandboxRejectedError(
      "MOUNT_SCOPE_INVALID",
      "writablePaths must be an array",
    );
  }

  const normalizedWritables: string[] = [];
  const seenPaths = new Set<string>();

  for (const raw of writablePaths) {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new SandboxRejectedError(
        "MOUNT_SCOPE_INVALID",
        `Invalid path in writablePaths: ${String(raw)}`,
      );
    }

    if (hasForbiddenPathChars(raw)) {
      throw new SandboxRejectedError(
        "MOUNT_SCOPE_INVALID",
        `Path contains forbidden characters: ${raw}`,
      );
    }

    // 严禁 .. 路径穿越
    if (raw.split("/").includes("..") || raw.includes("..")) {
      throw new SandboxRejectedError(
        "MOUNT_SCOPE_INVALID",
        `Path traversal ('..') is strictly forbidden: ${raw}`,
      );
    }

    // 处理绝对路径或相对路径
    let rel: string;
    if (path.isAbsolute(raw)) {
      const resolved = path.resolve(raw);
      const relFromRoot = path.relative(normalizedRoot, resolved);
      if (
        relFromRoot.startsWith("..") ||
        path.isAbsolute(relFromRoot) ||
        relFromRoot === ""
      ) {
        throw new SandboxRejectedError(
          "MOUNT_SCOPE_INVALID",
          `Absolute path escapes worktree root (${normalizedRoot}): ${raw}`,
        );
      }
      rel = relFromRoot.split(path.sep).join("/");
    } else {
      // 规范化相对路径
      const segments = raw.split("/").filter((s) => s.length > 0 && s !== ".");
      if (segments.length === 0) {
        throw new SandboxRejectedError(
          "MOUNT_SCOPE_INVALID",
          `Cannot mount worktree root as writable: ${raw}`,
        );
      }
      rel = segments.join("/");
    }

    // 再次检验规范化后的相对路径是否为空或根
    if (rel === "" || rel === ".") {
      throw new SandboxRejectedError(
        "MOUNT_SCOPE_INVALID",
        `Cannot mount worktree root as writable: ${raw}`,
      );
    }

    // 严禁包含受保护路径段
    const segs = rel.split("/");
    for (const seg of segs) {
      if (PROTECTED_SEGMENTS.includes(seg)) {
        throw new SandboxRejectedError(
          "MOUNT_SCOPE_INVALID",
          `Cannot mount protected segment '${seg}' as writable: ${raw}`,
        );
      }
    }

    // 重复挂载校验
    if (seenPaths.has(rel)) {
      throw new SandboxRejectedError(
        "MOUNT_SCOPE_INVALID",
        `Duplicate mount path in writablePaths: ${rel}`,
      );
    }

    // 嵌套读写冲突校验（前缀冲突）
    for (const existing of seenPaths) {
      if (rel.startsWith(existing + "/")) {
        throw new SandboxRejectedError(
          "MOUNT_SCOPE_INVALID",
          `Nested mount conflict detected: '${existing}' is an ancestor of '${rel}'`,
        );
      }
      if (existing.startsWith(rel + "/")) {
        throw new SandboxRejectedError(
          "MOUNT_SCOPE_INVALID",
          `Nested mount conflict detected: '${rel}' is an ancestor of '${existing}'`,
        );
      }
    }

    seenPaths.add(rel);
    normalizedWritables.push(rel);
  }

  // 1. 根目录只读挂载
  const rootEntry: MountEntry = {
    type: "bind",
    source: normalizedRoot,
    target: containerWorkRoot,
    readonly: true,
  };

  // 2. /work/.git tmpfs 隔离遮蔽
  const gitTmpfsTarget = path.posix.join(containerWorkRoot, ".git");
  const gitTmpfsEntry: MountEntry = {
    type: "tmpfs",
    target: gitTmpfsTarget,
    readonly: false,
  };

  // 挂载项与 dockerArgs 初始化
  const entries: MountEntry[] = [rootEntry, gitTmpfsEntry];
  const dockerArgs: string[] = [
    "-v",
    `${normalizedRoot}:${containerWorkRoot}:ro`,
    "--tmpfs",
    `${gitTmpfsTarget}:rw,noexec,nosuid`,
  ];

  // 验收只读模式：严禁生成任何 :rw 挂载
  if (mode === "readonly_enforced") {
    return {
      mode: "readonly_enforced",
      worktreeRoot: normalizedRoot,
      containerWorkRoot,
      writablePaths: [],
      entries,
      placeholderPaths: [],
      dockerArgs,
    };
  }

  // scoped 模式：生成各授权路径的独立读写挂载
  const placeholderPaths: string[] = [];
  const fileExistsFn =
    options?.fileExists ??
    ((relPath: string) => {
      try {
        return fs.existsSync(path.resolve(normalizedRoot, relPath));
      } catch {
        return false;
      }
    });

  for (const rel of normalizedWritables) {
    const hostSource = path.resolve(normalizedRoot, rel);
    const containerTarget = path.posix.join(containerWorkRoot, rel);

    entries.push({
      type: "bind",
      source: hostSource,
      target: containerTarget,
      readonly: false,
    });

    dockerArgs.push("-v", `${hostSource}:${containerTarget}:rw`);

    if (!fileExistsFn(rel)) {
      placeholderPaths.push(rel);
    }
  }

  return {
    mode: "scoped",
    worktreeRoot: normalizedRoot,
    containerWorkRoot,
    writablePaths: normalizedWritables,
    entries,
    placeholderPaths,
    dockerArgs,
  };
}

/**
 * 宿主侧占位文件预置辅助函数（P03B1-P3）。
 *
 * 若 writable_paths 包含尚未存在的目标文件路径，在宿主文件系统预创建 0 字节空占位文件，
 * 防止 Docker daemon 自动创建为目录导致文件挂载失败。
 * 针对已存在的文件或目录则予以保留并不覆盖。
 */
export function prepareHostPlaceholders(
  specOrRoot:
    | ScopedMountSpec
    | {
        worktreeRoot: string;
        writablePaths?: readonly string[];
        placeholderPaths?: readonly string[];
      }
    | string,
  paths?: readonly string[],
): PreparePlaceholdersResult {
  let root: string;
  let targetPaths: readonly string[];

  if (typeof specOrRoot === "string") {
    root = path.resolve(specOrRoot);
    targetPaths = paths ?? [];
  } else if (
    "writablePaths" in specOrRoot &&
    Array.isArray(specOrRoot.writablePaths) &&
    specOrRoot.writablePaths.length > 0
  ) {
    root = path.resolve(specOrRoot.worktreeRoot);
    targetPaths = specOrRoot.writablePaths;
  } else if (
    "placeholderPaths" in specOrRoot &&
    Array.isArray(specOrRoot.placeholderPaths)
  ) {
    root = path.resolve(specOrRoot.worktreeRoot);
    targetPaths = specOrRoot.placeholderPaths;
  } else {
    root = path.resolve(specOrRoot.worktreeRoot);
    targetPaths = specOrRoot.writablePaths ?? [];
  }

  const created: string[] = [];
  const existing: string[] = [];

  for (const rel of targetPaths) {
    const fullPath = path.resolve(root, rel);
    if (fs.existsSync(fullPath)) {
      existing.push(fullPath);
    } else {
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      // 创建 0 字节空占位文件
      const fd = fs.openSync(fullPath, "w");
      fs.closeSync(fd);
      created.push(fullPath);
    }
  }

  return { created, existing };
}
