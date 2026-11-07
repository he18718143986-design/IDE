/**
 * TASK-W.9g：Cursor CLI 容器镜像与最小运行协议（钉死引用 + 实证门闩）。
 *
 * 本模块回答的问题很窄：
 * 1. 我们打算用哪张镜像、什么 argv/cwd/挂载/密钥通道去跑 cursor-agent；
 * 2. 这条协议是否已经在 **stagent 的** `runInSandbox` / `executeContainerCli`
 *    桥上实证通过。
 *
 * **不是**本模块回答的问题：
 * - 宿主侧 CA-06 / `CURSOR_AGENT_VERIFIED_ON`（那是本机/CI 上直接跑 CLI 的
 *   plan-mode 负例，与容器协议无关，禁止复用为本卡证明）；
 * - generic 容器桥可用 ≠ Cursor 在容器内可执行；
 * - 未把 `empirically_verified` 翻成 `true` 前，适配器必须保持
 *   `has_executor=false` 且 `run() → E_CURSOR_AGENT_NO_EXECUTOR`。
 *
 * 镜像候选来自 Docker Sandboxes 公开模板（`docker/sandbox-templates`），
 * 非漂浮标签对齐本仓库已记录的 CLI 构建号 `2026.10.01-e373342`。
 * digest 取自 Docker Hub 公开 layer 页的 index digest；**本机/本卡未
 * `docker pull` + `inspect` 确认，也未经 stagent 宿主跑通**，故
 * `empirically_verified` 恒为 false，直到另一次实测回填。
 */

import type { AdapterControlMode } from "../worker-adapter.interface";
import { resolveEvidenceControlMode } from "../worker-adapter.interface";
import {
  executeContainerCli,
  type ContainerCliExecutionResult,
} from "./container-cli-executor";
import type { ContainerHostPort, SandboxWitness } from "./container-host";

/** 与 `CURSOR_AGENT_MEASURED_CLI_VERSION` 对齐的非漂浮标签（不是 `:latest`） */
export const CURSOR_AGENT_CONTAINER_IMAGE_TAG =
  "docker/sandbox-templates:cursor-agent-2026.10.01-e373342-docker" as const;

/**
 * Hub 公开 index digest（tag `cursor-agent-docker` layer 页）。
 * 实证前仅作钉死引用；真正可执行前必须以本桥实测回填并翻
 * `empirically_verified`。
 */
export const CURSOR_AGENT_CONTAINER_IMAGE_DIGEST =
  "docker/sandbox-templates@sha256:bc735747bb7d30bbd85de0565e16b0f65a32df9dae06f82fba6348f316eabbed" as const;

/** 容器内 Worktree 挂载点 / cwd（与 OpenHands / DockerContainerHost 默认一致） */
export const CURSOR_AGENT_CONTAINER_WORK_ROOT = "/work" as const;

/**
 * 最小 argv 协议：复用宿主 `buildLaunch()` 的只读档形状，**禁止**镜像默认的
 * `--yolo` / `-f` / `--force`（那些是适配器禁用旗标）。
 *
 * `<prompt>` 由调用方替换。镜像 ENTRYPOINT 是否吞掉首参，必须在实证中确认；
 * 若 ENTRYPOINT 不兼容且宿主不可改 entrypoint，实证失败 → fail-closed（正确）。
 */
export const CURSOR_AGENT_CONTAINER_ARGV_TEMPLATE = [
  "cursor-agent",
  "--print",
  "--output-format",
  "stream-json",
  "--mode",
  "plan",
  "--workspace",
  CURSOR_AGENT_CONTAINER_WORK_ROOT,
  "--",
  "<prompt>",
] as const;

export const CURSOR_AGENT_CONTAINER_SECRET_ENV_KEY = "CURSOR_API_KEY" as const;
export const CURSOR_AGENT_CONTAINER_SECRET_PATH =
  `/run/secrets/${CURSOR_AGENT_CONTAINER_SECRET_ENV_KEY}` as const;

export type CursorAgentContainerEmpiricismFailureCode =
  | "E_CURSOR_CONTAINER_NO_API_KEY"
  | "E_CURSOR_CONTAINER_HOST_UNAVAILABLE"
  | "E_CURSOR_CONTAINER_EXEC_FAILED"
  | "E_CURSOR_CONTAINER_PROTOCOL_UNPROVEN";

/**
 * 钉死的协议对象。`empirically_verified` 是适配器执行门闩的**唯一**真相源；
 * 宿主 CA-06 的 `CURSOR_AGENT_VERIFIED_ON` **不得**写入或暗示本字段为 true。
 *
 * 注意：`empirically_verified` 类型是 `boolean`（运行时当前为 false），以便未来
 * 回填为 true 时不必改函数签名；**当前值必须保持 false**，直到容器桥实测通过。
 */
export const CURSOR_AGENT_CONTAINER_PROTOCOL: {
  readonly image_digest_ref: typeof CURSOR_AGENT_CONTAINER_IMAGE_DIGEST;
  readonly image_tag_ref: typeof CURSOR_AGENT_CONTAINER_IMAGE_TAG;
  readonly image_ref: typeof CURSOR_AGENT_CONTAINER_IMAGE_DIGEST;
  readonly container_work_root: typeof CURSOR_AGENT_CONTAINER_WORK_ROOT;
  readonly cwd: typeof CURSOR_AGENT_CONTAINER_WORK_ROOT;
  readonly argv_template: typeof CURSOR_AGENT_CONTAINER_ARGV_TEMPLATE;
  readonly secret_env_key: typeof CURSOR_AGENT_CONTAINER_SECRET_ENV_KEY;
  readonly secret_file_path: typeof CURSOR_AGENT_CONTAINER_SECRET_PATH;
  readonly network_policy: "DENY";
  readonly mounts: readonly [
    {
      readonly source: "<worktreeRoot>";
      readonly target: typeof CURSOR_AGENT_CONTAINER_WORK_ROOT;
      readonly readonly: false;
    },
  ];
  /** 未在 stagent 容器桥上实测通过前必须为 false */
  readonly empirically_verified: boolean;
  readonly empirically_verified_at: string | undefined;
  readonly host_ca06_verified_on_is_not_protocol_proof: true;
  readonly notes: readonly string[];
} = {
  image_digest_ref: CURSOR_AGENT_CONTAINER_IMAGE_DIGEST,
  image_tag_ref: CURSOR_AGENT_CONTAINER_IMAGE_TAG,
  /** 登记 / 宿主构造优先使用 digest 引用（防漂） */
  image_ref: CURSOR_AGENT_CONTAINER_IMAGE_DIGEST,
  container_work_root: CURSOR_AGENT_CONTAINER_WORK_ROOT,
  cwd: CURSOR_AGENT_CONTAINER_WORK_ROOT,
  argv_template: CURSOR_AGENT_CONTAINER_ARGV_TEMPLATE,
  secret_env_key: CURSOR_AGENT_CONTAINER_SECRET_ENV_KEY,
  secret_file_path: CURSOR_AGENT_CONTAINER_SECRET_PATH,
  /**
   * 隔离负例用 DENY；模型 API 可达性不在本协议「最小启动」范围内宣称。
   * （与 OpenHands 同纪律：DENY 下不声称端到端改动。）
   */
  network_policy: "DENY",
  mounts: [
    {
      source: "<worktreeRoot>",
      target: CURSOR_AGENT_CONTAINER_WORK_ROOT,
      readonly: false,
    },
  ],
  empirically_verified: false,
  empirically_verified_at: undefined,
  host_ca06_verified_on_is_not_protocol_proof: true,
  notes: [
    "Public Docker Sandboxes template image; not Cursor-official agent image claim",
    "Default sbx startup uses --yolo — our protocol forbids that flag",
    "Host CA-06 / CURSOR_AGENT_VERIFIED_ON ≠ container protocol proof",
    "Generic runInSandbox bridge availability ≠ Cursor executable in container",
  ],
};

export type CursorAgentContainerProtocol =
  typeof CURSOR_AGENT_CONTAINER_PROTOCOL;

/** 适配器 / 注册表共用的实证门闩 */
export function isCursorAgentContainerProtocolProven(): boolean {
  return CURSOR_AGENT_CONTAINER_PROTOCOL.empirically_verified === true;
}

export interface CursorAgentContainerEmpiricismEvidence {
  measured_at: string;
  protocol_image_ref: string;
  protocol_image_tag_ref: string;
  empirically_verified: boolean;
  failure_code?: CursorAgentContainerEmpiricismFailureCode;
  failure_detail?: string;
  host_kind?: string;
  host_available?: boolean;
  has_api_key: boolean;
  witness_present: boolean;
  evidence_control_mode?: AdapterControlMode;
  /** 宿主 CA-06 不得被当作本证据的成功条件 */
  reused_host_ca06_verified_on: false;
}

export interface CursorAgentContainerEmpiricismResult {
  empirically_verified: boolean;
  evidence: CursorAgentContainerEmpiricismEvidence;
  witness?: SandboxWitness;
  execution?: ContainerCliExecutionResult;
}

function buildArgv(prompt: string): string[] {
  return CURSOR_AGENT_CONTAINER_ARGV_TEMPLATE.map((part) =>
    part === "<prompt>" ? prompt : part,
  );
}

function baseEvidence(input: {
  measuredAt: string;
  hasKey: boolean;
  host: ContainerHostPort | undefined;
  hostAvailable: boolean | undefined;
}): CursorAgentContainerEmpiricismEvidence {
  return {
    measured_at: input.measuredAt,
    protocol_image_ref: CURSOR_AGENT_CONTAINER_PROTOCOL.image_ref,
    protocol_image_tag_ref: CURSOR_AGENT_CONTAINER_PROTOCOL.image_tag_ref,
    empirically_verified: false,
    has_api_key: input.hasKey,
    witness_present: false,
    reused_host_ca06_verified_on: false,
    ...(input.host?.kind !== undefined ? { host_kind: input.host.kind } : {}),
    ...(input.hostAvailable === undefined
      ? {}
      : { host_available: input.hostAvailable }),
  };
}

/**
 * 尝试一次最小容器实证（或在缺 KEY / 缺宿主时留下失败证据）。
 *
 * 纪律：
 * - **不得**因缺 KEY/缺容器而 skip 冒充通过——调用方必须消费返回的 evidence；
 * - 即便本次调用碰巧成功产出 witness，只要模块常量
 *   `empirically_verified === false`，结果仍报 `empirically_verified: false`
 *   并带 `E_CURSOR_CONTAINER_PROTOCOL_UNPROVEN`（常量回填是另一次显式变更，
 *   与 CA-06 填 `CURSOR_AGENT_VERIFIED_ON` 同纪律）；
 * - **禁止**本地 spawn / Gateway 会话 fallback。
 */
export async function attemptCursorAgentContainerEmpiricism(opts: {
  host?: ContainerHostPort | undefined;
  apiKey?: string | undefined;
  worktreeRoot: string;
  prompt?: string;
  signal?: AbortSignal;
}): Promise<CursorAgentContainerEmpiricismResult> {
  const measuredAt = new Date().toISOString();
  const apiKey = opts.apiKey?.trim() ?? "";
  const hasKey = apiKey.length > 0;
  const host = opts.host;
  const hostAvailable = host === undefined ? undefined : host.isAvailable();

  if (!hasKey) {
    return {
      empirically_verified: false,
      evidence: {
        ...baseEvidence({
          measuredAt,
          hasKey,
          host,
          hostAvailable,
        }),
        failure_code: "E_CURSOR_CONTAINER_NO_API_KEY",
        failure_detail:
          "CURSOR_API_KEY missing; refuse to skip-as-pass (TASK-W.9g P3). No local/Gateway fallback.",
      },
    };
  }

  if (host === undefined || hostAvailable !== true) {
    return {
      empirically_verified: false,
      evidence: {
        ...baseEvidence({
          measuredAt,
          hasKey,
          host,
          hostAvailable,
        }),
        failure_code: "E_CURSOR_CONTAINER_HOST_UNAVAILABLE",
        failure_detail:
          "container host unavailable or not injected; refuse to skip-as-pass (TASK-W.9g P3). No local spawn fallback.",
      },
    };
  }

  const execInput = {
    host,
    worktreeRoot: opts.worktreeRoot,
    argv: buildArgv(opts.prompt ?? "stagent W.9g container protocol probe"),
    cwd: CURSOR_AGENT_CONTAINER_WORK_ROOT,
    env: { CURSOR_API_KEY: apiKey },
    networkPolicy: CURSOR_AGENT_CONTAINER_PROTOCOL.network_policy,
    expectedArtifacts: [] as const,
    declaredControlMode: "SANDBOX_ENFORCED" as const,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };

  let execution: ContainerCliExecutionResult | undefined;
  let execError: string | undefined;
  try {
    execution = await executeContainerCli(execInput);
  } catch (error) {
    execError =
      error instanceof Error
        ? error.message
        : `unknown error: ${String(error)}`;
  }

  const proven = isCursorAgentContainerProtocolProven();

  if (execError !== undefined) {
    return {
      empirically_verified: false,
      evidence: {
        ...baseEvidence({ measuredAt, hasKey, host, hostAvailable }),
        failure_code: "E_CURSOR_CONTAINER_EXEC_FAILED",
        failure_detail: execError,
      },
    };
  }

  const witness = execution?.sandbox;
  const mode = resolveEvidenceControlMode("SANDBOX_ENFORCED", witness);

  if (!proven) {
    return {
      empirically_verified: false,
      evidence: {
        ...baseEvidence({ measuredAt, hasKey, host, hostAvailable }),
        failure_code: "E_CURSOR_CONTAINER_PROTOCOL_UNPROVEN",
        failure_detail:
          "Minimal container call returned a witness, but CURSOR_AGENT_CONTAINER_PROTOCOL.empirically_verified is still false pending explicit constant promotion (same discipline as CURSOR_AGENT_VERIFIED_ON). Adapter must keep NO_EXECUTOR.",
        witness_present: witness !== undefined,
        evidence_control_mode: mode,
      },
      ...(witness === undefined ? {} : { witness }),
      ...(execution === undefined ? {} : { execution }),
    };
  }

  return {
    empirically_verified: true,
    evidence: {
      ...baseEvidence({ measuredAt, hasKey, host, hostAvailable }),
      empirically_verified: true,
      witness_present: witness !== undefined,
      evidence_control_mode: mode,
    },
    ...(witness === undefined ? {} : { witness }),
    ...(execution === undefined ? {} : { execution }),
  };
}

/** 纯构建：由协议模板得到可断言的 argv（测试用） */
export function buildCursorAgentContainerArgv(prompt: string): string[] {
  return buildArgv(prompt);
}

/** 证据面：无见证不得记 SANDBOX_ENFORCED（供单测钉死 P4 相关口径） */
export function cursorAgentContainerEvidenceMode(
  witness: SandboxWitness | undefined,
): AdapterControlMode {
  return resolveEvidenceControlMode("SANDBOX_ENFORCED", witness);
}
