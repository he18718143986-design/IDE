import type {
  GraphIssueSeverity,
  TaskGraphFingerprint,
  TaskNode,
} from "../../src/lib/graph/task-graph";
import {
  isGlobPattern,
  normalizeTargetPath,
  pathSatisfiesTargetPattern,
  patternIsSatisfied,
} from "./target-file-match";

/**
 * 物理点亮验证器（架构规范 §3.2.2 / §3.4，TASK-C.7）。
 *
 * 本模块是纯函数：不读磁盘、不跑命令、不写文件。它只回答一个问题——
 * **这组证据是否足以把节点点亮？** 真正的证据采集（受控 Worktree 写入、
 * 命令退出码、Git SHA、指纹）由 Daemon 在执行链路上采集后传进来。
 *
 * 三条充要条件（缺一即拒绝点亮）：
 * 1. 受控 Worktree 内目标文件确实写入；
 * 2. 绑定验证命令集非空、结果集完整，且每条退出码为期望值（默认 0）；
 * 3. 存在可追溯的 Git Commit SHA，且目标文件指纹可计算。
 *
 * C-04 红线：`COMMAND` 模式下命令集为空、或结果集为空/不完整，一律
 * `E_EMPTY_VERIFICATION_BLOCKED`，绝不"没报错就算过"。该判定先于文件与
 * SHA 检查——规格本身无效时，先告诉用户"这条验收是空的"，而不是拿
 * 一个次要错误掩盖根因。
 */

export const E_EMPTY_VERIFICATION_BLOCKED = "E_EMPTY_VERIFICATION_BLOCKED";
export const E_FILES_NOT_WRITTEN = "E_FILES_NOT_WRITTEN";
export const E_FINGERPRINT_MISSING = "E_FINGERPRINT_MISSING";
export const E_SCOPE_VIOLATION = "E_SCOPE_VIOLATION";
export const E_COMMAND_FAILED = "E_COMMAND_FAILED";
export const E_COMMIT_SHA_MISSING = "E_COMMIT_SHA_MISSING";
export const E_SIDE_EFFECT_UNVERIFIED = "E_SIDE_EFFECT_UNVERIFIED";
export const E_MANUAL_APPROVAL_MISSING = "E_MANUAL_APPROVAL_MISSING";
export const E_SYNTAX_CHECK_FAILED = "E_SYNTAX_CHECK_FAILED";
export const E_VERIFICATION_MODE_MISMATCH = "E_VERIFICATION_MODE_MISMATCH";
export const E_TARGET_FILES_MISSING = "E_TARGET_FILES_MISSING";

/** 单条验证命令的执行结果（alias 与节点声明的命令一一对应） */
export interface VerificationCommandResult {
  alias: string;
  exit_code: number;
}

/** 隐式副作用检查：执行前后同一文件的 SHA-256 是否变化 */
export interface SideEffectCheck {
  path: string;
  before_sha256: string | null;
  after_sha256: string | null;
}

export interface IlluminationInput {
  node: TaskNode;
  /** 本次执行实际写入的文件（相对 Worktree 根） */
  files_written: string[];
  /** 写入后指纹：路径 -> SHA-256。缺失即无法满足"指纹持久化" */
  file_hashes: Record<string, string>;
  /** Scope 联合校验（tracked diff + untracked，TASK-W.2b）是否通过 */
  scope_valid: boolean;
  /** 验证命令结果集；COMMAND 模式必须覆盖全部声明命令 */
  command_results: VerificationCommandResult[];
  /** 节点执行命令自身的退出码（COMMAND_EXECUTION 隐式模式用） */
  execution_exit_code?: number;
  /** 期望退出码，默认 0 */
  expected_exit_code?: number;
  /** 本次证据绑定的 Git Commit SHA */
  commit_sha: string | null;
  /** MANUAL_REVIEW：用户是否显式点击【确认此项】 */
  manual_approved?: boolean;
  /** 来源声明；Daemon 无法独立鉴别浏览器事件，仅记录 UI 提交的来源标记。 */
  manual_approved_source?: "ui_click";
  /** FAST_PATH：轻量语法/类型检查退出码 */
  syntax_check_exit_code?: number;
  /** COMMAND_EXECUTION 隐式模式：预期物理副作用 */
  side_effects?: SideEffectCheck[];
  /** 证据生成时刻（由调用方注入，保证测试确定性） */
  now: string;
}

export interface IlluminationSuccess {
  illuminated: true;
  state: "ILLUMINATED";
  executed_at: string;
  commit_sha: string;
  fingerprints: TaskGraphFingerprint[];
}

export interface IlluminationBlocked {
  illuminated: false;
  /**
   * 规范 §3.2.2 对空验证集的规定是强制 `FAILED` 并报错；
   * `invalid_spec` 让展示层把这类失败呈现为"警告灰"而不是"红闪"，
   * 因为用户要修的是规格，不是代码。
   */
  state: "FAILED";
  code: string;
  message: string;
  severity: GraphIssueSeverity;
  invalid_spec: boolean;
}

export type IlluminationResult = IlluminationSuccess | IlluminationBlocked;

function normalizePath(input: string): string {
  return normalizeTargetPath(input);
}

function blocked(
  code: string,
  message: string,
  options: { invalid_spec?: boolean } = {},
): IlluminationBlocked {
  return {
    illuminated: false,
    state: "FAILED",
    code,
    message,
    severity: options.invalid_spec === true ? "WARNING" : "ERROR",
    invalid_spec: options.invalid_spec === true,
  };
}

/** 声明了验证命令，但结果集为空 / 缺项 —— C-04 的两种触发形态之一 */
function verificationSetBlocked(node: TaskNode): IlluminationBlocked | null {
  if (node.verification_mode !== "COMMAND") return null;
  if (node.verification_commands.length === 0) {
    return blocked(
      E_EMPTY_VERIFICATION_BLOCKED,
      `节点 ${node.node_id} 的验证命令集为空：COMMAND 节点严禁无证据点亮，请补充至少一条可执行验证命令`,
      { invalid_spec: true },
    );
  }
  return null;
}

/**
 * 判定节点是否被外部改动波及：任一目标文件命中变更路径即视为失效。
 * 目录前缀（例如 `src/auth`）命中其下文件时同样算命中。
 */
export function nodeTouchesPaths(
  node: TaskNode,
  changedPaths: readonly string[],
): boolean {
  const targets = node.target_files.map(normalizePath);
  for (const raw of changedPaths) {
    const changed = normalizePath(raw);
    for (const target of targets) {
      if (
        changed === target ||
        changed.startsWith(`${target}/`) ||
        target.startsWith(`${changed}/`)
      ) {
        return true;
      }
    }
  }
  return false;
}

function buildFingerprints(
  node: TaskNode,
  input: IlluminationInput,
): TaskGraphFingerprint[] | null {
  const fingerprints: TaskGraphFingerprint[] = [];
  const seen = new Set<string>();
  const add = (filePath: string): boolean => {
    if (seen.has(filePath)) return true;
    const sha256 = input.file_hashes[filePath];
    if (typeof sha256 !== "string" || sha256.length === 0) return false;
    seen.add(filePath);
    fingerprints.push({
      node_id: node.node_id,
      path: filePath,
      sha256,
      recorded_at: input.now,
      commit_sha: input.commit_sha as string,
    });
    return true;
  };

  for (const rawPath of node.target_files) {
    const pattern = normalizePath(rawPath);
    if (!isGlobPattern(pattern)) {
      if (!add(pattern)) return null;
      continue;
    }
    const matched = Object.keys(input.file_hashes)
      .map(normalizePath)
      .filter((filePath) => pathSatisfiesTargetPattern(filePath, pattern))
      .sort((a, b) => a.localeCompare(b));
    if (matched.length === 0) return null;
    for (const filePath of matched) {
      if (!add(filePath)) return null;
    }
  }
  return fingerprints;
}

/**
 * 主判定入口。
 *
 * 检查顺序刻意固定：规格有效性 → Scope → 文件写入 → 验证结果 → SHA → 指纹。
 * 顺序稳定意味着同一组坏证据恒得同一个错误码，测试与用户排查都不会
 * "这次报 A、下次报 B"。
 */
export function evaluateIllumination(
  input: IlluminationInput,
): IlluminationResult {
  const { node } = input;

  // ---- 0. 规格自洽性（Fast Path 必须是语法检查模式） ----
  if (node.kind === "FAST_PATH" && node.verification_mode !== "SYNTAX_CHECK") {
    return blocked(
      E_VERIFICATION_MODE_MISMATCH,
      `Fast Path 节点 ${node.node_id} 必须使用 SYNTAX_CHECK 验证模式`,
      { invalid_spec: true },
    );
  }

  // ---- 1. C-04：空验证集先于一切物理证据判定 ----
  const emptySet = verificationSetBlocked(node);
  if (emptySet) return emptySet;

  if (node.verification_mode === "COMMAND") {
    const declared = node.verification_commands;
    const received = new Map(
      input.command_results.map((result) => [result.alias, result.exit_code]),
    );
    const missing = declared.filter((alias) => !received.has(alias));
    if (input.command_results.length === 0 || missing.length > 0) {
      return blocked(
        E_EMPTY_VERIFICATION_BLOCKED,
        input.command_results.length === 0
          ? `节点 ${node.node_id} 的验证结果集为空：未执行任何验证命令，禁止点亮`
          : `节点 ${node.node_id} 的验证结果集不完整，缺少: ${missing.join(", ")}`,
        { invalid_spec: true },
      );
    }
  }

  // ---- 2. 节点必须声明目标文件（纯命令节点除外） ----
  const requiresFiles =
    node.kind === "CODE_MODIFICATION" ||
    node.kind === "MANUAL_REVIEW" ||
    node.kind === "FAST_PATH";
  if (requiresFiles && node.target_files.length === 0) {
    return blocked(
      E_TARGET_FILES_MISSING,
      `节点 ${node.node_id} 未声明 target_files，无法证明任何文件被写入`,
      { invalid_spec: true },
    );
  }

  // ---- 3. Scope 零越界 ----
  if (!input.scope_valid) {
    return blocked(
      E_SCOPE_VIOLATION,
      `节点 ${node.node_id} 的变更越出合同 Scope，禁止点亮`,
    );
  }

  // ---- 4. 目标文件确实写入 ----
  // 字面路径仍精确包含；glob 在已采集路径上判定是否被满足。缺项仍列原始模式。
  const written = input.files_written.map(normalizePath);
  const missingFiles = node.target_files
    .map(normalizePath)
    .filter((pattern) => !patternIsSatisfied(written, pattern));
  if (missingFiles.length > 0) {
    return blocked(
      E_FILES_NOT_WRITTEN,
      `节点 ${node.node_id} 的目标文件尚未写入: ${missingFiles.join(", ")}`,
    );
  }

  // ---- 5. 验证结果 / 副作用 / 人工确认 / 语法检查 ----
  const expected = input.expected_exit_code ?? 0;
  switch (node.verification_mode) {
    case "COMMAND": {
      const failed = input.command_results.filter(
        (result) => result.exit_code !== expected,
      );
      if (failed.length > 0) {
        return blocked(
          E_COMMAND_FAILED,
          `节点 ${node.node_id} 的验证命令未通过: ` +
            failed
              .map((result) => `${result.alias}(exit ${result.exit_code})`)
              .join(", "),
        );
      }
      break;
    }
    case "IMPLICIT_SIDE_EFFECT": {
      // 隐式模式没有后验命令，但"执行命令退出码为 0"仍是硬条件；
      // 缺失退出码等同于没有证据，不得放行。
      if (input.execution_exit_code !== expected) {
        return blocked(
          E_COMMAND_FAILED,
          `节点 ${node.node_id} 的执行命令退出码 ${
            input.execution_exit_code === undefined
              ? "缺失"
              : String(input.execution_exit_code)
          }，期望 ${expected}`,
        );
      }
      const effects = input.side_effects ?? [];
      if (effects.length === 0) {
        return blocked(
          E_EMPTY_VERIFICATION_BLOCKED,
          `节点 ${node.node_id} 既无后验命令，也无副作用证据：空结果集禁止点亮`,
          { invalid_spec: true },
        );
      }
      const changed = effects.some(
        (effect) =>
          effect.before_sha256 !== effect.after_sha256 &&
          effect.after_sha256 !== null,
      );
      if (!changed) {
        return blocked(
          E_SIDE_EFFECT_UNVERIFIED,
          `节点 ${node.node_id} 声明的副作用文件哈希未发生变化，无法证明执行产生了物理结果`,
        );
      }
      break;
    }
    case "MANUAL":
      if (input.manual_approved !== true) {
        return blocked(
          E_MANUAL_APPROVAL_MISSING,
          `节点 ${node.node_id} 尚未获得用户显式确认（user_manual_approved）`,
        );
      }
      break;
    case "SYNTAX_CHECK":
      if (input.syntax_check_exit_code !== 0) {
        return blocked(
          E_SYNTAX_CHECK_FAILED,
          `节点 ${node.node_id} 的语法/类型检查未通过（exit ${String(
            input.syntax_check_exit_code,
          )}）`,
        );
      }
      break;
  }

  // ---- 6. Git Commit SHA 指纹 ----
  if (typeof input.commit_sha !== "string" || input.commit_sha.trim() === "") {
    return blocked(
      E_COMMIT_SHA_MISSING,
      `节点 ${node.node_id} 缺少 Git Commit SHA：点亮必须绑定可追溯提交`,
    );
  }

  // ---- 7. 产物指纹 ----
  const fingerprints = buildFingerprints(node, input);
  if (fingerprints === null) {
    return blocked(
      E_FINGERPRINT_MISSING,
      `节点 ${node.node_id} 的目标文件缺少 SHA-256 指纹，无法持久化点亮证据`,
    );
  }

  return {
    illuminated: true,
    state: "ILLUMINATED",
    executed_at: input.now,
    commit_sha: input.commit_sha,
    fingerprints,
  };
}
