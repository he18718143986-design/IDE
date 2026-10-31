import fs from "node:fs";
import path from "node:path";
import {
  softwareContractSchema,
  type ApprovalStatus,
  type LifecycleState,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  LIFECYCLE_TRANSITIONS,
  validateTransition,
  writeJsonAtomic,
  type ContractStatePair,
  type TransitionContext,
} from "../../src/lib/state-machine";
import {
  migrateContractToV13,
  needsV13Migration,
  type MigrationResultV13,
} from "../../src/lib/migration";

export const E_SCHEME_BINDING_IMMUTABLE = "E_SCHEME_BINDING_IMMUTABLE";

/**
 * TASK-J.18b：`scheme_binding` 写一次锁定——已落盘合同不得增删改此字段。
 * 旧直签合同（无 binding）也不得事后发明 binding。
 */
export class SchemeBindingImmutableError extends Error {
  readonly code: typeof E_SCHEME_BINDING_IMMUTABLE = E_SCHEME_BINDING_IMMUTABLE;
  constructor(message = "scheme_binding 签署后不可改，且旧直签合同不得事后写入") {
    super(`[${E_SCHEME_BINDING_IMMUTABLE}] ${message}`);
    this.name = "SchemeBindingImmutableError";
  }
}

function schemeBindingEqual(
  a: SoftwareContract["scheme_binding"],
  b: SoftwareContract["scheme_binding"],
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.confirmation_id === b.confirmation_id &&
    a.snapshot_digest === b.snapshot_digest &&
    a.plan_digest === b.plan_digest
  );
}

/**
 * 一次合同加载的结果。
 *
 * `migration` 非空表示磁盘上是 v1.2.0 存量合同，本次读取时**在内存中**
 * 迁移到了 v1.3.0（TASK-D.2b）。迁移结果不外写：读取不应产生副作用，
 * 落盘只发生在显式状态迁移时。
 */
export interface ContractLoadResult {
  contract: SoftwareContract;
  migration: MigrationResultV13 | null;
}

/**
 * 合同权威存储（Daemon 侧，规范 §1：Daemon 是合同状态唯一权威）。
 * 所有写入均经过 Schema 校验，保证 §9.1.1 双状态机不变式不被破坏。
 *
 * TASK-0.2b：
 *  - 落盘改为 `writeTemp + fsync + rename`（writeJsonAtomic），避免半截 JSON 与掉电丢更新
 *  - 状态迁移前调用 `validateTransition`（4 维：from 组合 → to 组合），
 *    拒绝非法跃迁边与「边合法但落点组合非法」的情形
 */
export class ContractStore {
  private readonly contractsDir: string;

  constructor(repoRoot: string) {
    this.contractsDir = path.join(
      path.resolve(repoRoot),
      ".stagent",
      "contracts",
    );
    fs.mkdirSync(this.contractsDir, { recursive: true });
  }

  get directory(): string {
    return this.contractsDir;
  }

  filePath(contractId: string): string {
    return path.join(this.contractsDir, `${contractId}.json`);
  }

  save(contract: SoftwareContract): SoftwareContract {
    const validated = softwareContractSchema.parse(contract);
    // TASK-J.18b：scheme_binding 写一次锁定（runtime §2「改合同本身」禁止）
    const priorBinding = this.peekSchemeBinding(validated.contract_id);
    if (priorBinding.fileExists) {
      if (!schemeBindingEqual(priorBinding.binding, validated.scheme_binding)) {
        throw new SchemeBindingImmutableError(
          priorBinding.binding === undefined
            ? "旧直签合同不得事后写入 scheme_binding"
            : "已落盘的 scheme_binding 不可改写或删除",
        );
      }
    }
    writeJsonAtomic(this.filePath(validated.contract_id), validated);
    return validated;
  }

  /**
   * 探测已落盘合同的 scheme_binding（不做完整 Schema 强制）。
   * 文件不存在 → fileExists=false；存在但无该字段 → binding=undefined。
   */
  private peekSchemeBinding(contractId: string): {
    fileExists: boolean;
    binding: SoftwareContract["scheme_binding"];
  } {
    const file = this.filePath(contractId);
    if (!fs.existsSync(file)) return { fileExists: false, binding: undefined };
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
        scheme_binding?: unknown;
      };
      const b = raw?.scheme_binding;
      if (
        b &&
        typeof b === "object" &&
        typeof (b as { confirmation_id?: unknown }).confirmation_id ===
          "string" &&
        typeof (b as { snapshot_digest?: unknown }).snapshot_digest ===
          "string" &&
        typeof (b as { plan_digest?: unknown }).plan_digest === "string"
      ) {
        return {
          fileExists: true,
          binding: {
            confirmation_id: (b as { confirmation_id: string }).confirmation_id,
            snapshot_digest: (b as { snapshot_digest: string }).snapshot_digest,
            plan_digest: (b as { plan_digest: string }).plan_digest,
          },
        };
      }
      return { fileExists: true, binding: undefined };
    } catch {
      return { fileExists: true, binding: undefined };
    }
  }

  /**
   * 读取合同并**按需内存迁移**（TASK-D.2b）。
   *
   * 为什么加载期必须迁移：`softwareContractSchema` 只认 v1.3.0，v1.2.0 存量
   * 合同直接 parse 会失败——旧写法把它当成「合同不存在」返回 null，等于让
   * 一段历史授权在系统里凭空消失。迁移在这里只做两件事：补齐 `authorization.git`
   * 与按生命周期回填审批事实；**零静默授权**由 `migrateContractToV13` 的后置
   * 断言保证（DRAFT / PENDING_APPROVAL 绝不变成 APPROVED）。
   *
   * 不写盘：读取必须无副作用；需要固化时由调用方显式 `save()`。
   */
  getWithMigration(contractId: string): ContractLoadResult | null {
    const file = this.filePath(contractId);
    if (!fs.existsSync(file)) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return null;
    }

    if (needsV13Migration(raw)) {
      const migration = migrateContractToV13(raw);
      return { contract: migration.contract, migration };
    }

    try {
      return { contract: softwareContractSchema.parse(raw), migration: null };
    } catch {
      return null;
    }
  }

  get(contractId: string): SoftwareContract | null {
    try {
      return this.getWithMigration(contractId)?.contract ?? null;
    } catch {
      // 保持既有契约：任何不可读/不可解析的合同一律按「不存在」处理。
      // 需要区分「迁移失败」与「文件损坏」的调用方走 `getWithMigration`。
      return null;
    }
  }

  list(): SoftwareContract[] {
    if (!fs.existsSync(this.contractsDir)) return [];
    const contracts: SoftwareContract[] = [];
    for (const entry of fs.readdirSync(this.contractsDir)) {
      if (!entry.endsWith(".json")) continue;
      const parsed = this.get(entry.slice(0, -".json".length));
      if (parsed) contracts.push(parsed);
    }
    return contracts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /**
   * 原子状态迁移：同时更新 lifecycle_state 与 approval.status，
   * 迁移前后均按 §9.1.1 校验（§9.1.1「避免只更新其中一个字段」）。
   *
   * 非法跃迁抛出 `IllegalContractTransitionError`，其 `code` 为
   * `E_INVALID_STATE_TRANSITION`，与编排层既有约定一致。
   */
  transition(params: {
    contractId: string;
    lifecycleState: LifecycleState;
    approvalStatus?: ApprovalStatus;
    approvedBy?: string;
    approvedAt?: string;
    approvedRevision?: number;
    rejectionReason?: string;
    /**
     * TASK-D.3：受控跃迁的上下文（如 D-3 自愈边的 `WORKTREE_MISSING_HEAL`）。
     * 缺省时不传，受控边会按 Fail-Closed 拒绝——这正是我们要的行为，
     * 不能因为"调用方忘了传"就默默放行一条本应带理由的边。
     */
    transitionContext?: TransitionContext;
  }): SoftwareContract {
    const current = this.get(params.contractId);
    if (!current) {
      throw new Error(`Contract not found: ${params.contractId}`);
    }

    const nextApprovalStatus = params.approvalStatus ?? current.approval.status;

    const from: ContractStatePair = {
      lifecycle_state: current.lifecycle_state,
      approval_status: current.approval.status,
    };
    const to: ContractStatePair = {
      lifecycle_state: params.lifecycleState,
      approval_status: nextApprovalStatus,
    };

    const verdict = validateTransition(from, to, params.transitionContext);
    if (!verdict.ok) {
      throw new IllegalContractTransitionError(
        current.lifecycle_state,
        LIFECYCLE_TRANSITIONS[current.lifecycle_state],
        `${params.lifecycleState} (${verdict.message})`,
      );
    }

    const approval = {
      ...current.approval,
      status: nextApprovalStatus,
      ...(params.approvedBy === undefined
        ? {}
        : { approved_by: params.approvedBy }),
      ...(params.approvedAt === undefined
        ? {}
        : { approved_at: params.approvedAt }),
      // 审批版本绑定：记录被批准时的 contract_revision（防 TOCTOU）
      ...(params.approvedRevision === undefined
        ? {}
        : { approved_revision: params.approvedRevision }),
      ...(params.rejectionReason === undefined
        ? {}
        : { rejection_reason: params.rejectionReason }),
    };

    return this.save({
      ...current,
      lifecycle_state: params.lifecycleState,
      approval,
    });
  }
}

export const E_INVALID_STATE_TRANSITION = "E_INVALID_STATE_TRANSITION";

/**
 * 合同状态跃迁非法。
 * 与 `daemon/core/contract-mutex.ts` 的同名语义错误保持相同 `code`，
 * 使上层统一按 `err.code` 判定，而不必区分抛错模块。
 */
export class IllegalContractTransitionError extends Error {
  readonly code = E_INVALID_STATE_TRANSITION;
  readonly current: string;
  readonly expected: readonly string[];

  constructor(current: string, expected: readonly string[], detail: string) {
    super(
      `[${E_INVALID_STATE_TRANSITION}] Illegal transition from ${current}: ${detail}`,
    );
    this.name = "IllegalContractTransitionError";
    this.current = current;
    this.expected = expected;
  }
}
