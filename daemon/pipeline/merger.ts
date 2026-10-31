import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ContractStore } from "./contract-store";
import { archiveContractRecords } from "./records-archive";
import { publicDeliveryCopy } from "../../src/lib/state/terminal-delivery-closure";
import { readStateFile } from "../guard/state-store";
import type { SoftwareContract } from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import {
  execGit,
  getWorktreePath,
  removeTaskWorktree,
} from "../git/worktree-manager";
import { assertEvidenceIntegrity } from "../guard/evidence-integrity";
import {
  E_OUT_OF_SCOPE_UNTRACKED,
  describeUntrackedViolations,
  enforceUntrackedScope,
} from "./untracked-scope-guard";
import {
  graveyardBlockMessage,
  graveyardViolationTags,
  prepareDispatchGate,
  scanWorktreeGraveyard,
} from "../guard/graveyard-wiring";
import type { FileSystemScope } from "../../src/lib/scope";
import {
  contractLockPath,
  withContractLock,
  InvalidStateTransitionError,
} from "../core/contract-mutex";

/**
 * Evidence 核销与 Squash-Merge（规范 TASK-D.2 / §5.2）。
 * 门禁：合同 AUDITED + verdict PASSED + can_merge=true + 非 STALE + 证据快照存在。
 */
export interface MergeOptions {
  repoRoot: string;
  contractId: string;
  evidence: EvidenceBundle;
  reviewer: string;
}

export interface MergeResult {
  commitSha: string;
  commitMessage: string;
  contract: SoftwareContract;
  worktreeRemoved: boolean;
  /** P.1 User-First Discard：发生冲突时是否按「用户主分支永远胜出」自动仲裁 */
  conflictResolution: "USER_FIRST_DISCARD" | null;
  /** AI 改动全部被用户版本覆盖，没有可提交内容（不是错误，需向用户白话说明） */
  nothingToMerge: boolean;
  /** nothingToMerge 时的白话提示 */
  message?: string | undefined;
  /** TASK-C.12d/e：MERGED 后 records 归档结果（失败则不得标交付完成） */
  recordsArchive?: {
    ok: boolean;
    records_dir: string;
    copied: string[];
    error?: string;
  };
  /**
   * TASK-H.2 方案 B：对外终态 = MERGED；
   * delivery_complete 仅在 archive_ok 时为 true，失败不得伪造成功文案。
   */
  deliveryTerminal?: {
    scheme: "B_MERGED_IS_TERMINAL";
    lifecycle_state: "MERGED";
    label: string;
    delivery_complete: boolean;
  };
}

export class MergeGateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "MergeGateError";
    this.code = code;
  }
}

/** TASK-D.3 / D-4：目标分支在施工期间前进 */
export const E_TARGET_BRANCH_ADVANCED = "E_TARGET_BRANCH_ADVANCED";

/** D-4 的二选一选项：前端据此渲染两个按钮，无需自己拼文案 */
export const TARGET_ADVANCED_OPTIONS = [
  "REPLAY_ON_CURRENT_BASELINE",
  "ABANDON_CANDIDATE",
] as const;

/**
 * 目标分支已前进。
 *
 * 继承 `MergeGateError` 以便既有错误处理路径仍能识别；额外携带 `options`，
 * 让 HTTP 层能原样透出"重演 / 放弃"两个可执行决策，而不是只给一句错误。
 */
export class TargetBranchAdvancedError extends MergeGateError {
  readonly options = TARGET_ADVANCED_OPTIONS;
  readonly targetHead: string;
  readonly baseHead: string;

  constructor(targetHead: string, baseHead: string) {
    super(
      E_TARGET_BRANCH_ADVANCED,
      `Target branch advanced since the task branched: ${baseHead} -> ${targetHead}. ` +
        `Choose REPLAY_ON_CURRENT_BASELINE or ABANDON_CANDIDATE.`,
    );
    this.name = "TargetBranchAdvancedError";
    this.targetHead = targetHead;
    this.baseHead = baseHead;
  }
}

/**
 * 合并前检查目标分支是否仍在证据记录的基线上。
 *
 * 只做"是否前进"这一个判断：不自动 rebase、不自动放弃。
 * 传入的 `baseCommitSha` 来自证据快照，而不是合同——证据才是"这份结论对应
 * 哪次基线"的事实来源，合同里的分支名只用于定位当前 tip。
 */
export async function assertTargetBranchNotAdvanced(options: {
  repoRoot: string;
  baseBranch: string;
  baseCommitSha: string;
}): Promise<void> {
  const tip = await execGit(
    ["rev-parse", options.baseBranch],
    options.repoRoot,
  );
  if (tip.exitCode !== 0) {
    throw new MergeGateError(
      "E_TARGET_BRANCH_MISSING",
      `Cannot resolve target branch ${options.baseBranch}: ${tip.stderr.trim()}`,
    );
  }
  const targetHead = tip.stdout.trim();
  if (options.baseCommitSha && targetHead !== options.baseCommitSha) {
    throw new TargetBranchAdvancedError(targetHead, options.baseCommitSha);
  }
}

/**
 * 合并前置检查：主工作区必须干净（E_MAIN_TREE_DIRTY）。
 *
 * squash merge 直接在主工作树上落盘并暂存；若主树存在未提交/未跟踪改动，
 * 这些无关改动会被卷入带 Stagent Trailer 的审计提交，或与任务分支冲突导致
 * 合并中断在现场。因此合并前强制 `git status --porcelain` 为空。
 *
 * 例外：`.stagent/` 是 Daemon 自身的运行态目录（合同/证据/Worktree 元数据），
 * 不参与业务代码审计，从脏检查中排除。
 */
export async function assertMainTreeClean(repoRoot: string): Promise<void> {
  // -uall：展开未跟踪目录内的具体文件，诊断信息更精确
  const status = await execGit(["status", "--porcelain", "-uall"], repoRoot);
  if (status.exitCode !== 0) {
    throw new MergeGateError(
      "E_GIT_STATUS_FAILED",
      `git status failed: ${status.stderr || status.stdout}`,
    );
  }
  const dirty = status.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      // porcelain 行格式："XY <path>"（重命名为 "XY <orig> -> <new>"）
      // 保留行首空格，避免 ` M styles.css` 被 trim 后 slice(3) 成 tyles.css
      if (line.length < 4) return "";
      let p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4);
      return p.replace(/^"|"$/g, "").replace(/\/$/, "");
    })
    .filter((p) => p !== "" && p !== ".stagent" && !p.startsWith(".stagent/"));

  if (dirty.length > 0) {
    throw new MergeGateError(
      "E_MAIN_TREE_DIRTY",
      `主工作区存在 ${dirty.length} 处未提交/未跟踪改动，已阻断合并：请先 commit 或 stash 主树后再核销（${dirty
        .slice(0, 5)
        .join(", ")}${dirty.length > 5 ? ", ..." : ""}）`,
    );
  }
}

/** 标准 Git Trailer（§5.2，字段顺序固定） */
export interface MergeCommitMessageOptions {
  /**
   * 证据文件**字节**的 SHA-256（与 `shasum -a 256 <evidence>.json` 同源）。
   *
   * TASK-E.2：提供时写入 `Stagent-Evidence-Hash`，让审计方可以独立复算并发现
   * 「合并后用另一份证据替换磁盘文件」这类事后调包——Evidence-ID 只是名字，
   * 名字不防篡改，哈希才防。
   */
  evidenceHash?: string | undefined;
}

export function buildMergeCommitMessage(
  contract: SoftwareContract,
  evidence: EvidenceBundle,
  reviewer: string,
  conflictResolution: "USER_FIRST_DISCARD" | null = null,
  options: MergeCommitMessageOptions = {},
): string {
  const trailers = [
    `Stagent-Contract-ID: ${contract.contract_id}`,
    `Stagent-Evidence-ID: ${evidence.evidence_id}`,
  ];
  if (options.evidenceHash) {
    trailers.push(`Stagent-Evidence-Hash: ${options.evidenceHash}`);
  }
  trailers.push(
    `Stagent-Verdict: ${evidence.verdict.status}`,
    // 合并时的审批事实（AUDITED 态恒为 APPROVED，写进提交便于事后核对
    // 「这条提交是谁批的、批的时候是什么状态」，无需回查 .stagent/）
    `Stagent-Approval-Status: ${contract.approval.status}`,
    `Reviewed-By: ${reviewer}`,
  );
  // 测试完整性留痕：任务修改过测试文件时，审计提交中显式标记
  if (evidence.tests_modified === true) {
    trailers.push("Stagent-Tests-Modified: true");
  }
  if (evidence.manual_confirmation) {
    trailers.push(
      `Stagent-Manual-Confirmation-Actor: ${evidence.manual_confirmation.actor}`,
    );
    trailers.push(
      `Stagent-Manual-Confirmation-Confirmed-At: ${evidence.manual_confirmation.confirmed_at}`,
    );
  }
  return [
    `feat(${contract.contract_id.replace(/^contract_/, "")}): ${contract.intent.title}`,
    "",
    "由 Stagent 受限执行并通过全部门禁验证。",
    ...(conflictResolution
      ? [
          "冲突处理：以用户主分支版本为准，Worker 冲突改动已丢弃（User-First Discard）。",
        ]
      : []),
    "",
    ...trailers,
  ].join("\n");
}

/**
 * Git Trailer 尺寸红线（TASK-D.2b）：**单条 ≤512 字节，合计 ≤4KB**。
 *
 * 差异说明：架构规范 §5.2 写的是「单条 1024 / 合计 4096」，任务规范
 * TASK-D.2b 与本次指令要求「单条 512 / 合计 4KB」。两者在单条上限上不一致，
 * 本实现取**更严格**的 512——Trailer 是审计索引键，超过半 KB 只可能是
 * 把日志或长文本塞进了提交信息，那本来就不该出现在这里。
 */
export const MAX_TRAILER_LINE_BYTES = 512;
export const MAX_TRAILER_BLOCK_BYTES = 4096;

/** Trailer 行形态：`Key: value`，Key 为字母开头的连字符标识 */
const TRAILER_LINE_PATTERN = /^[A-Za-z][A-Za-z0-9-]*: /;

export interface TrailerBounds {
  lines: Array<{ key: string; bytes: number }>;
  maxLineBytes: number;
  totalBytes: number;
}

/**
 * 度量提交信息末尾的 Trailer 块尺寸。
 *
 * 只统计**末尾连续**的 `Key: value` 行：一旦遇到空行、标题或正文即停止，
 * 避免把正文里的 "Note: ..." 误判成 Trailer 而错误阻断合并。
 */
export function measureTrailerBounds(message: string): TrailerBounds {
  const lines = message.split("\n");
  const block: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] as string;
    if (!TRAILER_LINE_PATTERN.test(line)) break;
    block.unshift(line);
  }
  const entries = block.map((line) => ({
    key: line.slice(0, line.indexOf(":")),
    bytes: Buffer.byteLength(line, "utf-8"),
  }));
  return {
    lines: entries,
    maxLineBytes: entries.reduce((max, entry) => Math.max(max, entry.bytes), 0),
    totalBytes: Buffer.byteLength(block.join("\n"), "utf-8"),
  };
}

/** 尺寸越界即阻断提交，绝不静默截断审计字段 */
export function assertTrailerBounds(message: string): TrailerBounds {
  const bounds = measureTrailerBounds(message);
  const oversize = bounds.lines.find(
    (line) => line.bytes > MAX_TRAILER_LINE_BYTES,
  );
  if (oversize) {
    throw new MergeGateError(
      "E_TRAILER_TOO_LARGE",
      `Trailer '${oversize.key}' 为 ${oversize.bytes} 字节，超过单条上限 ${MAX_TRAILER_LINE_BYTES} 字节；` +
        "审计字段不允许塞入长文本或日志",
    );
  }
  if (bounds.totalBytes > MAX_TRAILER_BLOCK_BYTES) {
    throw new MergeGateError(
      "E_TRAILER_TOO_LARGE",
      `Trailer 块合计 ${bounds.totalBytes} 字节，超过上限 ${MAX_TRAILER_BLOCK_BYTES} 字节`,
    );
  }
  return bounds;
}

/**
 * 合并前未跟踪文件复核（TASK-D.2b）。
 *
 * 与 TASK-W.2b 的执行侧守卫同源（同一个 `enforceUntrackedScope`），但检测点
 * 更靠后：覆盖「证据生成之后、真正合入之前」这段时间里被绕过网关写入的文件
 * ——例如用户在 IDE 里新建、或外部脚本落盘。这类文件不在任务分支里，
 * `git merge --squash` 看不见，却可能在合并后混入主树。
 *
 * 与 `assertMainTreeClean` 的分工：后者检查**主工作树**，本函数检查
 * **任务 Worktree**；两者互补，不重叠。
 */
export async function assertWorktreeUntrackedScope(options: {
  worktreePath: string;
  scope: FileSystemScope;
}): Promise<void> {
  const report = await enforceUntrackedScope({
    worktreePath: options.worktreePath,
    scope: options.scope,
    phase: "PRE_MERGE",
  });
  if (report.passed) return;

  const list = report.violations
    .slice(0, 5)
    .map((v) => v.path)
    .join(", ");
  const more =
    report.violations.length > 5 ? ` 等 ${report.violations.length} 处` : "";
  throw new MergeGateError(
    E_OUT_OF_SCOPE_UNTRACKED,
    `${describeUntrackedViolations(report)}（违规清单：${list}${more}）`,
  );
}

export async function squashMerge(options: MergeOptions): Promise<MergeResult> {
  const repoRoot = path.resolve(options.repoRoot);
  // 合同排他锁：并发的两次核销串行执行，第二次在锁内看到 MERGED 立即失败
  return withContractLock(contractLockPath(repoRoot, options.contractId), () =>
    mergeInternal(repoRoot, options),
  );
}

async function mergeInternal(
  repoRoot: string,
  options: MergeOptions,
): Promise<MergeResult> {
  const store = new ContractStore(repoRoot);

  // TASK-D.2b：存量 v1.2.0 合同走内存迁移后再裁决；迁移本身带零静默授权后置断言。
  let loaded: ReturnType<ContractStore["getWithMigration"]>;
  try {
    loaded = store.getWithMigration(options.contractId);
  } catch (err) {
    throw new MergeGateError(
      "E_CONTRACT_MIGRATION_FAILED",
      `合同迁移失败，已阻断合并：${(err as Error).message}`,
    );
  }

  if (!loaded) {
    throw new MergeGateError(
      "E_CONTRACT_NOT_FOUND",
      `Contract ${options.contractId} not found`,
    );
  }
  const { contract, migration } = loaded;

  // 零静默授权：被迁移拉回草稿/待审的合同，必须由用户重新批准，
  // 不允许借「合并核销」这条路把它一次性洗成已授权。
  if (migration?.requiresReapproval) {
    throw new MergeGateError(
      "E_CONTRACT_REQUIRES_REAPPROVAL",
      `存量合同（schema ${migration.from} → ${migration.to}）迁移后处于 ` +
        `${contract.lifecycle_state} / ${contract.approval.status}，` +
        "必须由用户重新审批授权范围后才能合并；静默授权一律拒绝",
    );
  }

  // 1. 状态门禁（已合并 → 并发冲突语义；未审计 → 前置条件不足）
  if (contract.lifecycle_state === "MERGED") {
    throw new InvalidStateTransitionError(
      contract.lifecycle_state,
      ["AUDITED"],
      "merge",
    );
  }
  if (contract.lifecycle_state !== "AUDITED") {
    throw new MergeGateError(
      "E_NOT_AUDITED",
      `Contract must be AUDITED before merge (state=${contract.lifecycle_state})`,
    );
  }

  // 2. Evidence 门禁（以磁盘快照为准，避免内存伪造）
  const evidencePath = path.join(
    repoRoot,
    ".stagent",
    "evidence",
    `${contract.contract_id}-${options.evidence.evidence_id}.json`,
  );
  if (!fs.existsSync(evidencePath)) {
    throw new MergeGateError(
      "E_EVIDENCE_MISSING",
      `Evidence snapshot not found: ${evidencePath}`,
    );
  }
  const snapshot = evidenceBundleSchema.parse(
    JSON.parse(fs.readFileSync(evidencePath, "utf-8")),
  );
  if (snapshot.contract_id !== contract.contract_id) {
    throw new MergeGateError(
      "E_EVIDENCE_MISMATCH",
      "Evidence does not belong to contract",
    );
  }
  if (snapshot.verdict.status === "STALE") {
    throw new MergeGateError(
      "E_EVIDENCE_STALE",
      "Evidence is STALE; re-run verification",
    );
  }
  if (snapshot.verdict.status !== "PASSED" || !snapshot.verdict.can_merge) {
    throw new MergeGateError(
      "E_CANNOT_MERGE",
      `Evidence verdict is ${snapshot.verdict.status} (can_merge=${snapshot.verdict.can_merge})`,
    );
  }

  // G2 / G3 守卫条款：若合同声明了 manual_confirmation，追加「确认记录齐全否则拒绝合并」闸门
  if (contract.verification_spec.manual_confirmation !== undefined) {
    const mc = snapshot.manual_confirmation;
    const isComplete =
      Boolean(mc) &&
      typeof mc?.actor === "string" &&
      mc.actor.trim().length > 0 &&
      typeof mc?.confirmed_at === "string" &&
      mc.confirmed_at.trim().length > 0 &&
      typeof mc?.reason === "string" &&
      mc.reason.trim().length > 0;
    if (!isComplete) {
      throw new MergeGateError(
        "E_CANNOT_MERGE",
        "Contract declares manual_confirmation but evidence snapshot lacks complete manual confirmation record (actor, confirmed_at, reason)",
      );
    }
  }

  // 3. Worktree 与分支必须存在
  const worktreePath = getWorktreePath(repoRoot, contract.contract_id);
  if (!fs.existsSync(worktreePath)) {
    throw new MergeGateError(
      "E_WORKTREE_LOST",
      `Worktree missing: ${worktreePath}`,
    );
  }
  const branch = contract.authorization.git.task_branch;

  // 3.5 TASK-D.2b：合并前复核完整工作树（含未跟踪文件）。
  // 放在证据完整性之前：越界文件是更具体、更可操作的结论，
  // 不该被指纹失配（E_EVIDENCE_STALE）抢先掩盖。
  await assertWorktreeUntrackedScope({
    worktreePath,
    scope: contract.authorization.file_system_scope,
  });

  // 3.55 TASK-J.18d：PRE_MERGE 墓地全量扫描（纵深：绕过 hook 仍拦）
  {
    const prep = await prepareDispatchGate(repoRoot, contract);
    if (!prep.ok) {
      throw new MergeGateError(prep.code, prep.message);
    }
    const scan = await scanWorktreeGraveyard({
      worktreePath,
      baseBranch: contract.authorization.git.base_branch,
      context: prep.context,
    });
    if (!scan.ok) {
      throw new MergeGateError("E_GATE_SCAN_FAILED", scan.reason);
    }
    if (scan.gate.block) {
      const tags = graveyardViolationTags(scan.gate).join(", ");
      throw new MergeGateError(
        "E_PROPOSAL_PREVIOUSLY_REJECTED",
        `${graveyardBlockMessage(scan.gate)}（${tags}）`,
      );
    }
  }

  // 3.6 防偷渡门禁：Worktree 指纹必须与 Evidence 记录一致。
  // 用户在验证通过后外部篡改 Worktree（VS Code 直改 / 脚本写入）→ 指纹不符 →
  // 证据落盘标记 STALE 并阻断合并，杜绝用旧 PASSED 证据合并未验证代码。
  await assertEvidenceIntegrity({
    worktreePath,
    evidencePath,
    snapshot,
  });

  // 3.7 重复合并防御：主干已存在携带同一 Evidence-ID 的审计提交则拒绝再合一次
  const headMessage = await execGit(["log", "-1", "--format=%B"], repoRoot);
  if (
    headMessage.stdout.includes(`Stagent-Evidence-ID: ${snapshot.evidence_id}`)
  ) {
    throw new MergeGateError(
      "E_ALREADY_MERGED",
      `Evidence ${snapshot.evidence_id} has already been merged into ${await currentBranchName(repoRoot)}`,
    );
  }

  // 3.5 主工作区脏状态门禁：脏树会污染审计提交，直接阻断
  await assertMainTreeClean(repoRoot);

  // 3.8 TASK-D.3 / D-4：目标分支前进门禁。
  // 证据描述的是"基于哪个基线验证通过"；基线一旦前进，结论就不再等价，
  // 必须由用户二选一，禁止 daemon 自行 rebase 或静默放弃。
  await assertTargetBranchNotAdvanced({
    repoRoot,
    baseBranch: contract.authorization.git.base_branch,
    baseCommitSha: snapshot.git_info.base_commit_sha,
  });

  // 4. Squash merge（-X ours 兜底用户优先；冲突清场用 reset --merge）
  let merge = await execGit(["merge", "--squash", branch], repoRoot);
  let conflictResolution: "USER_FIRST_DISCARD" | null = null;
  if (merge.exitCode !== 0) {
    // `git merge --squash` 不产生 MERGE_HEAD，`merge --abort` 必然失败
    // （fatal: There is no merge to abort），必须用 `reset --merge` 清掉冲突标记。
    await execGit(["reset", "--merge"], repoRoot);
    // P.1 User-First Discard Rule（架构 §0.6.4）：不向用户抛 Git 冲突界面，
    // 冲突处永远以用户当前主分支版本为准，丢弃 Worker 的冲突改动，AI 需基于最新代码重做。
    merge = await execGit(
      ["merge", "--squash", "-X", "ours", branch],
      repoRoot,
    );
    if (merge.exitCode === 0) {
      conflictResolution = "USER_FIRST_DISCARD";
    } else {
      await execGit(["reset", "--merge"], repoRoot);
      throw new MergeGateError(
        "E_MERGE_CONFLICT",
        `git merge --squash failed: ${merge.stderr || merge.stdout}`,
      );
    }
  }

  // 4.5 全部丢弃兜底：AI 的改动与主分支冲突且全部以用户版本为准时，
  // 暂存区没有任何变化，`git commit` 会因 "nothing to commit" 失败。
  // 这不是错误：明确告诉用户本轮全部以他为准，保留合同与 Worktree 供 AI 重做。
  const staged = await execGit(["diff", "--cached", "--quiet"], repoRoot);
  if (staged.exitCode === 0) {
    return {
      commitSha: "",
      commitMessage: "",
      contract,
      worktreeRemoved: false,
      conflictResolution,
      nothingToMerge: true,
      message: "本轮改动与你的修改冲突，已全部以你为准",
    };
  }
  if (staged.exitCode > 1) {
    throw new MergeGateError(
      "E_GIT_DIFF_FAILED",
      `git diff --cached failed: ${staged.stderr || staged.stdout}`,
    );
  }

  // 5. 生成 Trailer 提交
  //    Evidence-Hash = 磁盘证据文件字节哈希，写入提交后任何人可用系统 shasum 复算
  const evidenceHash = createHash("sha256")
    .update(fs.readFileSync(evidencePath))
    .digest("hex");
  const message = buildMergeCommitMessage(
    contract,
    snapshot,
    options.reviewer,
    conflictResolution,
    { evidenceHash },
  );
  // TASK-D.2b：Trailer 尺寸红线，越界即拒绝提交（不静默截断审计字段）
  assertTrailerBounds(message);
  const commit = await execGit(["commit", "-m", message], repoRoot);
  if (commit.exitCode !== 0) {
    throw new MergeGateError(
      "E_COMMIT_FAILED",
      `git commit failed: ${commit.stderr || commit.stdout}`,
    );
  }
  const shaResult = await execGit(["rev-parse", "HEAD"], repoRoot);
  const commitSha = shaResult.stdout.trim();

  // 6. 清理 Worktree 与任务分支
  let worktreeRemoved = false;
  try {
    await removeTaskWorktree({
      repoRoot,
      contractId: contract.contract_id,
      force: true,
      deleteBranch: true,
    });
    worktreeRemoved = true;
  } catch {
    worktreeRemoved = false;
  }

  // 7. 合同终态（存证与合同文件均保留在 .stagent/）
  const merged = store.transition({
    contractId: contract.contract_id,
    lifecycleState: "MERGED",
  });

  // 8. TASK-C.12d/e：MERGED 后轻量 records 归档 + audit-manifest（失败不标 DELIVERED）
  const archive = archiveContractRecords({
    repoRoot,
    contract_id: contract.contract_id,
    snapshot: {
      contract_id: contract.contract_id,
      commit_sha: commitSha,
      lifecycle_state: "MERGED",
    },
    commit_sha: commitSha,
    events: [{ type: "MERGED", commit_sha: commitSha }],
  });
  const delivery = publicDeliveryCopy({
    lifecycle_state: "MERGED",
    archive_ok: archive.ok,
  });
  return {
    commitSha,
    commitMessage: message,
    contract: merged,
    worktreeRemoved,
    conflictResolution,
    nothingToMerge: false,
    recordsArchive: {
      ok: archive.ok,
      records_dir: archive.records_dir,
      copied: archive.copied,
      ...(archive.error ? { error: archive.error } : {}),
    },
    deliveryTerminal: {
      scheme: "B_MERGED_IS_TERMINAL",
      lifecycle_state: "MERGED",
      label: delivery.label,
      delivery_complete: delivery.delivery_complete,
    },
  };
}

/** 当前主干分支名（仅用于错误信息可读性） */
async function currentBranchName(repoRoot: string): Promise<string> {
  const res = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  return res.stdout.trim() || "HEAD";
}

/** 读取证据快照（供 UI/清单使用） */
/**
 * 取某合同最新一份 Evidence（控制台刷新后恢复「验收面板」用）。
 * Evidence 可以有多份（重试/恢复都会追加），按文件 mtime 取最新。
 */
export function loadLatestEvidenceSnapshot(
  repoRoot: string,
  contractId: string,
): EvidenceBundle | null {
  const dir = path.join(repoRoot, ".stagent", "evidence");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }

  const prefix = `${contractId}-`;
  const latest = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return { file, mtime: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { file: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)[0];

  if (!latest) return null;
  const raw = readStateFile<unknown>(latest.file);
  if (!raw) return null;
  try {
    return evidenceBundleSchema.parse(raw);
  } catch {
    return null;
  }
}

export function loadEvidenceSnapshot(
  repoRoot: string,
  contractId: string,
  evidenceId: string,
): EvidenceBundle | null {
  const file = path.join(
    repoRoot,
    ".stagent",
    "evidence",
    `${contractId}-${evidenceId}.json`,
  );
  const raw = readStateFile<unknown>(file);
  if (!raw) return null;
  try {
    return evidenceBundleSchema.parse(raw);
  } catch {
    return null;
  }
}
