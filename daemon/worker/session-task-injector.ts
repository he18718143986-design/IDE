import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import type { DesignNote } from "../../src/lib/design/design-note";
import type { GraveyardEntry } from "../../src/lib/journey/scheme-patch-types";
import { renderRejectedProposalsSection } from "../guard/graveyard-wiring";
import type { AdapterCapabilityDeclaration } from "./worker-adapter.interface";

/**
 * Worker 任务指令装配器（TASK-W.1 目标 2 / 规范 A §2.3、§4.1）。
 *
 * 职责：把用户**已批准**的 `SoftwareContractV12` 逐字段翻译成 Worker 的
 * System Prompt 与结构化任务指令，并在此处完成两道强制校验：
 *
 * 1. **审批前置**：只有 `approval.status === "APPROVED"` 的合同才允许装配；
 * 2. **工作区绑定**：Worktree 根必须是绝对路径，且（当提供宿主仓库根时）
 *    必须位于 `<repo>/.stagent/worktrees/` 之下，既不能等于宿主根，
 *    也不能是宿主根的祖先——从根上阻断「Worker 在宿主项目里直接作业」。
 *
 * 装配结果同时携带**暴露给 Worker 的工具清单**：未授权的命令工具
 * （合同 `allowed_commands` 为空时的 `stagent_exec_command`）不会出现在
 * 指令中，避免模型「看见即尝试」。
 *
 * 本文件只做只读的路径规范化（realpath），不执行命令、不写文件、不持有执行句柄。
 */

/**
 * TASK-W.2 注入 Worker 的 5 大受控 MCP 工具（规范 §4.1 + §4.2）。
 *
 * 这五个工具是 Worker 唯一的写入/执行面：读写文件、遍历目录、删除文件、
 * 执行合同白名单命令。`stagent_declare_complete` 与历史命名 `stagent_list_dir`
 * 属于协议/兼容工具，不占五席位，但仍受同一套授权与暴露规则约束。
 */
export const WORKER_MCP_TOOLS = [
  "stagent_read_file",
  "stagent_write_file",
  "stagent_list_directory",
  "stagent_delete_file",
  "stagent_exec_command",
] as const;

/** 协议与历史兼容工具（非 W.2 五席位） */
export const WORKER_PROTOCOL_TOOLS = [
  "stagent_declare_complete",
  "stagent_list_dir",
] as const;

/** 可暴露工具全集（5 大核心 + 协议/兼容） */
export const WORKER_STANDARD_TOOLS = [
  ...WORKER_MCP_TOOLS,
  ...WORKER_PROTOCOL_TOOLS,
] as const;

export type WorkerCoreTool = (typeof WORKER_MCP_TOOLS)[number];

export type WorkerStandardTool = (typeof WORKER_STANDARD_TOOLS)[number];

/** 工具说明（写入 System Prompt，避免模型臆造参数） */
const TOOL_DESCRIPTIONS: Readonly<Record<WorkerStandardTool, string>> = {
  stagent_read_file:
    "读取 Worktree 内文件（默认上限 1 MiB，二进制仅返回元数据）",
  stagent_write_file:
    "写入 Worktree 内文件；传入 expected_hash 时执行乐观锁校验，不匹配返回 E_CONFLICT",
  stagent_list_directory: "列出 Worktree 内目录（可递归，隐私路径自动脱敏）",
  stagent_delete_file:
    "删除 Worktree 内单个普通文件（目录与测试文件受额外限制）",
  stagent_exec_command:
    "按合同命令别名执行（结构化 argv、shell:false；含 shell 元字符的参数一律拒绝）",
  stagent_declare_complete: "声明任务完成，由 Daemon 判定是否可进入审计",
  stagent_list_dir: "stagent_list_directory 的历史命名别名，行为完全一致",
};

/** Worktree 边界违规：复用 §9.3 的 SCOPE_VIOLATION 归因，不新增野码 */
export const E_WORKER_BOUNDARY_VIOLATION = "E_OUT_OF_SCOPE";

export type WorkerInstructionFailure =
  | "CONTRACT_NOT_APPROVED"
  | "WORKTREE_NOT_ABSOLUTE"
  | "WORKTREE_IS_HOST_ROOT"
  | "WORKTREE_IS_HOST_ANCESTOR"
  | "WORKTREE_OUTSIDE_ISOLATION_ROOT"
  | "UNKNOWN_TOOL"
  | "TOOL_NOT_AUTHORIZED";

export class WorkerInstructionError extends Error {
  readonly failure: WorkerInstructionFailure;
  constructor(failure: WorkerInstructionFailure, message: string) {
    super(message);
    this.name = "WorkerInstructionError";
    this.failure = failure;
  }
}

/** 工作区绑定违规：作为 Scope 违规上报控制面 */
export class WorkerBoundaryError extends Error {
  readonly code = E_WORKER_BOUNDARY_VIOLATION;
  constructor(message: string) {
    super(`[${E_WORKER_BOUNDARY_VIOLATION}] ${message}`);
    this.name = "WorkerBoundaryError";
  }
}

export interface WorkerCommandBudget {
  allowed_commands: string[];
  max_file_modifications: number;
  max_total_diff_lines: number;
  max_duration_seconds: number;
  max_agent_turns?: number | undefined;
  max_verification_retries: number;
  max_command_executions?: number | undefined;
  max_tool_calls?: number | undefined;
  max_cost_minor_units: number;
  currency: string;
}

export interface WorkerInstructionSection {
  title: string;
  body: string;
}

export interface WorkerTaskInstruction {
  contract_id: string;
  contract_revision: number;
  worktree_root: string;
  objective: { title: string; description: string; risk_level: string };
  allowed_paths: string[];
  readonly_paths: string[];
  forbidden_paths: string[];
  acceptance_criteria: string[];
  command_budget: WorkerCommandBudget;
  exposed_tools: WorkerStandardTool[];
  known_limitations: string[];
  system_prompt: string;
  sections: WorkerInstructionSection[];
}

export interface BuildWorkerInstructionInput {
  contract: SoftwareContract;
  /** Worktree 物理根（A.1 生成，必须为绝对路径） */
  worktreeRoot: string;
  /** 宿主仓库根；提供时启用隔离目录强校验 */
  repoRoot?: string | undefined;
  /** 适配器能力声明；缺省表示未声明，不注入 known_limitations 且告警 */
  declaration?: AdapterCapabilityDeclaration | undefined;
  /** 调用方期望暴露的工具子集；缺省按合同授权推导 */
  exposedTools?: readonly string[] | undefined;
  /**
   * TASK-L.4：追加到「你会被这样检查」段末的条目（本段义务清单等）。
   * 缺省空数组，行为与 L.2 一致。
   */
  checksExtras?: readonly string[] | undefined;
  /**
   * TASK-J.18d / GAP-W3：派工时注入「用户否决过的方案」白话段。
   * 只列 proposal / rejection_reason，不列 artifact_keys。
   */
  graveyard?: readonly GraveyardEntry[] | undefined;
  /**
   * TASK-L.11：已通过校验的 DesignNote；注入「技术方案」段（§2.4）。
   * 未提供时不注入该段（兼容 L.11 前路径）。
   */
  designNote?: DesignNote | undefined;
}

/**
 * 解析真实路径（路径不存在时退回字面绝对路径）。
 *
 * 用于阻断「符号链接穿透」：若 `<repo>/.stagent/worktrees/task-x` 是指向宿主根
 * 或任意目录的链接，仅做字面前缀比较会被绕过；realpath 后重新比较才能证明
 * 工作目录确实落在隔离区内。
 */
function canonicalPath(absolute: string): string {
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * 校验并规范化 Worktree 绑定。
 * 返回规范化后的绝对路径；任一违规抛 `WorkerBoundaryError`。
 */
export function assertWorkerWorkspace(input: {
  worktreeRoot: string;
  repoRoot?: string | undefined;
}): string {
  const raw = input.worktreeRoot;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new WorkerInstructionError(
      "WORKTREE_NOT_ABSOLUTE",
      "worktree_root must be a non-empty absolute path",
    );
  }
  if (!path.isAbsolute(raw)) {
    throw new WorkerInstructionError(
      "WORKTREE_NOT_ABSOLUTE",
      `worktree_root must be absolute, received: ${raw}`,
    );
  }
  const worktreeRoot = canonicalPath(path.resolve(raw));
  if (input.repoRoot === undefined) return worktreeRoot;

  const repoRoot = canonicalPath(path.resolve(input.repoRoot));
  const relative = path.relative(repoRoot, worktreeRoot);

  if (relative === "") {
    throw new WorkerBoundaryError(
      `worktree_root must not be the host repository root: ${worktreeRoot}`,
    );
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    // Worktree 在宿主根之外：既可能是兄弟目录，也可能是宿主根的祖先
    const back = path.relative(worktreeRoot, repoRoot);
    if (back !== "" && !back.startsWith("..") && !path.isAbsolute(back)) {
      throw new WorkerBoundaryError(
        `worktree_root must not be an ancestor of the host repository root: ${worktreeRoot}`,
      );
    }
    throw new WorkerBoundaryError(
      `worktree_root must live under ${path.join(repoRoot, ".stagent", "worktrees")}, received: ${worktreeRoot}`,
    );
  }

  const isolationRoot = path.join(repoRoot, ".stagent", "worktrees");
  const isolationRelative = path.relative(isolationRoot, worktreeRoot);
  if (
    isolationRelative === "" ||
    isolationRelative.startsWith("..") ||
    path.isAbsolute(isolationRelative)
  ) {
    throw new WorkerBoundaryError(
      `worktree_root must live under ${isolationRoot}, received: ${worktreeRoot}`,
    );
  }
  return worktreeRoot;
}

/** 按合同授权推导可暴露工具：无命令授权（或无可执行别名）时不暴露 exec 工具 */
export function resolveExposedTools(
  contract: SoftwareContract,
  requested?: readonly string[] | undefined,
): WorkerStandardTool[] {
  const authorized = new Set<WorkerStandardTool>(WORKER_STANDARD_TOOLS);
  const hasExecutableAlias =
    contract.verification_spec.commands.length > 0 &&
    contract.authorization.execution_permissions.allowed_commands.length > 0;
  if (!hasExecutableAlias) {
    authorized.delete("stagent_exec_command");
  }

  if (requested === undefined) {
    return WORKER_STANDARD_TOOLS.filter((tool) => authorized.has(tool));
  }

  const exposed: WorkerStandardTool[] = [];
  for (const name of requested) {
    if (!(WORKER_STANDARD_TOOLS as readonly string[]).includes(name)) {
      throw new WorkerInstructionError(
        "UNKNOWN_TOOL",
        `unknown worker tool requested: ${name}`,
      );
    }
    const tool = name as WorkerStandardTool;
    if (!authorized.has(tool)) {
      throw new WorkerInstructionError(
        "TOOL_NOT_AUTHORIZED",
        `tool ${name} is not authorized by the current contract`,
      );
    }
    if (!exposed.includes(tool)) exposed.push(tool);
  }
  return exposed;
}

function bulletList(items: readonly string[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * 渲染「你会被这样检查」段（TASK-L.2 / verification-strategy §8 第 1 项）。
 *
 * 原样列出合同 `verification_spec.commands` 的 alias、argv 与期望退出码；
 * 命令为空且声明了 `manual_confirmation` 时，改为人工确认句。
 * `extras` 供 L.4（分段义务）与 L.12（知识库规则）追加条目；本卡只保证
 * 空 extras 行为正确，非空时原样追加在段末。
 */
export function renderChecksSection(
  contract: SoftwareContract,
  extras: readonly string[] = [],
): WorkerInstructionSection {
  const commands = contract.verification_spec.commands;
  const lines: string[] = [];

  if (commands.length === 0) {
    if (contract.verification_spec.manual_confirmation !== undefined) {
      lines.push("本合同没有自动检查，完成后由用户人工确认");
    }
  } else {
    for (let i = 0; i < commands.length; i += 1) {
      const cmd = commands[i]!;
      const argv = [cmd.executable, ...cmd.args].join(" ");
      lines.push(
        `${i + 1}. 别名 ${cmd.alias}：${argv}（期望退出码 ${cmd.expected_exit_code}）`,
      );
    }
  }

  for (const extra of extras) {
    lines.push(extra);
  }

  return {
    title: "你会被这样检查",
    body: lines.length === 0 ? "（无检查项）" : lines.join("\n"),
  };
}

/**
 * 装配 Worker 任务指令。
 *
 * 说明：`objective` 取合同的 `intent.title` / `intent.description`；
 * 规范中的「目标意图」在 `SoftwareContractV12` 里即由 `intent` 承载。
 */

/**
 * TASK-L.11 / technical-design §2.4：渲染「技术方案」段。
 * 顺序：approach → touches → interfaces → test_plan → knowledge_delta。
 */
export function renderDesignNoteSection(
  note: DesignNote,
): WorkerInstructionSection {
  const lines: string[] = [];
  lines.push("### approach");
  lines.push(note.approach);
  lines.push("");
  lines.push("### touches");
  if (note.touches.length === 0) {
    lines.push("（无）");
  } else {
    for (const t of note.touches) {
      lines.push(`- ${t.change} ${t.path} — ${t.why}`);
    }
  }
  lines.push("");
  lines.push("### interfaces");
  if (note.interfaces.length === 0) {
    lines.push("（无）");
  } else {
    for (const i of note.interfaces) {
      lines.push(
        `- ${i.kind} ${i.name}: ${i.signature}（consumers: ${i.consumers.join(", ") || "—"}）`,
      );
    }
  }
  lines.push("");
  lines.push("### test_plan");
  if (note.test_plan.length === 0) {
    lines.push("（无）");
  } else {
    for (const t of note.test_plan) {
      lines.push(`- ${t.acceptance_id} → ${t.test_path}（${t.level}）`);
    }
  }
  lines.push("");
  lines.push("### knowledge_delta");
  lines.push(
    `- modules_upsert: ${note.knowledge_delta.modules_upsert.map((m) => m.id).join(", ") || "（无）"}`,
  );
  lines.push(
    `- decisions_add: ${note.knowledge_delta.decisions_add.join(", ") || "（无）"}`,
  );
  lines.push(
    `- overview_changed: ${note.knowledge_delta.overview_changed ? "yes" : "no"}`,
  );
  return { title: "技术方案", body: lines.join("\n") };
}

export function buildWorkerTaskInstruction(
  input: BuildWorkerInstructionInput,
): WorkerTaskInstruction {
  const { contract, declaration } = input;

  if (contract.approval.status !== "APPROVED") {
    throw new WorkerInstructionError(
      "CONTRACT_NOT_APPROVED",
      `contract ${contract.contract_id} is not approved (status: ${contract.approval.status}); task instructions must not be assembled`,
    );
  }

  const worktreeRoot = assertWorkerWorkspace({
    worktreeRoot: input.worktreeRoot,
    ...(input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot }),
  });
  const exposedTools = resolveExposedTools(contract, input.exposedTools);

  const scope = contract.authorization.file_system_scope;
  const budget = contract.authorization.budget_limits;
  const cost = contract.authorization.cost_limits;

  const commandBudget: WorkerCommandBudget = {
    allowed_commands: [
      ...contract.authorization.execution_permissions.allowed_commands,
    ],
    max_file_modifications: budget.max_file_modifications,
    max_total_diff_lines: budget.max_total_diff_lines,
    max_duration_seconds: budget.max_duration_seconds,
    ...(budget.max_agent_turns === undefined
      ? {}
      : { max_agent_turns: budget.max_agent_turns }),
    max_verification_retries: budget.max_verification_retries,
    ...(budget.max_command_executions === undefined
      ? {}
      : { max_command_executions: budget.max_command_executions }),
    ...(budget.max_tool_calls === undefined
      ? {}
      : { max_tool_calls: budget.max_tool_calls }),
    max_cost_minor_units: cost.max_cost_minor_units,
    currency: cost.currency,
  };

  const knownLimitations = declaration?.known_limitations ?? [];
  const objective = {
    title: contract.intent.title,
    description: contract.intent.description,
    risk_level: contract.intent.risk_level,
  };

  const sections: WorkerInstructionSection[] = [
    {
      title: "角色与边界",
      body: [
        "你是 Stagent 的 Coding Worker，只在一个隔离的 Git Worktree 中工作。",
        `工作目录（Worktree 根）：${worktreeRoot}`,
        "你必须通过受管工具读写文件与执行命令；严禁直接调用 Shell、严禁访问 Worktree 之外的任何路径。",
        "宿主项目根对你是不可见的；任何试图跳出 Worktree 的路径都会被网关拒绝。",
      ].join("\n"),
    },
    {
      title: "任务目标",
      body: [
        `- 标题：${objective.title}`,
        `- 说明：${objective.description}`,
        `- 风险等级：${objective.risk_level}`,
      ].join("\n"),
    },
    ...(input.designNote
      ? [renderDesignNoteSection(input.designNote)]
      : []),
    {
      title: "可写范围（allowed_files / directories）",
      body: bulletList(scope.writable_paths, "（未授权任何可写路径）"),
    },
    {
      title: "只读范围",
      body: bulletList(scope.readonly_paths, "（无显式只读路径）"),
    },
    {
      title: "严格禁区（forbidden_files）",
      body: bulletList(scope.strictly_forbidden_paths, "（无显式禁区）"),
    },
    {
      title: "验收标准（acceptance_criteria）",
      body:
        contract.intent.acceptance_criteria.length === 0
          ? "（合同未提供验收标准）"
          : contract.intent.acceptance_criteria
              .map((item, index) => `${index + 1}. ${item}`)
              .join("\n"),
    },
    {
      title: "命令与预算限制",
      body: [
        `- 允许的命令别名：${
          commandBudget.allowed_commands.length === 0
            ? "（无，禁止执行任何命令）"
            : commandBudget.allowed_commands.join(", ")
        }`,
        `- 最大修改文件数：${commandBudget.max_file_modifications}`,
        `- 最大 Diff 行数：${commandBudget.max_total_diff_lines}`,
        `- 任务总时长上限：${commandBudget.max_duration_seconds}s`,
        `- 最大验证重试次数：${commandBudget.max_verification_retries}`,
        ...(commandBudget.max_agent_turns === undefined
          ? []
          : [`- 最大对话轮次：${commandBudget.max_agent_turns}`]),
        ...(commandBudget.max_command_executions === undefined
          ? []
          : [`- 最大命令执行次数：${commandBudget.max_command_executions}`]),
        ...(commandBudget.max_tool_calls === undefined
          ? []
          : [`- 最大工具调用次数：${commandBudget.max_tool_calls}`]),
        `- 费用上限：${commandBudget.max_cost_minor_units} ${commandBudget.currency}（最小货币单位）`,
      ].join("\n"),
    },
    {
      title: "可用工具",
      body: bulletList(
        exposedTools.map((tool) => `${tool}：${TOOL_DESCRIPTIONS[tool]}`),
        "（当前合同未暴露任何工具）",
      ),
    },
    {
      title: "已知限制（known_limitations）",
      body: bulletList(
        knownLimitations,
        "（适配器未声明已知限制；该状态不允许受控执行）",
      ),
    },
    renderChecksSection(contract, input.checksExtras ?? []),
    ...((): WorkerInstructionSection[] => {
      const rejected = renderRejectedProposalsSection(input.graveyard ?? []);
      return rejected ? [rejected] : [];
    })(),
    {
      title: "输出契约",
      body: [
        "返回完整文件内容（changes 数组），不要输出 diff。",
        "不得引入未授权依赖，不得修改验收标准或测试断言来规避验证。",
        "若无需改动，返回空 changes 数组。",
      ].join("\n"),
    },
  ];

  const systemPrompt = [
    "# Stagent Coding Worker 任务指令",
    ...sections.map((section) => `## ${section.title}\n${section.body}`),
  ].join("\n\n");

  return {
    contract_id: contract.contract_id,
    contract_revision: contract.contract_revision,
    worktree_root: worktreeRoot,
    objective,
    allowed_paths: [...scope.writable_paths],
    readonly_paths: [...scope.readonly_paths],
    forbidden_paths: [...scope.strictly_forbidden_paths],
    acceptance_criteria: [...contract.intent.acceptance_criteria],
    command_budget: commandBudget,
    exposed_tools: exposedTools,
    known_limitations: [...knownLimitations],
    system_prompt: systemPrompt,
    sections,
  };
}
