import type { SoftwareContract } from "@/lib/contract.schema";
import type { AdmissionView } from "@/lib/daemon-api";
import type { SupervisorContractView } from "./supervisor/SupervisorTab";
import type { ExecutionStatus, WorkerControl } from "./workspace-types";

/**
 * TASK-C.2 Supervisor Studio 的**纯视图模型**（无 React，便于单测与复用）。
 *
 * 放在独立模块而不是组件文件里有两个原因：
 * 1. react-refresh 只允许组件文件导出组件，helper 混在一起会产生告警；
 * 2. 「是否该弹确认卡」「合同 → 审阅视图」这两件事是可独立验证的纯逻辑，
 *    不该被 JSX 绑架。
 */

/** 验证命令的可读视图（argv 已分离，不拼 shell 字符串） */
export interface StudioCommandView {
  alias?: string;
  executable: string;
  args: string[];
  timeout_seconds?: number;
}

export interface StudioBudgetView {
  max_file_modifications?: number | undefined;
  max_total_diff_lines?: number | undefined;
  max_command_executions?: number | undefined;
  max_duration_seconds?: number | undefined;
  max_input_tokens?: number | undefined;
  max_output_tokens?: number | undefined;
  max_cost_minor_units?: number | undefined;
  currency?: string | undefined;
}

/** 草案审阅视图：全部来自 Daemon 事实（合同 + `supervisor_metadata`），前端不加工内容 */
export interface StudioDraftView {
  rationale: string[];
  unresolved_questions: string[];
  writable_paths: string[];
  readonly_paths: string[];
  strictly_forbidden_paths: string[];
  commands: StudioCommandView[];
  budget: StudioBudgetView;
}

export interface StudioExecutionView {
  contractId?: string | undefined;
  status: ExecutionStatus;
  workerControl?: WorkerControl | undefined;
  /** 实时进度白话（例如「正在执行第 2/3 条验证命令」），由控制面推送 */
  progress?: string | undefined;
}

export interface StudioProtectedEntryView {
  id: string;
  name: string;
  patterns: string[];
}

/**
 * 合同 → 审阅视图的纯适配器。
 * 关键约束：`unresolved_questions` **原样透传、不去重、不截断**（G-11 零丢失在前端也成立）。
 */
export function toStudioDraft(contract: SoftwareContract): StudioDraftView {
  const scope = contract.authorization.file_system_scope;
  const assessment = contract.supervisor_metadata?.maturity_assessment;
  const budgetLimits = contract.authorization.budget_limits;
  const costLimits = contract.authorization.cost_limits;
  return {
    rationale: [...(assessment?.rationale ?? [])],
    unresolved_questions: [...(assessment?.unresolved_questions ?? [])],
    writable_paths: [...scope.writable_paths],
    readonly_paths: [...(scope.readonly_paths ?? [])],
    strictly_forbidden_paths: [...(scope.strictly_forbidden_paths ?? [])],
    commands: contract.verification_spec.commands.map((command) => ({
      alias: command.alias,
      executable: command.executable,
      args: [...command.args],
      timeout_seconds: command.timeout_seconds,
    })),
    budget: {
      max_file_modifications: budgetLimits.max_file_modifications,
      max_total_diff_lines: budgetLimits.max_total_diff_lines,
      max_command_executions: budgetLimits.max_command_executions,
      max_duration_seconds: budgetLimits.max_duration_seconds,
      max_input_tokens: costLimits.max_input_tokens,
      max_output_tokens: costLimits.max_output_tokens,
      max_cost_minor_units: costLimits.max_cost_minor_units,
      currency: costLimits.currency,
    },
  };
}

/** 是否需要弹确认卡：只有"需要人工审批且确实命中了受保护内容"才算 */
export function shouldConfirmAdmission(
  admission: AdmissionView | null | undefined,
): boolean {
  if (!admission) return false;
  if (admission.decision !== "NEEDS_APPROVAL") return false;
  return admission.protectedFiles.length > 0 || admission.entryNames.length > 0;
}

/** 白话提问句：AI 想修改被保护的【登录】代码，同意吗？ */
export function confirmSentence(entryNames: string[]): string {
  if (entryNames.length === 0) {
    return "AI 想修改被保护的代码，同意吗？";
  }
  return `AI 想修改被保护的【${entryNames.join("、")}】代码，同意吗？`;
}

// ---------------------------------------------------------------------------
// Supervisor Tab 的视图适配
//
// 同一套映射同时服务两种来源：
// - 已落盘合同（左侧需求列表 / 合同操作台选中）；
// - `POST /api/supervisor/draft` 刚返回的**未落盘草案**（`isDraft=true`）。
// 两者字段完全同源（草案本身就是 `softwareContractSchema` 的解析结果），
// 因此不需要第二套渲染分支——否则界面迟早会出现"草案能看到、合同看不到"的漂移。
// ---------------------------------------------------------------------------

/**
 * 合同/草案 → Supervisor Tab 视图。
 *
 * 只搬字段，不做推断：健康度、成熟度分数、风险百分比一律不补（D4 边界）。
 * `unresolved_questions` 原样透传，**不去重、不截断**（G-11 零丢失）。
 */
export function toSupervisorContractView(
  contract: SoftwareContract,
  options: { isDraft?: boolean } = {},
): SupervisorContractView {
  const scope = contract.authorization.file_system_scope;
  const assessment = contract.supervisor_metadata?.maturity_assessment;
  return {
    id: contract.contract_id,
    title: contract.intent.title,
    description: contract.intent.description || "（该合同未填写描述）",
    state: contract.lifecycle_state,
    approval: contract.approval.status,
    revision: contract.contract_revision,
    acceptance: [...contract.intent.acceptance_criteria],
    writable: [...scope.writable_paths],
    forbidden: [...(scope.strictly_forbidden_paths ?? [])],
    commands: contract.verification_spec.commands.map((command) => ({
      alias: command.alias,
      argv: [command.executable, ...command.args].join(" "),
    })),
    rationale: [...(assessment?.rationale ?? [])],
    unresolved: [...(assessment?.unresolved_questions ?? [])],
    ...(options.isDraft === true ? { isDraft: true } : {}),
  };
}

/** 名词→相对路径的默认值，与后端 L0 的 `DEFAULT_FORBIDDEN_PATHS` 不同源，这里只做兜底展示 */
const FALLBACK_COMMAND = "npm test";

export interface DraftFormSeed {
  title: string;
  description: string;
  /** 逗号分隔，直接喂给表单输入框 */
  paths: string;
  command: string;
  acceptance: string[];
}

/**
 * 草案 → 「新建需求」表单预填。
 *
 * 关键点：可写路径取 **L0 推导结果**（`plan.writable_paths`），而不是草案合同里的
 * 同名字段——两者本应相同，但用 plan 能让"涉及范围"在 UI 上指向推导来源，
 * 一旦将来合同侧加了裁剪逻辑，界面仍然呈现 Supervisor 真实给出的范围。
 *
 * 参数只声明真正读到的字段（结构化最小集），这样 Daemon 侧的 `L0DraftPlan`
 * 与 HTTP 视图 `SupervisorDraftPlanView` 都能直接传入，不必为类型做二次转换。
 */
export function seedDraftForm(draft: {
  contract: SoftwareContract;
  plan: {
    writable_paths: string[];
    commands: ReadonlyArray<{ executable: string; args: string[] }>;
  };
}): DraftFormSeed {
  const command =
    draft.plan.commands[0] ?? draft.contract.verification_spec.commands[0];
  return {
    title: draft.contract.intent.title,
    description: draft.contract.intent.description,
    paths: draft.plan.writable_paths.join(", "),
    command: command
      ? [command.executable, ...command.args].join(" ")
      : FALLBACK_COMMAND,
    acceptance:
      draft.contract.intent.acceptance_criteria.length > 0
        ? [...draft.contract.intent.acceptance_criteria]
        : ["验证命令通过"],
  };
}

// ---------------------------------------------------------------------------
// TASK-C.8b：Fast Path 老板三步台（仅呈现；不改准入/状态机）
// ---------------------------------------------------------------------------

/** 适合收成老板三步的合同：低风险、尚未进入执行期（或系统 Fast Path 签发） */
export function isBossFastPathPresentation(
  contract: SoftwareContract | null | undefined,
): boolean {
  if (!contract) return false;
  // 只在确认前收成三步；执行期仍用完整台看进度 / 暂停
  const preExec =
    contract.lifecycle_state === "DRAFT" ||
    contract.lifecycle_state === "PENDING_APPROVAL";
  if (!preExec) return false;
  return (
    contract.intent.risk_level === "LOW" ||
    contract.creator === "system:fast-path"
  );
}

export interface BossFastPathStepSummary {
  /** ① 改哪里（白话位置，非 Scope 工单） */
  whereLabel: string;
  wherePaths: string[];
  /** ② 要不要动保护 */
  touchesProtection: boolean;
  protectionNames: string[];
  protectionFiles: string[];
  /** ③ 主按钮文案 */
  confirmLabel: string;
}

/**
 * 从合同/草案事实拼老板三步摘要。只搬字段，不改准入。
 * 保护命中优先用草案 plan；否则用 admission / 空。
 */
export function buildBossFastPathSummary(input: {
  title: string;
  writablePaths: string[];
  needsProtectionApproval?: boolean | undefined;
  protectedEntryNames?: string[] | undefined;
  protectedFiles?: string[] | undefined;
}): BossFastPathStepSummary {
  const paths = input.writablePaths.map(humanizePathForBoss).filter(Boolean);
  const names = [...(input.protectedEntryNames ?? [])];
  const files = [...(input.protectedFiles ?? [])];
  const touches =
    input.needsProtectionApproval === true ||
    names.length > 0 ||
    files.length > 0;
  return {
    whereLabel: input.title.trim() || "这次小改",
    wherePaths: paths.length > 0 ? paths : ["（范围待确认）"],
    touchesProtection: touches,
    protectionNames: names,
    protectionFiles: files,
    confirmLabel: "确认开改",
  };
}

/** 把 `src/pages/**` 收成老板能扫一眼的位置，不删审计原值（原值仍在高级区） */
export function humanizePathForBoss(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // 去掉末尾 /** 或 /*
  const bare = trimmed.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
  if (bare === "src" || bare === ".") return "项目源码";
  const leaf = bare.split("/").filter(Boolean).pop() ?? bare;
  return leaf;
}
