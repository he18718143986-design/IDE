/**
 * TASK-L.11：设计步骤——合同 + 可选 docs/system → DesignNote。
 * 形态开放（可注入 generator）；落盘 design-note.json / obligations.json。
 */

import fs from "node:fs";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import {
  detectEscalations,
  obligationsFromTestPlan,
  validateDesignNote,
  DEFAULT_DESIGN_PROTECTION_LIST,
  type DesignNote,
  type DetectedEscalation,
} from "../../../src/lib/design/design-note";
import { PAID_SDK_LIST } from "../../../src/lib/design/paid-sdk-list";
import {
  safeParseModulesYaml,
  type ModuleEntry,
} from "../../../src/lib/knowledge/modules-schema";
import type { ContractStub, ProjectPlan } from "../../../src/lib/project/project-plan";
import { applyPlanPatch } from "../../../src/lib/project/plan-patch";
import type { ProjectPlanScheme, RepoFacts } from "../../../src/lib/project/project-plan";
import { writePlan, readPlan } from "../../project/plan-store";
import { writeSuspension } from "../../pipeline/two-phase";

export type DesignSuspensionReason =
  | "DESIGN_INVALID"
  | "DESIGN_ESCALATION"
  | "DESIGN_NEEDS_DEPENDENCY";

export interface DesignGeneratorInput {
  contract: SoftwareContract;
  modules: ModuleEntry[];
  docsSystemDir: string | null;
  /** 1 = 首次；2 = 校验失败后的重试 */
  attempt: number;
  /** DN-2：要求不引入新依赖 */
  forbidDependencies: boolean;
}

export interface DesignGeneratorResult {
  note: DesignNote;
  /**
   * 在 forbidDependencies 时仍认为必须装新库 → 走 DESIGN_NEEDS_DEPENDENCY。
   */
  stillNeedsDependencies?: boolean;
  neededDependencies?: Array<{ name: string; version: string; why: string }>;
}

export type DesignNoteGenerator = (
  input: DesignGeneratorInput,
) => Promise<DesignGeneratorResult> | DesignGeneratorResult;

export type DesignStepOk = {
  status: "ok";
  note: DesignNote;
  designNotePath: string;
  obligationsPath: string;
  escalation_missed: DetectedEscalation[];
};

export type DesignStepSuspended = {
  status: "suspended";
  reason: DesignSuspensionReason;
  detail: string;
  suspensionPath: string;
  note: DesignNote | null;
  neededDependencies?: Array<{ name: string; version: string; why: string }>;
  escalations?: DetectedEscalation[];
  escalation_missed?: DetectedEscalation[];
};

export type DesignStepResult = DesignStepOk | DesignStepSuspended;

export interface RunDesignStepOptions {
  repoRoot: string;
  contract: SoftwareContract;
  generator?: DesignNoteGenerator;
  protectionList?: readonly string[];
  paidSdkList?: readonly string[];
  /** 测试可注入已解析的 modules */
  modules?: ModuleEntry[];
}

function recordsDir(repoRoot: string, contractId: string): string {
  return path.join(repoRoot, ".stagent", "records", contractId);
}

export function designNotePath(repoRoot: string, contractId: string): string {
  return path.join(recordsDir(repoRoot, contractId), "design-note.json");
}

export function obligationsJsonPath(
  repoRoot: string,
  contractId: string,
): string {
  return path.join(recordsDir(repoRoot, contractId), "obligations.json");
}

export function loadModulesFromDocsSystem(
  repoRoot: string,
): { modules: ModuleEntry[]; docsSystemDir: string | null } {
  const docsSystemDir = path.join(repoRoot, "docs", "system");
  const modulesFile = path.join(docsSystemDir, "modules.yaml");
  if (!fs.existsSync(modulesFile)) {
    return { modules: [], docsSystemDir: null };
  }
  try {
    const rawText = fs.readFileSync(modulesFile, "utf8");
    const raw = parseYaml(rawText);
    const parsed = safeParseModulesYaml(raw);
    if (!parsed.success) {
      return { modules: [], docsSystemDir };
    }
    return { modules: parsed.data.modules, docsSystemDir };
  } catch {
    return { modules: [], docsSystemDir };
  }
}

/**
 * 默认生成器：不发明方案目标，只从合同投影一份可过 DN 的最小 DesignNote。
 * ADR-0018：不回写未密封方案目标。
 */
export function defaultDesignNoteGenerator(
  input: DesignGeneratorInput,
): DesignGeneratorResult {
  const { contract, forbidDependencies } = input;
  const refs = contract.supervisor_metadata?.acceptance_refs ?? [];
  const autoRefs = refs.filter((r) => r.check === "auto" || r.check === "both");
  const writable =
    contract.authorization.file_system_scope.writable_paths ?? [];

  const touches: DesignNote["touches"] = [];
  // 选一条可写 glob 的字面示意路径（若可推导）；否则留空（DN-1 允许空 touches）
  for (const pattern of writable) {
    if (pattern.includes("*")) continue;
    touches.push({
      path: pattern,
      change: "modify",
      why: "合同可写范围内的施工点",
    });
    break;
  }

  const test_plan = autoRefs.map((r) => ({
    acceptance_id: r.id,
    test_path: `tests/stagent/${r.id}.test.ts`,
    level: "unit" as const,
  }));

  const note: DesignNote = {
    schema_version: "1.0.0",
    contract_id: contract.contract_id,
    approach: [
      `按已签合同「${contract.intent.title}」施工。`,
      contract.intent.description.slice(0, 240),
      "不扩大合同范围，不引入未授权依赖。",
    ]
      .filter(Boolean)
      .join(" "),
    touches,
    interfaces: [],
    data_changes: [],
    dependencies: [],
    decisions: [],
    test_plan,
    knowledge_delta: {
      modules_upsert: [],
      decisions_add: [],
      overview_changed: false,
    },
  };

  if (forbidDependencies) {
    return { note, stillNeedsDependencies: false };
  }
  return { note };
}

function writeDesignArtifacts(
  repoRoot: string,
  note: DesignNote,
): { designNotePath: string; obligationsPath: string } {
  const dir = recordsDir(repoRoot, note.contract_id);
  fs.mkdirSync(dir, { recursive: true });
  const dnPath = designNotePath(repoRoot, note.contract_id);
  const oblPath = obligationsJsonPath(repoRoot, note.contract_id);
  fs.writeFileSync(dnPath, `${JSON.stringify(note, null, 2)}\n`, "utf8");
  const obligations = obligationsFromTestPlan(note.test_plan);
  fs.writeFileSync(
    oblPath,
    `${JSON.stringify(
      {
        contract_id: note.contract_id,
        obligations,
        source: "design_note.test_plan",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { designNotePath: dnPath, obligationsPath: oblPath };
}

/**
 * 执行设计步骤：生成 → 校验（失败重试 1 次）→ 二次升级判定 → 落盘或挂起。
 */
export async function runDesignStep(
  options: RunDesignStepOptions,
): Promise<DesignStepResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const contract = options.contract;
  const generator = options.generator ?? defaultDesignNoteGenerator;
  const protectionList =
    options.protectionList ?? DEFAULT_DESIGN_PROTECTION_LIST;
  const paidSdkList = options.paidSdkList ?? PAID_SDK_LIST;

  const loaded = options.modules
    ? { modules: options.modules, docsSystemDir: path.join(repoRoot, "docs", "system") }
    : loadModulesFromDocsSystem(repoRoot);

  const generate = async (
    attempt: number,
    forbidDependencies: boolean,
  ): Promise<DesignGeneratorResult> =>
    generator({
      contract,
      modules: loaded.modules,
      docsSystemDir: loaded.docsSystemDir,
      attempt,
      forbidDependencies,
    });

  let gen = await generate(1, false);
  let note = gen.note;
  let validation = validateDesignNote(note, contract, loaded.modules);

  // DN-2：先重试一次「不引入依赖」
  if (!validation.ok && validation.rule === "DN-2") {
    const retry = await generate(2, true);
    if (retry.stillNeedsDependencies) {
      const deps =
        retry.neededDependencies ??
        (retry.note.dependencies.length > 0
          ? retry.note.dependencies
          : gen.note.dependencies);
      const suspensionPath = writeSuspension(repoRoot, contract.contract_id, {
        reason: "DESIGN_NEEDS_DEPENDENCY",
        phase: "design",
        detail: `需要新依赖：${deps.map((d) => d.name).join(", ")}`,
      });
      return {
        status: "suspended",
        reason: "DESIGN_NEEDS_DEPENDENCY",
        detail: `需要新依赖：${deps.map((d) => `${d.name}@${d.version}`).join(", ")}`,
        suspensionPath,
        note: retry.note,
        neededDependencies: deps,
      };
    }
    note = retry.note;
    // 强制清空依赖后再校验
    if (note.dependencies.length > 0) {
      note = { ...note, dependencies: [] };
    }
    validation = validateDesignNote(note, contract, loaded.modules);
  } else if (!validation.ok) {
    // 其它规则：整份重试一次
    const retry = await generate(2, false);
    note = retry.note;
    validation = validateDesignNote(note, contract, loaded.modules);
    gen = retry;
  }

  if (!validation.ok) {
    // DN-2 在第二次仍失败 → NEEDS_DEPENDENCY
    if (validation.rule === "DN-2") {
      const deps = note.dependencies;
      const suspensionPath = writeSuspension(repoRoot, contract.contract_id, {
        reason: "DESIGN_NEEDS_DEPENDENCY",
        phase: "design",
        detail: validation.message,
      });
      return {
        status: "suspended",
        reason: "DESIGN_NEEDS_DEPENDENCY",
        detail: validation.message,
        suspensionPath,
        note,
        neededDependencies: deps,
      };
    }
    const suspensionPath = writeSuspension(repoRoot, contract.contract_id, {
      reason: "DESIGN_INVALID",
      phase: "design",
      detail: `${validation.rule}: ${validation.message}`,
    });
    return {
      status: "suspended",
      reason: "DESIGN_INVALID",
      detail: `${validation.rule}: ${validation.message}`,
      suspensionPath,
      note,
    };
  }

  const detected = detectEscalations(note, protectionList, paidSdkList);
  // DN-6：任何 escalation（含二次判定补上的）→ 挂起等用户点头
  if (detected.escalations.length > 0) {
    const suspensionPath = writeSuspension(repoRoot, contract.contract_id, {
      reason: "DESIGN_ESCALATION",
      phase: "design",
      detail: detected.escalations
        .map((e) => `${e.class}: ${e.detail}`)
        .join(" | "),
    });
    // 仍落盘 design-note，供意外卡与审计读取
    writeDesignArtifacts(repoRoot, note);
    return {
      status: "suspended",
      reason: "DESIGN_ESCALATION",
      detail: `escalations: ${detected.escalations.map((e) => e.class).join(",")}`,
      suspensionPath,
      note,
      escalations: detected.escalations,
      escalation_missed: detected.escalation_missed,
    };
  }

  const paths = writeDesignArtifacts(repoRoot, note);
  return {
    status: "ok",
    note,
    designNotePath: paths.designNotePath,
    obligationsPath: paths.obligationsPath,
    escalation_missed: detected.escalation_missed,
  };
}

export type DependencySurpriseChoice = "allow" | "deny_continue" | "deny_abort";

export interface ResolveDependencySurpriseInput {
  repoRoot: string;
  /** 当前（需中止的）合同 */
  contract: SoftwareContract;
  /** 计划与补丁上下文 */
  plan: ProjectPlan;
  scheme: ProjectPlanScheme;
  repoFacts: RepoFacts;
  neededDependencies: Array<{ name: string; version: string; why: string }>;
  choice: "allow";
}

export type ResolveDependencySurpriseResult =
  | {
      ok: true;
      choice: "allow";
      plan: ProjectPlan;
      dependencyStubId: string;
      /** 原合同文件在 abort 之前的原始字节（调用方用于断言未改签） */
      contractBytesBeforeAbort: string;
    }
  | { ok: false; code: string; message: string };

/**
 * DN-2 选「可以」：不修改已签合同正文去放行依赖；
 * 调用方随后 abort 本合同，本函数只负责在原桩前插入 dependency 桩。
 *
 * 返回插入后的 plan；调用方负责 writePlan + abort。
 */
export function insertDependencyStubBeforeOriginal(
  plan: ProjectPlan,
  scheme: ProjectPlanScheme,
  repoFacts: RepoFacts,
  opts: {
    originalStubId: string;
    dependencies: Array<{ name: string; version: string; why: string }>;
  },
): ResolveDependencySurpriseResult {
  const original = plan.contracts.find((c) => c.stub_id === opts.originalStubId);
  if (!original) {
    return {
      ok: false,
      code: "E_STUB_NOT_FOUND",
      message: `original stub not found: ${opts.originalStubId}`,
    };
  }
  const primary = opts.dependencies[0];
  if (!primary) {
    return {
      ok: false,
      code: "E_NO_DEPENDENCY",
      message: "no dependency to insert",
    };
  }

  const depStubId = `cs-dep-${primary.name.replace(/[@/]/g, "-")}-${plan.plan_revision + 1}`;
  const depStub: Omit<ContractStub, "status" | "contract_id"> = {
    stub_id: depStubId,
    milestone_id: original.milestone_id,
    kind: "dependency",
    origin: "system",
    context: {
      dependency: { name: primary.name, version: primary.version },
    },
    title: `安装依赖 ${primary.name}@${primary.version}`,
    scheme_item_ids: [],
    acceptance_ids: ["sys-acc-dependency"],
    area_hints: ["package.json"],
    depends_on: [],
    size_estimate: { files: 2, diff_lines: 40, minutes: 5 },
  };

  // 只 add_stub：原桩若已 signed/aborted 则 edit 会被 E_PLAN_STUB_LOCKED 丢弃
  const add = applyPlanPatch(
    plan,
    {
      base_revision: plan.plan_revision,
      reason: "contract_aborted",
      ops: [{ op: "add_stub", stub: depStub }],
    },
    scheme,
    repoFacts,
  );
  if (!add.ok) {
    return {
      ok: false,
      code: add.code,
      message: add.plain_message ?? add.code,
    };
  }

  // 把依赖桩排到原桩之前
  const ms = add.plan.milestones.find(
    (m) => m.milestone_id === original.milestone_id,
  );
  if (!ms) {
    return {
      ok: false,
      code: "E_MILESTONE_MISSING",
      message: "milestone missing after patch",
    };
  }
  const ids = ms.contract_ids.filter((id) => id !== depStubId);
  const origIdx = ids.indexOf(original.stub_id);
  if (origIdx < 0) {
    ids.unshift(depStubId);
  } else {
    ids.splice(origIdx, 0, depStubId);
  }

  const reordered = applyPlanPatch(
    add.plan,
    {
      base_revision: add.plan.plan_revision,
      reason: "contract_aborted",
      ops: [
        {
          op: "reorder",
          milestone_id: original.milestone_id,
          contract_ids: ids,
        },
      ],
    },
    scheme,
    repoFacts,
  );
  if (!reordered.ok) {
    return {
      ok: false,
      code: reordered.code,
      message: reordered.plain_message ?? reordered.code,
    };
  }

  return {
    ok: true,
    choice: "allow",
    plan: reordered.plan,
    dependencyStubId: depStubId,
    contractBytesBeforeAbort: "",
  };
}

/**
 * DN-2「可以」完整处理：快照合同字节 → 插入依赖桩并写计划 →（由调用方 abort）。
 * 本函数不改合同文件。
 */
export function applyDesignDependencyAllow(input: {
  repoRoot: string;
  contractFileBytes: string;
  plan: ProjectPlan;
  scheme: ProjectPlanScheme;
  repoFacts: RepoFacts;
  originalStubId: string;
  dependencies: Array<{ name: string; version: string; why: string }>;
}): ResolveDependencySurpriseResult {
  const inserted = insertDependencyStubBeforeOriginal(
    input.plan,
    input.scheme,
    input.repoFacts,
    {
      originalStubId: input.originalStubId,
      dependencies: input.dependencies,
    },
  );
  if (!inserted.ok) return inserted;
  writePlan(input.repoRoot, inserted.plan);
  return {
    ...inserted,
    contractBytesBeforeAbort: input.contractFileBytes,
  };
}

export { readPlan, writePlan };
