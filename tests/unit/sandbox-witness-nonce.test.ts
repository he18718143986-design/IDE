import { describe, it, expect, beforeEach } from "vitest";
import {
  WitnessNonceStore,
  WitnessNonceError,
  normalizeWorktreePath,
  getDefaultWitnessNonceStore,
  resetDefaultWitnessNonceStore,
} from "../../daemon/pipeline/sandbox-witness-nonce";
import {
  verifySandboxWitness,
  SandboxWitnessValidationError,
  type SandboxWitness,
} from "../../daemon/worker/sandbox/container-host";
import {
  assertEvidenceControlAndRevision,
  MergeGateError,
} from "../../daemon/pipeline/merger";
import {
  evidenceBundleSchema,
  deriveCanMerge,
} from "../../src/lib/evidence.schema";

describe("TASK-P1.4: 沙箱见证 Nonce 与会话级绑定", () => {
  let store: WitnessNonceStore;

  beforeEach(() => {
    store = new WitnessNonceStore();
    resetDefaultWitnessNonceStore();
  });

  describe("WitnessNonceStore (CSPRNG 生成与绑定)", () => {
    it("生成具有 256 位熵（64 位十六进制字符）的高强度 CSPRNG Nonce", () => {
      const binding = store.generateNonce({
        contract_id: "c-100",
        contract_revision: 1,
        session_id: "s-1",
        worktree_root: "/repo/worktree",
      });

      expect(binding.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(binding.contract_id).toBe("c-100");
      expect(binding.contract_revision).toBe(1);
      expect(binding.session_id).toBe("s-1");
      expect(binding.worktree_root).toBe(
        normalizeWorktreePath("/repo/worktree"),
      );
      expect(binding.consumed).toBe(false);
    });

    it("参数非法时抛出 E_NONCE_PARAM_INVALID", () => {
      expect(() =>
        store.generateNonce({
          contract_id: "",
          contract_revision: 1,
          session_id: "s-1",
          worktree_root: "/repo",
        }),
      ).toThrow(WitnessNonceError);

      expect(() =>
        store.generateNonce({
          contract_id: "c-1",
          contract_revision: 0,
          session_id: "s-1",
          worktree_root: "/repo",
        }),
      ).toThrow(WitnessNonceError);
    });

    it("单次消费成功，重复消费（重放）立即拒绝（fail-closed）", () => {
      const binding = store.generateNonce({
        contract_id: "c-1",
        contract_revision: 2,
        session_id: "s-123",
        worktree_root: "/repo/wt",
      });

      const consumed = store.verifyAndConsume({
        nonce: binding.nonce,
        contract_id: "c-1",
        contract_revision: 2,
        session_id: "s-123",
        worktree_root: "/repo/wt",
      });
      expect(consumed.consumed).toBe(true);

      // 重放攻击 -> fail-closed
      expect(() =>
        store.verifyAndConsume({
          nonce: binding.nonce,
          contract_id: "c-1",
          contract_revision: 2,
          session_id: "s-123",
          worktree_root: "/repo/wt",
        }),
      ).toThrowError(/E_NONCE_ALREADY_CONSUMED/);
    });

    it("跨合同嫁接检测：contract_id 不匹配直接拒绝", () => {
      const binding = store.generateNonce({
        contract_id: "c-victim",
        contract_revision: 1,
        session_id: "s-1",
        worktree_root: "/repo/wt",
      });

      expect(() =>
        store.verifyAndConsume({
          nonce: binding.nonce,
          contract_id: "c-attacker",
          contract_revision: 1,
          session_id: "s-1",
          worktree_root: "/repo/wt",
        }),
      ).toThrowError(/E_NONCE_CONTRACT_MISMATCH/);
    });

    it("跨合同版本嫁接检测：contract_revision 不匹配直接拒绝", () => {
      const binding = store.generateNonce({
        contract_id: "c-1",
        contract_revision: 1,
        session_id: "s-1",
        worktree_root: "/repo/wt",
      });

      expect(() =>
        store.verifyAndConsume({
          nonce: binding.nonce,
          contract_id: "c-1",
          contract_revision: 2,
          session_id: "s-1",
          worktree_root: "/repo/wt",
        }),
      ).toThrowError(/E_NONCE_REVISION_MISMATCH/);
    });

    it("跨工作树嫁接检测：worktree_root 规范化后不匹配直接拒绝", () => {
      const binding = store.generateNonce({
        contract_id: "c-1",
        contract_revision: 1,
        session_id: "s-1",
        worktree_root: "/repo/wt-alice",
      });

      expect(() =>
        store.verifyAndConsume({
          nonce: binding.nonce,
          contract_id: "c-1",
          contract_revision: 1,
          session_id: "s-1",
          worktree_root: "/repo/wt-bob",
        }),
      ).toThrowError(/E_NONCE_WORKTREE_MISMATCH/);
    });

    it("跨会话嫁接检测：session_id 不匹配直接拒绝", () => {
      const binding = store.generateNonce({
        contract_id: "c-1",
        contract_revision: 1,
        session_id: "s-valid",
        worktree_root: "/repo/wt",
      });

      expect(() =>
        store.verifyAndConsume({
          nonce: binding.nonce,
          contract_id: "c-1",
          contract_revision: 1,
          session_id: "s-forged",
          worktree_root: "/repo/wt",
        }),
      ).toThrowError(/E_NONCE_SESSION_MISMATCH/);
    });
  });

  describe("container-host: verifySandboxWitness Nonce 扩展", () => {
    const validWitness: SandboxWitness = {
      host_kind: "docker",
      via: "exit",
      exit_code: 0,
      duration_ms: 120,
      worktree_root: "/repo/wt",
      nonce: "a".repeat(64),
      contract_id: "c-1",
      contract_revision: 1,
      session_id: "s-1",
    };

    it("合法带有 Nonce 的见证验证通过", () => {
      const res = verifySandboxWitness(validWitness, {
        expectedWorktreeRoot: "/repo/wt",
        expectedContractId: "c-1",
        expectedContractRevision: 1,
        requireNonce: true,
      });
      expect(res.nonce).toBe("a".repeat(64));
    });

    it("requireNonce 为 true 但见证缺少 Nonce 时阻断", () => {
      const witnessWithoutNonce: SandboxWitness = {
        host_kind: "docker",
        via: "exit",
        exit_code: 0,
        duration_ms: 120,
        worktree_root: "/repo/wt",
      };

      expect(() =>
        verifySandboxWitness(witnessWithoutNonce, {
          expectedWorktreeRoot: "/repo/wt",
          requireNonce: true,
        }),
      ).toThrow(SandboxWitnessValidationError);
    });

    it("合同绑定不匹配时抛出 WITNESS_CONTRACT_MISMATCH", () => {
      expect(() =>
        verifySandboxWitness(validWitness, {
          expectedWorktreeRoot: "/repo/wt",
          expectedContractId: "c-other",
        }),
      ).toThrowError(/WITNESS_CONTRACT_MISMATCH/);
    });
  });

  describe("merger: assertEvidenceControlAndRevision 防重放与绑定校验", () => {
    it("通过默认 NonceStore 消费 Nonce，并防范重放", () => {
      const store = getDefaultWitnessNonceStore();
      const binding = store.generateNonce({
        contract_id: "c-merge-1",
        contract_revision: 1,
        session_id: "sess-1",
        worktree_root: "/repo/wt",
      });

      const snapshot = {
        worker_control_mode: "SANDBOX_ENFORCED" as const,
        contract_revision: 1,
        sandbox_witness: {
          host_kind: "docker",
          via: "exit" as const,
          exit_code: 0,
          duration_ms: 50,
          worktree_root: "/repo/wt",
          nonce: binding.nonce,
          contract_id: "c-merge-1",
          contract_revision: 1,
          session_id: "sess-1",
        },
      };

      // 第一次合并消费：成功
      expect(() =>
        assertEvidenceControlAndRevision(snapshot, 1, "/repo/wt", {
          contractId: "c-merge-1",
          consumeNonce: true,
        }),
      ).not.toThrow();

      // 第二次相同证据重放合并：失败
      expect(() =>
        assertEvidenceControlAndRevision(snapshot, 1, "/repo/wt", {
          contractId: "c-merge-1",
          consumeNonce: true,
        }),
      ).toThrow(MergeGateError);
    });

    it("requireNonce 开启但见证无 Nonce 时阻断合并", () => {
      const snapshot = {
        worker_control_mode: "SANDBOX_ENFORCED" as const,
        contract_revision: 1,
        sandbox_witness: {
          host_kind: "docker",
          via: "exit" as const,
          exit_code: 0,
          duration_ms: 50,
          worktree_root: "/repo/wt",
        },
      };

      expect(() =>
        assertEvidenceControlAndRevision(snapshot, 1, "/repo/wt", {
          contractId: "c-1",
          requireNonce: true,
        }),
      ).toThrow(MergeGateError);
    });
  });

  describe("evidence.schema: 见证绑定验证与 deriveCanMerge", () => {
    it("requireWitnessNonce 为 true 且缺少 Nonce 时 deriveCanMerge 返回 false", () => {
      const canMerge = deriveCanMerge({
        status: "PASSED",
        scopePassed: true,
        budgetExhausted: false,
        forbiddenViolationCount: 0,
        manualConfirmationDeclared: false,
        workerControlMode: "SANDBOX_ENFORCED",
        contractRevision: 1,
        contractId: "c-1",
        requireWitnessNonce: true,
        sandboxWitness: {
          host_kind: "docker",
          via: "exit",
          exit_code: 0,
          duration_ms: 50,
          worktree_root: "/repo/wt",
        },
        worktreeRoot: "/repo/wt",
      });
      expect(canMerge).toBe(false);
    });

    it("附带正确 Nonce 与绑定的见证 deriveCanMerge 返回 true", () => {
      const canMerge = deriveCanMerge({
        status: "PASSED",
        scopePassed: true,
        budgetExhausted: false,
        forbiddenViolationCount: 0,
        manualConfirmationDeclared: false,
        workerControlMode: "SANDBOX_ENFORCED",
        contractRevision: 1,
        contractId: "c-1",
        requireWitnessNonce: true,
        sandboxWitness: {
          host_kind: "docker",
          via: "exit",
          exit_code: 0,
          duration_ms: 50,
          worktree_root: "/repo/wt",
          nonce: "b".repeat(64),
          contract_id: "c-1",
          contract_revision: 1,
          session_id: "s-1",
        },
        worktreeRoot: "/repo/wt",
      });
      expect(canMerge).toBe(true);
    });
  });
});
