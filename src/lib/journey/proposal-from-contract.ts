/**
 * 从已落盘/内存中的合同拼一份「全灰」Supervisor 提案（TASK-S.6）。
 *
 * 用途：用户点【确认原型并实施真实工程】后，前端/Daemon 调
 * `POST /api/graph/proposal` 建图。节点一律不含运行态；Daemon
 * `createFromProposal` 会把它们初始化为 PENDING（全灰）。
 *
 * 拆解策略刻意保守、确定性：
 * - 一个根功能区 = 合同标题
 * - 每个可写路径（或验收标准）对应一个 CODE_MODIFICATION 节点
 * - 验证命令优先用合同里已声明的 alias；否则挂一条占位 `verify`
 *   （空验证集会被 illumination 挡住，不会假绿）
 *
 * TASK-J.60：`writable_paths` 是**写入权限上界**，不等于**必须产物**。
 * 绿野 npm 模板（`GREENFIELD_NPM_WRITABLE_DEFAULTS`）里的纯脚手架/配置类
 * 路径只在验收命令真的要求相应能力时才建成核销节点；否则会把
 * `tsconfig.json` 这类 Worker 不会写的路径变成必失败节点
 * （核销报 `E_FILES_NOT_WRITTEN`）。这些路径仍留在可写范围里。
 */

import type { SoftwareContract, VerificationCommand } from "../contract.schema";
import type {
  SupervisorProposalNode,
  SupervisorProposalV1,
} from "../graph/task-graph";

export interface BuildProposalOptions {
  /** 注入时钟，便于测试 */
  now?: () => Date;
  /** 覆盖 proposal_id（默认带时间戳） */
  proposalId?: string;
}

function slugify(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * 纯脚手架 / 配置类目标：属于写入权限，但通常不是本轮的真实产物。
 * 与 `daemon/supervisor/rules-l0.ts` 的 `GREENFIELD_NPM_WRITABLE_DEFAULTS`
 * 同源；只在这里按验收命令能力决定是否剔除（TASK-J.60 方案 A）。
 *
 * TASK-J.61：旧图目标迁移复用同一份判定，禁止另写第二套规则。
 */
export const SCAFFOLDING_TARGETS: ReadonlySet<string> = new Set([
  "tsconfig.json",
  "tsconfig.*.json",
  "vitest.config.*",
  "vite.config.*",
  "*.config.ts",
  "*.config.mjs",
  "*.config.js",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
]);

export interface VerificationCapabilities {
  typescript: boolean;
  tests: boolean;
}

function commandArgumentIncludes(
  command: VerificationCommand,
  needle: string,
): boolean {
  const args = command.args.map((arg) => arg.toLowerCase());
  if (args.includes(needle)) return true;
  const runIdx = args.indexOf("run");
  return runIdx >= 0 && args[runIdx + 1] === needle;
}

/**
 * 与 `rules-l0.ts::commandsNeedNpmVerification` 同一判定语义
 * （不 import `daemon/`，保持 `src/lib` 共享契约层的分层）。
 * 导出供 TASK-J.61 旧图目标迁移复用——迁移与提案必须同一套判定。
 */
export function verificationCapabilities(
  commands: readonly VerificationCommand[],
): VerificationCapabilities {
  let typescript = false;
  let tests = false;
  for (const command of commands) {
    if (command.executable !== "npm") continue;
    if (commandArgumentIncludes(command, "typecheck")) typescript = true;
    if (commandArgumentIncludes(command, "test")) tests = true;
  }
  return { typescript, tests };
}

/** 该脚手架目标是否被验收命令「要求」；未被要求则不作为核销节点。 */
function isUnneededScaffoldingTarget(
  pattern: string,
  capabilities: VerificationCapabilities,
): boolean {
  if (!SCAFFOLDING_TARGETS.has(pattern)) return false;
  if (pattern.startsWith("tsconfig")) return !capabilities.typescript;
  return !capabilities.tests;
}

/**
 * 该目标模式是否仍应作为「必须产物」核销目标。
 * TASK-J.61：迁移按节点逐个过滤 `target_files` 时复用这个函数。
 */
export function isDeliverableTarget(
  pattern: string,
  capabilities: VerificationCapabilities,
): boolean {
  return !isUnneededScaffoldingTarget(pattern, capabilities);
}

/**
 * 把合同编成可提交给 Graph 引擎的提案。
 * 调用方负责再调 `createTaskGraph`；本函数不做 IO。
 */
export function buildProposalFromContract(
  contract: SoftwareContract,
  options: BuildProposalOptions = {},
): SupervisorProposalV1 {
  const now = options.now?.() ?? new Date();
  const areaId = `area-${slugify(contract.intent.title, "main")}`;
  const writable = contract.authorization.file_system_scope.writable_paths;
  const criteria = contract.intent.acceptance_criteria;
  const declaredCommands = contract.verification_spec?.commands ?? [];
  const commandAliases = declaredCommands
    .map((c) => c.alias)
    .filter((a): a is string => typeof a === "string" && a.length > 0);
  const isManualOnly = declaredCommands.length === 0;

  // TASK-J.60：只把验收命令真正要求的脚手架/配置类路径建成节点；
  // 若过滤后为空（可写范围全是脚手架），回退原列表，不产出零节点图。
  const capabilities = verificationCapabilities(declaredCommands);
  const deliverableWritable = writable.filter(
    (pattern) => !isUnneededScaffoldingTarget(pattern, capabilities),
  );
  const effectiveWritable =
    deliverableWritable.length > 0 ? deliverableWritable : writable;

  const targets: Array<{ title: string; files: string[] }> = [];
  if (effectiveWritable.length > 0) {
    for (const file of effectiveWritable.slice(0, 12)) {
      targets.push({
        title: `落实：${file}`,
        files: [file],
      });
    }
  } else if (criteria.length > 0) {
    for (const [index, item] of criteria.slice(0, 8).entries()) {
      targets.push({
        title: item.slice(0, 80),
        files: [`src/feature/step-${index + 1}.ts`],
      });
    }
  } else {
    targets.push({
      title: contract.intent.title || "实施本轮需求",
      files: ["src/app/main.ts"],
    });
  }

  const nodes: SupervisorProposalNode[] = targets.map((target, index) => {
    const prev = index === 0 ? [] : [`n${index}`];
    if (isManualOnly) {
      // G4 守卫条款（对齐架构 §6.4 D-5 与 N-⑦ 裁决）：
      // commands 为空时，生成 MANUAL_REVIEW 节点（verification_mode: "MANUAL"），
      // 不挂占位 verify 命令，由用户在 UI 上显式确认。
      return {
        node_id: `n${index + 1}`,
        title: target.title,
        kind: "MANUAL_REVIEW",
        depends_on: prev,
        functional_area: areaId,
        target_files: target.files,
        verification_mode: "MANUAL",
        verification_commands: [],
      };
    }

    return {
      node_id: `n${index + 1}`,
      title: target.title,
      kind: "CODE_MODIFICATION",
      depends_on: prev,
      functional_area: areaId,
      target_files: target.files,
      verification_mode: "COMMAND",
      verification_commands:
        commandAliases.length > 0 ? [...commandAliases] : ["verify"],
    };
  });

  return {
    schema_version: "1.0",
    proposal_id:
      options.proposalId ?? `proposal_${contract.contract_id}_${now.getTime()}`,
    contract_id: contract.contract_id,
    generated_at: now.toISOString(),
    functional_tree: [
      {
        id: areaId,
        title: contract.intent.title || "本轮功能",
        parent_id: null,
        description: contract.intent.description.slice(0, 240),
      },
    ],
    nodes,
  };
}
