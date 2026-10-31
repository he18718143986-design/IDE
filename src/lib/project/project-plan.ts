/**
 * TASK-L.7：ProjectPlan 类型、SYSTEM_ACCEPTANCE 与确定性校验（纯函数，零 fs）。
 * 规格：project-decomposition.md §2、§3、§6、§8。
 */

import {
  dice,
  lexemes,
  matchNormalize,
} from "../journey/evidence-anchor";
import { GRAVEYARD_DICE_THRESHOLD } from "../journey/scheme-patch-types";
import type { SchemeDraftV2 } from "../journey/scheme-patch-types";

// ─── §2 数据模型 ───────────────────────────────────────────────

export interface ArchitectureBaselineRef {
  baseline_id: string;
  baseline_revision: number;
  baseline_digest: string;
}

export interface ProjectPlan {
  schema_version: "1.0.0";
  project_id: string;
  plan_revision: number;
  architecture_baseline_ref: ArchitectureBaselineRef;
  scheme_id: string;
  scheme_revision: number;
  milestones: Milestone[];
  contracts: ContractStub[];
  graveyard: RemovedStub[];
}

export interface Milestone {
  milestone_id: string;
  title: string;
  exit_acceptance_ids: string[];
  contract_ids: string[];
}

export type StubKind =
  | "feature"
  | "interface_first"
  | "test_foundation"
  | "refactor"
  | "knowledge_bootstrap"
  | "dependency";

export interface ContractStub {
  stub_id: string;
  milestone_id: string;
  kind: StubKind;
  origin: "scheme" | "system";
  context?: {
    release_id?: string;
    commit_sha?: string;
    log_tail?: string;
    flaky_test?: string;
    dependency?: { name: string; version: string };
  };
  title: string;
  scheme_item_ids: string[];
  acceptance_ids: string[];
  area_hints: string[];
  depends_on: string[];
  size_estimate: { files: number; diff_lines: number; minutes: number };
  status: "planned" | "signed" | "merged" | "aborted" | "superseded";
  contract_id: string | null;
}

export interface RemovedStub {
  stub_id: string;
  title: string;
  removed_by: "user" | "replan";
  reason: string;
  removed_in_revision: number;
}

/** §2.1 系统验收条目（系统桩固定引用） */
export const SYSTEM_ACCEPTANCE = [
  {
    id: "sys-acc-test-foundation",
    text: "项目 test 命令退出码 0，且冒烟测试被实际执行",
  },
  {
    id: "sys-acc-knowledge",
    text: "docs/system/ 通过 KB-1（覆盖全部源码文件）与 KB-4",
  },
  {
    id: "sys-acc-dependency",
    text: "依赖已安装，V0 与 V2 通过",
  },
  {
    id: "sys-acc-flaky",
    text: "该测试在同一候选上连续 5 次通过",
  },
  {
    id: "sys-acc-incident",
    text: "复现步骤对应的测试红→绿，且发布后探活通过",
  },
] as const;

export type SystemAcceptanceId = (typeof SYSTEM_ACCEPTANCE)[number]["id"];

export const SYSTEM_ACCEPTANCE_IDS: ReadonlySet<string> = new Set(
  SYSTEM_ACCEPTANCE.map((a) => a.id),
);

/** D-1 默认合同预算上限（对齐 contract.schema budget_limits） */
export const PLAN_SIZE_LIMITS = {
  files: 10,
  diff_lines: 2000,
  minutes: 30,
} as const;

/** 调用方传入的仓库事实（校验不读盘） */
export interface RepoFacts {
  /** false ⇒ 验证方式视为 manual_only（D-8） */
  has_test_script: boolean;
  /** false ⇒ 需要 knowledge_bootstrap（D-9） */
  has_modules_yaml: boolean;
  /** 已存在的目录列表（相对仓库根）；供后续面积规则使用 */
  existing_dirs: readonly string[];
}

export type PlanRuleId =
  | "D-1"
  | "D-2"
  | "D-3"
  | "D-4"
  | "D-5"
  | "D-6"
  | "D-7"
  | "D-8"
  | "D-9"
  | "D-10"
  | "D-11";

export interface PlanViolation {
  rule: PlanRuleId;
  target: string;
}

export interface PlanValidationResult {
  ok: boolean;
  violations: PlanViolation[];
}

/** 方案侧校验视图：接受完整 SchemeDraftV2 */
export type ProjectPlanScheme = Pick<
  SchemeDraftV2,
  | "scheme_id"
  | "scheme_revision"
  | "size_hint"
  | "goals"
  | "out_of_scope"
  | "modules"
  | "entities"
  | "acceptance"
>;

const SYSTEM_KINDS: ReadonlySet<StubKind> = new Set([
  "test_foundation",
  "knowledge_bootstrap",
  "dependency",
  "refactor",
  "feature",
]);

function systemKindAllowed(stub: ContractStub): boolean {
  if (!SYSTEM_KINDS.has(stub.kind)) return false;
  if (stub.kind === "refactor") return Boolean(stub.context?.flaky_test);
  if (stub.kind === "feature") {
    return Boolean(
      stub.context?.release_id ||
        stub.context?.commit_sha ||
        stub.context?.log_tail,
    );
  }
  if (stub.kind === "dependency") return Boolean(stub.context?.dependency);
  // test_foundation / knowledge_bootstrap：无额外 context 要求
  return stub.kind === "test_foundation" || stub.kind === "knowledge_bootstrap";
}

/** 里程碑顺序下的合同桩序列（合同序列「第一份」的权威次序） */
export function orderedStubs(plan: ProjectPlan): ContractStub[] {
  const byId = new Map(plan.contracts.map((c) => [c.stub_id, c]));
  const out: ContractStub[] = [];
  const seen = new Set<string>();
  for (const ms of plan.milestones) {
    for (const id of ms.contract_ids) {
      const s = byId.get(id);
      if (s && !seen.has(id)) {
        out.push(s);
        seen.add(id);
      }
    }
  }
  for (const s of plan.contracts) {
    if (!seen.has(s.stub_id)) out.push(s);
  }
  return out;
}

/**
 * G-MATCH-NL 标题比对（D-11）：规范化全等或 Dice ≥ 阈值。
 * 复用 evidence-anchor 的 matchNormalize / lexemes / dice（supervisor §14.11 小节 5）。
 */
export function titlesMatchNl(a: string, b: string): boolean {
  const ka = matchNormalize(a);
  const kb = matchNormalize(b);
  if (ka.length > 0 && ka === kb) return true;
  return dice(lexemes(a), lexemes(b)) >= GRAVEYARD_DICE_THRESHOLD;
}

function schemeItemIds(scheme: ProjectPlanScheme): Set<string> {
  const ids = new Set<string>();
  for (const g of scheme.goals) ids.add(g.id);
  for (const o of scheme.out_of_scope) ids.add(o.id);
  for (const m of scheme.modules) ids.add(m.id);
  for (const e of scheme.entities) ids.add(e.id);
  for (const a of scheme.acceptance) ids.add(a.id);
  return ids;
}

function acceptanceIdSet(scheme: ProjectPlanScheme): Set<string> {
  return new Set(scheme.acceptance.map((a) => a.id));
}

/**
 * validateProjectPlan：§3 D-1～D-11 全量确定性校验。
 * 纯函数：同一输入两次结果字节级相同；不触碰文件系统。
 */
export function validateProjectPlan(
  plan: ProjectPlan,
  scheme: ProjectPlanScheme,
  repoFacts: RepoFacts,
): PlanValidationResult {
  const violations: PlanViolation[] = [];
  const stubs = plan.contracts;
  const stubIds = new Set(stubs.map((s) => s.stub_id));
  const schemeIds = schemeItemIds(scheme);
  const schemeAcc = acceptanceIdSet(scheme);
  const outOfScopeIds = new Set(scheme.out_of_scope.map((o) => o.id));

  // D-1
  for (const s of stubs) {
    const { files, diff_lines, minutes } = s.size_estimate;
    if (
      files > PLAN_SIZE_LIMITS.files ||
      diff_lines > PLAN_SIZE_LIMITS.diff_lines ||
      minutes > PLAN_SIZE_LIMITS.minutes
    ) {
      violations.push({ rule: "D-1", target: s.stub_id });
    }
  }

  // D-2
  for (const s of stubs) {
    if (s.acceptance_ids.length < 1) {
      violations.push({ rule: "D-2", target: s.stub_id });
      continue;
    }
    if (s.origin === "scheme") {
      for (const id of s.acceptance_ids) {
        if (!schemeAcc.has(id)) {
          violations.push({ rule: "D-2", target: `${s.stub_id}:${id}` });
        }
      }
    } else {
      for (const id of s.acceptance_ids) {
        if (!SYSTEM_ACCEPTANCE_IDS.has(id)) {
          violations.push({ rule: "D-2", target: `${s.stub_id}:${id}` });
        }
      }
    }
  }

  // D-3
  for (const s of stubs) {
    if (s.origin === "scheme") {
      if (s.scheme_item_ids.length < 1) {
        violations.push({ rule: "D-3", target: s.stub_id });
      } else {
        for (const id of s.scheme_item_ids) {
          if (!schemeIds.has(id)) {
            violations.push({ rule: "D-3", target: `${s.stub_id}:${id}` });
          }
        }
      }
    } else if (!systemKindAllowed(s)) {
      violations.push({ rule: "D-3", target: s.stub_id });
    }
  }

  // D-4：goals 与 user_visible 模块须被未删除桩覆盖，或 id 出现在 out_of_scope
  const covered = new Set<string>();
  for (const s of stubs) {
    for (const id of s.scheme_item_ids) covered.add(id);
  }
  for (const g of scheme.goals) {
    if (!covered.has(g.id) && !outOfScopeIds.has(g.id)) {
      violations.push({ rule: "D-4", target: g.id });
    }
  }
  for (const m of scheme.modules) {
    if (!m.user_visible) continue;
    if (!covered.has(m.id) && !outOfScopeIds.has(m.id)) {
      violations.push({ rule: "D-4", target: m.id });
    }
  }

  // D-5：depends_on 成 DAG，且只引用本计划 stub
  for (const s of stubs) {
    for (const dep of s.depends_on) {
      if (!stubIds.has(dep)) {
        violations.push({ rule: "D-5", target: `${s.stub_id}->${dep}` });
      }
    }
  }
  {
    const byId = new Map(stubs.map((s) => [s.stub_id, s]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];
    const cycleTargets = new Set<string>();
    function dfs(id: string): void {
      if (visited.has(id) || cycleTargets.has(id)) return;
      if (visiting.has(id)) {
        const idx = stack.indexOf(id);
        const loop = idx >= 0 ? stack.slice(idx) : [id];
        for (const t of loop) cycleTargets.add(t);
        return;
      }
      visiting.add(id);
      stack.push(id);
      const node = byId.get(id);
      if (node) {
        for (const d of node.depends_on) {
          if (byId.has(d)) dfs(d);
        }
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
    }
    for (const s of stubs) dfs(s.stub_id);
    for (const t of [...cycleTargets].sort()) {
      violations.push({ rule: "D-5", target: t });
    }
  }

  // D-6：area_hints 相交且无相互依赖 → 必须补边
  for (let i = 0; i < stubs.length; i++) {
    for (let j = i + 1; j < stubs.length; j++) {
      const a = stubs[i]!;
      const b = stubs[j]!;
      const setB = new Set(b.area_hints);
      const overlap = a.area_hints.some((h) => setB.has(h));
      if (!overlap) continue;
      const aDependsB = a.depends_on.includes(b.stub_id);
      const bDependsA = b.depends_on.includes(a.stub_id);
      if (!aDependsB && !bDependsA) {
        violations.push({
          rule: "D-6",
          target: `${a.stub_id}|${b.stub_id}`,
        });
      }
    }
  }

  // D-7：≥2 桩共享同一 entity（新类型）时须有 interface_first 被它们全部依赖
  {
    const entityIds = new Set(scheme.entities.map((e) => e.id));
    const byEntity = new Map<string, ContractStub[]>();
    for (const s of stubs) {
      if (s.kind === "interface_first") continue;
      for (const id of s.scheme_item_ids) {
        if (!entityIds.has(id)) continue;
        const list = byEntity.get(id) ?? [];
        list.push(s);
        byEntity.set(id, list);
      }
    }
    const interfaceFirst = stubs.filter((s) => s.kind === "interface_first");
    for (const [entityId, group] of byEntity) {
      if (group.length < 2) continue;
      const ok = interfaceFirst.some((iface) =>
        group.every((s) => s.depends_on.includes(iface.stub_id)),
      );
      if (!ok) {
        violations.push({ rule: "D-7", target: entityId });
      }
    }
  }

  const ordered = orderedStubs(plan);

  // D-8：manual_only + large → 首桩 test_foundation
  if (!repoFacts.has_test_script && scheme.size_hint === "large") {
    const first = ordered[0];
    if (!first || first.kind !== "test_foundation") {
      violations.push({
        rule: "D-8",
        target: first?.stub_id ?? "(empty)",
      });
    }
  }

  // D-9：无 modules.yaml → 首桩（或紧随 test_foundation）须为 knowledge_bootstrap
  if (!repoFacts.has_modules_yaml) {
    const first = ordered[0];
    const second = ordered[1];
    const ok =
      (first && first.kind === "knowledge_bootstrap") ||
      (first &&
        first.kind === "test_foundation" &&
        second &&
        second.kind === "knowledge_bootstrap");
    if (!ok) {
      violations.push({
        rule: "D-9",
        target: first?.stub_id ?? "(empty)",
      });
    }
  }

  // D-10：里程碑 exit_acceptance_ids ⊆ 其桩 acceptance 并集，且非空
  {
    const byId = new Map(stubs.map((s) => [s.stub_id, s]));
    for (const ms of plan.milestones) {
      if (ms.exit_acceptance_ids.length < 1) {
        violations.push({ rule: "D-10", target: ms.milestone_id });
        continue;
      }
      const union = new Set<string>();
      for (const cid of ms.contract_ids) {
        const s = byId.get(cid);
        if (s) for (const a of s.acceptance_ids) union.add(a);
      }
      for (const id of ms.exit_acceptance_ids) {
        if (!union.has(id)) {
          violations.push({
            rule: "D-10",
            target: `${ms.milestone_id}:${id}`,
          });
        }
      }
    }
  }

  // D-11：用户删除的墓碑标题不得以同义标题复活
  for (const s of stubs) {
    for (const g of plan.graveyard) {
      if (g.removed_by !== "user") continue;
      if (titlesMatchNl(s.title, g.title)) {
        violations.push({
          rule: "D-11",
          target: `${s.stub_id}~${g.stub_id}`,
        });
      }
    }
  }

  // 稳定排序，保证同一输入两次结果相同
  violations.sort((a, b) => {
    const r = a.rule.localeCompare(b.rule);
    return r !== 0 ? r : a.target.localeCompare(b.target);
  });

  return { ok: violations.length === 0, violations };
}
