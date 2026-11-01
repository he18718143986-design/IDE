/**
 * TASK-L.16：旅程入口算 E 类分流上下文（纯函数）。
 * - liveTargetNames：当前 LIVE（及未插桩线上事故）目标白话名 / id
 * - hasInProgressContract：存在施工中合同（或请求所选合同仍在施工）
 *
 * 施工中 = PREPARING | EXECUTING | VERIFYING | PENDING_RESUME
 * （不含 DRAFT / PENDING_APPROVAL / AUDITED / MERGED / ABORTED）
 */

/** 与 supervisor §16.2「施工」幕对齐的 lifecycle */
export const CONSTRUCTION_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "PREPARING",
  "EXECUTING",
  "VERIFYING",
  "PENDING_RESUME",
]);

export function isConstructionLifecycle(state: string | null | undefined): boolean {
  if (!state) return false;
  return CONSTRUCTION_LIFECYCLE_STATES.has(state);
}

export interface LiveReleaseHint {
  state: string;
  target_id: string;
  /** 白话目标名；缺省用 target_id */
  target_label?: string | null;
  live_incident?: {
    target_id: string;
    target_label: string;
    stub_created?: boolean;
  } | null;
}

export interface ContractLifecycleHint {
  lifecycle_state: string;
}

/**
 * 收集 intent-router 匹配用的 LIVE 目标名字符串。
 * 含 target_label 与 target_id（用户可能叫任一种）。
 * 另并入未插桩 live_incident 的目标名——崩溃后 state 可能已 FAILED，
 * 但「本机又挂了」仍应能命中 E。
 */
export function collectLiveTargetNames(
  releases: readonly LiveReleaseHint[],
): string[] {
  const names = new Set<string>();
  for (const r of releases) {
    if (r.state === "LIVE") {
      const label = (r.target_label ?? "").trim();
      if (label) names.add(label);
      if (r.target_id.trim()) names.add(r.target_id.trim());
    }
    const inc = r.live_incident;
    if (inc && !inc.stub_created) {
      const label = (inc.target_label ?? "").trim();
      if (label) names.add(label);
      if (inc.target_id.trim()) names.add(inc.target_id.trim());
    }
  }
  return [...names].sort();
}

/**
 * 是否有施工中合同。
 * selectedContract：请求已带 contract_id 且该合同仍在施工 → 一律 true。
 */
export function hasInProgressConstruction(input: {
  contracts: readonly ContractLifecycleHint[];
  selectedContract?: ContractLifecycleHint | null;
}): boolean {
  if (
    input.selectedContract &&
    isConstructionLifecycle(input.selectedContract.lifecycle_state)
  ) {
    return true;
  }
  return input.contracts.some((c) =>
    isConstructionLifecycle(c.lifecycle_state),
  );
}

export interface JourneyLiveIncidentContext {
  liveTargetNames: string[];
  hasInProgressContract: boolean;
}

/** server / 测试共用的一次组装 */
export function buildJourneyLiveIncidentContext(input: {
  releases: readonly LiveReleaseHint[];
  contracts: readonly ContractLifecycleHint[];
  selectedContract?: ContractLifecycleHint | null;
}): JourneyLiveIncidentContext {
  return {
    liveTargetNames: collectLiveTargetNames(input.releases),
    hasInProgressContract: hasInProgressConstruction({
      contracts: input.contracts,
      selectedContract: input.selectedContract,
    }),
  };
}
