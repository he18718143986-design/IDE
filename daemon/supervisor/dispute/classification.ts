import { randomUUID } from "node:crypto";
import {
  createContractDraft,
  type SoftwareContract,
} from "../../../src/lib/contract.schema";
import { checkWriteAccess } from "../../../src/lib/scope";
import { addedCodeLines } from "./added-code";
import { matchesKeywords } from "./evidence-triad";
import {
  DISPUTE_CONFIDENCE_THRESHOLD,
  type DisputeClassification,
  type RequirementChangeProposal,
  type ReworkProposal,
  type TriadFacts,
} from "./types";

/**
 * 根因分流归因（TASK-S.5 / 架构 §5.7、§6.5）。
 *
 * 纯规则、确定性、零模型调用：同一组事实恒得同一结论与置信度。
 * 这样测试可复现，用户也能在报告里看到"为什么是这个结论"。
 *
 * 三条分流：
 * - `IMPLEMENTATION_BUG`：Spec 明确要求，但验证失败或代码未触及；
 * - `REQUIREMENT_DRIFT`：用户原始意图存在，但 Spec 缺失/未覆盖（含代码实现了
 *   规范外诉求）；
 * - `UNATTRIBUTED`：证据不足、信号互相矛盾，或置信度 < 0.7。
 */

export interface DisputeSignals {
  spec_matched_entries: number;
  diff_matched: boolean;
  prompt_matched_messages: number;
  changed_files: number;
  changed_files_in_scope: number;
  tests_total: number;
  tests_failed: number;
  tests_passed: boolean;
  has_evidence: boolean;
  worktree_available: boolean;
}

export interface ClassificationOutcome {
  classification: DisputeClassification;
  /** 降级前的算法建议（供报告展示，不改变处置） */
  suggested: DisputeClassification;
  confidence: number;
  signals: DisputeSignals;
  rationale: string[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(0.95, Number(value.toFixed(2))));
}

export function computeSignals(
  facts: TriadFacts,
  contract: SoftwareContract,
): DisputeSignals {
  const specMatched = facts.spec?.matched_entries.length ?? 0;
  // 修 P-4：只看新增的非注释、非字符串代码行；文件名与 diff_stat 由 Worker 命名，不作正向证据
  const addedCode =
    facts.code.added_code_lines ?? addedCodeLines(facts.code.diff_excerpt);
  const testsTotal = facts.code.verification_results.length;
  const testsFailed = facts.code.verification_results.filter(
    (result) => result.exit_code !== 0 || !result.passed,
  ).length;

  const scope = contract.authorization.file_system_scope;
  const inScope = facts.code.changed_files.filter(
    (file) => checkWriteAccess(file, scope).allowed,
  ).length;

  return {
    spec_matched_entries: specMatched,
    diff_matched: matchesKeywords(addedCode.join("\n"), facts.keywords),
    prompt_matched_messages: facts.prompt.matched_messages.length,
    changed_files: facts.code.changed_files.length,
    changed_files_in_scope: inScope,
    tests_total: testsTotal,
    tests_failed: testsFailed,
    tests_passed: testsTotal > 0 && testsFailed === 0,
    has_evidence: facts.code.evidence_id !== null,
    worktree_available: facts.code.available,
  };
}

/** 置信度门槛的唯一收口：低于 0.7 一律降级为人工裁决 */
export function finalizeClassification(
  suggested: DisputeClassification,
  confidence: number,
): DisputeClassification {
  if (suggested === "UNATTRIBUTED") return "UNATTRIBUTED";
  return confidence < DISPUTE_CONFIDENCE_THRESHOLD ? "UNATTRIBUTED" : suggested;
}

/**
 * 归因主函数。
 *
 * 规则顺序即优先级，不允许"先看代码再补规范"的重排——顺序变了，同一组
 * 证据可能得出不同结论，置信度就不再可审计。
 */
export function classifyDispute(
  facts: TriadFacts,
  contract: SoftwareContract,
): ClassificationOutcome {
  const signals = computeSignals(facts, contract);
  const rationale: string[] = [];

  let suggested: DisputeClassification = "UNATTRIBUTED";
  let confidence = 0.35;

  if (facts.spec === null) {
    rationale.push("缺少需求规范基准，无法判断代码是否偏离 Spec");
    confidence = 0.2;
  } else if (!facts.code.available) {
    rationale.push("受控 Worktree 不可用，拿不到真实 Diff");
    confidence = 0.25;
  } else if (signals.tests_failed > 0 && signals.spec_matched_entries > 0) {
    suggested = "IMPLEMENTATION_BUG";
    confidence = 0.9;
    rationale.push(
      `规范中有 ${signals.spec_matched_entries} 条与质询相关的要求，但 ${signals.tests_failed}/${signals.tests_total} 条验证未通过`,
    );
  } else if (
    signals.spec_matched_entries > 0 &&
    !signals.diff_matched &&
    signals.changed_files > 0
  ) {
    suggested = "IMPLEMENTATION_BUG";
    confidence = 0.82;
    rationale.push("规范明确要求该能力，但本轮代码 Diff 未触及相关实现");
  } else if (
    signals.spec_matched_entries === 0 &&
    signals.prompt_matched_messages > 0
  ) {
    suggested = "REQUIREMENT_DRIFT";
    confidence = signals.tests_passed ? 0.78 : 0.74;
    rationale.push(
      "用户原始提问中包含该诉求，但已批准的需求规范没有对应条目（需求遗漏）",
    );
    if (signals.diff_matched && signals.tests_passed) {
      rationale.push("代码已实现该诉求，说明是实现先于规范，需补正式变更");
    }
  } else if (
    signals.spec_matched_entries === 0 &&
    signals.diff_matched &&
    signals.tests_passed
  ) {
    suggested = "REQUIREMENT_DRIFT";
    confidence = 0.76;
    rationale.push("代码实现了规范未授权的新行为，验证虽通过但属于范围外演进");
  } else if (
    signals.spec_matched_entries > 0 &&
    signals.diff_matched &&
    signals.tests_passed
  ) {
    confidence = 0.55;
    rationale.push(
      "规范、代码与验证均指向该能力已实现，三方事实不足以支持自动归因",
    );
  } else {
    confidence = 0.45;
    rationale.push("三方事实信号不足或相互矛盾，无法自动归因");
  }

  if (signals.has_evidence) confidence += 0.03;
  if (signals.tests_total === 0) {
    confidence -= 0.08;
    rationale.push("没有可用的验证退出码，归因可信度下调");
  }
  if (!signals.worktree_available) confidence -= 0.2;
  // 结论是"实现偏差"但没有任何合法可返工文件：不能生成越界提案，
  // 只能降级为人工裁决（这也是对 Scope 红线的保护）。
  if (
    suggested === "IMPLEMENTATION_BUG" &&
    signals.changed_files > 0 &&
    signals.changed_files_in_scope === 0
  ) {
    confidence = Math.min(confidence, 0.6);
    rationale.push("全部变更都在合同 Scope 之外，无法生成合法的返工提案");
  }

  confidence = clamp(confidence);
  const classification = finalizeClassification(suggested, confidence);
  const downgraded = classification !== suggested;
  if (downgraded) {
    rationale.push(
      `置信度 ${confidence.toFixed(2)} < ${DISPUTE_CONFIDENCE_THRESHOLD}，自动降级为人工裁决`,
    );
  }

  return {
    classification,
    suggested,
    confidence,
    signals,
    rationale,
  };
}

/**
 * 返工提案：目标文件严格等于「已变更文件 ∩ 合同 writable_paths」。
 * 越界候选只记录到 `rejected_paths`，绝不因为"用户说了"就扩权。
 */
export function buildReworkProposal(
  contract: SoftwareContract,
  facts: TriadFacts,
  changeRequestId: string,
): ReworkProposal {
  const scope = contract.authorization.file_system_scope;
  const target: string[] = [];
  const rejected: string[] = [];
  for (const file of facts.code.changed_files) {
    if (checkWriteAccess(file, scope).allowed) {
      if (target.length < 20) target.push(file);
    } else {
      rejected.push(file);
    }
  }

  const scopeNote =
    rejected.length > 0
      ? `；${rejected.length} 个越界文件已排除（严禁扩权），` +
        "如需改动这些文件，必须先发起合同升版审批（EXPANDED_SCOPE_REQUIRED）"
      : "";
  return {
    proposal_id: `rework_${randomUUID().slice(0, 8)}`,
    contract_id: contract.contract_id,
    change_request_id: changeRequestId,
    target_files: target,
    rejected_paths: rejected,
    requires_scope_expansion: rejected.length > 0,
    scope_subset_valid: true,
    instructions:
      `仅在下列已授权文件内做定向修复：${target.join("、") || "（无可用文件）"}` +
      `。修复后必须重新执行合同验证命令${scopeNote}。`,
  };
}

/** 供测试与路由复用的 Scope 子集校验：返回越界文件列表（空 = 合法） */
export function assertReworkScopeSubset(
  contract: SoftwareContract,
  files: readonly string[],
): string[] {
  const scope = contract.authorization.file_system_scope;
  return files.filter((file) => !checkWriteAccess(file, scope).allowed);
}

/**
 * 需求变更提案：代码符合当前 Spec，但用户意图未被 Spec 覆盖。
 * 只产出一份**未落盘**的新合同草案，必须重新走审批（Zero-Silent-Authorization）。
 */
export function buildRequirementChangeProposal(
  contract: SoftwareContract,
  facts: TriadFacts,
  changeRequestId: string,
  now: Date = new Date(),
): RequirementChangeProposal {
  const scope = contract.authorization.file_system_scope;
  const title = `${contract.intent.title}（需求变更）`.slice(0, 200);
  const criteria = Array.from(
    new Set([
      ...contract.intent.acceptance_criteria,
      `补充：${facts.challenge}`.slice(0, 300),
    ]),
  ).slice(0, 20);

  const draft = createContractDraft({
    title,
    description:
      `基于用户质疑「${facts.challenge}」发起需求变更。` +
      `原合同 ${contract.contract_id} 的 Spec 未覆盖该诉求，需重新审批后执行。`.slice(
        0,
        2000,
      ),
    acceptanceCriteria: criteria,
    riskLevel: contract.intent.risk_level,
    writablePaths: scope.writable_paths,
    readonlyPaths: scope.readonly_paths ?? [],
    strictlyForbiddenPaths: scope.strictly_forbidden_paths ?? [],
    commands: contract.verification_spec.commands,
    creator: "supervisor",
    supervisorMetadata: {
      suggestion_id: changeRequestId,
      maturity_assessment: {
        rationale: [
          "质疑自查判定为需求理解差异/遗漏",
          facts.spec ? `基准规范：${facts.spec.snapshot_id}` : "无需求规范基准",
        ],
        unresolved_questions: [
          `变更范围是否仍限定在原合同 Scope（${scope.writable_paths.join("、")}）内？`,
        ],
        assessed_at: now.toISOString(),
      },
      suggested_scope: {
        writable_paths: scope.writable_paths,
        readonly_paths: scope.readonly_paths ?? [],
        strictly_forbidden_paths: scope.strictly_forbidden_paths ?? [],
      },
    },
  });

  return {
    proposal_id: `change_${randomUUID().slice(0, 8)}`,
    contract_id: contract.contract_id,
    change_request_id: changeRequestId,
    title,
    description: `补入用户诉求：${facts.challenge}`.slice(0, 2000),
    acceptance_criteria: criteria,
    source_snapshot_id: facts.spec?.snapshot_id ?? "none",
    draft_contract: draft,
  };
}
