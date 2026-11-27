/**
 * TASK-P1.4: 沙箱见证 Nonce 与会话级绑定模块。
 *
 * 核心安全边界与规范约束（红线）：
 * 1. CSPRNG 随机 Nonce：必须基于 node:crypto (如 randomBytes 或 randomUUID)，禁用 Math.random；
 * 2. 上下文绑定：将 Nonce 强绑定至 contract_id、contract_revision、session_id、规范化 worktree_root；
 * 3. 单次原子消费与防重放：已消费 Nonce 再次使用直接拒绝（fail-closed）；
 * 4. 诚实边界记录（Honest Boundary）：当前 NonceStore 为进程内内存态管理；daemon 重启后的跨进程防重放
 *    属于当前架构挂账项，本卡不宣称覆盖跨进程重启防重放。
 */

import crypto from "node:crypto";
import path from "node:path";

export interface WitnessNonceBinding {
  readonly nonce: string;
  readonly contract_id: string;
  readonly contract_revision: number;
  readonly session_id: string;
  readonly worktree_root: string;
  readonly created_at: string;
  consumed: boolean;
  consumed_at?: string;
}

export class WitnessNonceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "WitnessNonceError";
    this.code = code;
  }
}

export function normalizeWorktreePath(p: string): string {
  const resolved = path
    .resolve(p)
    .replace(/[\\/]+/g, "/")
    .replace(/\/$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export class WitnessNonceStore {
  private readonly nonces = new Map<string, WitnessNonceBinding>();

  /**
   * 生成并登记一个新的可信 CSPRNG 随机 Nonce
   */
  public generateNonce(params: {
    contract_id: string;
    contract_revision: number;
    session_id: string;
    worktree_root: string;
  }): WitnessNonceBinding {
    if (!params.contract_id || params.contract_id.trim() === "") {
      throw new WitnessNonceError(
        "E_NONCE_PARAM_INVALID",
        "contract_id 不能为空",
      );
    }
    if (
      typeof params.contract_revision !== "number" ||
      params.contract_revision < 1
    ) {
      throw new WitnessNonceError(
        "E_NONCE_PARAM_INVALID",
        "contract_revision 必须为正整数",
      );
    }
    if (!params.session_id || params.session_id.trim() === "") {
      throw new WitnessNonceError(
        "E_NONCE_PARAM_INVALID",
        "session_id 不能为空",
      );
    }
    if (!params.worktree_root || params.worktree_root.trim() === "") {
      throw new WitnessNonceError(
        "E_NONCE_PARAM_INVALID",
        "worktree_root 不能为空",
      );
    }

    // 强制 CSPRNG 随机性（256-bit entropy）
    const nonce = crypto.randomBytes(32).toString("hex");

    const binding: WitnessNonceBinding = {
      nonce,
      contract_id: params.contract_id,
      contract_revision: params.contract_revision,
      session_id: params.session_id,
      worktree_root: normalizeWorktreePath(params.worktree_root),
      created_at: new Date().toISOString(),
      consumed: false,
    };

    this.nonces.set(nonce, binding);
    return binding;
  }

  /**
   * 核验并原子消费 Nonce（单次使用，重放即拒）
   */
  public verifyAndConsume(params: {
    nonce: string | undefined | null;
    contract_id: string;
    contract_revision: number;
    worktree_root: string;
    session_id?: string | undefined;
  }): WitnessNonceBinding {
    if (
      !params.nonce ||
      typeof params.nonce !== "string" ||
      params.nonce.trim() === ""
    ) {
      throw new WitnessNonceError("E_NONCE_MISSING", "沙箱见证缺少 Nonce");
    }

    const binding = this.nonces.get(params.nonce);
    if (!binding) {
      throw new WitnessNonceError(
        "E_NONCE_NOT_FOUND",
        `未知或未登记的沙箱见证 Nonce: ${params.nonce}`,
      );
    }

    if (binding.consumed) {
      throw new WitnessNonceError(
        "E_NONCE_ALREADY_CONSUMED",
        `沙箱见证 Nonce 已被消费，拒绝重复使用/重放攻击: ${params.nonce}`,
      );
    }

    if (binding.contract_id !== params.contract_id) {
      throw new WitnessNonceError(
        "E_NONCE_CONTRACT_MISMATCH",
        `Nonce 合同绑定错配: 预期 ${params.contract_id}, 实际为 ${binding.contract_id}`,
      );
    }

    if (binding.contract_revision !== params.contract_revision) {
      throw new WitnessNonceError(
        "E_NONCE_REVISION_MISMATCH",
        `Nonce 合同版本绑定错配: 预期 ${params.contract_revision}, 实际为 ${binding.contract_revision}`,
      );
    }

    if (
      params.session_id !== undefined &&
      binding.session_id !== params.session_id
    ) {
      throw new WitnessNonceError(
        "E_NONCE_SESSION_MISMATCH",
        `Nonce 会话绑定错配: 预期 ${params.session_id}, 实际为 ${binding.session_id}`,
      );
    }

    const normWorktree = normalizeWorktreePath(params.worktree_root);
    if (binding.worktree_root !== normWorktree) {
      throw new WitnessNonceError(
        "E_NONCE_WORKTREE_MISMATCH",
        `Nonce 工作树路径错配: 预期 ${normWorktree}, 实际为 ${binding.worktree_root}`,
      );
    }

    // 原子标记已消费
    binding.consumed = true;
    binding.consumed_at = new Date().toISOString();
    return binding;
  }

  public peek(nonce: string): WitnessNonceBinding | undefined {
    return this.nonces.get(nonce);
  }

  public clear(): void {
    this.nonces.clear();
  }
}

let defaultStore: WitnessNonceStore | null = null;

export function getDefaultWitnessNonceStore(): WitnessNonceStore {
  if (!defaultStore) {
    defaultStore = new WitnessNonceStore();
  }
  return defaultStore;
}

export function resetDefaultWitnessNonceStore(): void {
  defaultStore = new WitnessNonceStore();
}
