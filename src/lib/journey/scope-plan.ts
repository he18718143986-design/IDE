/**
 * TASK-J.2 / SSOT §15.3：ScopePlan 类型与纯函数（前后端共享，零 fs）。
 *
 * - 范围预检与合同创建共用同一套结构；
 * - digest 确定性：同输入同输出；摘要不含 plan_digest 自身、不含时间戳；
 * - 禁止以原始聊天文本直推可签署范围（ADR-0018 INV-SEAL-01）——本模块只消费
 *   已结构化的 ScopePlan，不读聊天。
 */

import type {
  BudgetLimits,
  VerificationCommand,
} from "../contract.schema";

/** SSOT §15.3 ScopePlan */
export interface ScopePlanArea {
  id: string;
  label: string;
  why: string;
  module_ids: string[];
  kind: "change_existing" | "create_new";
  paths: string[];
  excluded_by_user: boolean;
}

export interface ScopePlanNeverTouch {
  label: string;
  paths: string[];
}

export interface ScopePlanNeedsApproval {
  id: string;
  label: string;
  why: string;
  paths: string[];
  /** null = 还没表态 */
  approved: boolean | null;
}

export interface ScopePlanVerification {
  commands: VerificationCommand[];
  plain: string[];
  manual_only: boolean;
}

export interface ScopePlanBudget {
  limits: BudgetLimits;
  plain: string;
}

export interface ScopePlanGrade {
  ok: boolean;
  rejected: { path: string; kind: string }[];
}

export interface ScopePlan {
  scheme_revision: number;
  plan_digest: string;
  areas: ScopePlanArea[];
  never_touch: ScopePlanNeverTouch[];
  needs_approval: ScopePlanNeedsApproval[];
  verification: ScopePlanVerification;
  budget: ScopePlanBudget;
  grade: ScopePlanGrade;
}

/** 用户对范围预检的表态（排除区域 / 敏感项授权） */
export interface ScopePlanDecisions {
  excluded_area_ids?: readonly string[];
  /** key = needs_approval[].id → 是否同意 */
  approvals?: Readonly<Record<string, boolean>>;
}

/** 合同范围投影（J.4 / J.5 共用；键名按卡面约定） */
export interface ContractScopeFromPlan {
  writable_paths: string[];
  forbidden_paths: string[];
  verification_spec: {
    commands: VerificationCommand[];
    manual_confirmation?: {
      reason_required: true;
      capture_evidence: Array<"actor" | "confirmed_at" | "reason">;
    };
  };
  budget: BudgetLimits;
}

/**
 * 规范化序列化：对象键排序、数组保序；用于 digest。
 * 与 daemon/pipeline/scheme-snapshot-store 口径一致，便于日后抽共享。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/**
 * 纯 JS SHA-256（同步）。避免 src/lib 引入 node:crypto，以便前后端共享。
 * 输出小写 hex，与 Node createHash('sha256') 对齐。
 */
function sha256Hex(message: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) & ~63));
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  // 大端 64-bit 长度：本模块消息远小于 2^32 字节，高 32 位为 0
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const v1 = w[j - 15]!;
      const v2 = w[j - 2]!;
      const s0 = rotr(v1, 7) ^ rotr(v1, 18) ^ (v1 >>> 3);
      const s1 = rotr(v2, 17) ^ rotr(v2, 19) ^ (v2 >>> 10);
      w[j] = (w[j - 16]! + s0 + w[j - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j]! + w[j]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
  let hex = "";
  for (const word of out) {
    hex += word.toString(16).padStart(8, "0");
  }
  return hex;
}

/** 参与 digest 的载荷：剔除 plan_digest 与任何 *At / timestamp 类字段 */
function digestBearingPlan(plan: ScopePlan): Omit<ScopePlan, "plan_digest"> {
  const { plan_digest: _drop, ...rest } = plan;
  return rest;
}

/**
 * ScopePlan 规范化摘要。同样的决策内容 → 同样的 hex；
 * 不含 `plan_digest` 自身，也不含时间戳字段。
 */
export function scopePlanDigest(plan: ScopePlan): string {
  const bearing = digestBearingPlan(plan);
  // 防御：若 areas/budget 等被污染进时间戳键，stableStringify 仍会纳入；
  // 构建器保证不写这类字段。这里再剥一层常见时间戳键名。
  const cleaned = JSON.parse(stableStringify(bearing)) as unknown;
  stripTimestampKeys(cleaned);
  return sha256Hex(stableStringify(cleaned));
}

function stripTimestampKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) stripTimestampKeys(entry);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key === "updatedAt" ||
      key === "created_at" ||
      key === "updated_at" ||
      key === "timestamp" ||
      /_at$/i.test(key)
    ) {
      delete record[key];
      continue;
    }
    stripTimestampKeys(record[key]);
  }
}

/**
 * 应用用户表态：排除区域 / 敏感项授权 → 新 plan 并重算 digest。
 * 纯函数：不读盘、不改入参。
 */
export function applyScopeDecisions(
  plan: ScopePlan,
  decisions: ScopePlanDecisions,
): ScopePlan {
  const excluded = new Set(decisions.excluded_area_ids ?? []);
  const approvals = decisions.approvals ?? {};

  const areas = plan.areas.map((area) => ({
    ...area,
    excluded_by_user: excluded.has(area.id) ? true : area.excluded_by_user,
  }));

  const needs_approval = plan.needs_approval.map((item) => {
    if (Object.prototype.hasOwnProperty.call(approvals, item.id)) {
      return { ...item, approved: approvals[item.id]! };
    }
    return { ...item };
  });

  // 排除后仍落在活跃可写路径上的拒绝项才保留；全部消掉则 grade.ok
  const activePaths = new Set(
    areas
      .filter((a) => !a.excluded_by_user)
      .flatMap((a) => a.paths),
  );
  const rejected = plan.grade.rejected.filter((r) => activePaths.has(r.path));
  const grade: ScopePlanGrade = {
    ok: rejected.length === 0,
    rejected: rejected.map((r) => ({ ...r })),
  };

  // delivery-lifecycle §5：排除区域 / 明确未授权的敏感项 → 追加进 never_touch
  const never_touch = plan.never_touch.map((g) => ({
    ...g,
    paths: [...g.paths],
  }));
  const neverSeen = new Set(never_touch.flatMap((g) => g.paths));
  const appendNever = (label: string, paths: readonly string[]): void => {
    const fresh = paths.filter((p) => !neverSeen.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) neverSeen.add(p);
    never_touch.push({ label, paths: [...fresh] });
  };
  for (const area of areas) {
    if (!area.excluded_by_user) continue;
    if (!excluded.has(area.id)) continue; // 仅本次决策新排除的区域
    appendNever(`已排除：${area.label}`, area.paths);
  }
  for (const item of needs_approval) {
    if (item.approved !== false) continue;
    if (!Object.prototype.hasOwnProperty.call(approvals, item.id)) continue;
    appendNever(`未授权：${item.label}`, item.paths);
  }

  const next: ScopePlan = {
    ...plan,
    areas,
    needs_approval,
    grade,
    never_touch,
    verification: {
      ...plan.verification,
      commands: plan.verification.commands.map((c) => ({
        ...c,
        args: [...c.args],
      })),
      plain: [...plan.verification.plain],
    },
    budget: {
      limits: { ...plan.budget.limits },
      plain: plan.budget.plain,
    },
    plan_digest: "",
  };
  next.plan_digest = scopePlanDigest(next);
  return next;
}

/**
 * 从 ScopePlan 投影合同范围字段（签署链唯一来源，ADR-0018）。
 * - 已排除区域不进入 writable_paths；
 * - 未获批（approved !== true）的 needs_approval 路径绝不能进入 writable_paths，
 *   即使它们也出现在 areas.paths（敏感项穿透门禁）；
 * - 仅 approved === true 的敏感项并入可写；
 * - never_touch 全部并入 forbidden_paths；
 * - manual_only 时带 manual_confirmation。
 */
export function scopePlanToContractScope(
  plan: ScopePlan,
): ContractScopeFromPlan {
  // 尚未明确获批的敏感路径：areas 循环中必须拦截
  const unapprovedProtectedPaths = new Set(
    plan.needs_approval
      .filter((item) => item.approved !== true)
      .flatMap((item) => item.paths),
  );

  const writable: string[] = [];
  const seen = new Set<string>();
  for (const area of plan.areas) {
    if (area.excluded_by_user) continue;
    for (const p of area.paths) {
      if (unapprovedProtectedPaths.has(p)) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      writable.push(p);
    }
  }

  // 仅明确同意的敏感项并入可写
  for (const item of plan.needs_approval) {
    if (item.approved !== true) continue;
    for (const p of item.paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      writable.push(p);
    }
  }

  const forbidden: string[] = [];
  const forbSeen = new Set<string>();
  for (const group of plan.never_touch) {
    for (const p of group.paths) {
      if (forbSeen.has(p)) continue;
      forbSeen.add(p);
      forbidden.push(p);
    }
  }

  const verification_spec: ContractScopeFromPlan["verification_spec"] = {
    commands: plan.verification.commands.map((c) => ({
      ...c,
      args: [...c.args],
    })),
  };
  if (plan.verification.manual_only) {
    verification_spec.manual_confirmation = {
      reason_required: true,
      capture_evidence: ["actor", "confirmed_at", "reason"],
    };
  }

  return {
    writable_paths: writable,
    forbidden_paths: forbidden,
    verification_spec,
    budget: { ...plan.budget.limits },
  };
}

/** 由文件数与时长生成白话规模（禁止 token / tool 字样） */
export function formatBudgetPlain(
  limits: Pick<BudgetLimits, "max_file_modifications" | "max_duration_seconds"> | BudgetLimits,
): string {
  const n = limits.max_file_modifications ?? 10;
  const secs = limits.max_duration_seconds ?? 1800;
  const maxMin = Math.max(1, Math.ceil(secs / 60));
  const minMin = Math.max(1, Math.round(maxMin * (2 / 3)));
  return `最多改约 ${n} 个文件，预计 ${minMin}～${maxMin} 分钟`;
}

/**
 * 路径 → 白话区域标签：去掉通配，避免 `**` / glob 字样进入用户面。
 */
export function plainAreaLabel(pathPattern: string, moduleName?: string): string {
  if (moduleName && moduleName.trim().length > 0) return moduleName.trim();
  const cleaned = pathPattern
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "");
  const trimmed = cleaned.replace(/\/+$/, "") || pathPattern;
  return `${trimmed} 这一块`;
}

/**
 * 从已有 ScopePlan 还原用户表态，供 Daemon 冻结时重跑 `buildScopePlan`。
 * - excluded_area_ids：excluded_by_user === true 的区域；
 * - approvals：仅纳入已表态（true/false）的敏感项，null 不写入。
 */
export function decisionsFromScopePlan(plan: ScopePlan): ScopePlanDecisions {
  const excluded_area_ids = plan.areas
    .filter((a) => a.excluded_by_user)
    .map((a) => a.id);
  const approvals: Record<string, boolean> = {};
  for (const item of plan.needs_approval) {
    if (item.approved === true || item.approved === false) {
      approvals[item.id] = item.approved;
    }
  }
  return { excluded_area_ids, approvals };
}

/** 合同侧与 ScopePlan 投影比对用的最小切片（J.4 签署链）。 */
export interface ContractScopeFields {
  writable_paths: readonly string[];
  strictly_forbidden_paths: readonly string[];
  verification_spec: {
    commands: unknown;
    manual_confirmation?: unknown;
  };
  budget_limits: unknown;
}

/**
 * 合同范围字段是否与 `scopePlanToContractScope(plan)` 一字不差。
 * 用稳定序列化比对，避免引用相等误判；路径数组顺序敏感（与投影保序一致）。
 */
export function contractMatchesScopePlan(
  contract: ContractScopeFields,
  plan: ScopePlan,
): boolean {
  const expected = scopePlanToContractScope(plan);
  const actualShape = {
    writable_paths: contract.writable_paths,
    forbidden_paths: contract.strictly_forbidden_paths,
    verification_spec: {
      commands: contract.verification_spec.commands,
      ...(contract.verification_spec.manual_confirmation !== undefined
        ? { manual_confirmation: contract.verification_spec.manual_confirmation }
        : {}),
    },
    budget: contract.budget_limits,
  };
  const expectedShape = {
    writable_paths: expected.writable_paths,
    forbidden_paths: expected.forbidden_paths,
    verification_spec: expected.verification_spec,
    budget: expected.budget,
  };
  return stableStringify(actualShape) === stableStringify(expectedShape);
}
