import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  E_EVIDENCE_REVISION_MISMATCH,
  MergeGateError,
  assertEvidenceControlAndRevision,
  squashMerge,
} from "../../daemon/pipeline/merger";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import {
  deriveCanMerge,
  evidenceBundleSchema,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";

/**
 * TASK-P0.1 Evidence / Merge Fail-Closed。
 *
 * 双重封锁：
 * - 第一道（生成时）：deriveCanMerge 对控制模式缺失 / 不受控、合同版本缺失一律 false；
 * - 第二道（合并时）：squashMerge 读真实 Evidence Snapshot 独立重核，不信任快照里的 can_merge。
 *
 * 负向用例直接篡改磁盘上的证据快照，构造「PASSED + can_merge=true」的异常证据，
 * 证明它绕不过 merger。
 */

const PASSING_GATES = {
  status: "PASSED",
  scopePassed: true,
  budgetExhausted: false,
  forbiddenViolationCount: 0,
} as const;

describe("TASK-P0.1 第一道封锁：deriveCanMerge（生成时）", () => {
  it("P01-P1：UNCONTROLLED_EXTERNAL 与控制模式缺失均 can_merge=false", () => {
    expect(
      deriveCanMerge({
        ...PASSING_GATES,
        workerControlMode: "UNCONTROLLED_EXTERNAL",
        contractRevision: 1,
      }),
    ).toBe(false);
    expect(deriveCanMerge({ ...PASSING_GATES, contractRevision: 1 })).toBe(
      false,
    );
  });

  it("P01-P2：GATEWAY_ENFORCED / SANDBOX_ENFORCED 进入正常验收逻辑", () => {
    expect(
      deriveCanMerge({
        ...PASSING_GATES,
        workerControlMode: "GATEWAY_ENFORCED",
        contractRevision: 1,
      }),
    ).toBe(true);
    expect(
      deriveCanMerge({
        ...PASSING_GATES,
        workerControlMode: "SANDBOX_ENFORCED",
        contractRevision: 1,
      }),
    ).toBe(true);
  });

  it("P01-P3：合同版本缺失时 can_merge=false", () => {
    expect(
      deriveCanMerge({
        ...PASSING_GATES,
        workerControlMode: "GATEWAY_ENFORCED",
      }),
    ).toBe(false);
  });
});

describe("TASK-P0.1 第二道封锁：assertEvidenceControlAndRevision（合并时，纯函数）", () => {
  const expectCode = (fn: () => void, code: string) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(MergeGateError);
      expect((err as MergeGateError).code).toBe(code);
      return;
    }
    throw new Error(`expected MergeGateError ${code}`);
  };

  it("P01-P5：控制模式缺失 / UNCONTROLLED_EXTERNAL / 未知值 → E_CANNOT_MERGE", () => {
    expectCode(
      () => assertEvidenceControlAndRevision({ contract_revision: 1 }, 1),
      "E_CANNOT_MERGE",
    );
    expectCode(
      () =>
        assertEvidenceControlAndRevision(
          {
            worker_control_mode: "UNCONTROLLED_EXTERNAL",
            contract_revision: 1,
          },
          1,
        ),
      "E_CANNOT_MERGE",
    );
    expectCode(
      () =>
        assertEvidenceControlAndRevision(
          {
            worker_control_mode:
              "SOMETHING_ELSE" as unknown as "GATEWAY_ENFORCED",
            contract_revision: 1,
          },
          1,
        ),
      "E_CANNOT_MERGE",
    );
  });

  it("P01-P5：contract_revision 缺失或不符 → E_EVIDENCE_REVISION_MISMATCH", () => {
    expectCode(
      () =>
        assertEvidenceControlAndRevision(
          { worker_control_mode: "GATEWAY_ENFORCED" },
          2,
        ),
      E_EVIDENCE_REVISION_MISMATCH,
    );
    expectCode(
      () =>
        assertEvidenceControlAndRevision(
          { worker_control_mode: "GATEWAY_ENFORCED", contract_revision: 1 },
          2,
        ),
      E_EVIDENCE_REVISION_MISMATCH,
    );
  });

  it("受控档位且版本一致时放行（不抛）", () => {
    expect(() =>
      assertEvidenceControlAndRevision(
        { worker_control_mode: "GATEWAY_ENFORCED", contract_revision: 2 },
        2,
      ),
    ).not.toThrow();
    expect(() =>
      assertEvidenceControlAndRevision(
        { worker_control_mode: "SANDBOX_ENFORCED", contract_revision: 2 },
        2,
      ),
    ).not.toThrow();
  });
});

describe("TASK-P0.1 端到端：真实证据快照 + squashMerge", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  const makeContract = (title: string) => {
    const draft = createContractDraft({
      title,
      description: "p0-1 merge fail-closed",
      acceptanceCriteria: ["pass"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", "process.exit(0)"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
  };

  const worktreeOf = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  const evidencePathOf = (contractId: string, evidenceId: string) =>
    path.join(repo, ".stagent", "evidence", `${contractId}-${evidenceId}.json`);

  /** 走真实 approve → execute，得到 AUDITED 合同与磁盘上的证据快照 */
  const audited = async (title: string) => {
    const contract = makeContract(title);
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = worktreeOf(contract.contract_id);
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "src", "b.ts"),
      "export const b = 2;\n",
    );
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    return { contract: outcome.contract, evidence: outcome.evidence };
  };

  /** 直接改写磁盘证据快照（模拟伪造 / 旧证据），保持 Schema 合法 */
  const rewriteSnapshot = (
    contractId: string,
    evidence: EvidenceBundle,
    mutate: (raw: Record<string, unknown>) => void,
  ) => {
    const p = evidencePathOf(contractId, evidence.evidence_id);
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      unknown
    >;
    mutate(raw);
    // 伪造者总会把结论写成「可合并」
    raw["verdict"] = {
      ...(raw["verdict"] as Record<string, unknown>),
      status: "PASSED",
      can_merge: true,
    };
    expect(evidenceBundleSchema.safeParse(raw).success).toBe(true);
    fs.writeFileSync(p, JSON.stringify(raw, null, 2));
  };

  const expectMergeRejected = async (
    contractId: string,
    evidence: EvidenceBundle,
    code: string,
  ) => {
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();
    await expect(
      squashMerge({ repoRoot: repo, contractId, evidence, reviewer: "tina" }),
    ).rejects.toMatchObject({ name: "MergeGateError", code });
    // 失败关闭：主干未动、合同未进入 MERGED
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(store.get(contractId)?.lifecycle_state).toBe("AUDITED");
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-p01-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    safeRmSync(repo);
  });

  it("P01-P4：新证据写入合同版本与受控档位，can_merge 由二者参与派生", async () => {
    const { contract, evidence } = await audited("fresh evidence");
    expect(evidence.contract_revision).toBe(contract.contract_revision);
    expect(evidence.worker_control_mode).toBe("GATEWAY_ENFORCED");
    expect(evidence.verdict.can_merge).toBe(true);
    const onDisk = evidenceBundleSchema.parse(
      JSON.parse(
        fs.readFileSync(
          evidencePathOf(contract.contract_id, evidence.evidence_id),
          "utf-8",
        ),
      ),
    );
    expect(onDisk.contract_revision).toBe(contract.contract_revision);
  });

  it("P01-P6：构造 UNCONTROLLED_EXTERNAL + PASSED + can_merge=true 的异常证据，绕不过 merger", async () => {
    const { contract, evidence } = await audited("forged uncontrolled");
    rewriteSnapshot(contract.contract_id, evidence, (raw) => {
      raw["worker_control_mode"] = "UNCONTROLLED_EXTERNAL";
    });
    await expectMergeRejected(contract.contract_id, evidence, "E_CANNOT_MERGE");
  });

  it("P01-P6：控制模式缺失的证据（PASSED + can_merge=true）不可合并", async () => {
    const { contract, evidence } = await audited("missing control mode");
    rewriteSnapshot(contract.contract_id, evidence, (raw) => {
      delete raw["worker_control_mode"];
    });
    await expectMergeRejected(contract.contract_id, evidence, "E_CANNOT_MERGE");
  });

  it("P01-P7：旧证据缺 contract_revision——可读、不可合并", async () => {
    const { contract, evidence } = await audited("legacy no revision");
    rewriteSnapshot(contract.contract_id, evidence, (raw) => {
      delete raw["contract_revision"];
    });
    // 可读可展示：Schema 照常解析
    const p = evidencePathOf(contract.contract_id, evidence.evidence_id);
    expect(
      evidenceBundleSchema.safeParse(JSON.parse(fs.readFileSync(p, "utf-8")))
        .success,
    ).toBe(true);
    await expectMergeRejected(
      contract.contract_id,
      evidence,
      E_EVIDENCE_REVISION_MISMATCH,
    );
  });

  it("P01-P7：contract_revision 与当前合同版本不符——合并时重新比对拒绝", async () => {
    const { contract, evidence } = await audited("revision mismatch");
    rewriteSnapshot(contract.contract_id, evidence, (raw) => {
      raw["contract_revision"] = contract.contract_revision + 1;
    });
    await expectMergeRejected(
      contract.contract_id,
      evidence,
      E_EVIDENCE_REVISION_MISMATCH,
    );
  });

  it("候选提交绑定：Worktree detach 后任务分支被移走（指纹仍一致），合并被拒", async () => {
    const { contract, evidence } = await audited("candidate moved");
    const worktree = worktreeOf(contract.contract_id);
    const branch = contract.authorization.git.task_branch;
    const tip = git(repo, ["rev-parse", `refs/heads/${branch}`]).trim();
    expect(tip).toBe(evidence.worktree_snapshot.head_sha);

    // Worktree HEAD 停在原提交（detach 不改 HEAD SHA 与工作区，指纹不变）
    git(worktree, ["checkout", "-q", "--detach"]);

    // 在主仓库为任务分支另造一个带额外文件的提交，并把分支 ref 移过去
    const tmpIndex = path.join(repo, ".git", "p01-tmp-index");
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    const run = (args: string[], input?: string) =>
      execFileSync("git", args, {
        cwd: repo,
        env,
        encoding: "utf8",
        input,
      }).trim();
    run(["read-tree", tip]);
    const blob = run(["hash-object", "-w", "--stdin"], "sneaky\n");
    run([
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},src/sneaky.ts`,
    ]);
    const tree = run(["write-tree"]);
    const sneaky = run(["commit-tree", tree, "-p", tip, "-m", "sneaky"]);
    fs.rmSync(tmpIndex, { force: true });
    git(repo, ["update-ref", `refs/heads/${branch}`, sneaky]);

    await expectMergeRejected(
      contract.contract_id,
      evidence,
      "E_EVIDENCE_STALE",
    );
    expect(fs.existsSync(path.join(repo, "src", "sneaky.ts"))).toBe(false);
  });

  it("P01-P8：受控证据（GATEWAY_ENFORCED + 版本齐全）合并路径零回归", async () => {
    const { contract, evidence } = await audited("controlled happy");
    const result = await squashMerge({
      repoRoot: repo,
      contractId: contract.contract_id,
      evidence,
      reviewer: "tina",
    });
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(result.contract.lifecycle_state).toBe("MERGED");
    expect(fs.existsSync(path.join(repo, "src", "b.ts"))).toBe(true);
  });
});
