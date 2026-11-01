/**
 * TASK-L.15：发布生命周期纯函数层（状态机 + R-INV-1～3）。
 * 合同状态机与 MERGED 终态不变（ADR-0012 / ADR-0017）。
 */

export const RELEASE_SCHEMA_VERSION = "1.0.0" as const;

export type ReleaseState =
  | "RELEASE_DRAFT"
  | "BUILDING"
  | "DEPLOYING"
  | "CHECKING_HEALTH"
  | "LIVE"
  | "FAILED"
  | "ROLLING_BACK"
  | "ROLLED_BACK"
  | "SUPERSEDED";

export type ReleaseStepName = "build" | "deploy" | "health" | "rollback";

export interface ReleaseStep {
  step: ReleaseStepName;
  argv: string[];
  exit_code: number | null;
  started_at: string;
  ended_at: string | null;
  /** 已脱敏 */
  log_tail: string;
}

export interface ReleaseRecord {
  schema_version: typeof RELEASE_SCHEMA_VERSION;
  release_id: string;
  target_id: string;
  commit_sha: string;
  contract_ids: string[];
  state: ReleaseState;
  previous_live_release_id: string | null;
  steps: ReleaseStep[];
  created_at: string;
  triggered_by: "USER";
  /** 白话意外说明（如两个版本都起不来 / rollback_supported:false） */
  incident?: string | null;
}

export const RELEASE_TRANSITIONS: Readonly<
  Record<ReleaseState, readonly ReleaseState[]>
> = {
  RELEASE_DRAFT: ["BUILDING"],
  BUILDING: ["DEPLOYING", "FAILED"],
  DEPLOYING: ["CHECKING_HEALTH", "FAILED"],
  CHECKING_HEALTH: ["LIVE", "ROLLING_BACK", "FAILED"],
  ROLLING_BACK: ["ROLLED_BACK", "FAILED"],
  LIVE: ["SUPERSEDED", "FAILED"],
  FAILED: [],
  ROLLED_BACK: [],
  SUPERSEDED: [],
};

export const TERMINAL_RELEASE_STATES: ReadonlySet<ReleaseState> = new Set([
  "FAILED",
  "ROLLED_BACK",
  "SUPERSEDED",
]);

/** 进行中（占坑）状态：不含 LIVE（LIVE 是稳定运行态，允许再开草稿） */
export const IN_FLIGHT_RELEASE_STATES: ReadonlySet<ReleaseState> = new Set([
  "RELEASE_DRAFT",
  "BUILDING",
  "DEPLOYING",
  "CHECKING_HEALTH",
  "ROLLING_BACK",
]);

export function isTerminalReleaseState(state: ReleaseState): boolean {
  return TERMINAL_RELEASE_STATES.has(state);
}

export function isInFlightReleaseState(state: ReleaseState): boolean {
  return IN_FLIGHT_RELEASE_STATES.has(state);
}

export function canTransition(
  from: ReleaseState,
  to: ReleaseState,
): boolean {
  return (RELEASE_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(
  from: ReleaseState,
  to: ReleaseState,
): void {
  if (!canTransition(from, to)) {
    throw new ReleaseInvariantError(
      "E_RELEASE_ILLEGAL_TRANSITION",
      `非法发布状态迁移：${from} → ${to}`,
    );
  }
}

export class ReleaseInvariantError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ReleaseInvariantError";
    this.code = code;
  }
}

/** R-INV-1：同一目标同一时刻至多一个 LIVE */
export function assertAtMostOneLive(
  releases: readonly ReleaseRecord[],
  targetId: string,
): void {
  const lives = releases.filter(
    (r) => r.target_id === targetId && r.state === "LIVE",
  );
  if (lives.length > 1) {
    throw new ReleaseInvariantError(
      "E_RELEASE_INV1",
      `目标 ${targetId} 同时有 ${lives.length} 个 LIVE 发布`,
    );
  }
}

/** R-INV-2：同一目标同一时刻至多一个进行中发布（不含 LIVE） */
export function assertAtMostOneActive(
  releases: readonly ReleaseRecord[],
  targetId: string,
): void {
  const active = releases.filter(
    (r) => r.target_id === targetId && isInFlightReleaseState(r.state),
  );
  if (active.length > 1) {
    throw new ReleaseInvariantError(
      "E_RELEASE_INV2",
      `目标 ${targetId} 已有进行中的发布，请等它结束再发`,
    );
  }
}

export type ReleaseTargetKind = "local_process" | "user_command";

export interface ReleaseTargetConfig {
  target_id: string;
  /** 白话名；缺省用 target_id */
  label?: string;
  kind: ReleaseTargetKind;
  /** local_process 端口；不得落在 4100～4110 / 4200～4210 */
  port?: number;
  health_path?: string;
  /** user_command：package.json script 名，或显式 argv */
  deploy_script?: string;
  deploy_argv?: string[];
  health_url?: string;
  health_argv?: string[];
  env_keys?: string[];
  /** 明文构建环境（不进保险库） */
  build_env?: Record<string, string>;
  /** 缺省 true；false 时探活失败只进 FAILED */
  rollback_supported?: boolean;
}

export interface ReleaseTargetsFile {
  targets: ReleaseTargetConfig[];
}

/** 保留给 Daemon / Console 的端口带，local_process 不得占用 */
export const RESERVED_PORT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [4100, 4110],
  [4200, 4210],
];

export function isReservedPort(port: number): boolean {
  return RESERVED_PORT_RANGES.some(([lo, hi]) => port >= lo && port <= hi);
}

export function validateTargetPort(port: number | undefined): void {
  if (port === undefined) return;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ReleaseInvariantError(
      "E_RELEASE_BAD_PORT",
      `端口 ${port} 非法`,
    );
  }
  if (isReservedPort(port)) {
    throw new ReleaseInvariantError(
      "E_RELEASE_RESERVED_PORT",
      `端口 ${port} 保留给 Daemon/Console，请换一个`,
    );
  }
}
